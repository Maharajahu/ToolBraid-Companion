import assert from 'node:assert/strict';
import test from 'node:test';
import { createHumanVerificationHandoff, detectHumanVerification, validatePostHumanVerification } from '../../extension/human-verification.js';

const page = (overrides = {}) => ({ metadata: { url: 'https://example.test/login', title: 'Login' }, pageFingerprint: 'before', accessibleControls: [], elementRefs: [], ...overrides });

test('detects top and accessible-frame challenges without inspecting inaccessible frames', () => {
  const snapshot = page({
    accessibleControls: [{ role: 'checkbox', name: 'I am not a robot', attributes: { class: 'g-recaptcha' } }],
    frames: [
      { accessible: true, url: 'https://challenges.cloudflare.com/turnstile/x', snapshot: page({ metadata: { url: 'https://challenges.cloudflare.com/turnstile/x' }, accessibleControls: [{ role: 'checkbox', name: 'Verify you are human' }] }) },
      { accessible: false, snapshot: page({ accessibleControls: [{ name: 'hcaptcha' }] }) },
    ],
  });
  const found = detectHumanVerification(snapshot);
  assert.equal(found.length, 2);
  assert.equal(found[0].provider, 'recaptcha');
  assert.deepEqual([found[1].provider, found[1].frame.top, found[1].frame.index], ['turnstile', false, 0]);
});

test('handoff forbids solving and validation requires disappearance plus advancement', () => {
  const before = page({ accessibleControls: [{ role: 'checkbox', name: 'hCaptcha challenge' }] });
  const handoff = createHumanVerificationHandoff(before);
  assert.deepEqual(handoff.automation, { solveChallenge: false, evadeAntiBot: false });
  assert.equal(validatePostHumanVerification(handoff, before).reason, 'challenge-still-present');
  assert.equal(validatePostHumanVerification(handoff, page()).reason, 'page-did-not-advance');
  assert.deepEqual(validatePostHumanVerification(handoff, page({ pageFingerprint: 'after' })), { ok: true, reason: 'verified-and-advanced', remaining: [] });
});

test('post-human validation fails closed across origins', () => {
  const handoff = createHumanVerificationHandoff(page({ accessibleControls: [{ name: 'Verify you are human challenge' }] }));
  assert.equal(validatePostHumanVerification(handoff, page({ metadata: { url: 'https://evil.test/' }, pageFingerprint: 'after' })).reason, 'origin-changed');
});

test('ordinary standalone challenge wording is not human verification', () => {
  assert.deepEqual(detectHumanVerification(page({ metadata: { url: 'https://example.test/', title: 'Weekly coding challenge' }, mainText: 'Join our fitness challenge.' })), []);
});
