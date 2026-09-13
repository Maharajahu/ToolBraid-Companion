import { detectHumanVerification } from './human-verification.js';
import { createVisualTargetDescriptor, revalidateVisualTarget } from './visual-targets.js';

const PREFIX = 'toolbraid.visual.';
const CAPTURE_TTL_MS = 2 * 60_000;
const MAX_CAPTURES = 16;

export class VisualOwnerToolError extends Error {
  constructor(code, message) { super(message); this.name = 'VisualOwnerToolError'; this.code = code; }
}

function fail(code, message) { throw new VisualOwnerToolError(code, message); }
function schema(properties = {}, required = []) { return Object.freeze({ type: 'object', properties, required, additionalProperties: false }); }

const DESCRIPTORS = Object.freeze([
  Object.freeze({
    name: `${PREFIX}inspect`,
    title: 'Inspect visible canvas UI',
    description: 'Capture and analyze the visible tab for canvas or custom-rendered controls using the explicitly configured multimodal provider. CAPTCHA and browser-challenge pages require human handoff.',
    inputSchema: schema({ objective: { type: 'string', maxLength: 1000 } }),
    annotations: Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }),
    _meta: Object.freeze({ 'toolbraid/ownerOnly': true, 'toolbraid/surface': 'visual' }),
  }),
  Object.freeze({
    name: `${PREFIX}click`,
    title: 'Click exact visual target',
    description: 'Click one CSS-pixel point from a fresh visual inspection only when the screenshot, viewport, page session, and origin are unchanged. CAPTCHA targets are never accepted.',
    inputSchema: schema({
      token: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      x: { type: 'integer', minimum: 0, maximum: 32767 },
      y: { type: 'integer', minimum: 0, maximum: 32767 },
      radius: { type: 'integer', minimum: 1, maximum: 256 },
      label: { type: 'string', maxLength: 180 },
    }, ['token', 'x', 'y']),
    annotations: Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }),
    _meta: Object.freeze({ 'toolbraid/ownerOnly': true, 'toolbraid/surface': 'visual' }),
  }),
]);

function sameBinding(left, right) {
  return Boolean(left && right
    && left.tabId === right.tabId
    && left.windowId === right.windowId
    && left.frameId === right.frameId
    && left.sessionId === right.sessionId
    && left.origin === right.origin
    && left.pageFingerprint === right.pageFingerprint);
}

function token(cryptoRef) {
  if (typeof cryptoRef?.getRandomValues !== 'function') fail('VISUAL_CRYPTO_UNAVAILABLE', 'Secure visual capture tokens are unavailable.');
  const bytes = new Uint8Array(32);
  cryptoRef.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(bytes, cryptoRef) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) fail('VISUAL_CAPTURE_INVALID', 'Visible screenshot bytes are unavailable.');
  if (typeof cryptoRef?.subtle?.digest !== 'function') fail('VISUAL_HASH_UNAVAILABLE', 'SHA-256 is unavailable for visual target binding.');
  const digest = new Uint8Array(await cryptoRef.subtle.digest('SHA-256', bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function boundedAnalysis(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const regions = [];
  let regionBytes = 2;
  for (const raw of Array.isArray(source.regions) ? source.regions.slice(0, 256) : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const region = {};
    for (const key of ['label', 'role']) if (typeof raw[key] === 'string') region[key] = raw[key].slice(0, 256);
    for (const key of ['x', 'y', 'width', 'height', 'confidence']) if (Number.isFinite(raw[key])) region[key] = raw[key];
    const encoded = JSON.stringify(region);
    if (regionBytes + encoded.length + 1 > 48 * 1024) break;
    regionBytes += encoded.length + 1;
    regions.push(Object.freeze(region));
  }
  return Object.freeze({
    summary: typeof source.summary === 'string' ? source.summary.slice(0, 16_000) : null,
    text: typeof source.text === 'string' ? source.text.slice(0, 32_000) : null,
    labels: Object.freeze(Array.isArray(source.labels) ? source.labels.slice(0, 128).map((entry) => String(entry).slice(0, 256)) : []),
    regions: Object.freeze(regions),
    warnings: Object.freeze(Array.isArray(source.warnings) ? source.warnings.slice(0, 64).map((entry) => String(entry).slice(0, 256)) : []),
    confidence: Number.isFinite(source.confidence) ? Math.max(0, Math.min(1, source.confidence)) : null,
    model: typeof source.model === 'string' ? source.model.slice(0, 256) : null,
    untrustedContent: true,
  });
}

export function createVisualOwnerTools({
  captureVisual,
  getSnapshotContext,
  dispatchClick,
  cryptoRef = globalThis.crypto,
  nowRef = Date.now,
} = {}) {
  if (typeof captureVisual !== 'function' || typeof getSnapshotContext !== 'function' || typeof dispatchClick !== 'function') {
    throw new TypeError('captureVisual, getSnapshotContext, and dispatchClick are required.');
  }
  const captures = new Map();

  function prune() {
    const now = nowRef();
    for (const [key, entry] of captures) if (entry.expiresAt <= now) captures.delete(key);
    while (captures.size >= MAX_CAPTURES) captures.delete(captures.keys().next().value);
  }

  async function contextWithoutChallenge() {
    const context = await getSnapshotContext();
    if (context.binding.frameId !== 0) fail('VISUAL_TOP_FRAME_REQUIRED', 'Visual coordinate actions currently require the selected top frame. Use frame tools for iframe DOM controls.');
    if (detectHumanVerification(context.snapshot).length) {
      fail('HUMAN_VERIFICATION_REQUIRED', 'Complete the CAPTCHA or browser challenge manually, then validate it before visual automation resumes.');
    }
    return context;
  }

  async function call(name, args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) fail('VISUAL_ARGUMENTS_INVALID', 'Visual tool arguments must be an object.');
    prune();
    const suffix = name.startsWith(PREFIX) ? name.slice(PREFIX.length) : '';
    if (suffix === 'inspect') {
      const context = await contextWithoutChallenge();
      const capture = await captureVisual({ context, objective: typeof args.objective === 'string' ? args.objective.slice(0, 1000) : '' });
      let screenshotHash;
      try { screenshotHash = await sha256(capture.bytes, cryptoRef); }
      finally { try { capture.bytes.fill(0); } catch { /* best effort */ } }
      const captureToken = token(cryptoRef);
      captures.set(captureToken, Object.freeze({
        screenshotHash,
        viewport: capture.viewport,
        origin: context.binding.origin,
        binding: context.binding,
        expiresAt: nowRef() + CAPTURE_TTL_MS,
      }));
      return Object.freeze({
        token: captureToken,
        viewport: Object.freeze({ ...capture.viewport }),
        screenshotHash,
        analysis: boundedAnalysis(capture.analysis),
        expiresInMs: CAPTURE_TTL_MS,
      });
    }
    if (suffix === 'click') {
      const entry = typeof args.token === 'string' ? captures.get(args.token) : null;
      if (!entry || entry.expiresAt <= nowRef()) {
        if (entry) captures.delete(args.token);
        fail('VISUAL_CAPTURE_STALE', 'Inspect the current visible tab again before clicking a visual target.');
      }
      const context = await contextWithoutChallenge();
      if (!sameBinding(entry.binding, context.binding)) {
        captures.delete(args.token);
        fail('VISUAL_CONTEXT_DRIFT', 'The selected tab, page, or session changed after visual inspection.');
      }
      const descriptor = createVisualTargetDescriptor({
        screenshotHash: entry.screenshotHash,
        viewport: entry.viewport,
        x: args.x,
        y: args.y,
        radius: args.radius ?? 1,
        label: args.label ?? 'visual target',
        origin: entry.origin,
      });
      const fresh = await captureVisual({ context, objective: '', analyze: false });
      let freshHash;
      try { freshHash = await sha256(fresh.bytes, cryptoRef); }
      finally { try { fresh.bytes.fill(0); } catch { /* best effort */ } }
      const validation = revalidateVisualTarget(descriptor, {
        screenshotHash: freshHash,
        viewport: fresh.viewport,
        origin: context.binding.origin,
      });
      if (!validation.ok) {
        captures.delete(args.token);
        fail('VISUAL_TARGET_DRIFT', `The visual target is stale: ${validation.reason}.`);
      }
      await dispatchClick({ context, point: validation.point, descriptor });
      captures.delete(args.token);
      return Object.freeze({ clicked: true, point: validation.point, label: descriptor.label, pageFingerprint: context.binding.pageFingerprint });
    }
    fail('VISUAL_TOOL_UNKNOWN', 'The visual owner tool is not supported.');
  }

  function invalidate() { prune(); }
  return Object.freeze({ descriptors: () => DESCRIPTORS, call, invalidate });
}

export { CAPTURE_TTL_MS as VISUAL_CAPTURE_TTL_MS };
