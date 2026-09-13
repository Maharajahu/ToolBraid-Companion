import assert from 'node:assert/strict';
import test from 'node:test';
import { createVisualTargetDescriptor, revalidateVisualTarget } from '../../extension/visual-targets.js';

const hash = 'a'.repeat(64);
const descriptor = () => createVisualTargetDescriptor({ screenshotHash: hash, viewport: { width: 1280, height: 720, deviceScaleFactor: 2 }, x: 640, y: 360, radius: 12, origin: 'https://example.test' });

test('binds a bounded visual point to screenshot, viewport and origin', () => {
  const target = descriptor();
  assert.deepEqual(target.point, { x: 640, y: 360, radius: 12 });
  assert.equal(revalidateVisualTarget(target, { screenshotHash: hash, viewport: target.viewport, origin: target.origin }).ok, true);
});

test('fails closed on screenshot, viewport, and origin drift', () => {
  const target = descriptor();
  assert.equal(revalidateVisualTarget(target, { screenshotHash: 'b'.repeat(64), viewport: target.viewport, origin: target.origin }).reason, 'screenshot-drift');
  assert.equal(revalidateVisualTarget(target, { screenshotHash: hash, viewport: { ...target.viewport, width: 1279 }, origin: target.origin }).reason, 'viewport-drift');
  assert.equal(revalidateVisualTarget(target, { screenshotHash: hash, viewport: target.viewport, origin: 'https://other.test' }).reason, 'origin-drift');
});

test('rejects malformed hashes and out-of-viewport coordinates', () => {
  assert.throws(() => createVisualTargetDescriptor({ screenshotHash: 'no', viewport: { width: 10, height: 10 }, x: 1, y: 1 }), /SHA-256/);
  assert.throws(() => createVisualTargetDescriptor({ screenshotHash: hash, viewport: { width: 10, height: 10 }, x: 10, y: 1 }), /x must/);
});
