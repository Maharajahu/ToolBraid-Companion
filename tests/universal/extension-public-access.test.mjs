import assert from 'node:assert/strict';
import test from 'node:test';
import { createServiceWorkerController } from '../../extension/service-worker.js';
import { MESSAGE_TYPES } from '../../extension/protocol.js';
import { createExtensionMcpEndpoint, installNativeMcpBridge } from '../../extension/native-mcp-bridge.js';

const id = 'public-access-test';
const sender = { id, url: `chrome-extension://${id}/sidepanel.html` };
const tab = { id: 12, url: 'https://example.test/article', active: true, status: 'complete' };
function harness(values = {}) {
  const injections = [];
  const changes = [];
  const api = {
    runtime: { id },
    storage: { local: {
      async get(key) { return { [key]: values[key] }; },
      async set(record) { Object.assign(values, record); },
      async remove(key) { delete values[key]; },
    } },
    tabs: { query: async () => [tab], get: async () => tab },
    permissions: { contains: async () => true, request: async () => { throw new Error('No automatic permission request is allowed.'); } },
    scripting: { executeScript: async (details) => { injections.push(details); return []; } },
  };
  const controller = createServiceWorkerController({ chromeApi: api, publicRelease: true, onAccessChanged: (enabled) => changes.push(enabled) });
  const message = (type, payload) => controller.handleRuntimeMessage({ type, payload }, sender);
  return { api, values, injections, changes, controller, message };
}

test('public install is paused before consent and exposes no MCP or page authority', async () => {
  const h = harness();
  const state = await h.message('UI_GET_ACCESS');
  assert.equal(state.access.enabled, false);
  assert.deepEqual(state.tab, { id: tab.id, origin: 'https://example.test' });
  for (const type of [MESSAGE_TYPES.PAGE_READY, 'UI_GET_STATE', 'UI_EXECUTE_OWNER_ACTION']) {
    assert.equal((await h.message(type)).error.code, 'ACCESS_PAUSED');
  }
  for (const method of ['bridge.status', 'tools.list', 'tools.call']) {
    await assert.rejects(h.controller.mcpEndpoint.handle(method, {}), { code: 'ACCESS_PAUSED' });
  }
  assert.equal((await h.controller.activateOwnerTab(tab)).error.code, 'ACCESS_PAUSED');
  assert.equal((await h.controller.handleActivatedTab(tab.id)).error.code, 'ACCESS_PAUSED');
  assert.equal(h.injections.length, 0);
});

test('community and native WebMCP controls reject page and unrelated extension senders', async () => {
  const h = harness();
  await h.message('UI_SET_ACCESS', { enabled: true });
  for (const type of ['UI_COMMUNITY', 'UI_WEBMCP']) {
    for (const forged of [{ id, url: tab.url, tab }, { id, url: `chrome-extension://${id}/bridge.html` }]) {
      const result = await h.controller.handleRuntimeMessage({ type, operation: 'inspect' }, forged);
      assert.equal(result.error.code, 'UI_SENDER_INVALID');
    }
  }
  assert.equal(h.injections.length, 0);
});

test('only the canonical side panel can opt in, and the saved choice survives restart', async () => {
  const h = harness();
  for (const forged of [{ id, url: tab.url, tab }, { id, url: `chrome-extension://${id}/bridge.html` }, { id: 'other', url: sender.url }]) {
    const response = await h.controller.handleRuntimeMessage({ type: 'UI_SET_ACCESS', payload: { enabled: true } }, forged);
    assert.equal(response.error.code, 'UI_SENDER_INVALID');
  }
  assert.equal((await h.message('UI_SET_ACCESS', { enabled: 'true' })).error.code, 'ACCESS_SETTING_INVALID');
  assert.equal((await h.message('UI_SET_ACCESS', { enabled: true })).access.enabled, true);
  assert.deepEqual(h.changes, [true]);
  assert.equal((await harness(h.values).message('UI_GET_ACCESS')).access.enabled, true);
  assert.equal((await h.controller.activateOwnerTab(tab)).ok, true);
  assert.equal(h.injections.length, 2);
});

test('connection requires the reviewed active origin and an actual browser host grant', async () => {
  const h = harness();
  await h.message('UI_SET_ACCESS', { enabled: true });
  assert.equal((await h.message('UI_CONNECT_SITE', { targetTabId: 99, origin: 'https://example.test' })).error.code, 'ACTIVE_TAB_CHANGED');
  assert.equal((await h.message('UI_CONNECT_SITE', { targetTabId: tab.id, origin: 'https://other.test' })).error.code, 'ACTIVE_TAB_CHANGED');
  h.api.permissions.contains = async () => false;
  assert.equal((await h.message('UI_CONNECT_SITE', { targetTabId: tab.id, origin: 'https://example.test' })).error.code, 'HOST_PERMISSION_REQUIRED');
  assert.equal(h.injections.length, 0);
  h.api.permissions.contains = async (request) => {
    assert.deepEqual(request, { origins: ['https://example.test/*'] });
    return true;
  };
  assert.equal((await h.message('UI_CONNECT_SITE', { targetTabId: tab.id, origin: 'https://example.test' })).ok, true);
  assert.equal(h.injections.length, 2);
});

test('pause disconnects, clears live authority, rejects new requests and persists', async () => {
  const h = harness();
  await h.message('UI_SET_ACCESS', { enabled: true });
  let cleared = false;
  const clear = h.controller.registry.clear.bind(h.controller.registry);
  h.controller.registry.clear = () => { cleared = true; return clear(); };
  assert.equal((await h.message('UI_SET_ACCESS', { enabled: false })).access.enabled, false);
  assert.deepEqual(h.changes, [true, false]);
  assert.equal(cleared, true);
  await assert.rejects(h.controller.mcpEndpoint.listTools(), { code: 'ACCESS_PAUSED' });
  assert.equal((await h.controller.activateTab(tab)).error.code, 'ACCESS_PAUSED');
  assert.equal((await harness(h.values).message('UI_GET_ACCESS')).access.enabled, false);
});

test('paused endpoint cannot fall back to browser owner tools when the active page is unavailable', async () => {
  let calls = 0;
  const endpoint = createExtensionMcpEndpoint({
    authorize: async () => { throw Object.assign(new Error('Paused'), { code: 'ACCESS_PAUSED' }); },
    getState: async () => { calls += 1; return { ok: false }; },
    executeRead: async () => {}, prepareAction: async () => {}, executeOwnerAction: async () => {},
    nativeOwnerToolProviders: [{ descriptors: () => { calls += 1; return []; }, call: async () => { calls += 1; } }],
  });
  await assert.rejects(endpoint.listTools(), { code: 'ACCESS_PAUSED' });
  for (const method of ['bridge.status', 'tools.list', 'tools.call']) await assert.rejects(endpoint.handle(method), { code: 'ACCESS_PAUSED' });
  assert.equal(calls, 0);
});

test('native port can pause and resume but cannot reconnect while disabled or stopped', () => {
  let connections = 0;
  let disconnected = 0;
  let unsubscribed = 0;
  const timers = [];
  const bridge = installNativeMcpBridge({
    enabled: false,
    endpoint: { handle: async () => {}, onToolsChanged: () => () => { unsubscribed += 1; } },
    schedule: (callback) => { timers.push(callback); return timers.length; },
    chromeApi: { runtime: { connectNative() {
      connections += 1;
      return { onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {}, disconnect() { disconnected += 1; } };
    } } },
  });
  assert.equal(connections, 0);
  assert.equal(bridge.connect(), false);
  bridge.setEnabled(true);
  assert.equal(connections, 1);
  bridge.setEnabled(false);
  assert.equal(disconnected, 1);
  assert.equal(bridge.state().connected, false);
  assert.equal(bridge.connect(), false);
  assert.equal(unsubscribed, 0);
  bridge.setEnabled(true);
  assert.equal(connections, 2);
  bridge.stop();
  assert.equal(unsubscribed, 1);
  assert.equal(bridge.setEnabled(true), false);
});
