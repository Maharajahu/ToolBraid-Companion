import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import { createVisualOwnerTools } from '../../extension/visual-owner-tools.js';

const bytes = new Uint8Array([1, 2, 3, 4]);
const digest = async (_algorithm, input) => createHash('sha256').update(new Uint8Array(input)).digest().buffer;
function context(challenged = false) {
  return {
    binding: { tabId: 7, windowId: 2, frameId: 0, sessionId: 'tab-7-session', origin: 'https://example.test', pageFingerprint: 'a'.repeat(64) },
    snapshot: { metadata: { url: 'https://example.test/', title: challenged ? 'Verify you are human' : 'Canvas app' }, mainText: challenged ? 'hCaptcha challenge' : 'Ready', accessibleControls: [], elementRefs: [] },
  };
}

test('visual click requires an identical recapture and dispatches one bound point', async () => {
  const clicks = [];
  const tools = createVisualOwnerTools({
    getSnapshotContext: async () => context(),
    captureVisual: async ({ analyze = true }) => ({ bytes: new Uint8Array(bytes), viewport: { width: 100, height: 80, deviceScaleFactor: 1 }, analysis: analyze ? { summary: 'Play button', regions: [{ label: 'Play', x: 20, y: 10 }] } : null }),
    dispatchClick: async (request) => clicks.push({ point: request.point, screenshotHash: request.descriptor.screenshotHash }),
    cryptoRef: { subtle: { digest }, getRandomValues(target) { target.fill(5); } },
  });
  const inspected = await tools.call('toolbraid.visual.inspect', { objective: 'Find Play' });
  assert.equal(inspected.screenshotHash, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(inspected.analysis.regions[0].label, 'Play');
  const result = await tools.call('toolbraid.visual.click', { token: inspected.token, x: 20, y: 10 });
  assert.equal(result.clicked, true);
  assert.deepEqual(clicks, [{ point: { x: 20, y: 10, radius: 1 }, screenshotHash: inspected.screenshotHash }]);
});

test('visual tools block challenge pages and reject screenshot drift', async () => {
  let challenged = true;
  let currentBytes = new Uint8Array(bytes);
  const tools = createVisualOwnerTools({
    getSnapshotContext: async () => context(challenged),
    captureVisual: async () => ({ bytes: new Uint8Array(currentBytes), viewport: { width: 100, height: 80, deviceScaleFactor: 1 }, analysis: {} }),
    dispatchClick: async () => assert.fail('must not click'),
    cryptoRef: { subtle: { digest }, getRandomValues(target) { target.fill(6); } },
  });
  await assert.rejects(tools.call('toolbraid.visual.inspect', {}), (error) => error.code === 'HUMAN_VERIFICATION_REQUIRED');
  challenged = false;
  const inspected = await tools.call('toolbraid.visual.inspect', {});
  currentBytes = new Uint8Array([9, 9, 9]);
  await assert.rejects(tools.call('toolbraid.visual.click', { token: inspected.token, x: 1, y: 1 }), (error) => error.code === 'VISUAL_TARGET_DRIFT');
});

test('zeroizes screenshot bytes when hashing rejects', async () => {
  const retained = new Uint8Array([7, 8, 9]);
  const tools = createVisualOwnerTools({
    getSnapshotContext: async () => context(),
    captureVisual: async () => ({ bytes: retained, viewport: { width: 10, height: 10, deviceScaleFactor: 1 }, analysis: {} }),
    dispatchClick: async () => {},
    cryptoRef: { subtle: { digest: async () => { throw new Error('digest failed'); } }, getRandomValues(target) { target.fill(1); } },
  });
  await assert.rejects(tools.call('toolbraid.visual.inspect', {}), /digest failed/);
  assert.deepEqual([...retained], [0, 0, 0]);
});

test('bounds and normalizes untrusted visual regions below the native envelope', async () => {
  const huge = 'x'.repeat(100_000);
  const tools = createVisualOwnerTools({
    getSnapshotContext: async () => context(),
    captureVisual: async () => ({ bytes: new Uint8Array(bytes), viewport: { width: 100, height: 80, deviceScaleFactor: 1 }, analysis: { regions: Array.from({ length: 256 }, () => ({ label: huge, role: huge, nested: { huge }, x: 1, y: 2 })) } }),
    dispatchClick: async () => {},
    cryptoRef: { subtle: { digest }, getRandomValues(target) { target.fill(2); } },
  });
  const result = await tools.call('toolbraid.visual.inspect', {});
  assert.ok(Buffer.byteLength(JSON.stringify(result.analysis.regions)) < 64 * 1024);
  assert.equal(result.analysis.regions[0].label.length, 256);
  assert.equal(Object.hasOwn(result.analysis.regions[0], 'nested'), false);
});
