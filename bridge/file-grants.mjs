import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { realpath as nodeRealpath, stat as nodeStat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { LocalBridgeError } from './common.mjs';

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MIME_BY_EXTENSION = Object.freeze({
  '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.m4a': 'audio/mp4',
  '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.png': 'image/png',
  '.txt': 'text/plain', '.webm': 'video/webm', '.webp': 'image/webp',
});

function grantError(code, message) {
  return new LocalBridgeError(code, message);
}

function requireOwnerId(ownerId) {
  if (typeof ownerId !== 'string' || ownerId.length < 16 || ownerId.length > 128) {
    throw grantError('FILE_GRANT_OWNER_INVALID', 'An internal file-grant owner is required.');
  }
  return ownerId;
}

export function selectFileWithWindowsDialog() {
  if (process.platform !== 'win32') throw grantError('FILE_SELECTOR_UNAVAILABLE', 'The local file selector is available only on Windows.');
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    '$dialog.Multiselect = $false',
    '$dialog.CheckFileExists = $true',
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }",
  ].join('; ');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', script], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.once('error', () => reject(grantError('FILE_SELECTOR_FAILED', 'The local file selector could not be opened.')));
    child.once('close', (code) => {
      if (code !== 0) return reject(grantError('FILE_SELECTOR_FAILED', 'The local file selector failed.'));
      const selected = Buffer.concat(chunks).toString('utf8').trim();
      resolve(selected || null);
    });
  });
}

export class FileGrantStore {
  #grants = new Map();
  #selectFile;
  #realpath;
  #stat;
  #now;
  #randomBytes;
  #ttlMs;

  constructor({
    selectFile = selectFileWithWindowsDialog,
    realpath = nodeRealpath,
    stat = nodeStat,
    now = Date.now,
    randomBytes = nodeRandomBytes,
    ttlMs = DEFAULT_TTL_MS,
  } = {}) {
    this.#selectFile = selectFile;
    this.#realpath = realpath;
    this.#stat = stat;
    this.#now = now;
    this.#randomBytes = randomBytes;
    this.#ttlMs = ttlMs;
  }

  async create(ownerId) {
    const owner = requireOwnerId(ownerId);
    let selected;
    try { selected = await this.#selectFile(); } catch (error) {
      if (error instanceof LocalBridgeError) throw error;
      throw grantError('FILE_SELECTOR_FAILED', 'The local file selector failed.');
    }
    if (!selected) throw grantError('FILE_SELECTION_CANCELLED', 'No local file was selected.');
    let resolved;
    let details;
    try {
      resolved = await this.#realpath(selected);
      details = await this.#stat(resolved);
    } catch {
      throw grantError('FILE_GRANT_UNAVAILABLE', 'The selected file is unavailable.');
    }
    if (!details.isFile()) throw grantError('FILE_GRANT_NOT_FILE', 'The selected item is not a file.');
    let grantId;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = this.#randomBytes(32).toString('hex');
      if (/^[a-f0-9]{64}$/.test(candidate) && !this.#grants.has(candidate)) { grantId = candidate; break; }
    }
    if (!grantId) throw grantError('FILE_GRANT_ID_FAILED', 'A unique file grant could not be created.');
    const expiresAt = this.#now() + this.#ttlMs;
    const record = Object.freeze({
      ownerId: owner,
      path: resolved,
      basename: path.basename(resolved),
      size: details.size,
      mime: MIME_BY_EXTENSION[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream',
      expiresAt,
      identity: Object.freeze({ dev: details.dev, ino: details.ino, size: details.size, mtimeMs: details.mtimeMs }),
    });
    this.#grants.set(grantId, record);
    return Object.freeze({ grantId, basename: record.basename, size: record.size, mime: record.mime, expiresAt });
  }

  async createFromPath(filePath, ownerId) {
    const owner = requireOwnerId(ownerId);
    let resolved; let details;
    try { resolved = await this.#realpath(filePath); details = await this.#stat(resolved); } catch { throw grantError('FILE_GRANT_UNAVAILABLE', 'The completed download is unavailable.'); }
    if (!details.isFile()) throw grantError('FILE_GRANT_NOT_FILE', 'The completed download is not a file.');
    let grantId; for (let attempt=0;attempt<4;attempt+=1){const candidate=this.#randomBytes(32).toString('hex');if(/^[a-f0-9]{64}$/.test(candidate)&&!this.#grants.has(candidate)){grantId=candidate;break;}}
    if(!grantId)throw grantError('FILE_GRANT_ID_FAILED','A unique file grant could not be created.');
    const expiresAt=this.#now()+this.#ttlMs;const record=Object.freeze({ownerId:owner,path:resolved,basename:path.basename(resolved),size:details.size,mime:MIME_BY_EXTENSION[path.extname(resolved).toLowerCase()]??'application/octet-stream',expiresAt,identity:Object.freeze({dev:details.dev,ino:details.ino,size:details.size,mtimeMs:details.mtimeMs})});this.#grants.set(grantId,record);return Object.freeze({grantId,basename:record.basename,size:record.size,mime:record.mime,expiresAt});
  }

  revoke(grantId, ownerId) {
    if (typeof grantId !== 'string' || !/^[a-f0-9]{64}$/.test(grantId)) throw grantError('FILE_GRANT_INVALID', 'The file grant id is invalid.');
    const owner = requireOwnerId(ownerId);
    const record = this.#grants.get(grantId);
    if (!record || record.ownerId !== owner) return Object.freeze({ revoked: false });
    return Object.freeze({ revoked: this.#grants.delete(grantId) });
  }

  async resolveOnce(grantId, ownerId) {
    if (typeof grantId !== 'string' || !/^[a-f0-9]{64}$/.test(grantId)) throw grantError('FILE_GRANT_INVALID', 'The file grant id is invalid.');
    const owner = requireOwnerId(ownerId);
    const record = this.#grants.get(grantId);
    if (!record || record.ownerId !== owner) throw grantError('FILE_GRANT_NOT_FOUND', 'The file grant is missing or already consumed.');
    this.#grants.delete(grantId); // Atomic reservation: every outcome consumes the grant.
    if (this.#now() >= record.expiresAt) throw grantError('FILE_GRANT_EXPIRED', 'The file grant expired.');
    let resolved;
    let details;
    try {
      resolved = await this.#realpath(record.path);
      details = await this.#stat(resolved);
    } catch {
      throw grantError('FILE_GRANT_CHANGED', 'The granted file changed after selection.');
    }
    if (resolved !== record.path || !details.isFile()
      || details.dev !== record.identity.dev || details.ino !== record.identity.ino
      || details.size !== record.identity.size || details.mtimeMs !== record.identity.mtimeMs) {
      throw grantError('FILE_GRANT_CHANGED', 'The granted file changed after selection.');
    }
    return Object.freeze({ path: resolved, basename: record.basename, size: record.size, mime: record.mime });
  }
}

export function createFileGrantMethods(store = new FileGrantStore()) {
  return Object.freeze({
    async create(_params = {}, ownerId) { return store.create(ownerId); },
    async revoke(params = {}, ownerId) { return store.revoke(params.grantId, ownerId); },
    async resolveOnce(grantId, ownerId) { return store.resolveOnce(grantId, ownerId); },
    async createFromPath(filePath, ownerId) { return store.createFromPath(filePath, ownerId); },
  });
}
