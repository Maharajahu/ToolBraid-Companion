import { randomBytes } from 'node:crypto';
import { link, lstat, mkdir, open, realpath, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { LocalBridgeError } from './common.mjs';

const ROOT_TTL_MS = 60 * 60_000;
const HANDLE_TTL_MS = 10 * 60_000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_READ_CHUNK_BYTES = 256 * 1024;
const MAX_WRITE_BYTES = 512 * 1024;
const MAX_LIST_COUNT = 100;
const MAX_LIST_DEPTH = 3;

function fail(code, message) { throw new LocalBridgeError(code, message); }
function owner(value) { if (typeof value !== 'string' || value.length < 16 || value.length > 128) fail('FILES_OWNER_INVALID', 'An internal filesystem owner is required.'); return value; }
function token() { return randomBytes(32).toString('hex'); }
function relative(value = '') {
  if (typeof value !== 'string' || value.length > 2048 || value.includes('\0') || path.isAbsolute(value)) fail('FILES_RELATIVE_PATH_INVALID', 'A bounded relative path is required.');
  const normalized = path.normalize(value || '.');
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) fail('FILES_SCOPE_ESCAPE', 'The requested path leaves the granted root.');
  return normalized;
}
function contained(root, candidate) { const rel = path.relative(root, candidate); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); }
async function rejectLinks(root, candidate, { allowMissingLeaf = false } = {}) {
  if (!contained(root, candidate)) fail('FILES_SCOPE_ESCAPE', 'The requested path leaves the granted root.');
  const rel = path.relative(root, candidate); let current = root;
  for (const [index, part] of rel.split(path.sep).filter(Boolean).entries()) {
    current = path.join(current, part);
    let details;
    try { details = await lstat(current); } catch (error) {
      if (allowMissingLeaf && error?.code === 'ENOENT') return;
      fail('FILES_PATH_UNAVAILABLE', 'The requested scoped path is unavailable.');
    }
    if (details.isSymbolicLink()) fail('FILES_REPARSE_REJECTED', 'Symbolic links and junctions are not allowed in scoped paths.');
  }
  let resolved;
  try { resolved = await realpath(candidate); } catch (error) { if (allowMissingLeaf && error?.code === 'ENOENT') return; throw error; }
  if (!contained(root, resolved)) fail('FILES_SCOPE_ESCAPE', 'The resolved path leaves the granted root.');
}

export function selectFolderWithWindowsDialog() {
  if (process.platform !== 'win32') fail('FILES_SELECTOR_UNAVAILABLE', 'The folder selector is available only on Windows.');
  const script = ['Add-Type -AssemblyName System.Windows.Forms','$d=New-Object System.Windows.Forms.FolderBrowserDialog',"if($d.ShowDialog() -eq 'OK'){[Console]::Out.Write($d.SelectedPath)}"].join(';');
  return new Promise((resolve, reject) => { const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-STA','-Command',script],{windowsHide:true,stdio:['ignore','pipe','ignore']});const chunks=[];child.stdout.on('data',c=>chunks.push(c));child.once('error',()=>reject(new LocalBridgeError('FILES_SELECTOR_FAILED','The folder selector failed.')));child.once('close',code=>code===0?resolve(Buffer.concat(chunks).toString('utf8').trim()||null):reject(new LocalBridgeError('FILES_SELECTOR_FAILED','The folder selector failed.'))); });
}

export class ScopedFilesystem {
  #roots = new Map(); #handles = new Map(); #select; #now;
  constructor({ selectFolder = selectFolderWithWindowsDialog, now = Date.now } = {}) { this.#select=selectFolder; this.#now=now; }
  #prune(){for(const [id,r] of this.#roots)if(r.expiresAt<=this.#now())this.#roots.delete(id);for(const [id,h] of this.#handles)if(h.expiresAt<=this.#now()||!this.#roots.has(h.rootId))this.#handles.delete(id);}
  async grantRoot(ownerId){const own=owner(ownerId);const selected=await this.#select();if(!selected)fail('FILES_SELECTION_CANCELLED','No folder was selected.');const root=await realpath(selected);const details=await lstat(root);if(!details.isDirectory()||details.isSymbolicLink())fail('FILES_ROOT_INVALID','The selected root must be a real directory.');const rootId=token();this.#roots.set(rootId,{ownerId:own,path:root,expiresAt:this.#now()+ROOT_TTL_MS});return Object.freeze({rootId,expiresAt:this.#now()+ROOT_TTL_MS});}
  revokeRoot(rootId,ownerId){const r=this.#roots.get(rootId);if(!r||r.ownerId!==owner(ownerId))return Object.freeze({revoked:false});this.#roots.delete(rootId);for(const [id,h]of this.#handles)if(h.rootId===rootId)this.#handles.delete(id);return Object.freeze({revoked:true});}
  #root(rootId,ownerId){this.#prune();const r=this.#roots.get(rootId);if(!r||r.ownerId!==owner(ownerId))fail('FILES_ROOT_NOT_FOUND','The scoped root grant is missing or expired.');return r;}
  #bind(rootId,ownerId,filePath,details){const handle=token();this.#handles.set(handle,{rootId,ownerId,path:filePath,identity:{dev:details.dev,ino:details.ino,size:details.size,mtimeMs:details.mtimeMs},expiresAt:this.#now()+HANDLE_TTL_MS});return handle;}
  async #file(handle,ownerId){this.#prune();const h=this.#handles.get(handle);if(!h||h.ownerId!==owner(ownerId))fail('FILES_HANDLE_NOT_FOUND','The file handle is missing or expired.');const r=this.#root(h.rootId,ownerId);await rejectLinks(r.path,h.path);const d=await stat(h.path);if(!d.isFile()||d.dev!==h.identity.dev||d.ino!==h.identity.ino||d.size!==h.identity.size||d.mtimeMs!==h.identity.mtimeMs)fail('FILES_IDENTITY_CHANGED','The scoped file changed after it was listed.');return {h,r,d};}
  async list({rootId,relativePath='',depth=1,count=MAX_LIST_COUNT}={},ownerId){if(!Number.isInteger(depth)||depth<1||depth>MAX_LIST_DEPTH||!Number.isInteger(count)||count<1||count>MAX_LIST_COUNT)fail('FILES_LIMIT_INVALID','List depth must be 1-3 and count 1-100.');const r=this.#root(rootId,ownerId);const start=path.resolve(r.path,relative(relativePath));await rejectLinks(r.path,start);const sd=await stat(start);if(!sd.isDirectory())fail('FILES_NOT_DIRECTORY','The scoped target is not a directory.');const entries=[];const walk=async(dir,level)=>{const names=(await import('node:fs/promises')).readdir(dir,{withFileTypes:true});for(const e of await names){if(entries.length>=count)return;const p=path.join(dir,e.name);const ls=await lstat(p);if(ls.isSymbolicLink())continue;if(e.isFile()){entries.push(Object.freeze({handle:this.#bind(rootId,ownerId,p,ls),name:e.name,size:ls.size}));}else if(e.isDirectory()&&level<depth)await walk(p,level+1);}};await walk(start,1);return Object.freeze({entries:Object.freeze(entries),truncated:entries.length>=count});}
  async read({handle,offset=0,maxBytes=MAX_READ_CHUNK_BYTES}={},ownerId){if(!Number.isInteger(offset)||offset<0||offset>MAX_FILE_BYTES||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>MAX_READ_CHUNK_BYTES)fail('FILES_LIMIT_INVALID','offset must be 0-1048576 and maxBytes 1-262144.');const {h,d}=await this.#file(handle,ownerId);if(d.size>MAX_FILE_BYTES)fail('FILES_BYTES_EXCEEDED','The file exceeds the 1048576-byte scoped read limit.');if(offset>d.size)fail('FILES_OFFSET_INVALID','The read offset is beyond the end of the file.');const length=Math.min(maxBytes,d.size-offset),data=Buffer.alloc(length);let fh;try{fh=await open(h.path,'r');const live=await fh.stat();if(!live.isFile()||live.dev!==h.identity.dev||live.ino!==h.identity.ino||live.size!==h.identity.size||live.mtimeMs!==h.identity.mtimeMs)fail('FILES_IDENTITY_CHANGED','The scoped file changed after it was listed.');if(length)await fh.read(data,0,length,offset);}finally{await fh?.close().catch(()=>{});}return Object.freeze({content:data.toString('base64'),encoding:'base64',offset,size:data.length,totalSize:d.size,eof:offset+data.length>=d.size});}
  async write({rootId,relativePath,content,encoding='utf8',overwrite=false}={},ownerId){if(overwrite!==false)fail('FILES_OVERWRITE_REJECTED','Blind overwrite is not allowed.');const r=this.#root(rootId,ownerId);const target=path.resolve(r.path,relative(relativePath));await rejectLinks(r.path,target,{allowMissingLeaf:true});const data=encoding==='base64'?Buffer.from(String(content??''),'base64'):Buffer.from(String(content??''),'utf8');if(data.length>MAX_WRITE_BYTES)fail('FILES_BYTES_EXCEEDED','Write content exceeds 524288 bytes.');await mkdir(path.dirname(target),{recursive:true});await rejectLinks(r.path,path.dirname(target));const temp=path.join(path.dirname(target),`.toolbraid-${token()}.tmp`);let fh;try{fh=await open(temp,'wx');await fh.writeFile(data);await fh.sync();await fh.close();fh=null;try{await link(temp,target);}catch(e){if(e.code==='EEXIST')fail('FILES_EXISTS','The destination already exists.');throw e;}}finally{await fh?.close().catch(()=>{});await (await import('node:fs/promises')).rm(temp,{force:true}).catch(()=>{});}const d=await stat(target);return Object.freeze({handle:this.#bind(rootId,ownerId,target,d),name:path.basename(target),size:d.size});}
  async move({handle,destinationRelative,overwrite=false}={},ownerId){
    if(overwrite!==false)fail('FILES_OVERWRITE_REJECTED','Blind overwrite is not allowed.');
    const {h,r}=await this.#file(handle,ownerId);
    const dest=path.resolve(r.path,relative(destinationRelative));
    await rejectLinks(r.path,dest,{allowMissingLeaf:true});
    await mkdir(path.dirname(dest),{recursive:true});
    await rejectLinks(r.path,path.dirname(dest));
    // Exclusive creation prevents a destination appearing between check and move
    // from being overwritten. If unlink fails, both copies remain recoverable.
    try{await link(h.path,dest);}catch(error){if(error?.code==='EEXIST')fail('FILES_EXISTS','The destination already exists.');throw error;}
    await unlink(h.path);
    this.#handles.delete(handle);
    const d=await stat(dest);
    return Object.freeze({handle:this.#bind(h.rootId,ownerId,dest,d),name:path.basename(dest),size:d.size});
  }
  async archive({handle}={},ownerId){const {h,r}=await this.#file(handle,ownerId);const dir=path.join(r.path,'.toolbraid-archive');await mkdir(dir,{recursive:true});await rejectLinks(r.path,dir);const dest=path.join(dir,`${token()}-${path.basename(h.path)}`);await rename(h.path,dest);this.#handles.delete(handle);const d=await stat(dest);return Object.freeze({archived:true,handle:this.#bind(h.rootId,ownerId,dest,d),name:path.basename(h.path),size:d.size});}
  async call(method,params,ownerId){try{if(method==='files.root.create')return await this.grantRoot(ownerId);if(method==='files.root.revoke')return this.revokeRoot(params.rootId,ownerId);if(method==='files.list')return await this.list(params,ownerId);if(method==='files.read')return await this.read(params,ownerId);if(method==='files.write')return await this.write(params,ownerId);if(method==='files.move')return await this.move(params,ownerId);if(method==='files.archive')return await this.archive(params,ownerId);fail('BRIDGE_METHOD_UNSUPPORTED','The scoped filesystem method is unsupported.');}catch(error){if(error instanceof LocalBridgeError)throw error;fail('FILES_OPERATION_FAILED','The scoped filesystem operation failed.');}}
}
