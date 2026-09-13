const MIN_INTERVAL_MS = 1_000;
const MAX_INTERVAL_MS = 30 * 24 * 60 * 60_000;
const MAX_SCHEDULES = 128;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
function clone(value) { return structuredClone(value); }

export function createLocalScheduler({ store, dispatch, key = 'toolbraid.scheduler.v1', now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') throw new TypeError('An atomic store is required.');
  if (typeof dispatch !== 'function') throw new TypeError('dispatch is required.');
  let timer = null; let mutationLane = Promise.resolve(); let ticking = null; let stateLane = Promise.resolve(); let started = false;
  function exclusive(work) { const operation = stateLane.then(work, work); stateLane = operation.catch(() => {}); return operation; }
  async function read() { return (await store.read(key)) ?? { version: 1, schedules: [] }; }
  async function write(state) { await store.write(key, clone(state)); }
  async function arm() {
    if (timer !== null) clearTimer(timer);
    const state = await read(); const active = state.schedules.filter((s) => !s.paused && s.nextRunAt !== null);
    if (!active.length) { timer = null; return; }
    const next = Math.min(...active.map((s) => s.nextRunAt));
    timer = setTimer(() => { void tick().catch(() => undefined); }, Math.min(MAX_TIMER_DELAY_MS, Math.max(0, next - now())));
    timer?.unref?.();
  }
  async function add(input) {
    const state = await read(); if (state.schedules.length >= MAX_SCHEDULES) throw new RangeError('Schedule limit reached.');
    if (!input || typeof input.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.id) || state.schedules.some((s) => s.id === input.id)) throw new TypeError('A unique schedule id is required.');
    const type = input.type;
    if (!['once', 'recurring'].includes(type)) throw new TypeError('type must be once or recurring.');
    if (type === 'recurring' && (!Number.isInteger(input.intervalMs) || input.intervalMs < MIN_INTERVAL_MS || input.intervalMs > MAX_INTERVAL_MS)) throw new RangeError('intervalMs is outside the allowed range.');
    if (type === 'once' && (!Number.isFinite(input.at) || input.at < now())) throw new RangeError('at must be a future timestamp.');
    if (!['skip', 'run-once'].includes(input.missedRunPolicy ?? 'run-once')) throw new TypeError('Invalid missedRunPolicy.');
    const schedule = { id: input.id, type, at: type === 'once' ? input.at : null, intervalMs: type === 'recurring' ? input.intervalMs : null, missedRunPolicy: input.missedRunPolicy ?? 'run-once', lane: input.lane === 'mutation' ? 'mutation' : 'read', payload: clone(input.payload ?? {}), paused: false, lastRunAt: null, nextRunAt: type === 'once' ? input.at : now() + input.intervalMs };
    state.schedules.push(schedule); await write(state); await arm(); return clone(schedule);
  }
  async function mutate(id, action) { const state = await read(); const schedule = state.schedules.find((s) => s.id === id); if (!schedule) return null; action(schedule, state); await write(state); await arm(); return clone(schedule); }
  async function pause(id) { return mutate(id, (s) => { s.paused = true; }); }
  async function resume(id) { return mutate(id, (s) => { s.paused = false; if (s.nextRunAt !== null && s.nextRunAt < now()) s.nextRunAt = s.type === 'once' ? now() : now() + s.intervalMs; }); }
  async function remove(id) { const state = await read(); const index = state.schedules.findIndex((s) => s.id === id); if (index < 0) return false; state.schedules.splice(index, 1); await write(state); await arm(); return true; }
  async function runTick() {
    const instant = now(); const state = await read();
    for (const schedule of state.schedules.filter((s) => !s.paused && s.nextRunAt !== null && s.nextRunAt <= instant)) {
      const job = () => dispatch({ scheduleId: schedule.id, payload: clone(schedule.payload), scheduledFor: schedule.nextRunAt, lane: schedule.lane });
      try {
        if (schedule.lane === 'mutation') {
          schedule.lastOutcome = 'dispatching'; schedule.lastError = null; schedule.dispatchedFor = schedule.nextRunAt;
          await write(state);
        }
        if (schedule.lane === 'mutation') mutationLane = mutationLane.then(job, job); else await job();
        if (schedule.lane === 'mutation') await mutationLane;
        schedule.lastRunAt = instant; schedule.lastOutcome = 'complete'; schedule.lastError = null; schedule.dispatchedFor = null;
      } catch (error) {
        schedule.paused = true;
        schedule.lastOutcome = schedule.lane === 'mutation' ? 'outcome-unknown' : 'failed';
        schedule.dispatchedFor = null;
        schedule.lastError = { code: String(error?.code ?? 'DISPATCH_FAILED').slice(0, 64), message: String(error?.message ?? 'Dispatch failed.').slice(0, 512) };
        continue;
      }
      schedule.nextRunAt = schedule.type === 'once' ? null : instant + schedule.intervalMs;
    }
    await write(state); await arm(); return clone(state);
  }
  async function tick() {
    if (ticking) return ticking;
    ticking = exclusive(runTick).finally(() => { ticking = null; });
    return ticking;
  }
  async function recoverAndArm() {
    const state = await read(); let changed = false; const instant = now();
    for (const schedule of state.schedules) {
      if (schedule.lane === 'mutation' && schedule.lastOutcome === 'dispatching') {
        schedule.paused = true; schedule.lastOutcome = 'outcome-unknown'; schedule.dispatchedFor = null;
        schedule.lastError = { code: 'INTERRUPTED_MUTATION', message: 'Scheduled mutation outcome is unknown and will not be retried.' };
        changed = true; continue;
      }
      if (!started && !schedule.paused && schedule.nextRunAt !== null && schedule.nextRunAt < instant && schedule.missedRunPolicy === 'skip') {
        schedule.lastOutcome = 'skipped'; schedule.lastError = null;
        schedule.nextRunAt = schedule.type === 'once' ? null : instant + schedule.intervalMs;
        changed = true;
      }
    }
    if (changed) await write(state);
    started = true;
    await arm();
  }
  return Object.freeze({
    add: (input) => exclusive(() => add(input)),
    pause: (id) => exclusive(() => pause(id)),
    resume: (id) => exclusive(() => resume(id)),
    delete: (id) => exclusive(() => remove(id)),
    tick,
    start: () => exclusive(recoverAndArm),
    state: () => exclusive(async () => clone(await read())),
  });
}

export { MIN_INTERVAL_MS, MAX_INTERVAL_MS, MAX_SCHEDULES };
