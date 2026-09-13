import {
  createHumanVerificationHandoff,
  detectHumanVerification,
  validatePostHumanVerification,
} from './human-verification.js';

const PREFIX = 'toolbraid.human_verification.';
const TOKEN_TTL_MS = 10 * 60_000;

export class HumanVerificationOwnerToolError extends Error {
  constructor(code, message) { super(message); this.name = 'HumanVerificationOwnerToolError'; this.code = code; }
}

function fail(code, message) { throw new HumanVerificationOwnerToolError(code, message); }
function schema(properties = {}, required = []) { return Object.freeze({ type: 'object', properties, required, additionalProperties: false }); }

const DESCRIPTORS = Object.freeze([
  Object.freeze({
    name: `${PREFIX}status`,
    title: 'Inspect human verification',
    description: 'Detect a CAPTCHA or browser challenge and create a manual-completion handoff. This does not solve or bypass the challenge.',
    inputSchema: schema(),
    annotations: Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }),
    _meta: Object.freeze({ 'toolbraid/ownerOnly': true, 'toolbraid/humanRequired': true }),
  }),
  Object.freeze({
    name: `${PREFIX}validate`,
    title: 'Validate completed human verification',
    description: 'After the owner completes the visible challenge, verify that it disappeared and the exact page advanced.',
    inputSchema: schema({ token: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, ['token']),
    annotations: Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }),
    _meta: Object.freeze({ 'toolbraid/ownerOnly': true, 'toolbraid/humanRequired': true }),
  }),
]);

function sameBinding(left, right) {
  return Boolean(left && right
    && left.tabId === right.tabId
    && left.windowId === right.windowId
    && left.frameId === right.frameId
    && left.sessionId === right.sessionId
    && left.origin === right.origin);
}

function safeReplacementBinding(left, right) {
  return Boolean(left && right
    && left.tabId === right.tabId
    && left.windowId === right.windowId
    && left.frameId === right.frameId
    && typeof left.origin === 'string'
    && left.origin === right.origin
    && /^https?:\/\//.test(left.origin));
}

export function createHumanVerificationOwnerTools({
  getSnapshotContext,
  cryptoRef = globalThis.crypto,
  nowRef = Date.now,
} = {}) {
  if (typeof getSnapshotContext !== 'function') throw new TypeError('getSnapshotContext is required.');
  const handoffs = new Map();

  function token() {
    if (typeof cryptoRef?.getRandomValues !== 'function') fail('HUMAN_VERIFICATION_CRYPTO_UNAVAILABLE', 'Secure handoff tokens are unavailable.');
    const bytes = new Uint8Array(32);
    cryptoRef.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  function prune() {
    const now = nowRef();
    for (const [key, entry] of handoffs) if (entry.expiresAt <= now) handoffs.delete(key);
  }

  async function call(name, args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) fail('HUMAN_VERIFICATION_ARGUMENTS_INVALID', 'Arguments must be an object.');
    prune();
    const suffix = name.startsWith(PREFIX) ? name.slice(PREFIX.length) : '';
    if (suffix === 'status') {
      const context = await getSnapshotContext();
      const challenges = detectHumanVerification(context.snapshot);
      if (!challenges.length) return Object.freeze({ required: false, challenges: Object.freeze([]) });
      const handoff = createHumanVerificationHandoff(context.snapshot);
      const handoffToken = token();
      handoffs.set(handoffToken, Object.freeze({ handoff, binding: context.binding, expiresAt: nowRef() + TOKEN_TTL_MS }));
      return Object.freeze({
        required: true,
        token: handoffToken,
        title: handoff.title,
        description: handoff.description,
        challenges: handoff.challenges,
        automation: handoff.automation,
        expiresInMs: TOKEN_TTL_MS,
      });
    }
    if (suffix === 'validate') {
      const entry = typeof args.token === 'string' ? handoffs.get(args.token) : null;
      if (!entry || entry.expiresAt <= nowRef()) {
        if (entry) handoffs.delete(args.token);
        fail('HUMAN_VERIFICATION_TOKEN_STALE', 'Inspect the current verification challenge again before validation.');
      }
      const context = await getSnapshotContext();
      if (!sameBinding(entry.binding, context.binding) && !safeReplacementBinding(entry.binding, context.binding)) {
        handoffs.delete(args.token);
        fail('HUMAN_VERIFICATION_SESSION_DRIFT', 'The page or selected frame changed before validation.');
      }
      const result = validatePostHumanVerification(entry.handoff, context.snapshot);
      if (result.ok || entry.binding.sessionId !== context.binding.sessionId) handoffs.delete(args.token);
      return result;
    }
    fail('HUMAN_VERIFICATION_TOOL_UNKNOWN', 'The human-verification tool is not supported.');
  }

  function invalidate() { prune(); }
  return Object.freeze({ descriptors: () => DESCRIPTORS, call, invalidate });
}

export { TOKEN_TTL_MS as HUMAN_VERIFICATION_TOKEN_TTL_MS };
