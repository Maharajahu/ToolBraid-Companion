const MAX_FRAMES = 32;
const MAX_TEXT = 512;

const PROVIDERS = Object.freeze([
  ['recaptcha', /(?:g-recaptcha|recaptcha|google\.com\/recaptcha)/iu],
  ['hcaptcha', /(?:h-captcha|hcaptcha\.com)/iu],
  ['turnstile', /(?:cf-turnstile|challenges\.cloudflare\.com\/turnstile)/iu],
  ['arkose', /(?:arkose|funcaptcha)/iu],
  ['cloudflare', /(?:cloudflare|verify you are human|checking your browser)/iu],
]);

function text(value, limit = MAX_TEXT) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function url(value) {
  try { return new URL(value); } catch { return null; }
}

function originOf(value) {
  const parsed = url(value);
  return parsed && ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : null;
}

function pageText(snapshot) {
  const controls = Array.isArray(snapshot?.accessibleControls) ? snapshot.accessibleControls : [];
  const elements = Array.isArray(snapshot?.elementRefs) ? snapshot.elementRefs : [];
  return [snapshot?.metadata?.url, snapshot?.metadata?.title, snapshot?.metadata?.text, ...controls.flatMap((item) => [item?.name, item?.text, item?.role, item?.type, item?.attributes?.src, item?.attributes?.class]), ...elements.flatMap((item) => [item?.name, item?.text, item?.attributes?.src, item?.attributes?.class])]
    .map((value) => text(value)).filter(Boolean).join(' ').slice(0, 32_768);
}

function providerFor(value) {
  for (const [provider, pattern] of PROVIDERS) if (pattern.test(value)) return provider;
  return 'unknown';
}

function challengeKind(value) {
  if (/captcha|recaptcha|hcaptcha|turnstile|funcaptcha/iu.test(value)) return 'captcha';
  if (/verify you are human|security check|checking your browser|browser challenge|security challenge|human verification/iu.test(value)) return 'browser-challenge';
  return null;
}

function candidate(snapshot, frame = null) {
  const haystack = pageText(snapshot);
  const kind = challengeKind(haystack);
  if (!kind) return null;
  const pageUrl = text(snapshot?.metadata?.url || frame?.url, 8192);
  return Object.freeze({
    kind,
    provider: providerFor(haystack),
    frame: Object.freeze({ top: frame === null, index: frame?.index ?? null, name: text(frame?.name, 128) || null, url: pageUrl || null }),
    origin: originOf(pageUrl),
  });
}

/** Detects only evidence available in the top snapshot and explicitly accessible frame snapshots. */
export function detectHumanVerification(snapshot) {
  const found = [];
  const top = candidate(snapshot);
  if (top) found.push(top);
  const frames = Array.isArray(snapshot?.frames) ? snapshot.frames.slice(0, MAX_FRAMES) : [];
  frames.forEach((frame, index) => {
    if (frame?.accessible !== true || !frame.snapshot) return;
    const match = candidate(frame.snapshot, { index: Number.isInteger(frame.frameId) ? frame.frameId : index, name: frame.name, url: frame.url });
    if (match) found.push(match);
  });
  return Object.freeze(found);
}

export function createHumanVerificationHandoff(snapshot) {
  const challenges = detectHumanVerification(snapshot);
  if (!challenges.length) return null;
  return Object.freeze({
    type: 'human-verification',
    title: 'Human verification required',
    description: 'Complete the visible verification manually, then request post-human validation.',
    challenges,
    binding: Object.freeze({
      origin: originOf(snapshot?.metadata?.url),
      url: text(snapshot?.metadata?.url, 8192) || null,
      pageFingerprint: text(snapshot?.pageFingerprint, 128) || null,
    }),
    automation: Object.freeze({ solveChallenge: false, evadeAntiBot: false }),
  });
}

export function validatePostHumanVerification(handoff, snapshot) {
  if (handoff?.type !== 'human-verification' || !handoff.binding) throw new TypeError('A human-verification handoff is required.');
  const currentOrigin = originOf(snapshot?.metadata?.url);
  if (handoff.binding.origin && currentOrigin !== handoff.binding.origin) {
    return Object.freeze({ ok: false, reason: 'origin-changed', remaining: detectHumanVerification(snapshot) });
  }
  const remaining = detectHumanVerification(snapshot);
  if (remaining.length) return Object.freeze({ ok: false, reason: 'challenge-still-present', remaining });
  const currentUrl = text(snapshot?.metadata?.url, 8192) || null;
  const currentFingerprint = text(snapshot?.pageFingerprint, 128) || null;
  const advanced = currentUrl !== handoff.binding.url || (currentFingerprint && currentFingerprint !== handoff.binding.pageFingerprint);
  return Object.freeze({ ok: advanced, reason: advanced ? 'verified-and-advanced' : 'page-did-not-advance', remaining });
}

export { MAX_FRAMES as MAX_HUMAN_VERIFICATION_FRAMES };
