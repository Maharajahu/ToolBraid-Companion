const MAX_STEPS = 64;

function clone(value) { return structuredClone(value); }
function assertStore(store) {
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') throw new TypeError('An atomic store with read() and write() is required.');
}
function validatePlan(plan) {
  if (!Array.isArray(plan) || !plan.length || plan.length > MAX_STEPS) throw new RangeError(`plan must contain 1 through ${MAX_STEPS} steps.`);
  const ids = new Set();
  for (const step of plan) {
    if (!step || typeof step.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(step.id) || ids.has(step.id)) throw new TypeError('Every step requires a unique immutable id.');
    if (!['read', 'idempotent', 'mutation'].includes(step.kind)) throw new TypeError(`Invalid step kind: ${step.kind}.`);
    ids.add(step.id);
  }
  for (const step of plan) for (const dependency of step.dependsOn ?? []) if (!ids.has(dependency) || dependency === step.id) throw new TypeError(`Invalid dependency for ${step.id}.`);
  const visiting = new Set(); const visited = new Set(); const byId = new Map(plan.map((step) => [step.id, step]));
  function visit(id) { if (visiting.has(id)) throw new TypeError('plan must be acyclic.'); if (visited.has(id)) return; visiting.add(id); for (const dep of byId.get(id).dependsOn ?? []) visit(dep); visiting.delete(id); visited.add(id); }
  for (const id of ids) visit(id);
  return plan.map((step) => Object.freeze({ id: step.id, kind: step.kind, dependsOn: Object.freeze([...(step.dependsOn ?? [])]), input: clone(step.input ?? {}), idempotencyKey: `${step.id}:${step.idempotencyKey ?? step.id}` }));
}

export function createDurableMissionRunner({ store, dispatch, key = 'toolbraid.durable-runner.v1', now = () => Date.now() } = {}) {
  assertStore(store); if (typeof dispatch !== 'function') throw new TypeError('dispatch is required.');
  let running = null; let createLane = Promise.resolve(); let cancellationRequested = false;
  async function persist(state) { if (cancellationRequested) state.cancelled = true; state.updatedAt = now(); await store.write(key, clone(state)); }
  async function load() { return await store.read(key); }
  async function createInternal({ missionId, plan }) {
    if (typeof missionId !== 'string' || !missionId) throw new TypeError('missionId is required.');
    if (await load()) throw new Error('A durable mission already exists.');
    cancellationRequested = false;
    const normalized = validatePlan(plan);
    const state = { version: 1, missionId, status: 'pending', cancelled: false, createdAt: now(), updatedAt: now(), steps: normalized.map((step) => ({ ...step, status: 'pending', attempts: 0, result: null, error: null })) };
    await persist(state); return clone(state);
  }
  function create(input) { const operation = createLane.then(() => createInternal(input), () => createInternal(input)); createLane = operation.catch(() => {}); return operation; }
  async function cancel() { const state = await load(); if (!state) return null; cancellationRequested = true; state.cancelled = true; if (state.status !== 'complete') state.status = 'cancelled'; await persist(state); return clone(state); }
  async function run() {
    if (running) return running;
    running = (async () => {
      const state = await load(); if (!state) throw new Error('No durable mission exists.'); cancellationRequested ||= state.cancelled === true;
      for (const step of state.steps) {
        if (step.status !== 'dispatching') continue;
        if (step.kind === 'mutation') { step.status = 'outcome-unknown'; step.error = { code: 'INTERRUPTED_MUTATION', message: 'Mutation outcome is unknown and will not be retried.' }; }
        else step.status = 'pending';
      }
      state.status = state.cancelled ? 'cancelled' : 'running'; await persist(state);
      while (!state.cancelled) {
        const latest = await load();
        if (latest?.cancelled === true) { state.cancelled = true; break; }
        const completed = new Set(state.steps.filter((step) => step.status === 'complete').map((step) => step.id));
        const step = state.steps.find((candidate) => candidate.status === 'pending' && candidate.dependsOn.every((id) => completed.has(id)));
        if (!step) break;
        step.status = 'dispatching'; step.attempts += 1; step.dispatchedAt = now(); await persist(state);
        if (state.cancelled || cancellationRequested) { state.cancelled = true; step.status = 'pending'; break; }
        try {
          step.result = clone(await dispatch({ missionId: state.missionId, stepId: step.id, kind: step.kind, input: clone(step.input), idempotencyKey: step.idempotencyKey }));
          const afterDispatch = await load();
          if (afterDispatch?.cancelled === true) state.cancelled = true;
          step.status = 'complete'; step.completedAt = now(); await persist(state);
        } catch (error) {
          step.status = step.kind === 'mutation' ? 'outcome-unknown' : 'failed';
          step.error = step.kind === 'mutation'
            ? { code: 'MUTATION_OUTCOME_UNKNOWN', message: 'Mutation dispatch failed after its durable checkpoint; outcome is unknown and will not be retried.' }
            : { code: error?.code ?? 'DISPATCH_FAILED', message: error?.message ?? 'Dispatch failed.' };
          await persist(state); break;
        }
      }
      if (state.steps.some((step) => step.status === 'outcome-unknown')) state.status = 'outcome-unknown';
      else if (state.cancelled) state.status = 'cancelled';
      else if (state.steps.every((step) => step.status === 'complete')) state.status = 'complete';
      else if (state.steps.some((step) => step.status === 'failed')) state.status = 'failed';
      else state.status = 'blocked';
      await persist(state); return clone(state);
    })().finally(() => { running = null; });
    return running;
  }
  return Object.freeze({ create, run, cancel, state: async () => clone(await load()) });
}

export { MAX_STEPS as MAX_DURABLE_MISSION_STEPS };
