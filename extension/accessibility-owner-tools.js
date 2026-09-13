import { detectHumanVerification } from './human-verification.js';

const PREFIX = 'toolbraid.ax.';
const HANDLE_TTL_MS = 2 * 60_000;
const MAX_HANDLES = 128;
const MAX_NODES = 256;

export class AccessibilityOwnerToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AccessibilityOwnerToolError';
    this.code = code;
  }
}

function fail(code, message) { throw new AccessibilityOwnerToolError(code, message); }
function object(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function schema(properties = {}, required = []) { return Object.freeze({ type: 'object', properties, required, additionalProperties: false }); }
function normalized(value, limit = 512) { return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, limit); }

const DESCRIPTORS = Object.freeze([
  Object.freeze({
    name: `${PREFIX}inspect`,
    title: 'Inspect accessibility controls',
    description: 'Inspect bounded actionable nodes in the selected top-frame accessibility tree and issue exact short-lived handles.',
    inputSchema: schema({
      name: { type: 'string', minLength: 1, maxLength: 512 },
      role: { type: 'string', minLength: 1, maxLength: 128 },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    }),
    annotations: Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }),
    _meta: Object.freeze({ 'toolbraid/ownerOnly': true, 'toolbraid/surface': 'accessibility' }),
  }),
  Object.freeze({
    name: `${PREFIX}activate`,
    title: 'Activate accessibility control',
    description: 'Activate one exact accessibility node after revalidating its role, name, backend identity and selected page binding.',
    inputSchema: schema({ handle: { type: 'string', pattern: '^[a-f0-9]{32}$' } }, ['handle']),
    annotations: Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }),
    _meta: Object.freeze({ 'toolbraid/ownerOnly': true, 'toolbraid/surface': 'accessibility' }),
  }),
]);

const ACTIONABLE_ROLES = new Set([
  'button', 'checkbox', 'combobox', 'link', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'option', 'radio', 'searchbox', 'slider', 'spinbutton',
  'switch', 'tab', 'textbox', 'treeitem',
]);
const SENSITIVE = /(?:password|passcode|one[ -]?time|otp|security code|verification code|card number|credit card|cvv|cvc|captcha|human verification)/iu;

function sameBinding(left, right) {
  return Boolean(left && right
    && left.tabId === right.tabId
    && left.windowId === right.windowId
    && left.frameId === right.frameId
    && left.sessionId === right.sessionId
    && left.origin === right.origin
    && left.pageFingerprint === right.pageFingerprint);
}

function secureToken(cryptoRef) {
  if (typeof cryptoRef?.getRandomValues !== 'function') fail('AX_CRYPTO_UNAVAILABLE', 'Secure accessibility handles are unavailable.');
  const bytes = new Uint8Array(16);
  cryptoRef.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function propertyValue(properties, name) {
  const property = Array.isArray(properties) ? properties.find((entry) => entry?.name === name) : null;
  return property?.value?.value;
}

function normalizeNode(raw) {
  if (!object(raw) || raw.ignored === true || !Number.isInteger(raw.backendDOMNodeId) || raw.backendDOMNodeId <= 0) return null;
  const role = normalized(raw.role?.value, 128);
  const name = String(raw.name?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 512);
  if (!ACTIONABLE_ROLES.has(role) || !name) return null;
  const protectedValue = propertyValue(raw.properties, 'protected') === true;
  if (protectedValue || SENSITIVE.test(`${role} ${name}`)) return null;
  const disabled = propertyValue(raw.properties, 'disabled') === true;
  const nodeId = String(raw.nodeId ?? '').slice(0, 256);
  if (!nodeId) return null;
  return Object.freeze({ nodeId, backendDOMNodeId: raw.backendDOMNodeId, role, name, disabled });
}

export function createAccessibilityOwnerTools({
  getSnapshotContext,
  inspectTree,
  activateNode,
  cryptoRef = globalThis.crypto,
  nowRef = Date.now,
} = {}) {
  if (typeof getSnapshotContext !== 'function' || typeof inspectTree !== 'function' || typeof activateNode !== 'function') {
    throw new TypeError('getSnapshotContext, inspectTree, and activateNode are required.');
  }
  const handles = new Map();

  function prune() {
    const now = nowRef();
    for (const [handle, entry] of handles) if (entry.expiresAt <= now) handles.delete(handle);
    while (handles.size >= MAX_HANDLES) handles.delete(handles.keys().next().value);
  }

  async function safeContext() {
    const context = await getSnapshotContext();
    if (context?.binding?.frameId !== 0) fail('AX_TOP_FRAME_REQUIRED', 'Accessibility fallback currently requires the selected top frame.');
    if (detectHumanVerification(context?.snapshot).length) fail('HUMAN_VERIFICATION_REQUIRED', 'Complete and validate the visible human-verification challenge first.');
    return context;
  }

  async function observedNodes(context) {
    const raw = await inspectTree({ context });
    const values = Array.isArray(raw?.nodes) ? raw.nodes : Array.isArray(raw) ? raw : [];
    return values.slice(0, MAX_NODES).map(normalizeNode).filter(Boolean);
  }

  async function call(name, args = {}) {
    if (!object(args)) fail('AX_ARGUMENTS_INVALID', 'Accessibility tool arguments must be an object.');
    prune();
    const suffix = typeof name === 'string' && name.startsWith(PREFIX) ? name.slice(PREFIX.length) : '';
    if (suffix === 'inspect') {
      const context = await safeContext();
      const wantedName = args.name === undefined ? null : normalized(args.name);
      const wantedRole = args.role === undefined ? null : normalized(args.role, 128);
      const limit = args.limit === undefined ? 40 : args.limit;
      if ((args.name !== undefined && !wantedName) || (args.role !== undefined && !wantedRole)
        || !Number.isInteger(limit) || limit < 1 || limit > 100) fail('AX_QUERY_INVALID', 'Accessibility query bounds are invalid.');
      const nodes = (await observedNodes(context)).filter((node) =>
        (!wantedName || normalized(node.name).includes(wantedName))
        && (!wantedRole || node.role === wantedRole)).slice(0, limit);
      const controls = nodes.map((node) => {
        const handle = secureToken(cryptoRef);
        handles.set(handle, Object.freeze({ binding: context.binding, node, expiresAt: nowRef() + HANDLE_TTL_MS }));
        return Object.freeze({ handle, role: node.role, name: node.name, disabled: node.disabled });
      });
      return Object.freeze({ controls: Object.freeze(controls), count: controls.length, expiresInMs: HANDLE_TTL_MS });
    }
    if (suffix === 'activate') {
      const entry = typeof args.handle === 'string' ? handles.get(args.handle) : null;
      if (!entry || entry.expiresAt <= nowRef()) {
        if (entry) handles.delete(args.handle);
        fail('AX_HANDLE_STALE', 'Inspect accessibility controls again before activation.');
      }
      const context = await safeContext();
      if (!sameBinding(entry.binding, context.binding)) {
        handles.delete(args.handle);
        fail('AX_BINDING_DRIFT', 'The selected page changed after accessibility inspection.');
      }
      const live = (await observedNodes(context)).filter((node) =>
        node.nodeId === entry.node.nodeId
        && node.backendDOMNodeId === entry.node.backendDOMNodeId
        && node.role === entry.node.role
        && node.name === entry.node.name);
      if (live.length !== 1 || live[0].disabled) {
        handles.delete(args.handle);
        fail('AX_NODE_DRIFT', 'The exact accessibility control changed or is no longer actionable.');
      }
      const result = await activateNode({ context, node: live[0] });
      handles.delete(args.handle);
      return Object.freeze({ activated: true, role: live[0].role, name: live[0].name, receipt: object(result) ? result : null });
    }
    fail('AX_TOOL_UNKNOWN', 'The accessibility owner tool is not supported.');
  }

  function invalidate() { handles.clear(); }
  return Object.freeze({ descriptors: () => DESCRIPTORS, call, invalidate });
}

export { HANDLE_TTL_MS as AX_HANDLE_TTL_MS };
