const STORAGE_KEY = 'toolbraid.community.v1';
export const COMMUNITY_ALARM = 'toolbraid.community.check';
const PREFIX = 'toolbraid.community.';
const xUrl = (value) => {
  try { const url = new URL(value); return url.protocol === 'https:' && ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname) ? url : null; } catch { return null; }
};

export function inspectXCommunityPage() {
  const accountText = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')?.innerText ?? '';
  const account = accountText.match(/@[A-Za-z0-9_]{1,15}\b/)?.[0] ?? null;
  const items = [];
  const seen = new Set();
  for (const article of document.querySelectorAll('article[data-testid="tweet"], article')) {
    const owned = (selector) => [...article.querySelectorAll(selector)].filter((element) => element.closest('article') === article);
    const link = owned('a[href]').find((anchor) => anchor.querySelector('time') && /\/status\/\d+/.test(anchor.pathname))
      ?? owned('a[href]').find((anchor) => /^\/[A-Za-z0-9_]+\/status\/\d+$/.test(anchor.pathname));
    if (!link || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(link.hostname)) continue;
    const match = link.pathname.match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)/);
    if (!match || seen.has(match[2])) continue;
    seen.add(match[2]);
    const text = (owned('[data-testid="tweetText"]')[0]?.innerText ?? '').trim();
    items.push({ id: match[2], url: `https://x.com/${match[1]}/status/${match[2]}`, author: `@${match[1]}`, text: text.slice(0, 4000), truncated: text.length > 4000 });
    if (items.length >= 60) break;
  }
  return { account, url: location.href, title: document.title.slice(0, 256), items, coverage: 'Currently rendered posts only; not a complete account archive or DM inbox.' };
}

export function createCommunityTools({ chromeApi, authorize, now = Date.now, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  let running = null;
  const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
  const empty = () => ({ enabled: false, notify: false, tabId: null, account: null, seen: [], inbox: [], interval: 15, checkedAt: null, error: null });
  async function state() { return { ...empty(), ...(await chromeApi.storage.local.get(STORAGE_KEY))?.[STORAGE_KEY] }; }
  async function save(value) { await chromeApi.storage.local.set({ [STORAGE_KEY]: value }); return value; }
  async function inspect(tabId) {
    const tab = await chromeApi.tabs.get(tabId);
    if (!xUrl(tab?.url)) fail('COMMUNITY_X_PAGE_REQUIRED', 'Select an X notifications or conversation page.');
    await authorize(tab.url);
    const results = await chromeApi.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: inspectXCommunityPage });
    const result = results?.[0]?.result;
    if (!result || !xUrl(result.url) || result.url !== tab.url) fail('COMMUNITY_PAGE_CHANGED', 'The X page changed during inspection. Try again.');
    return { ...result, tabId, checkedAt: now() };
  }
  async function inspectSelected(context = {}) {
    if (Number.isInteger(context.targetTabId)) return inspect(context.targetTabId);
    const [active] = await chromeApi.tabs.query({ active: true, currentWindow: true });
    const saved = await state();
    const tabId = xUrl(active?.url) ? active.id : saved.tabId;
    if (!Number.isInteger(tabId)) fail('COMMUNITY_X_PAGE_REQUIRED', 'Open your X notifications or a conversation first.');
    return inspect(tabId);
  }
  async function watch({ interval = 15, notify = false } = {}) {
    if (![5, 15, 30, 60].includes(interval)) fail('COMMUNITY_INTERVAL_INVALID', 'Choose a 5, 15, 30 or 60 minute interval.');
    const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
    const url = xUrl(tab?.url);
    if (!url || !(/^\/notifications(?:\/|$)/.test(url.pathname) || /^\/[A-Za-z0-9_]+\/status\/\d+/.test(url.pathname))) {
      fail('COMMUNITY_WATCH_PAGE_REQUIRED', 'Open X Notifications, Mentions or a specific post conversation, then start watching.');
    }
    const snapshot = await inspect(tab.id);
    if (!snapshot.account) fail('COMMUNITY_ACCOUNT_UNKNOWN', 'Sign in to X and wait for your account menu to load before watching.');
    const saved = await save({ ...empty(), enabled: true, notify: notify === true, tabId: tab.id, url: tab.url, account: snapshot.account, interval, seen: snapshot.items.map((item) => item.id), checkedAt: now() });
    await chromeApi.alarms.create(COMMUNITY_ALARM, { delayInMinutes: interval, periodInMinutes: interval });
    return saved;
  }
  async function pause() {
    const saved = await save({ ...await state(), enabled: false });
    await chromeApi.alarms.clear(COMMUNITY_ALARM);
    return saved;
  }
  async function tick() {
    if (running) return running;
    running = (async () => {
      const saved = await state();
      if (!saved.enabled) return saved;
      try {
        const tab = await chromeApi.tabs.get(saved.tabId);
        if (tab.url !== saved.url) fail('COMMUNITY_WATCH_CHANGED', 'The watched tab changed. Select the intended X page and start watching again.');
        await authorize(tab.url);
        if (!tab.active) {
          await chromeApi.tabs.reload(tab.id);
          for (let attempt = 0; attempt < 20; attempt++) {
            await delay(500);
            if ((await chromeApi.tabs.get(tab.id)).status === 'complete') break;
          }
        }
        let snapshot = await inspect(tab.id);
        for (let attempt = 0; !snapshot.account && attempt < 8; attempt++) { await delay(500); snapshot = await inspect(tab.id); }
        if (snapshot.account !== saved.account) fail('COMMUNITY_ACCOUNT_CHANGED', 'The signed-in X account changed or is unavailable. Monitoring has paused.');
        // A pause or retarget during the read must not publish an old notification.
        const current = await state();
        if (!current.enabled || current.tabId !== saved.tabId || current.account !== saved.account) return current;
        const seen = new Set(saved.seen);
        const fresh = snapshot.items.filter((item) => !seen.has(item.id) && item.author.toLowerCase() !== saved.account.toLowerCase());
        const updated = await save({ ...current, checkedAt: now(), error: null,
          seen: [...new Set([...snapshot.items.map((item) => item.id), ...saved.seen])].slice(0, 1000),
          inbox: [...fresh.map((item) => ({ ...item, receivedAt: now() })), ...current.inbox].slice(0, 60),
        });
        if (fresh.length && current.notify && await chromeApi.permissions.contains({ permissions: ['notifications'] })) {
          await chromeApi.notifications.create('toolbraid-community', { type: 'basic', iconUrl: 'icons/toolbraid-128.png', title: 'ToolBraid · Your community', message: `${fresh.length} new conversation${fresh.length === 1 ? '' : 's'} on your watched X page. Open ToolBraid to review.`, silent: true }).catch(() => {});
        }
        return updated;
      } catch (error) {
        const current = await state();
        if (!current.enabled || current.tabId !== saved.tabId || current.checkedAt !== saved.checkedAt) return current;
        await chromeApi.alarms.clear(COMMUNITY_ALARM);
        return save({ ...current, enabled: false, error: String(error.message ?? 'Community check failed.').slice(0, 300) });
      }
    })().finally(() => { running = null; });
    return running;
  }
  async function restore() {
    const saved = await state();
    if (saved.enabled) await chromeApi.alarms.create(COMMUNITY_ALARM, { delayInMinutes: saved.interval, periodInMinutes: saved.interval });
  }
  return {
    state, inspectSelected, watch, pause, tick, restore,
    descriptors: () => [{ name: `${PREFIX}inspect`, title: 'Inspect your X community', description: 'Read currently rendered replies or mentions from the selected X page or explicitly watched tab. Returns exact post links, authors and text for a developer-facing summary. This does not send messages or read DMs.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } }],
    call: async (name, args = {}, context = {}) => { if (name !== `${PREFIX}inspect`) fail('COMMUNITY_TOOL_UNKNOWN', 'Unknown community tool.'); return inspectSelected(context); },
    invalidate() {},
  };
}
