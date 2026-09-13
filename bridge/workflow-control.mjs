import { createHash, randomUUID } from 'node:crypto';
import { createWorkflowLearning } from '../local-agent/workflow-learning.mjs';

const STATE_VERSION = 1;
const DEFAULT_STATE_KEY = 'toolbraid.workflow-control.v1';
const MAX_STATE_BYTES = 1024 * 1024;
const MAX_OWNERS = 32;
const MAX_DEMONSTRATIONS = 64;
const MAX_ADAPTERS = 64;
const MAX_STEPS = 128;
const MAX_TEXT = 4096;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const OWNER_ID = /^[A-Za-z0-9_.:-]{16,128}$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const PLACEHOLDER = /^[a-z0-9_]{1,96}$/;

const SECRET_KEY = /(password|passcode|secret|token|apikey|authorization|credential|bearer|cookie|otp|cvv|privatekey)/u;
const VOLATILE_KEY = /^(?:id|uuid|guid|handle|nonce|ref|selector|path|filepath|directory|folder|url|uri|session|sessionid|requestid|messageid|runid|jobid|windowid|controlid|timestamp|createdat|updatedat|expiresat)$/u;

export const WORKFLOW_CONTROL_METHODS = Object.freeze({
  demonstrationsPut: 'workflow.demonstrations.put',
  demonstrationsList: 'workflow.demonstrations.list',
  demonstrationsForget: 'workflow.demonstrations.forget',
  adapterDraft: 'workflow.adapter.draft',
  adapterVersion: 'workflow.adapter.version',
  adapterEnable: 'workflow.adapter.enable',
  adapterDisable: 'workflow.adapter.disable',
  adapterShadowReplay: 'workflow.adapter.shadow_replay',
});

export class WorkflowControlError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkflowControlError';
    this.code = code;
  }
}

function fail(code, message) { throw new WorkflowControlError(code, message); }
function plain(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const prototype = Object.getPrototypeOf(value); return prototype === Object.prototype || prototype === null; }
function cloneFrozen(value) { const result = structuredClone(value); const freeze = item => { if (item && typeof item === 'object' && !Object.isFrozen(item)) { Object.freeze(item); for (const child of Object.values(item)) freeze(child); } return item; }; return freeze(result); }
function canonicalKey(value) { return String(value).replace(/[^a-z0-9]/giu, '').toLowerCase(); }
function safeId(value, field) { if (typeof value !== 'string' || !SAFE_ID.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) fail('WORKFLOW_ID_INVALID', `${field} is invalid.`); return value; }
function ownerHash(value) { if (typeof value !== 'string' || !OWNER_ID.test(value)) fail('WORKFLOW_OWNER_INVALID', 'An internal workflow owner is required.'); return createHash('sha256').update(value).digest('hex'); }
function cleanText(value, max = MAX_TEXT) { return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, max); }
function exactInput(value, allowed, required = []) { if (!plain(value)) fail('WORKFLOW_INPUT_INVALID', 'Workflow input must be an object.'); if (Object.keys(value).some(key => !allowed.includes(key))) fail('WORKFLOW_INPUT_INVALID', 'Workflow input contains an unknown field.'); if (required.some(key => !Object.hasOwn(value, key))) fail('WORKFLOW_INPUT_INVALID', 'Workflow input is missing a required field.'); return value; }
function encodedBytes(value) { try { return Buffer.byteLength(JSON.stringify(value)); } catch { fail('WORKFLOW_STATE_INVALID', 'Workflow state is not serializable.'); } }
function timestamp(now) { const value = now(); if (!Number.isFinite(value)) fail('WORKFLOW_CLOCK_INVALID', 'Workflow clock is invalid.'); return Math.trunc(value); }
function iso(value) { try { return new Date(value).toISOString(); } catch { fail('WORKFLOW_CLOCK_INVALID', 'Workflow clock is invalid.'); } }

function isPlaceholder(value) {
  return plain(value) && Object.keys(value).length === 1 && typeof value.placeholder === 'string' && PLACEHOLDER.test(value.placeholder);
}

function volatileKey(key) {
  const raw = String(key);
  const canonical = canonicalKey(raw);
  return VOLATILE_KEY.test(canonical) || /(?:Id|ID)$/u.test(raw) || /(?:_id|-id)$/iu.test(raw);
}

function volatileString(value) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value)
    || /^[A-Za-z]:[\\/]/u.test(value)
    || /^\\\\/u.test(value)
    || /^file:\/\//iu.test(value);
}

function placeholderName(kind, key, ordinal) {
  const base = String(key).replace(/([a-z0-9])([A-Z])/gu, '$1_$2').replace(/[^a-z0-9]+/giu, '_').replace(/^_+|_+$/gu, '').toLowerCase().slice(0, 48) || 'value';
  return `${kind}_${base}_${ordinal}`.slice(0, 96);
}

function sanitizeParameters(parameters, context = { placeholders: new Map(), counters: { secret: 0, volatile: 0 } }) {
  const { placeholders, counters } = context;
  const nodes = { count: 0 };
  const placeholderFor = (kind, key, value) => {
    const primitive = value === null || ['string', 'number', 'boolean'].includes(typeof value);
    const identity = primitive ? `${kind}\0${canonicalKey(key)}\0${typeof value}\0${String(value).slice(0, MAX_TEXT)}` : null;
    if (identity && placeholders.has(identity)) return { placeholder: placeholders.get(identity) };
    const name = placeholderName(kind, key, ++counters[kind]);
    if (identity) placeholders.set(identity, name);
    return { placeholder: name };
  };
  const visit = (value, key = '', depth = 0) => {
    if (depth > 4 || ++nodes.count > 512) fail('WORKFLOW_BOUNDS', 'Workflow parameters are too complex.');
    if (isPlaceholder(value)) return { placeholder: value.placeholder };
    const canonical = canonicalKey(key);
    if (key && SECRET_KEY.test(canonical)) return placeholderFor('secret', key, value);
    if (key && (volatileKey(key) || (typeof value === 'string' && volatileString(value)))) return placeholderFor('volatile', key, value);
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail('WORKFLOW_PARAMETERS', 'Workflow numbers must be finite.'); return value; }
    if (typeof value === 'string') return cleanText(value);
    if (Array.isArray(value)) { if (value.length > 32) fail('WORKFLOW_BOUNDS', 'Workflow parameter array is too large.'); return value.map(item => visit(item, key, depth + 1)); }
    if (!plain(value)) fail('WORKFLOW_PARAMETERS', 'Workflow parameters must be declarative JSON.');
    const entries = Object.entries(value);
    if (entries.length > 64) fail('WORKFLOW_BOUNDS', 'Workflow parameter object is too large.');
    const result = {};
    for (const [rawKey, item] of entries) {
      const nextKey = cleanText(rawKey, 128);
      if (!nextKey || ['__proto__', 'prototype', 'constructor'].includes(nextKey) || Object.hasOwn(result, nextKey)) fail('WORKFLOW_PARAMETERS', 'Workflow parameter key is invalid.');
      result[nextKey] = visit(item, nextKey, depth + 1);
    }
    return result;
  };
  return visit(parameters ?? {});
}

function normalizeDemonstration({ name, steps }, at) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAX_STEPS) fail('WORKFLOW_STEPS', 'A bounded non-empty step list is required.');
  const placeholderContext = { placeholders: new Map(), counters: { secret: 0, volatile: 0 } };
  const sanitized = steps.map(step => {
    if (!plain(step)) fail('WORKFLOW_STEPS', 'Workflow step is invalid.');
    const allowed = ['tool', 'role', 'name', 'parameters', 'preFingerprint', 'postFingerprint'];
    if (Object.keys(step).some(key => !allowed.includes(key))) fail('WORKFLOW_STEPS', 'Workflow step contains an unknown field.');
    return { ...step, parameters: sanitizeParameters(step.parameters ?? {}, placeholderContext) };
  });
  try {
    return createWorkflowLearning({ nowRef: () => at }).record({ name, steps: sanitized });
  } catch (error) {
    if (error?.code) fail(error.code, error.message);
    throw error;
  }
}

function validateStoredValue(value, key = '', depth = 0, nodes = { count: 0 }) {
  if (depth > 5 || ++nodes.count > 512) fail('WORKFLOW_STATE_INVALID', 'Stored workflow parameters exceed their bounds.');
  if (isPlaceholder(value)) return;
  const canonical = canonicalKey(key);
  if ((key && (SECRET_KEY.test(canonical) || volatileKey(key))) || (typeof value === 'string' && volatileString(value))) fail('WORKFLOW_STATE_INVALID', 'Stored workflow parameters are not sanitized.');
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (typeof value === 'string') { if (value.length > MAX_TEXT) fail('WORKFLOW_STATE_INVALID', 'Stored workflow text exceeds its bound.'); return; }
  if (Array.isArray(value)) { if (value.length > 32) fail('WORKFLOW_STATE_INVALID', 'Stored workflow array exceeds its bound.'); for (const item of value) validateStoredValue(item, key, depth + 1, nodes); return; }
  if (!plain(value) || Object.keys(value).length > 64) fail('WORKFLOW_STATE_INVALID', 'Stored workflow parameters are invalid.');
  for (const [childKey, item] of Object.entries(value)) validateStoredValue(item, childKey, depth + 1, nodes);
}

function validateStoredSteps(steps) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAX_STEPS) fail('WORKFLOW_STATE_INVALID', 'Stored workflow steps are invalid.');
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!plain(step) || step.index !== index || typeof step.tool !== 'string' || !step.tool || step.tool.length > 256 || typeof step.role !== 'string' || !step.role || step.role.length > 128 || typeof step.name !== 'string' || !step.name || step.name.length > 512 || !FINGERPRINT.test(step.preFingerprint ?? '') || !FINGERPRINT.test(step.postFingerprint ?? '') || !plain(step.parameters)) fail('WORKFLOW_STATE_INVALID', 'Stored workflow anchor is invalid.');
    validateStoredValue(step.parameters);
  }
}

function freshState() { return { version: STATE_VERSION, owners: [] }; }
function validateState(state) {
  if (!plain(state) || state.version !== STATE_VERSION || !Array.isArray(state.owners) || state.owners.length > MAX_OWNERS || encodedBytes(state) > MAX_STATE_BYTES) fail('WORKFLOW_STATE_INVALID', 'Workflow state is invalid or exceeds its bound.');
  const ownerIds = new Set();
  for (const entry of state.owners) {
    if (!plain(entry) || !/^[a-f0-9]{64}$/u.test(entry.ownerHash ?? '') || ownerIds.has(entry.ownerHash) || !Array.isArray(entry.demonstrations) || entry.demonstrations.length > MAX_DEMONSTRATIONS || !Array.isArray(entry.adapters) || entry.adapters.length > MAX_ADAPTERS) fail('WORKFLOW_STATE_INVALID', 'Workflow owner state is invalid.');
    ownerIds.add(entry.ownerHash);
    const demonstrationIds = new Set();
    for (const demonstration of entry.demonstrations) {
      if (!plain(demonstration) || demonstrationIds.has(demonstration.id) || !Number.isSafeInteger(demonstration.revision) || demonstration.revision < 1 || typeof demonstration.name !== 'string' || demonstration.name.length > 256 || typeof demonstration.createdAt !== 'string' || demonstration.createdAt.length > 64 || typeof demonstration.updatedAt !== 'string' || demonstration.updatedAt.length > 64) fail('WORKFLOW_STATE_INVALID', 'Stored workflow demonstration is invalid.');
      safeId(demonstration.id, 'demonstrationId'); demonstrationIds.add(demonstration.id); validateStoredSteps(demonstration.steps);
    }
    const adapterIds = new Set();
    for (const adapter of entry.adapters) {
      if (!plain(adapter) || adapterIds.has(adapter.id) || !Number.isSafeInteger(adapter.version) || adapter.version < 1 || typeof adapter.enabled !== 'boolean' || typeof adapter.name !== 'string' || adapter.name.length > 256 || typeof adapter.createdAt !== 'string' || adapter.createdAt.length > 64 || typeof adapter.updatedAt !== 'string' || adapter.updatedAt.length > 64) fail('WORKFLOW_STATE_INVALID', 'Stored workflow adapter is invalid.');
      safeId(adapter.id, 'adapterId'); safeId(adapter.demonstrationId, 'demonstrationId'); adapterIds.add(adapter.id); validateStoredSteps(adapter.steps);
    }
  }
  return state;
}

function publicDemonstration(item) {
  return cloneFrozen({ id: item.id, name: item.name, revision: item.revision, createdAt: item.createdAt, updatedAt: item.updatedAt, stepCount: item.steps.length });
}

function publicAdapter(item) {
  return cloneFrozen({ id: item.id, demonstrationId: item.demonstrationId, name: item.name, version: item.version, enabled: item.enabled, createdAt: item.createdAt, updatedAt: item.updatedAt, steps: item.steps });
}

function observationResult(adapter, observations) {
  if (!Array.isArray(observations) || observations.length > MAX_STEPS) fail('WORKFLOW_OBSERVATIONS_INVALID', 'Shadow observations must be a bounded array.');
  if (observations.length !== adapter.steps.length) return cloneFrozen({ matched: false, reason: 'step-count-drift', version: adapter.version, mutated: false });
  const allowed = ['tool', 'role', 'name', 'preFingerprint', 'postFingerprint'];
  for (let index = 0; index < adapter.steps.length; index += 1) {
    const observed = observations[index];
    if (!plain(observed) || Object.keys(observed).some(key => !allowed.includes(key))) return cloneFrozen({ matched: false, reason: 'observation-invalid', step: index, version: adapter.version, mutated: false });
    const expected = adapter.steps[index];
    if (observed.tool !== expected.tool || observed.role !== expected.role || observed.name !== expected.name || observed.preFingerprint !== expected.preFingerprint || observed.postFingerprint !== expected.postFingerprint) return cloneFrozen({ matched: false, reason: 'anchor-drift', step: index, version: adapter.version, mutated: false });
  }
  return cloneFrozen({ matched: true, version: adapter.version, mutated: false });
}

export function createWorkflowControl({ store, now = () => Date.now(), idRef = randomUUID, stateKey = DEFAULT_STATE_KEY } = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') throw new TypeError('An atomic store is required.');
  if (typeof now !== 'function' || typeof idRef !== 'function') throw new TypeError('Workflow clock and identifier source must be functions.');
  safeId(stateKey, 'stateKey');
  let tail = Promise.resolve();

  const readState = async () => {
    const stored = await store.read(stateKey);
    return validateState(stored === undefined ? freshState() : structuredClone(stored));
  };
  const persist = async state => { validateState(state); await store.write(stateKey, state); };
  const bucket = (state, hash, create = false) => {
    let result = state.owners.find(entry => entry.ownerHash === hash);
    if (!result && create) {
      if (state.owners.length >= MAX_OWNERS) fail('WORKFLOW_BOUNDS', 'Workflow owner capacity is exhausted.');
      result = { ownerHash: hash, demonstrations: [], adapters: [] };
      state.owners.push(result);
    }
    return result;
  };
  const mutate = (ownerId, change) => {
    const hash = ownerHash(ownerId);
    const operation = tail.then(async () => {
      const state = await readState();
      const outcome = await change(state, hash);
      if (outcome.changed !== false) await persist(state);
      return outcome.result;
    });
    tail = operation.catch(() => {});
    return operation;
  };
  const inspect = async (ownerId, read) => {
    const hash = ownerHash(ownerId);
    await tail;
    return read(await readState(), hash);
  };
  const generatedId = prefix => safeId(`${prefix}-${String(idRef())}`, `${prefix}Id`);
  const findAdapter = (state, hash, adapterId) => {
    const adapter = bucket(state, hash)?.adapters.find(item => item.id === safeId(adapterId, 'adapterId'));
    if (!adapter) fail('WORKFLOW_ADAPTER_NOT_FOUND', 'Workflow adapter not found.');
    return adapter;
  };

  const demonstrations = Object.freeze({
    async put(input = {}, ownerId) {
      exactInput(input, ['demonstrationId', 'name', 'steps'], ['steps']);
      return mutate(ownerId, (state, hash) => {
        const at = timestamp(now);
        const normalized = normalizeDemonstration({ name: input.name, steps: input.steps }, at);
        const owner = bucket(state, hash, true);
        const demonstrationId = input.demonstrationId === undefined ? generatedId('demo') : safeId(input.demonstrationId, 'demonstrationId');
        const existingIndex = owner.demonstrations.findIndex(item => item.id === demonstrationId);
        if (existingIndex < 0 && owner.demonstrations.length >= MAX_DEMONSTRATIONS) fail('WORKFLOW_BOUNDS', 'Workflow demonstration capacity is exhausted.');
        const existing = owner.demonstrations[existingIndex];
        if (existing?.revision === Number.MAX_SAFE_INTEGER) fail('WORKFLOW_BOUNDS', 'Workflow demonstration revision capacity is exhausted.');
        const record = { id: demonstrationId, name: normalized.name, revision: (existing?.revision ?? 0) + 1, createdAt: existing?.createdAt ?? iso(at), updatedAt: iso(at), steps: structuredClone(normalized.steps) };
        if (existingIndex < 0) owner.demonstrations.push(record); else owner.demonstrations[existingIndex] = record;
        return { result: publicDemonstration(record) };
      });
    },
    async list(input = {}, ownerId) {
      exactInput(input, []);
      return inspect(ownerId, (state, hash) => cloneFrozen((bucket(state, hash)?.demonstrations ?? []).map(publicDemonstration)));
    },
    async forget(input = {}, ownerId) {
      exactInput(input, ['demonstrationId'], ['demonstrationId']);
      return mutate(ownerId, (state, hash) => {
        const owner = bucket(state, hash);
        const demonstrationId = safeId(input.demonstrationId, 'demonstrationId');
        const index = owner?.demonstrations.findIndex(item => item.id === demonstrationId) ?? -1;
        if (index < 0) return { changed: false, result: cloneFrozen({ forgotten: false }) };
        owner.demonstrations.splice(index, 1);
        if (!owner.demonstrations.length && !owner.adapters.length) state.owners.splice(state.owners.indexOf(owner), 1);
        return { result: cloneFrozen({ forgotten: true }) };
      });
    },
  });

  const setEnabled = async (input, ownerId, enabled) => {
    exactInput(input, ['adapterId'], ['adapterId']);
    return mutate(ownerId, (state, hash) => {
      const adapter = findAdapter(state, hash, input.adapterId);
      if (adapter.enabled === enabled) return { changed: false, result: publicAdapter(adapter) };
      if (adapter.version === Number.MAX_SAFE_INTEGER) fail('WORKFLOW_BOUNDS', 'Workflow adapter version capacity is exhausted.');
      adapter.enabled = enabled;
      adapter.version += 1;
      adapter.updatedAt = iso(timestamp(now));
      return { result: publicAdapter(adapter) };
    });
  };
  const shadowReplay = async (input = {}, ownerId) => {
    exactInput(input, ['adapterId', 'observations'], ['adapterId', 'observations']);
    return inspect(ownerId, (state, hash) => observationResult(findAdapter(state, hash, input.adapterId), input.observations));
  };
  const adapter = Object.freeze({
    async draft(input = {}, ownerId) {
      exactInput(input, ['adapterId', 'demonstrationId', 'name'], ['demonstrationId']);
      return mutate(ownerId, (state, hash) => {
        const owner = bucket(state, hash);
        const demonstrationId = safeId(input.demonstrationId, 'demonstrationId');
        const demonstration = owner?.demonstrations.find(item => item.id === demonstrationId);
        if (!demonstration) fail('WORKFLOW_DEMONSTRATION_NOT_FOUND', 'Workflow demonstration not found.');
        if (owner.adapters.length >= MAX_ADAPTERS) fail('WORKFLOW_BOUNDS', 'Workflow adapter capacity is exhausted.');
        const adapterId = input.adapterId === undefined ? generatedId('adapter') : safeId(input.adapterId, 'adapterId');
        if (owner.adapters.some(item => item.id === adapterId)) fail('WORKFLOW_ADAPTER_EXISTS', 'Workflow adapter already exists.');
        const at = timestamp(now);
        const learned = normalizeDemonstration({ name: input.name ?? demonstration.name, steps: demonstration.steps.map(({ index: _index, ...step }) => step) }, at);
        const record = { id: adapterId, demonstrationId, name: learned.name, version: 1, enabled: false, createdAt: iso(at), updatedAt: iso(at), steps: structuredClone(learned.steps) };
        owner.adapters.push(record);
        return { result: publicAdapter(record) };
      });
    },
    async version(input = {}, ownerId) {
      exactInput(input, ['adapterId'], ['adapterId']);
      return inspect(ownerId, (state, hash) => publicAdapter(findAdapter(state, hash, input.adapterId)));
    },
    async enable(input = {}, ownerId) { return setEnabled(input, ownerId, true); },
    async disable(input = {}, ownerId) { return setEnabled(input, ownerId, false); },
    shadowReplay,
    shadow_replay: shadowReplay,
  });

  async function call(method, params = {}, ownerId) {
    if (method === WORKFLOW_CONTROL_METHODS.demonstrationsPut) return demonstrations.put(params, ownerId);
    if (method === WORKFLOW_CONTROL_METHODS.demonstrationsList) return demonstrations.list(params, ownerId);
    if (method === WORKFLOW_CONTROL_METHODS.demonstrationsForget) return demonstrations.forget(params, ownerId);
    if (method === WORKFLOW_CONTROL_METHODS.adapterDraft) return adapter.draft(params, ownerId);
    if (method === WORKFLOW_CONTROL_METHODS.adapterVersion) return adapter.version(params, ownerId);
    if (method === WORKFLOW_CONTROL_METHODS.adapterEnable) return adapter.enable(params, ownerId);
    if (method === WORKFLOW_CONTROL_METHODS.adapterDisable) return adapter.disable(params, ownerId);
    if (method === WORKFLOW_CONTROL_METHODS.adapterShadowReplay) return adapter.shadowReplay(params, ownerId);
    fail('WORKFLOW_METHOD_UNSUPPORTED', 'Workflow control method is unsupported.');
  }

  return Object.freeze({ demonstrations, adapter, call });
}
