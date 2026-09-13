import assert from 'node:assert/strict';
import test from 'node:test';
import { createServiceWorkerController } from '../../extension/service-worker.js';
import { MESSAGE_TYPES, createEnvelope, parseEnvelope } from '../../extension/protocol.js';
import { isXDirectAction } from '../../src/site-adapters/x.js';

const extensionId = 'x-direct-control-test';
const postUrl = 'https://x.com/fixture/status/42';
const panel = { id: extensionId, url: `chrome-extension://${extensionId}/sidepanel.html` };
const button = (ref, name, testId, role = 'button') => ({ ref, name, role, type: 'button', attributes: { 'data-testid': testId } });
const editor = { ref: 'composer', role: 'textbox', type: 'textarea', name: 'Post text', attributes: { 'data-testid': 'tweetTextarea_0' } };
const cases = [
  { name: 'like_x_post', controls: [button('like', 'Like', 'like')] },
  { name: 'open_x_repost_menu', controls: [button('repost', 'Repost', 'retweet')] },
  { name: 'repost_x_post', controls: [button('confirm', 'Repost', 'retweetConfirm', 'menuitem')] },
  { name: 'open_x_quote_composer', controls: [button('quote', 'Quote', '', 'menuitem')] },
  { name: 'prepare_x_reply', controls: [editor], input: { text: 'Reply fixture' } },
  { name: 'prepare_x_post', controls: [editor], url: `https://x.com/compose/post?attachment_url=${encodeURIComponent(postUrl)}`, input: { text: 'Quote fixture' } },
  { name: 'publish_x_post', controls: [editor, button('publish', 'Post', 'tweetButton')], url: 'https://x.com/compose/post' },
];

async function harness(action = cases[0]) {
  const url = action.url ?? postUrl;
  let snapshot = {
    metadata: { url, origin: new URL(url).origin, title: 'Local X test', ...(!action.url ? { pageType: 'x-post' } : {}) },
    mainText: 'Local test only. No live X account is used.',
    accessibleControls: structuredClone(action.controls),
    elementRefs: action.controls.map((control) => ({ ...control, tagName: control.role === 'textbox' ? 'textarea' : 'button' })),
  };
  const values = {};
  const calls = [];
  const api = {
    runtime: { id: extensionId },
    storage: { local: {
      async get(key) { return { [key]: values[key] }; },
      async set(record) { Object.assign(values, record); },
      async remove(key) { delete values[key]; },
    } },
    tabs: { query: async () => [{ id: 12, windowId: 4, url, title: 'Local X test', active: true }], get: async () => ({ id: 12, windowId: 4, url, active: true }) },
    scripting: { executeScript: async () => [] },
  };
  const sender = { id: extensionId, tab: { id: 12, url }, frameId: 0, documentId: 'document-x-direct-control', url };
  const controller = createServiceWorkerController({ chromeApi: api, publicRelease: true, sendToContentScript: async (_tabId, message) => {
    if (message.type === MESSAGE_TYPES.PAGE_EXTRACT_SNAPSHOT) return { ok: true, snapshot };
    if (message.type === MESSAGE_TYPES.PAGE_ACTION_EXECUTE) {
      calls.push(message);
      return { ok: true, receipt: { receiptId: `x-fixture-${calls.length}`, changed: true } };
    }
    return { ok: true };
  } });
  const ui = (type, payload = {}) => controller.handleRuntimeMessage({ type, payload }, panel);
  assert.equal((await ui('UI_SET_ACCESS', { enabled: true })).ok, true);
  const ready = await controller.handleRuntimeMessage({ type: MESSAGE_TYPES.PAGE_READY, pageInstanceId: 'page-x-direct-control' }, sender);
  assert.equal(ready.ok, true);
  const channel = ready.channel;
  const ingested = await controller.handleRuntimeMessage({ type: MESSAGE_TYPES.PAGE_SNAPSHOT, sessionId: channel.sessionId, nonce: channel.nonce, snapshot }, sender);
  assert.equal(ingested.ok, true, JSON.stringify(ingested));
  return { controller, calls, channel, sender, ui, tools: ingested.state.tools, drift() { snapshot = { ...snapshot, metadata: { ...snapshot.metadata, title: 'Changed page' } }; } };
}

for (const route of ['panel', 'page', 'mcp']) {
  for (const action of cases) {
    test(`${route}: ${action.name} executes once using initial X authorization`, async () => {
      const h = await harness(action);
      const tool = h.tools.find((candidate) => candidate.name === action.name);
      assert.ok(tool, `${action.name} missing: ${h.tools.map((entry) => entry.name).join(', ')}`);
      assert.equal(isXDirectAction(tool), true);
      let response;
      if (route === 'panel') response = await h.ui('UI_PREPARE_ACTION', { actionId: tool.name, arguments: action.input ?? {} });
      if (route === 'mcp') {
        const listed = await h.controller.mcpEndpoint.handle('tools.list');
        const proxy = listed.tools.find((candidate) => candidate._meta?.['toolbraid/originalName'] === tool.name);
        assert.ok(proxy);
        assert.equal(proxy.annotations.readOnlyHint, false);
        assert.equal(proxy._meta['toolbraid/requiresApproval'], false);
        assert.equal(proxy._meta['toolbraid/authorization'], 'x-direct-control');
        response = await h.controller.mcpEndpoint.handle('tools.call', { name: proxy.name, arguments: action.input ?? {} });
      }
      if (route === 'page') {
        const pageResponse = await h.controller.handleRuntimeMessage({
          type: MESSAGE_TYPES.PAGE_EVENT,
          envelope: createEnvelope({ ...h.channel, type: MESSAGE_TYPES.EXECUTE_REQUEST, requestId: 'request-x-direct-control', payload: { name: tool.name, toolId: tool.name, input: action.input ?? {} } }),
        }, h.sender);
        const parsed = parseEnvelope(pageResponse.envelope, { nonce: h.channel.nonce, sessionId: h.channel.sessionId, tabId: h.channel.tabId, frameId: h.channel.frameId, documentId: h.channel.documentId, pageInstanceId: h.channel.pageInstanceId });
        assert.equal(parsed.ok, true, JSON.stringify({ parsed, pageResponse }));
        response = parsed.value.payload;
      }
      assert.equal(response.ok, true, JSON.stringify(response));
      assert.equal(response.result.status, 'dispatched');
      assert.equal(h.calls.length, 1);
      assert.equal(h.calls[0].approved, true);
      const target = action.controls.find((control) => control.ref === tool.target.ref);
      assert.deepEqual(h.calls[0].preparedAction.target.binding, {
        role: target.role, name: target.name, type: target.type, formRef: null,
      });
      assert.match(h.calls[0].approvalClaim.fingerprint, /^[a-f0-9]{64}$/);
      assert.equal((await h.controller.ensureUniversalRuntime()).runtime.state(12).pendingActions.length, 0);
    });
  }
}

test('X direct hints appear in the side panel only while owner control is active', async () => {
  const h = await harness();
  const state = (await h.ui('UI_GET_STATE')).state;
  assert.equal(state.actions.find((tool) => tool.name === 'like_x_post').directExecution, true);
  await h.ui('UI_SET_ACCESS', { enabled: false });
  assert.equal((await h.ui('UI_PREPARE_ACTION', { actionId: 'like_x_post' })).error.code, 'ACCESS_PAUSED');
  await assert.rejects(h.controller.mcpEndpoint.handle('tools.list'), { code: 'ACCESS_PAUSED' });
  assert.equal(h.calls.length, 0);
});

test('the direct X route still rejects changed page context before dispatch', async () => {
  const h = await harness();
  h.drift();
  const result = await h.ui('UI_PREPARE_ACTION', { actionId: 'like_x_post' });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /changed|drift/i);
  assert.equal(h.calls.length, 0);
});

test('other X controls keep their existing approval behavior', async () => {
  const h = await harness({ controls: [button('settings', 'Change account settings', '')], url: 'https://x.com/settings/account' });
  const tool = h.tools.find((candidate) => candidate.classification === 'mutate');
  assert.ok(tool);
  assert.equal(isXDirectAction(tool), false);
  const result = await h.ui('UI_PREPARE_ACTION', { actionId: tool.name });
  assert.equal(result.result.status, 'approval-required');
  assert.equal(h.calls.length, 0);
});

test('X direct policy does not trust a matching name on another origin or another adapter', async () => {
  const h = await harness();
  const tool = h.tools.find((candidate) => candidate.name === 'like_x_post');
  assert.equal(isXDirectAction({ ...tool, provenance: { ...tool.provenance, origin: 'https://evil.test', url: 'https://evil.test/post' } }), false);
  assert.equal(isXDirectAction({ ...tool, provenance: { ...tool.provenance, adapterId: 'untrusted' } }), false);
  assert.equal(isXDirectAction({ ...tool, name: 'delete_x_account' }), false);
});
