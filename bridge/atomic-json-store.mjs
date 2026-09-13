import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { LocalBridgeError } from './common.mjs';

const MAX_STORE_BYTES = 2 * 1024 * 1024;
const SAFE_KEY = /^[A-Za-z0-9_.:-]{1,128}$/;

function clone(value) { return value === undefined ? undefined : structuredClone(value); }

export class AtomicJsonStore {
  #file; #tail = Promise.resolve();
  constructor({ filePath, maxBytes = MAX_STORE_BYTES } = {}) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || filePath.length > 4096 || filePath.includes('\0')) throw new TypeError('A bounded absolute store filePath is required.');
    if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 16 * 1024 * 1024) throw new RangeError('maxBytes is outside the allowed range.');
    this.#file = path.resolve(filePath); this.maxBytes = maxBytes;
  }
  async #document() {
    try { const info=await stat(this.#file);if(info.size>this.maxBytes)throw new RangeError('Atomic store exceeds its byte limit.');const parsed=JSON.parse(await readFile(this.#file,'utf8'));if(!parsed||parsed.version!==1||!parsed.values||typeof parsed.values!=='object'||Array.isArray(parsed.values))throw new TypeError('Atomic store document is invalid.');return parsed; }
    catch(error){if(error?.code==='ENOENT')return {version:1,values:{}};if(error instanceof RangeError||error instanceof TypeError||error instanceof LocalBridgeError)throw error;throw new LocalBridgeError('ATOMIC_STORE_UNAVAILABLE','The local atomic state store is unavailable.');}
  }
  async read(key) { if(!SAFE_KEY.test(key??''))throw new TypeError('Store key is invalid.');await this.#tail;return clone((await this.#document()).values[key]); }
  async write(key,value) {
    if(!SAFE_KEY.test(key??''))throw new TypeError('Store key is invalid.');
    const operation=this.#tail.then(async()=>{try{const document=await this.#document();if(value===undefined)delete document.values[key];else document.values[key]=clone(value);const bytes=Buffer.from(`${JSON.stringify(document)}\n`);if(bytes.length>this.maxBytes)throw new RangeError('Atomic store write exceeds its byte limit.');await mkdir(path.dirname(this.#file),{recursive:true});const temporary=`${this.#file}.${process.pid}.${Date.now()}.tmp`;let handle;try{handle=await open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await rename(temporary,this.#file);let directory;try{directory=await open(path.dirname(this.#file),'r');await directory.sync();}catch{/* directory fsync is unavailable on some Windows runtimes */}finally{await directory?.close().catch(()=>{});}}finally{await handle?.close().catch(()=>{});await rm(temporary,{force:true}).catch(()=>{});}}catch(error){if(error instanceof RangeError||error instanceof TypeError||error instanceof LocalBridgeError)throw error;throw new LocalBridgeError('ATOMIC_STORE_UNAVAILABLE','The local atomic state store is unavailable.');}});
    this.#tail=operation.catch(()=>{});return operation;
  }
  publicInfo(){return Object.freeze({version:1,maxBytes:this.maxBytes});}
}

export function createAtomicJsonStore(options){return new AtomicJsonStore(options);}
