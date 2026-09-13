const TOOL_PREFIX = 'toolbraid.download.';
const DEFAULT_HANDLE_LIMIT = 256;
const HANDLE_TTL_MS = 5 * 60_000;

export class DownloadOwnerToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DownloadOwnerToolError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new DownloadOwnerToolError(code, message);
}

function object(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function schema(properties = {}, required = []) {
  return Object.freeze({ type: 'object', properties, required, additionalProperties: false });
}

const HANDLE_SCHEMA = { type: 'string', minLength: 16, maxLength: 128 };
const DESCRIPTORS = Object.freeze([
  ['list', 'List recent downloads', 'List recent browser downloads using short-lived opaque handles; local paths are never exposed.', schema({ limit: { type: 'integer', minimum: 1, maximum: 100 } })],
  ['wait', 'Wait for download', 'Wait up to 20 seconds for a listed download to complete.', schema({ handle: HANDLE_SCHEMA, timeoutMs: { type: 'integer', minimum: 100, maximum: 20000 } }, ['handle'])],
  ['cancel', 'Cancel download', 'Cancel an in-progress download selected from the latest download listing.', schema({ handle: HANDLE_SCHEMA }, ['handle'])],
  ['show', 'Show download', 'Reveal a completed download selected from the latest download listing.', schema({ handle: HANDLE_SCHEMA }, ['handle'])],
  ['grant_upload', 'Grant completed download for upload', 'Convert a completed listed download into a one-shot local upload grant without exposing its path.', schema({ handle: HANDLE_SCHEMA }, ['handle'])],
].map(([suffix, title, description, inputSchema]) => Object.freeze({
  name: `${TOOL_PREFIX}${suffix}`,
  title,
  description,
  inputSchema,
  annotations: Object.freeze({
    readOnlyHint: ['list', 'wait'].includes(suffix),
    destructiveHint: suffix === 'cancel',
    idempotentHint: ['list', 'wait', 'show'].includes(suffix),
    openWorldHint: false,
  }),
  _meta: Object.freeze({ 'toolbraid/ownerOnly': true, 'toolbraid/surface': 'native-mcp' }),
})));

function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 8_192) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function basename(value) {
  if (typeof value !== 'string') return '';
  return value.split(/[\\/]/).pop()?.slice(0, 512) ?? '';
}

function publicDownload(item, handle) {
  return Object.freeze({
    handle,
    url: safeUrl(item?.finalUrl || item?.url),
    filename: basename(item?.filename),
    status: ['in_progress', 'complete', 'interrupted'].includes(item?.state) ? item.state : 'unknown',
    bytesReceived: Number.isSafeInteger(item?.bytesReceived) && item.bytesReceived >= 0 ? item.bytesReceived : 0,
    totalBytes: Number.isSafeInteger(item?.totalBytes) && item.totalBytes >= 0 ? item.totalBytes : 0,
  });
}

export function createDownloadOwnerTools({ chromeApi = globalThis.chrome, cryptoRef = globalThis.crypto, setTimeoutRef = globalThis.setTimeout, nowRef = Date.now, handleLimit = DEFAULT_HANDLE_LIMIT } = {}) {
  if (typeof chromeApi?.downloads?.search !== 'function') throw new TypeError('Chrome downloads.search API is required.');
  if (!Number.isInteger(handleLimit) || handleLimit < 1) throw new TypeError('handleLimit must be a positive integer.');
  const handles = new Map();

  function token() {
    if (!cryptoRef?.getRandomValues) fail('DOWNLOAD_CRYPTO_UNAVAILABLE', 'Secure download handles are unavailable.');
    const bytes = new Uint8Array(16);
    cryptoRef.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  function invalidate() {
    handles.clear();
  }

  function pruneHandles() {
    const now = nowRef();
    for (const [handle, binding] of handles) {
      if (binding.expiresAt <= now) handles.delete(handle);
    }
    while (handles.size >= handleLimit) handles.delete(handles.keys().next().value);
  }

  function bind(item) {
    pruneHandles();
    const handle = token();
    handles.set(handle, Object.freeze({
      id: item.id,
      url: item.url,
      startTime: item.startTime,
      expiresAt: nowRef() + HANDLE_TTL_MS,
    }));
    return handle;
  }

  async function listed(handle) {
    if (typeof handle !== 'string') fail('DOWNLOAD_HANDLE_INVALID', 'A handle from the latest download listing is required.');
    const binding = handles.get(handle);
    if (!binding) fail('DOWNLOAD_HANDLE_STALE', 'List recent downloads again before selecting this download.');
    if (binding.expiresAt <= nowRef()) {
      handles.delete(handle);
      fail('DOWNLOAD_HANDLE_STALE', 'List recent downloads again before selecting this download.');
    }
    const found = await chromeApi.downloads.search({ id: binding.id });
    const item = found?.[0];
    if (!item || item.url !== binding.url || item.startTime !== binding.startTime) {
      handles.delete(handle);
      fail('DOWNLOAD_HANDLE_STALE', 'The listed download changed or no longer exists; list downloads again.');
    }
    return item;
  }

  async function wait(handle, timeoutMs = 10_000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 20_000) {
      fail('DOWNLOAD_TIMEOUT_INVALID', 'timeoutMs must be an integer from 100 through 20000.');
    }
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const item = await listed(handle);
      if (item.state === 'complete') return Object.freeze({ completed: true, download: publicDownload(item, handle) });
      if (item.state === 'interrupted') fail('DOWNLOAD_INTERRUPTED', 'The listed download was interrupted.');
      if (Date.now() >= deadline) fail('DOWNLOAD_WAIT_TIMEOUT', 'The listed download did not complete before timeout.');
      await new Promise((resolve) => setTimeoutRef(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
    }
  }

  async function call(name, args = {}) {
    if (!object(args)) fail('DOWNLOAD_ARGUMENTS_INVALID', 'Download tool arguments must be an object.');
    const suffix = name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : '';
    if (suffix === 'list') {
      const limit = args.limit === undefined ? 25 : args.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('DOWNLOAD_LIMIT_INVALID', 'limit must be an integer from 1 through 100.');
      const items = await chromeApi.downloads.search({ orderBy: ['-startTime'], limit });
      const downloads = [];
      for (const item of items ?? []) {
        if (!Number.isInteger(item?.id) || item.id < 0) continue;
        const handle = bind(item);
        downloads.push(publicDownload(item, handle));
      }
      return Object.freeze({ downloads: Object.freeze(downloads) });
    }
    if (suffix === 'wait') return wait(args.handle, args.timeoutMs);
    const item = await listed(args.handle);
    if (suffix === 'cancel') {
      if (item.state !== 'in_progress') fail('DOWNLOAD_NOT_IN_PROGRESS', 'Only an in-progress listed download can be cancelled.');
      if (typeof chromeApi.downloads.cancel !== 'function') fail('DOWNLOAD_API_UNAVAILABLE', 'Chrome downloads.cancel is unavailable.');
      await chromeApi.downloads.cancel(item.id);
      handles.delete(args.handle);
      return Object.freeze({ cancelled: true });
    }
    if (suffix === 'show') {
      if (item.state !== 'complete') fail('DOWNLOAD_NOT_COMPLETE', 'Only a completed listed download can be shown.');
      if (typeof chromeApi.downloads.show !== 'function') fail('DOWNLOAD_API_UNAVAILABLE', 'Chrome downloads.show is unavailable.');
      await chromeApi.downloads.show(item.id);
      return Object.freeze({ shown: true });
    }
    if (suffix === 'grant_upload') {
      if (item.state !== 'complete' || typeof item.filename !== 'string' || !item.filename) fail('DOWNLOAD_NOT_COMPLETE', 'Only a completed listed download can become an upload grant.');
      handles.delete(args.handle);
      return Object.freeze({ _toolbraidDownloadPath: item.filename, expected: Object.freeze({ name: basename(item.filename), size: item.totalBytes }) });
    }
    fail('DOWNLOAD_TOOL_UNKNOWN', 'The native download tool is not supported.');
  }

  return Object.freeze({ descriptors: () => DESCRIPTORS, call, invalidate, handleCount: () => handles.size });
}
