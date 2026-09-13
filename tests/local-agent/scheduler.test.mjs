import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalScheduler } from '../../local-agent/scheduler.mjs';

function memory() { let value = null; return { read: async () => structuredClone(value), write: async (_key, next) => { value = structuredClone(next); } }; }

test('persists one-shot and recurring last/next runs with missed-run policies', async () => {
  let instant = 10_000; const calls = []; const store = memory();
  const scheduler = createLocalScheduler({ store, now: () => instant, setTimer: () => 1, clearTimer: () => {}, dispatch: async (job) => calls.push(job) });
  await scheduler.add({ id: 'once', type: 'once', at: 11_000, payload: { a: 1 } });
  await scheduler.add({ id: 'repeat', type: 'recurring', intervalMs: 2_000, missedRunPolicy: 'skip' });
  instant = 13_000; await scheduler.start(); await scheduler.tick();
  assert.deepEqual(calls.map((c) => c.scheduleId), ['once']);
  const state = await scheduler.state();
  assert.equal(state.schedules.find((s) => s.id === 'once').nextRunAt, null);
  assert.equal(state.schedules.find((s) => s.id === 'repeat').nextRunAt, 15_000);
});

test('serializes mutation schedules and supports pause resume delete', async () => {
  let instant = 1_000; let active = 0; let peak = 0; const store = memory();
  const scheduler = createLocalScheduler({ store, now: () => instant, setTimer: () => 1, clearTimer: () => {}, dispatch: async () => { active += 1; peak = Math.max(peak, active); await Promise.resolve(); active -= 1; } });
  await scheduler.add({ id: 'a', type: 'recurring', intervalMs: 1_000, lane: 'mutation' });
  await scheduler.add({ id: 'b', type: 'recurring', intervalMs: 1_000, lane: 'mutation' });
  assert.equal((await scheduler.pause('a')).paused, true);
  assert.equal((await scheduler.resume('a')).paused, false);
  instant = 2_000; await scheduler.tick();
  assert.equal(peak, 1);
  assert.equal(await scheduler.delete('a'), true);
  assert.equal((await scheduler.state()).schedules.length, 1);
});

test('resuming a completed one-shot never schedules the mutation a second time', async () => {
  let instant = 1000; let calls = 0;
  const scheduler = createLocalScheduler({ store: memory(), now: () => instant, setTimer: () => 1, clearTimer: () => {}, dispatch: async () => { calls++; } });
  await scheduler.add({ id: 'publish-once', type: 'once', at: 2000, lane: 'mutation' });
  instant = 2000; await scheduler.tick();
  await scheduler.pause('publish-once'); instant = 3000;
  assert.equal((await scheduler.resume('publish-once')).nextRunAt, null);
  await scheduler.tick(); assert.equal(calls, 1);
});

test('enforces bounded intervals and exposes no cron expression API', async () => {
  const scheduler = createLocalScheduler({ store: memory(), now: () => 0, setTimer: () => 1, clearTimer: () => {}, dispatch: async () => {} });
  await assert.rejects(scheduler.add({ id: 'fast', type: 'recurring', intervalMs: 999 }), /intervalMs/);
  await assert.rejects(scheduler.add({ id: 'cron', type: 'cron', expression: '* * * * *' }), /type/);
});

test('pauses failed schedules and never retries an uncertain mutation automatically', async () => {
  let instant = 10_000;
  const scheduler = createLocalScheduler({
    store: memory(), now: () => instant, setTimer: () => 1, clearTimer: () => {},
    dispatch: async () => { throw Object.assign(new Error('receipt missing'), { code: 'POSTCONDITION_UNKNOWN' }); },
  });
  await scheduler.add({ id: 'publish', type: 'once', at: 11_000, lane: 'mutation', payload: {} });
  instant = 11_000;
  const state = await scheduler.tick();
  assert.equal(state.schedules[0].paused, true);
  assert.equal(state.schedules[0].lastOutcome, 'outcome-unknown');
  assert.equal(state.schedules[0].lastError.code, 'POSTCONDITION_UNKNOWN');
  assert.equal(state.schedules[0].nextRunAt, 11_000);
});

test('serializes concurrent schedule mutations without losing updates', async () => {
  const scheduler = createLocalScheduler({ store: memory(), now: () => 0, setTimer: () => 1, clearTimer: () => {}, dispatch: async () => {} });
  await Promise.all([
    scheduler.add({ id: 'a', type: 'recurring', intervalMs: 1_000 }),
    scheduler.add({ id: 'b', type: 'recurring', intervalMs: 2_000 }),
  ]);
  assert.deepEqual((await scheduler.state()).schedules.map((item) => item.id).sort(), ['a', 'b']);
  await Promise.all([scheduler.pause('a'), scheduler.delete('b')]);
  const state = await scheduler.state();
  assert.equal(state.schedules.length, 1);
  assert.equal(state.schedules[0].paused, true);
});

test('checkpoints scheduled mutations and recovers an interrupted dispatch as outcome unknown', async () => {
  const store = memory();
  await store.write('toolbraid.scheduler.v1', { version: 1, schedules: [{
    id: 'publish', type: 'once', at: 1_000, intervalMs: null, missedRunPolicy: 'run-once', lane: 'mutation', payload: {},
    paused: false, lastRunAt: null, nextRunAt: 1_000, lastOutcome: 'dispatching', dispatchedFor: 1_000, lastError: null,
  }] });
  let calls = 0;
  const scheduler = createLocalScheduler({ store, now: () => 2_000, setTimer: () => 1, clearTimer: () => {}, dispatch: async () => { calls += 1; } });
  await scheduler.start();
  const state = await scheduler.state();
  assert.equal(state.schedules[0].paused, true);
  assert.equal(state.schedules[0].lastOutcome, 'outcome-unknown');
  assert.equal(state.schedules[0].lastError.code, 'INTERRUPTED_MUTATION');
  assert.equal(calls, 0);
});

test('allows normal timer jitter and clamps long timer delays to the Node limit', async () => {
  let instant = 0; const calls = []; const delays = [];
  const scheduler = createLocalScheduler({ store: memory(), now: () => instant, setTimer: (_callback, delay) => { delays.push(delay); return 1; }, clearTimer: () => {}, dispatch: async (job) => calls.push(job) });
  await scheduler.start();
  await scheduler.add({ id: 'jitter', type: 'once', at: 1_000, missedRunPolicy: 'skip' });
  instant = 1_001; await scheduler.tick();
  assert.deepEqual(calls.map((item) => item.scheduleId), ['jitter']);
  await scheduler.add({ id: 'long', type: 'recurring', intervalMs: 30 * 24 * 60 * 60_000 });
  assert.ok(delays.every((delay) => delay <= 2_147_000_000));
});
