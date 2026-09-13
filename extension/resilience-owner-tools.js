const TOOL_PREFIX = 'toolbraid.resilience.';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STABLE_FOR_MS = 600;
const MIN_POLL_MS = 200;
const MAX_TIMEOUT_MS = 20_000;

export class ResilienceOwnerToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ResilienceOwnerToolError';
    this.code = code;
  }
}

function fail(code, message) { throw new ResilienceOwnerToolError(code, message); }
function object(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function schema(properties = {}, required = []) { return Object.freeze({ type: 'object', properties, required, additionalProperties: false }); }

const DESCRIPTORS = Object.freeze([
  ['wait_stable', 'Wait for stable page', 'Wait until the exact selected page fingerprint remains unchanged for a bounded stability window.', schema({
    timeoutMs: { type: 'integer', minimum: MIN_POLL_MS, maximum: MAX_TIMEOUT_MS },
    stableForMs: { type: 'integer', minimum: MIN_POLL_MS, maximum: MAX_TIMEOUT_MS },
  })],
  ['wait_for_control', 'Wait for page control', 'Wait until exactly one enabled accessible control on the exact selected page matches the normalized name and optional role.', schema({
    name: { type: 'string', minLength: 1, maxLength: 512 },
    role: { type: 'string', minLength: 1, maxLength: 128 },
    timeoutMs: { type: 'integer', minimum: MIN_POLL_MS, maximum: MAX_TIMEOUT_MS },
  }, ['name'])],
].map(([suffix, title, description, inputSchema]) => Object.freeze({
  name: `${TOOL_PREFIX}${suffix}`,
  title,
  description,
  inputSchema,
  annotations: Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }),
  _meta: Object.freeze({ 'toolbraid/ownerOnly': true, 'toolbraid/surface': 'native-mcp' }),
})));

function normalized(value, max) { return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, max); }
function boundedTimeout(value, fallback, field = 'timeoutMs') {
  const result = value === undefined ? fallback : value;
  if (!Number.isInteger(result) || result < MIN_POLL_MS || result > MAX_TIMEOUT_MS) {
    fail('RESILIENCE_BOUNDS_INVALID', `${field} must be an integer from ${MIN_POLL_MS} through ${MAX_TIMEOUT_MS}.`);
  }
  return result;
}

function snapshotState(raw) {
  if (!object(raw)) fail('RESILIENCE_CONTEXT_INVALID', 'Snapshot context must be an object.');
  const snapshot = raw.snapshot ?? raw.pageSnapshot;
  const source = raw.binding ?? raw;
  const origin = source.origin ?? snapshot?.metadata?.origin;
  const binding = {
    tabId: source.tabId,
    frameId: source.frameId ?? 0,
    sessionId: source.sessionId,
    origin,
  };
  if (!object(snapshot) || typeof snapshot.pageFingerprint !== 'string' || !snapshot.pageFingerprint
    || !Number.isInteger(binding.tabId) || binding.tabId < 0
    || !Number.isInteger(binding.frameId) || binding.frameId < 0
    || typeof binding.sessionId !== 'string' || !binding.sessionId
    || typeof binding.origin !== 'string' || !binding.origin) {
    fail('RESILIENCE_CONTEXT_INVALID', 'An exact tab, frame, session, origin, and page fingerprint context is required.');
  }
  return { snapshot, binding: Object.freeze(binding) };
}

function sameBinding(left, right) {
  return left.tabId === right.tabId && left.frameId === right.frameId
    && left.sessionId === right.sessionId && left.origin === right.origin;
}

function blocker(snapshot) {
  const content = normalized(`${snapshot?.metadata?.title ?? ''} ${snapshot?.mainText ?? ''} ${(snapshot?.accessibleControls ?? []).map((control) => `${control?.name ?? ''} ${control?.role ?? ''}`).join(' ')}`, 40_000);
  if (/(?:too many requests|rate limit(?:ed)?|retry after|http\s*429|temporarily blocked|request limit exceeded|access denied|you have been blocked|automated requests)/i.test(content)) {
    return Object.freeze({ ok: false, blocked: true, blocker: Object.freeze({ kind: 'rate-limited', code: 'RESILIENCE_RATE_LIMITED', humanRequired: true, retryAutomatically: false }) });
  }
  if (/(?:captcha|i am not a robot|verify you are human|browser challenge|security check|checking your browser|challenge-platform|cloudflare ray id|just a moment)/i.test(content)) {
    return Object.freeze({ ok: false, blocked: true, blocker: Object.freeze({ kind: 'human-required', code: 'RESILIENCE_HUMAN_CHALLENGE', humanRequired: true, retryAutomatically: false }) });
  }
  return null;
}

export function createResilienceOwnerTools({ getSnapshotContext, waitRef, nowRef = Date.now, pollIntervalMs = MIN_POLL_MS } = {}) {
  if (typeof getSnapshotContext !== 'function') throw new TypeError('getSnapshotContext callback is required.');
  if (typeof waitRef !== 'function') throw new TypeError('waitRef callback is required.');
  if (typeof nowRef !== 'function') throw new TypeError('nowRef must be a function.');
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < MIN_POLL_MS || pollIntervalMs > MAX_TIMEOUT_MS) throw new RangeError('pollIntervalMs must be at least 200ms and at most 20000ms.');
  let generation = 0;
  function invalidate() { generation += 1; }

  async function poll(args, observe) {
    const timeoutMs = boundedTimeout(args.timeoutMs, DEFAULT_TIMEOUT_MS);
    const startedAt = nowRef();
    const deadline = startedAt + timeoutMs;
    const operationGeneration = generation;
    const initial = snapshotState(await getSnapshotContext());
    const initialBlocker = blocker(initial.snapshot);
    if (initialBlocker) return initialBlocker;
    let current = initial;
    while (true) {
      if (operationGeneration !== generation) fail('RESILIENCE_INVALIDATED', 'The resilience wait was invalidated.');
      const result = observe(current, nowRef());
      if (result) return result;
      const remaining = deadline - nowRef();
      if (remaining < MIN_POLL_MS) fail('RESILIENCE_WAIT_TIMEOUT', 'The selected page did not satisfy the bounded wait condition.');
      await waitRef(Math.min(pollIntervalMs, remaining));
      if (operationGeneration !== generation) fail('RESILIENCE_INVALIDATED', 'The resilience wait was invalidated.');
      current = snapshotState(await getSnapshotContext());
      if (!sameBinding(initial.binding, current.binding)) fail('RESILIENCE_BINDING_DRIFT', 'The selected tab, frame, session, or origin changed while waiting.');
      const foundBlocker = blocker(current.snapshot);
      if (foundBlocker) return foundBlocker;
    }
  }

  async function call(name, args = {}) {
    if (!object(args)) fail('RESILIENCE_ARGUMENTS_INVALID', 'Resilience tool arguments must be an object.');
    const suffix = typeof name === 'string' && name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : '';
    if (suffix === 'wait_stable') {
      const timeoutMs = boundedTimeout(args.timeoutMs, DEFAULT_TIMEOUT_MS);
      const stableForMs = boundedTimeout(args.stableForMs, DEFAULT_STABLE_FOR_MS, 'stableForMs');
      if (stableForMs > timeoutMs) fail('RESILIENCE_BOUNDS_INVALID', 'stableForMs cannot exceed timeoutMs.');
      let fingerprint = null;
      let unchangedSince = null;
      return poll({ timeoutMs }, (state, now) => {
        if (state.snapshot.pageFingerprint !== fingerprint) {
          fingerprint = state.snapshot.pageFingerprint;
          unchangedSince = now;
          return null;
        }
        if (now - unchangedSince < stableForMs) return null;
        return Object.freeze({ ok: true, stable: true, pageFingerprint: fingerprint, stableForMs: now - unchangedSince });
      });
    }
    if (suffix === 'wait_for_control') {
      const wantedName = normalized(args.name, 512);
      const wantedRole = args.role === undefined ? null : normalized(args.role, 128);
      if (!wantedName || (args.role !== undefined && !wantedRole)) fail('RESILIENCE_CONTROL_INVALID', 'A non-empty bounded control name and optional role are required.');
      return poll(args, (state) => {
        const matches = (Array.isArray(state.snapshot.accessibleControls) ? state.snapshot.accessibleControls : []).filter((control) =>
          control?.disabled !== true && normalized(control?.name, 512) === wantedName
          && (wantedRole === null || normalized(control?.role, 128) === wantedRole));
        if (matches.length !== 1) return null;
        const control = matches[0];
        return Object.freeze({ ok: true, found: true, control: Object.freeze({ ref: String(control.ref ?? ''), name: String(control.name ?? ''), role: control.role ? String(control.role) : null }), pageFingerprint: state.snapshot.pageFingerprint });
      });
    }
    fail('RESILIENCE_TOOL_UNKNOWN', 'The native resilience tool is not supported.');
  }

  return Object.freeze({ descriptors: () => DESCRIPTORS, call, invalidate });
}
