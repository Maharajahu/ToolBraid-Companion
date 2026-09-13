import assert from 'node:assert/strict';
import test from 'node:test';

import { createBrowserOwnerTools } from '../../extension/browser-owner-tools.js';

function harness() {
  const tabs = new Map([
    [7, { id: 7, windowId: 2, active: true, status: 'complete', url: 'https://example.test/a', title: 'A' }],
    [8, { id: 8, windowId: 2, active: false, status: 'complete', url: 'https://example.test/b', title: 'B' }],
    [9, { id: 9, windowId: 2, active: false, url: 'chrome://settings/', title: 'Settings' }],
  ]);
  const calls = [];
  let sequence = 0;
  const chromeApi = {
    tabs: {
      async query(query) {
        if (query.active) return [...tabs.values()].filter((tab) => tab.active);
        return [...tabs.values()];
      },
      async get(id) { if (!tabs.has(id)) throw new Error('missing'); return structuredClone(tabs.get(id)); },
      async create(input) { calls.push(['create', input]); return { id: 10, windowId: 2, status: 'loading', title: 'Opened', ...input }; },
      async update(id, input) { calls.push(['update', id, input]); return { ...tabs.get(id), ...input }; },
      async remove(id) { calls.push(['remove', id]); tabs.delete(id); },
      async reload(id) { calls.push(['reload', id]); },
      async goBack(id) { calls.push(['back', id]); },
      async goForward(id) { calls.push(['forward', id]); },
    },
    windows: { async update(id, input) { calls.push(['window', id, input]); } },
  };
  const cryptoRef = { getRandomValues(bytes) { bytes.fill(++sequence); return bytes; } };
  return { tools: createBrowserOwnerTools({ chromeApi, cryptoRef }), tabs, calls, chromeApi };
}

test('navigation receipts accept Chrome pending URLs before the destination commits', async () => {
  const h = harness();
  h.chromeApi.tabs.create = async ({ url }) => ({ id: 10, windowId: 2, active: true, status: 'loading', url: '', pendingUrl: url });
  h.chromeApi.tabs.update = async (id, { url }) => ({ ...h.tabs.get(id), status: 'loading', pendingUrl: url });
  for (const name of ['tab_open', 'active_navigate']) {
    const result = await h.tools.call(`toolbraid.browser.${name}`, { url: 'https://example.test/destination' });
    assert.equal(result.tab.url, 'https://example.test/destination');
    assert.equal(result.tab.status, 'loading');
  }
});

test('chat navigation remains on the pinned tab instead of the active tab', async () => {
  const h = harness();
  await h.tools.call('toolbraid.browser.active_navigate', { url: 'https://example.test/c' }, { targetTabId: 8, targetWindowId: 2, targetFrameId: 0 });
  assert.deepEqual(h.calls, [['update', 8, { url: 'https://example.test/c' }]]);
  await assert.rejects(h.tools.call('toolbraid.browser.active_reload', {}, { targetTabId: 8, targetWindowId: 99 }), { code: 'BROWSER_TAB_HANDLE_STALE' });
});

test('owner browser tools use fresh opaque handles and reject tab drift', async () => {
  const h = harness();
  const listed = await h.tools.call('toolbraid.browser.tabs_list', {});
  assert.equal(listed.tabs.length, 2);
  assert.equal(Object.hasOwn(listed.tabs[0], 'tabId'), false);
  assert.equal(h.tools.handleCount(), 2);

  const activated = await h.tools.call('toolbraid.browser.tab_activate', { handle: listed.tabs[1].handle });
  assert.deepEqual(activated.tab, { url: 'https://example.test/b', title: 'B', status: 'complete', active: true });
  assert.equal(Object.hasOwn(activated.tab, 'id'), false);
  assert.equal(Object.hasOwn(activated.tab, 'windowId'), false);
  assert.deepEqual(h.calls.slice(-2), [['window', 2, { focused: true }], ['update', 8, { active: true }]]);

  h.tabs.set(8, { ...h.tabs.get(8), url: 'https://example.test/changed' });
  await assert.rejects(
    h.tools.call('toolbraid.browser.tab_close', { handle: listed.tabs[1].handle }),
    (error) => error.code === 'BROWSER_TAB_HANDLE_STALE',
  );
});

test('owner browser tools validate URLs and operate only on the active or explicitly listed tab', async () => {
  const h = harness();
  for (const url of ['javascript:alert(1)', 'data:text/plain,x', 'https://user:pass@example.test/']) {
    await assert.rejects(h.tools.call('toolbraid.browser.tab_open', { url }), (error) => error.code === 'BROWSER_URL_INVALID');
  }
  const opened = await h.tools.call('toolbraid.browser.tab_open', { url: 'https://open.test/path', active: false });
  const navigated = await h.tools.call('toolbraid.browser.active_navigate', { url: 'http://localhost:8080/' });
  assert.deepEqual(opened.tab, { url: 'https://open.test/path', title: 'Opened', status: 'loading', active: false });
  assert.deepEqual(navigated.tab, { url: 'http://localhost:8080/', title: 'A', status: 'complete', active: true });
  assert.equal(Object.hasOwn(opened.tab, 'id'), false);
  assert.equal(Object.hasOwn(navigated.tab, 'windowId'), false);
  await h.tools.call('toolbraid.browser.active_back', {});
  await h.tools.call('toolbraid.browser.active_forward', {});
  await h.tools.call('toolbraid.browser.active_reload', {});
  const listed = await h.tools.call('toolbraid.browser.tabs_list', {});
  await h.tools.call('toolbraid.browser.tab_close', { handle: listed.tabs[0].handle });
  assert.deepEqual(h.calls, [
    ['create', { url: 'https://open.test/path', active: false }],
    ['update', 7, { url: 'http://localhost:8080/' }],
    ['back', 7], ['forward', 7], ['reload', 7], ['remove', 7],
  ]);
});

test('invalidating browser tools revokes all listed tab handles', async () => {
  const h = harness();
  const listed = await h.tools.call('toolbraid.browser.tabs_list', {});
  h.tools.invalidate();
  await assert.rejects(
    h.tools.call('toolbraid.browser.tab_activate', { handle: listed.tabs[0].handle }),
    (error) => error.code === 'BROWSER_TAB_HANDLE_STALE',
  );
});

test('browser handles survive concurrent listings and the oldest capabilities are evicted at the bound', async () => {
  const h = harness();
  const first = await h.tools.call('toolbraid.browser.tabs_list', {});
  const second = await h.tools.call('toolbraid.browser.tabs_list', {});
  await h.tools.call('toolbraid.browser.tab_activate', { handle: first.tabs[0].handle });
  await h.tools.call('toolbraid.browser.tab_activate', { handle: second.tabs[1].handle });

  let sequence = 0;
  const bounded = createBrowserOwnerTools({
    chromeApi: {
      tabs: {
        query: async () => [{ id: sequence + 1, windowId: 1, url: `https://example.test/${sequence}`, active: false }],
        get: async (id) => ({ id, windowId: 1, url: `https://example.test/${id - 1}` }),
      },
    },
    cryptoRef: { getRandomValues(bytes) { bytes.fill(++sequence); } },
    handleLimit: 3,
  });
  const oldest = (await bounded.call('toolbraid.browser.tabs_list', {})).tabs[0].handle;
  await bounded.call('toolbraid.browser.tabs_list', {});
  await bounded.call('toolbraid.browser.tabs_list', {});
  await bounded.call('toolbraid.browser.tabs_list', {});
  assert.equal(bounded.handleCount(), 3);
  await assert.rejects(
    bounded.call('toolbraid.browser.tab_activate', { handle: oldest }),
    (error) => error.code === 'BROWSER_TAB_HANDLE_STALE',
  );
});

test('browser tool catalog exposes every supported call including bounded navigation wait', async () => {
  const h = harness();
  assert.deepEqual(h.tools.descriptors().map(({ name }) => name), [
    'toolbraid.browser.tabs_list',
    'toolbraid.browser.tab_open',
    'toolbraid.browser.tab_activate',
    'toolbraid.browser.active_navigate',
    'toolbraid.browser.active_back',
    'toolbraid.browser.active_forward',
    'toolbraid.browser.active_reload',
    'toolbraid.browser.active_wait',
    'toolbraid.browser.tab_close',
  ]);
  const result = await h.tools.call('toolbraid.browser.active_wait', {
    timeoutMs: 100,
    urlPrefix: 'https://example.test/a',
  });
  assert.deepEqual(result, { loaded: true, url: 'https://example.test/a', title: 'A' });
  const waitDescriptor = h.tools.descriptors().find(({ name }) => name.endsWith('.active_wait'));
  assert.equal(waitDescriptor.annotations.readOnlyHint, true);
  assert.equal(waitDescriptor.annotations.idempotentHint, true);
});

test('active wait rejects unsafe prefixes, invalid bounds, and expires without leaking tab state', async () => {
  const h = harness();
  await assert.rejects(
    h.tools.call('toolbraid.browser.active_wait', { timeoutMs: 99 }),
    (error) => error.code === 'BROWSER_TIMEOUT_INVALID',
  );
  await assert.rejects(
    h.tools.call('toolbraid.browser.active_wait', { urlPrefix: 'javascript:alert(1)' }),
    (error) => error.code === 'BROWSER_URL_INVALID',
  );
  h.tabs.set(7, { ...h.tabs.get(7), status: 'loading' });
  await assert.rejects(
    h.tools.call('toolbraid.browser.active_wait', { timeoutMs: 100 }),
    (error) => error.code === 'BROWSER_WAIT_TIMEOUT' && !error.message.includes('https://'),
  );
});
