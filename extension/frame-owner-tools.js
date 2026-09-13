const TOOL_PREFIX = 'toolbraid.frame.';
const HANDLE_TTL_MS = 5 * 60_000;
const DEFAULT_HANDLE_LIMIT = 128;

export class FrameOwnerToolError extends Error {
  constructor(code, message) { super(message); this.name = 'FrameOwnerToolError'; this.code = code; }
}

function fail(code, message) { throw new FrameOwnerToolError(code, message); }
function schema(properties = {}, required = []) { return Object.freeze({ type: 'object', properties, required, additionalProperties: false }); }
const HANDLE_SCHEMA = Object.freeze({ type: 'string', minLength: 16, maxLength: 128 });

const DESCRIPTORS = Object.freeze([
  ['list', 'List accessible frames', 'List active-tab frame sessions and issue short-lived opaque handles.', schema()],
  ['select', 'Select frame', 'Select one exact frame from the latest accessible-frame listing.', schema({ handle: HANDLE_SCHEMA }, ['handle'])],
  ['reset', 'Reset to top frame', 'Reset page-tool targeting to the active tab top frame.', schema()],
].map(([suffix, title, description, inputSchema]) => Object.freeze({
  name: `${TOOL_PREFIX}${suffix}`,
  title,
  description,
  inputSchema,
  annotations: Object.freeze({ readOnlyHint: suffix === 'list', destructiveHint: false, idempotentHint: suffix !== 'select', openWorldHint: false }),
  _meta: Object.freeze({ 'toolbraid/ownerOnly': true, 'toolbraid/surface': 'native-mcp' }),
})));

function safeUrl(value) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch { return null; }
}

function sameSession(left, right) {
  return Boolean(left && right && left.tabId === right.tabId && left.frameId === right.frameId
    && left.sessionId === right.sessionId && left.url === right.url && right.state === 'active');
}

export function createFrameOwnerTools({
  chromeApi = globalThis.chrome,
  lifecycleRegistry,
  cryptoRef = globalThis.crypto,
  nowRef = Date.now,
  handleLimit = DEFAULT_HANDLE_LIMIT,
  onSelectionChanged = null,
} = {}) {
  if (typeof chromeApi?.tabs?.query !== 'function') throw new TypeError('Chrome tabs.query API is required.');
  if (!lifecycleRegistry || typeof lifecycleRegistry.list !== 'function' || typeof lifecycleRegistry.get !== 'function') throw new TypeError('A lifecycle registry with list() and get() is required.');
  if (!Number.isInteger(handleLimit) || handleLimit < 1) throw new TypeError('handleLimit must be a positive integer.');
  if (onSelectionChanged !== null && typeof onSelectionChanged !== 'function') throw new TypeError('onSelectionChanged must be a function.');
  const handles = new Map();
  let selection = null;

  function token() {
    if (typeof cryptoRef?.getRandomValues !== 'function') fail('FRAME_CRYPTO_UNAVAILABLE', 'Secure frame handles are unavailable.');
    const bytes = new Uint8Array(16); cryptoRef.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  function prune() {
    for (const [handle, binding] of handles) if (binding.expiresAt <= nowRef()) handles.delete(handle);
    while (handles.size >= handleLimit) handles.delete(handles.keys().next().value);
  }
  function bind(tab, session) {
    prune();
    const handle = token();
    handles.set(handle, Object.freeze({ tabId: tab.id, windowId: tab.windowId, frameId: session.frameId, sessionId: session.sessionId, url: session.url, expiresAt: nowRef() + HANDLE_TTL_MS }));
    return handle;
  }
  async function activeTab() {
    const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    if (!Number.isInteger(tab?.id) || !Number.isInteger(tab?.windowId)) fail('FRAME_ACTIVE_TAB_MISSING', 'No active browser tab is available.');
    return tab;
  }
  async function revalidate(binding) {
    const tab = await activeTab();
    if (tab.id !== binding.tabId || tab.windowId !== binding.windowId) fail('FRAME_ACTIVE_TAB_DRIFT', 'The active tab changed after frames were listed.');
    const current = lifecycleRegistry.get(binding.tabId, binding.frameId);
    if (!sameSession(binding, current)) fail('FRAME_SESSION_DRIFT', 'The listed frame document session changed.');
    return current;
  }
  function publish(next) {
    selection = next;
    onSelectionChanged?.(next ? Object.freeze({ ...next }) : null);
  }
  function selectedFrameId() {
    if (!selection) return 0;
    const current = lifecycleRegistry.get(selection.tabId, selection.frameId);
    if (!sameSession(selection, current)) { publish(null); return 0; }
    return selection.frameId;
  }
  function selectedTarget() {
    if (!selection) return null;
    const current = lifecycleRegistry.get(selection.tabId, selection.frameId);
    if (!sameSession(selection, current)) { publish(null); return null; }
    return Object.freeze({
      targetTabId: selection.tabId,
      targetWindowId: selection.windowId,
      targetFrameId: selection.frameId,
    });
  }
  function invalidate() { handles.clear(); }

  async function call(name, args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) fail('FRAME_ARGUMENTS_INVALID', 'Frame tool arguments must be an object.');
    const suffix = name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : '';
    if (suffix === 'list') {
      const tab = await activeTab();
      const frames = lifecycleRegistry.list(tab.id)
        .filter((session) => session?.state === 'active' && Number.isInteger(session.frameId) && safeUrl(session.url))
        .sort((a, b) => a.frameId - b.frameId)
        .map((session) => Object.freeze({ handle: bind(tab, session), frameId: session.frameId, top: session.frameId === 0, url: safeUrl(session.url) }));
      return Object.freeze({ frames: Object.freeze(frames), selectedFrameId: selectedFrameId() });
    }
    if (suffix === 'select') {
      const binding = typeof args.handle === 'string' ? handles.get(args.handle) : null;
      if (!binding || binding.expiresAt <= nowRef()) { if (binding) handles.delete(args.handle); fail('FRAME_HANDLE_STALE', 'List accessible frames again before selecting a frame.'); }
      const current = await revalidate(binding);
      publish(Object.freeze({ tabId: binding.tabId, windowId: binding.windowId, frameId: binding.frameId, sessionId: binding.sessionId, url: binding.url, state: current.state }));
      return Object.freeze({ selected: true, frameId: binding.frameId, top: binding.frameId === 0 });
    }
    if (suffix === 'reset') {
      const tab = await activeTab();
      const top = lifecycleRegistry.get(tab.id, 0);
      if (!top || top.state !== 'active' || !safeUrl(top.url)) fail('FRAME_TOP_SESSION_MISSING', 'The active tab has no accessible top-frame session.');
      publish(Object.freeze({ tabId: tab.id, windowId: tab.windowId, frameId: 0, sessionId: top.sessionId, url: top.url, state: top.state }));
      return Object.freeze({ selected: true, frameId: 0, top: true });
    }
    fail('FRAME_TOOL_UNKNOWN', 'The native frame tool is not supported.');
  }

  return Object.freeze({ descriptors: () => DESCRIPTORS, call, invalidate, selectedFrameId, selectedTarget });
}

export { HANDLE_TTL_MS as FRAME_HANDLE_TTL_MS };
