import assert from 'node:assert/strict';
import test from 'node:test';

import { createHumanVerificationOwnerTools } from '../../extension/human-verification-owner-tools.js';

function context({ challenged = true, fingerprint = 'a'.repeat(64) } = {}) {
  return {
    binding: { tabId: 7, windowId: 2, frameId: 0, sessionId: 'tab-7-session', origin: 'https://example.test' },
    snapshot: {
      metadata: { url: 'https://example.test/login', title: challenged ? 'Verify you are human' : 'Welcome' },
      mainText: challenged ? 'Cloudflare security check' : 'Signed in',
      accessibleControls: [], elementRefs: [], pageFingerprint: fingerprint,
    },
  };
}

test('creates a human-only challenge handoff and validates disappearance plus page advance', async () => {
  let current = context();
  const tools = createHumanVerificationOwnerTools({
    getSnapshotContext: async () => current,
    cryptoRef: { getRandomValues(bytes) { bytes.fill(3); } },
  });
  const status = await tools.call('toolbraid.human_verification.status', {});
  assert.equal(status.required, true);
  assert.deepEqual(status.automation, { solveChallenge: false, evadeAntiBot: false });
  current = context({ challenged: false, fingerprint: 'b'.repeat(64) });
  assert.deepEqual(await tools.call('toolbraid.human_verification.validate', { token: status.token }), {
    ok: true, reason: 'verified-and-advanced', remaining: [],
  });
});

test('does not invent a handoff and fails closed on stale binding', async () => {
  let current = context({ challenged: false });
  const tools = createHumanVerificationOwnerTools({
    getSnapshotContext: async () => current,
    cryptoRef: { getRandomValues(bytes) { bytes.fill(4); } },
  });
  assert.deepEqual(await tools.call('toolbraid.human_verification.status', {}), { required: false, challenges: [] });
  current = context();
  const status = await tools.call('toolbraid.human_verification.status', {});
  current = { ...context({ challenged: false, fingerprint: 'b'.repeat(64) }), binding: { ...context().binding, frameId: 2 } };
  await assert.rejects(
    tools.call('toolbraid.human_verification.validate', { token: status.token }),
    (error) => error.code === 'HUMAN_VERIFICATION_SESSION_DRIFT',
  );
});

test('accepts one same-origin replacement session after navigation and rejects replay', async () => {
  let current = context();
  const tools = createHumanVerificationOwnerTools({ getSnapshotContext: async () => current, cryptoRef: { getRandomValues(bytes) { bytes.fill(8); } } });
  const status = await tools.call('toolbraid.human_verification.status', {});
  current = {
    ...context({ challenged: false, fingerprint: 'c'.repeat(64) }),
    binding: { ...context().binding, sessionId: 'tab-7-replacement' },
  };
  assert.equal((await tools.call('toolbraid.human_verification.validate', { token: status.token })).ok, true);
  await assert.rejects(tools.call('toolbraid.human_verification.validate', { token: status.token }), { code: 'HUMAN_VERIFICATION_TOKEN_STALE' });
});

test('rejects replacement-session origin drift and consumes the unsafe token', async () => {
  let current = context();
  const tools = createHumanVerificationOwnerTools({ getSnapshotContext: async () => current, cryptoRef: { getRandomValues(bytes) { bytes.fill(9); } } });
  const status = await tools.call('toolbraid.human_verification.status', {});
  current = {
    ...context({ challenged: false, fingerprint: 'd'.repeat(64) }),
    binding: { ...context().binding, sessionId: 'replacement', origin: 'https://evil.test' },
    snapshot: { ...context({ challenged: false }).snapshot, metadata: { url: 'https://evil.test/', title: 'Done' }, pageFingerprint: 'd'.repeat(64) },
  };
  await assert.rejects(tools.call('toolbraid.human_verification.validate', { token: status.token }), { code: 'HUMAN_VERIFICATION_SESSION_DRIFT' });
  await assert.rejects(tools.call('toolbraid.human_verification.validate', { token: status.token }), { code: 'HUMAN_VERIFICATION_TOKEN_STALE' });
});
