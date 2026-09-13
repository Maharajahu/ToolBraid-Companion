const TOOL_PREFIX = 'toolbraid.browser.';
const DEFAULT_HANDLE_LIMIT = 256;
const HANDLE_TTL_MS = 5 * 60_000;

export class BrowserOwnerToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BrowserOwnerToolError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new BrowserOwnerToolError(code, message);
}

function object(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 8_192) fail('BROWSER_URL_INVALID', 'A bounded HTTP(S) URL is required.');
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      fail('BROWSER_URL_INVALID', 'Only credential-free HTTP(S) URLs are allowed.');
    }
    return url.href;
  } catch (error) {
    if (error instanceof BrowserOwnerToolError) throw error;
    fail('BROWSER_URL_INVALID', 'A valid HTTP(S) URL is required.');
  }
}

function schema(properties = {}, required = []) {
  return Object.freeze({ type: 'object', properties, required, additionalProperties: false });
}

const HANDLE_SCHEMA = { type: 'string', minLength: 16, maxLength: 128 };
const DESCRIPTORS = Object.freeze([
  ['tabs_list', 'List browser tabs', 'List current HTTP(S) tabs and issue short-lived opaque handles.', schema()],
  ['tab_open', 'Open browser tab', 'Open a credential-free HTTP(S) URL in a new tab.', schema({ url: { type: 'string', minLength: 8, maxLength: 8192 }, active: { type: 'boolean' } }, ['url'])],
  ['tab_activate', 'Activate browser tab', 'Activate a tab from the latest tab listing.', schema({ handle: HANDLE_SCHEMA }, ['handle'])],
  ['active_navigate', 'Navigate active tab', 'Navigate the active tab to a credential-free HTTP(S) URL.', schema({ url: { type: 'string', minLength: 8, maxLength: 8192 } }, ['url'])],
  ['active_back', 'Go back', 'Navigate the active tab backward.', schema()],
  ['active_forward', 'Go forward', 'Navigate the active tab forward.', schema()],
  ['active_reload', 'Reload active tab', 'Reload the active tab.', schema()],
  ['active_wait', 'Wait for active tab', 'Wait up to 20 seconds for the current active tab to finish loading, optionally after reaching an HTTP(S) URL prefix.', schema({ timeoutMs: { type: 'integer', minimum: 100, maximum: 20000 }, urlPrefix: { type: 'string', minLength: 8, maxLength: 8192 } })],
  ['tab_close', 'Close browser tab', 'Close an explicit tab from the latest tab listing.', schema({ handle: HANDLE_SCHEMA }, ['handle'])],
].map(([suffix, title, description, inputSchema]) => Object.freeze({
  name: `${TOOL_PREFIX}${suffix}`,
  title,
  description,
  inputSchema,
  annotations: Object.freeze({ readOnlyHint: ['tabs_list', 'active_wait'].includes(suffix), destructiveHint: suffix === 'tab_close', idempotentHint: suffix === 'active_wait', openWorldHint: true }),
  _meta: Object.freeze({ 'toolbraid/ownerOnly': true, 'toolbraid/surface': 'native-mcp' }),
})));

export function createBrowserOwnerTools({ chromeApi = globalThis.chrome, cryptoRef = globalThis.crypto, setTimeoutRef = globalThis.setTimeout, nowRef = Date.now, handleLimit = DEFAULT_HANDLE_LIMIT } = {}) {
  if (!chromeApi?.tabs?.query) throw new TypeError('Chrome tabs.query API is required.');
  if (!Number.isInteger(handleLimit) || handleLimit < 1) throw new TypeError('handleLimit must be a positive integer.');
  const handles = new Map();

  function token() {
    if (!cryptoRef?.getRandomValues) fail('BROWSER_CRYPTO_UNAVAILABLE', 'Secure tab handles are unavailable.');
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

  function bind(tab) {
    pruneHandles();
    const handle = token();
    handles.set(handle, Object.freeze({
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url,
      expiresAt: nowRef() + HANDLE_TTL_MS,
    }));
    return handle;
  }

  function publicTab(tab) {
    return Object.freeze({
      url: safeUrl(tab?.pendingUrl || tab?.url),
      title: typeof tab?.title === 'string' ? tab.title.slice(0, 512) : '',
      status: ['loading', 'complete'].includes(tab?.status) ? tab.status : 'unknown',
      active: tab?.active === true,
    });
  }

  async function activeTab(context = {}) {
    if (Number.isInteger(context.targetTabId)) {
      const tab = await chromeApi.tabs.get(context.targetTabId);
      if (tab?.windowId !== context.targetWindowId) fail('BROWSER_TAB_HANDLE_STALE', 'The chat page closed or moved to another window.');
      return tab;
    }
    const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    if (!Number.isInteger(tab?.id) || tab.id < 0) fail('BROWSER_ACTIVE_TAB_MISSING', 'No active browser tab is available.');
    return tab;
  }

  async function listedTab(handle) {
    if (typeof handle !== 'string') fail('BROWSER_TAB_HANDLE_INVALID', 'A tab handle from the latest listing is required.');
    const binding = handles.get(handle);
    if (!binding) fail('BROWSER_TAB_HANDLE_STALE', 'List browser tabs again before selecting this tab.');
    if (binding.expiresAt <= nowRef()) {
      handles.delete(handle);
      fail('BROWSER_TAB_HANDLE_STALE', 'List browser tabs again before selecting this tab.');
    }
    if (typeof chromeApi.tabs.get !== 'function') fail('BROWSER_API_UNAVAILABLE', 'Chrome tabs.get is unavailable.');
    let tab;
    try { tab = await chromeApi.tabs.get(binding.tabId); } catch { fail('BROWSER_TAB_HANDLE_STALE', 'The listed tab no longer exists.'); }
    if (tab?.windowId !== binding.windowId || tab?.url !== binding.url) {
      handles.delete(handle);
      fail('BROWSER_TAB_HANDLE_STALE', 'The listed tab changed; list browser tabs again.');
    }
    return tab;
  }

  async function resolveHandle(handle) {
    const tab = await listedTab(handle);
    return Object.freeze({
      tabId: tab.id,
      windowId: tab.windowId,
      url: safeUrl(tab.url),
      title: typeof tab.title === 'string' ? tab.title.slice(0, 512) : '',
    });
  }

  async function waitForLoadedTab(tabId, { timeoutMs = 10_000, urlPrefix } = {}) {
    if (typeof chromeApi.tabs.get !== 'function') fail('BROWSER_API_UNAVAILABLE', 'Chrome tabs.get is unavailable.');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 20_000) {
      fail('BROWSER_TIMEOUT_INVALID', 'timeoutMs must be an integer from 100 through 20000.');
    }
    const expectedPrefix = urlPrefix === undefined ? null : safeUrl(urlPrefix);
    const deadline = Date.now() + timeoutMs;
    while (true) {
      let current;
      try { current = await chromeApi.tabs.get(tabId); } catch { fail('BROWSER_ACTIVE_TAB_MISSING', 'The active browser tab closed while waiting.'); }
      let currentUrl = null;
      try { currentUrl = safeUrl(current?.url); } catch { /* Transitional browser pages are not exposed. */ }
      if (current?.status === 'complete' && currentUrl && (!expectedPrefix || currentUrl.startsWith(expectedPrefix))) {
        return Object.freeze({ loaded: true, url: currentUrl, title: typeof current.title === 'string' ? current.title.slice(0, 512) : '' });
      }
      if (Date.now() >= deadline) fail('BROWSER_WAIT_TIMEOUT', 'The active tab did not finish the requested navigation before timeout.');
      await new Promise((resolve) => setTimeoutRef(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
    }
  }

  async function call(name, args = {}, context = {}) {
    if (!object(args)) fail('BROWSER_ARGUMENTS_INVALID', 'Browser tool arguments must be an object.');
    const suffix = name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : '';
    if (suffix === 'tabs_list') {
      const tabs = await chromeApi.tabs.query({});
      const result = [];
      for (const tab of tabs ?? []) {
        if (!Number.isInteger(tab?.id) || tab.id < 0 || !Number.isInteger(tab?.windowId)) continue;
        let url;
        try { url = safeUrl(tab.url); } catch { continue; }
        const handle = bind(tab);
        result.push(Object.freeze({ handle, windowId: tab.windowId, active: tab.active === true, url, title: typeof tab.title === 'string' ? tab.title.slice(0, 512) : '' }));
      }
      return Object.freeze({ tabs: Object.freeze(result) });
    }
    if (suffix === 'tab_open') {
      if (typeof chromeApi.tabs.create !== 'function') fail('BROWSER_API_UNAVAILABLE', 'Chrome tabs.create is unavailable.');
      return Object.freeze({ tab: publicTab(await chromeApi.tabs.create({ url: safeUrl(args.url), active: args.active !== false })) });
    }
    if (suffix === 'tab_activate') {
      const tab = await listedTab(args.handle);
      if (typeof chromeApi.tabs.update !== 'function') fail('BROWSER_API_UNAVAILABLE', 'Chrome tabs.update is unavailable.');
      await chromeApi.windows?.update?.(tab.windowId, { focused: true });
      return Object.freeze({ tab: publicTab(await chromeApi.tabs.update(tab.id, { active: true })) });
    }
    if (suffix === 'tab_close') {
      const tab = await listedTab(args.handle);
      if (typeof chromeApi.tabs.remove !== 'function') fail('BROWSER_API_UNAVAILABLE', 'Chrome tabs.remove is unavailable.');
      handles.delete(args.handle);
      await chromeApi.tabs.remove(tab.id);
      return Object.freeze({ closed: true });
    }
    const tab = await activeTab(context);
    if (suffix === 'active_navigate') {
      if (typeof chromeApi.tabs.update !== 'function') fail('BROWSER_API_UNAVAILABLE', 'Chrome tabs.update is unavailable.');
      return Object.freeze({ tab: publicTab(await chromeApi.tabs.update(tab.id, { url: safeUrl(args.url) })) });
    }
    if (suffix === 'active_back') {
      if (!chromeApi.tabs.goBack) fail('BROWSER_HISTORY_UNAVAILABLE', 'Chrome back navigation is unavailable.');
      await chromeApi.tabs.goBack(tab.id); return Object.freeze({ navigated: true });
    }
    if (suffix === 'active_forward') {
      if (!chromeApi.tabs.goForward) fail('BROWSER_HISTORY_UNAVAILABLE', 'Chrome forward navigation is unavailable.');
      await chromeApi.tabs.goForward(tab.id); return Object.freeze({ navigated: true });
    }
    if (suffix === 'active_reload') {
      if (typeof chromeApi.tabs.reload !== 'function') fail('BROWSER_API_UNAVAILABLE', 'Chrome tabs.reload is unavailable.');
      await chromeApi.tabs.reload(tab.id); return Object.freeze({ reloaded: true });
    }
    if (suffix === 'active_wait') return waitForLoadedTab(tab.id, args);
    fail('BROWSER_TOOL_UNKNOWN', 'The native browser tool is not supported.');
  }

  return Object.freeze({ descriptors: () => DESCRIPTORS, call, invalidate, resolveHandle, handleCount: () => handles.size });
}
