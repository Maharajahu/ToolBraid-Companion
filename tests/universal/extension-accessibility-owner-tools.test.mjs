import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccessibilityOwnerTools } from '../../extension/accessibility-owner-tools.js';

function context({ fingerprint = 'a'.repeat(64), challenged = false, frameId = 0 } = {}) {
  return {
    binding: { tabId: 7, windowId: 2, frameId, sessionId: 'session-7', origin: 'https://example.test', pageFingerprint: fingerprint },
    snapshot: {
      metadata: { url: 'https://example.test/app', title: challenged ? 'Verify you are human' : 'App' },
      mainText: challenged ? 'Cloudflare security check' : 'Ready', accessibleControls: [], elementRefs: [], pageFingerprint: fingerprint,
    },
  };
}

function node({ id = 'node-1', backend = 11, role = 'button', name = 'Continue', disabled = false, protectedValue = false } = {}) {
  return {
    nodeId: id, backendDOMNodeId: backend, ignored: false,
    role: { value: role }, name: { value: name },
    properties: [
      { name: 'disabled', value: { value: disabled } },
      { name: 'protected', value: { value: protectedValue } },
    ],
  };
}

test('lists bounded actionable AX controls and activates one after exact revalidation', async () => {
  let current = context();
  let activated = null;
  const tree = [node(), node({ id: 'node-2', backend: 12, role: 'link', name: 'Documentation' })];
  const tools = createAccessibilityOwnerTools({
    getSnapshotContext: async () => current,
    inspectTree: async () => ({ nodes: tree }),
    activateNode: async (request) => { activated = request; return { point: { x: 20, y: 30 } }; },
    cryptoRef: { getRandomValues(bytes) { bytes.fill(5); } },
  });
  const listed = await tools.call('toolbraid.ax.inspect', { name: 'continue', role: 'button' });
  assert.equal(listed.count, 1);
  assert.deepEqual(listed.controls[0], { handle: '05'.repeat(16), role: 'button', name: 'Continue', disabled: false });
  const result = await tools.call('toolbraid.ax.activate', { handle: listed.controls[0].handle });
  assert.equal(result.activated, true);
  assert.equal(activated.node.backendDOMNodeId, 11);
  await assert.rejects(tools.call('toolbraid.ax.activate', { handle: listed.controls[0].handle }), { code: 'AX_HANDLE_STALE' });
  current = context({ fingerprint: 'b'.repeat(64) });
});

test('filters protected and sensitive controls and rejects disabled-node drift', async () => {
  const tree = [
    node({ id: 'password', backend: 21, role: 'textbox', name: 'Password', protectedValue: true }),
    node({ id: 'card', backend: 22, role: 'textbox', name: 'Credit card number' }),
    node({ id: 'safe', backend: 23, name: 'Save' }),
  ];
  const tools = createAccessibilityOwnerTools({
    getSnapshotContext: async () => context(),
    inspectTree: async () => ({ nodes: tree }),
    activateNode: async () => ({}),
    cryptoRef: { getRandomValues(bytes) { bytes.fill(6); } },
  });
  const listed = await tools.call('toolbraid.ax.inspect', {});
  assert.deepEqual(listed.controls.map((control) => control.name), ['Save']);
  tree[2] = node({ id: 'safe', backend: 23, name: 'Save', disabled: true });
  await assert.rejects(tools.call('toolbraid.ax.activate', { handle: listed.controls[0].handle }), { code: 'AX_NODE_DRIFT' });
});

test('fails closed on page drift, iframe selection, human challenge, and invalid query', async () => {
  let current = context();
  const tools = createAccessibilityOwnerTools({
    getSnapshotContext: async () => current,
    inspectTree: async () => ({ nodes: [node()] }),
    activateNode: async () => ({}),
    cryptoRef: { getRandomValues(bytes) { bytes.fill(7); } },
  });
  const listed = await tools.call('toolbraid.ax.inspect', {});
  current = context({ fingerprint: 'b'.repeat(64) });
  await assert.rejects(tools.call('toolbraid.ax.activate', { handle: listed.controls[0].handle }), { code: 'AX_BINDING_DRIFT' });
  current = context({ frameId: 3 });
  await assert.rejects(tools.call('toolbraid.ax.inspect', {}), { code: 'AX_TOP_FRAME_REQUIRED' });
  current = context({ challenged: true });
  await assert.rejects(tools.call('toolbraid.ax.inspect', {}), { code: 'HUMAN_VERIFICATION_REQUIRED' });
  current = context();
  await assert.rejects(tools.call('toolbraid.ax.inspect', { limit: 101 }), { code: 'AX_QUERY_INVALID' });
});
