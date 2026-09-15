import assert from 'node:assert/strict';
import test from 'node:test';
import { createSidepanelApp, normalizeState } from '../../extension/sidepanel.js';

// Exercise the real public panel handlers without granting browser permissions.
async function panelHarness(t, { tab = { id: 12, origin: 'https://example.test' }, grant = true } = {}) {
  const calls = [];
  const nodes = new Map();
  const documentRef = { getElementById: (id) => nodes.get(id) ?? null };
  for (const id of ['public-access-panel', 'access-status', 'access-consent', 'access-consent-label',
    'access-site', 'access-help', 'access-setup', 'access-enable', 'access-pause', 'access-debugger',
    'connection-badge', 'owner-mode-badge', 'owner-mode-summary', 'workflow-now', 'workflow-next', 'workflow-required']) {
    const listeners = new Map();
    nodes.set(id, { textContent: '', checked: false, disabled: false, hidden: false,
      addEventListener: (name, listener) => listeners.set(name, listener),
      emit: async (name, event = { isTrusted: true }) => listeners.get(name)?.(event),
      scrollIntoView: () => calls.push('show-setup'),
      focus: () => { documentRef.activeElement = nodes.get(id); },
    });
  }
  let enabled = false;
  const browser = {
    permissions: {
      contains: async () => true,
      request: async (request) => { calls.push(['permission', request]); return grant; },
    },
    runtime: { async sendMessage(message) {
      if (message.type === 'UI_GET_ACCESS') return { ok: true, access: { enabled }, tab };
      calls.push(message);
      if (message.type === 'UI_SET_ACCESS') enabled = message.payload.enabled;
      return { ok: true };
    } },
  };
  const app = createSidepanelApp({ documentRef, browser, windowRef: null, controller: {
    async refresh() { calls.push('refresh-page'); return normalizeState({ connected: true }); },
  } });
  t.after(() => app.destroy());
  await app.initialRefresh();
  return { app, calls, nodes, enabled: () => enabled };
}

test('first run explains the disabled button and Finish setup only focuses consent', async (t) => {
  const h = await panelHarness(t);
  assert.equal(h.nodes.get('access-setup').hidden, false);
  assert.equal(h.nodes.get('access-enable').disabled, true);
  assert.match(h.nodes.get('access-help').textContent, /tick the checkbox/);
  await h.nodes.get('access-setup').emit('click', { isTrusted: false });
  assert.deepEqual(h.calls, []);
  await h.nodes.get('access-setup').emit('click');
  assert.deepEqual(h.calls, ['show-setup']);
  assert.equal(h.nodes.get('access-consent').checked, false);
  assert.equal(h.enabled(), false);
  await h.nodes.get('access-enable').emit('click');
  assert.deepEqual(h.calls, ['show-setup']);
});

test('a browser settings or new-tab page has an explicit normal-website instruction', async (t) => {
  const h = await panelHarness(t, { tab: null });
  h.nodes.get('access-consent').checked = true;
  await h.nodes.get('access-consent').emit('change');
  assert.equal(h.nodes.get('access-enable').disabled, true);
  assert.match(h.nodes.get('access-help').textContent, /https:\/\/example\.org\//);
  assert.match(h.nodes.get('access-help').textContent, /new-tab pages cannot be connected/);
  await h.nodes.get('access-enable').emit('click');
  assert.deepEqual(h.calls, []);
});

test('declining site access stays paused and sends no enable or connection command', async (t) => {
  const h = await panelHarness(t, { grant: false });
  h.nodes.get('access-consent').checked = true;
  await h.nodes.get('access-consent').emit('change');
  assert.equal(h.nodes.get('access-enable').disabled, false);
  await h.nodes.get('access-enable').emit('click');
  assert.deepEqual(h.calls, [['permission', { origins: ['https://example.test/*'] }]]);
  assert.equal(h.enabled(), false);
  assert.equal(h.nodes.get('access-setup').hidden, false);
});

test('consent plus the exact site grant connects, and pausing restores the setup action', async (t) => {
  const h = await panelHarness(t);
  h.nodes.get('access-consent').checked = true;
  await h.nodes.get('access-consent').emit('change');
  assert.match(h.nodes.get('access-help').textContent, /No AI sign-in is needed/);
  await h.nodes.get('access-enable').emit('click', { isTrusted: false });
  assert.deepEqual(h.calls, []);
  await h.nodes.get('access-enable').emit('click');
  assert.deepEqual(h.calls.slice(0, 3), [
    ['permission', { origins: ['https://example.test/*'] }],
    { type: 'UI_SET_ACCESS', payload: { enabled: true } },
    { type: 'UI_CONNECT_SITE', payload: { targetTabId: 12, origin: 'https://example.test' } },
  ]);
  assert.equal(h.nodes.get('access-setup').hidden, true);
  assert.equal(h.nodes.get('access-pause').hidden, false);
  await h.nodes.get('access-pause').emit('click');
  assert.equal(h.enabled(), false);
  assert.equal(h.nodes.get('access-setup').hidden, false);
  assert.equal(h.nodes.get('access-consent').checked, false);
  assert.equal(h.nodes.get('access-enable').disabled, true);
});
