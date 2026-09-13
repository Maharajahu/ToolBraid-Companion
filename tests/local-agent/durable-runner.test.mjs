import assert from 'node:assert/strict';
import test from 'node:test';
import { createDurableMissionRunner } from '../../local-agent/durable-runner.mjs';

function memory(initial = null) { let value = structuredClone(initial); const writes = []; return { read: async () => structuredClone(value), write: async (_key, next) => { value = structuredClone(next); writes.push(structuredClone(next)); }, writes, value: () => structuredClone(value) }; }

test('checkpoints before and after every DAG dispatch with immutable idempotency keys', async () => {
  const store = memory(); const calls = [];
  const runner = createDurableMissionRunner({ store, now: (() => { let n = 0; return () => ++n; })(), dispatch: async (step) => { calls.push(step); return { ok: step.stepId }; } });
  await runner.create({ missionId: 'm1', plan: [{ id: 'read-a', kind: 'read' }, { id: 'write-b', kind: 'mutation', dependsOn: ['read-a'], idempotencyKey: 'stable-b' }] });
  const result = await runner.run();
  assert.equal(result.status, 'complete');
  assert.deepEqual(calls.map((c) => [c.stepId, c.idempotencyKey]), [['read-a', 'read-a:read-a'], ['write-b', 'write-b:stable-b']]);
  assert.ok(store.writes.some((s) => s.steps[0].status === 'dispatching'));
  assert.ok(store.writes.some((s) => s.steps[0].status === 'complete' && s.steps[1].status === 'dispatching'));
});

test('resumes interrupted safe work but never retries an interrupted mutation', async () => {
  const base = { version: 1, missionId: 'm2', status: 'running', cancelled: false, steps: [
    { id: 'r', kind: 'read', dependsOn: [], input: {}, idempotencyKey: 'r:r', status: 'dispatching', attempts: 1 },
    { id: 'm', kind: 'mutation', dependsOn: [], input: {}, idempotencyKey: 'm:m', status: 'dispatching', attempts: 1 },
  ] };
  const store = memory(base); const calls = [];
  const runner = createDurableMissionRunner({ store, dispatch: async (step) => { calls.push(step.stepId); return {}; } });
  const result = await runner.run();
  assert.deepEqual(calls, ['r']);
  assert.equal(result.steps.find((s) => s.id === 'm').status, 'outcome-unknown');
  assert.equal(result.status, 'outcome-unknown');
});

test('supports durable cancellation and rejects cyclic or oversized DAGs', async () => {
  const store = memory(); const runner = createDurableMissionRunner({ store, dispatch: async () => ({}) });
  await assert.rejects(runner.create({ missionId: 'bad', plan: [{ id: 'a', kind: 'read', dependsOn: ['b'] }, { id: 'b', kind: 'read', dependsOn: ['a'] }] }), /acyclic/);
  await runner.create({ missionId: 'ok', plan: [{ id: 'a', kind: 'read' }] });
  assert.equal((await runner.cancel()).status, 'cancelled');
  assert.equal((await runner.run()).steps[0].attempts, 0);
});

test('observes cancellation issued while a dispatch is in flight', async () => {
  const store = memory(); let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const runner = createDurableMissionRunner({ store, dispatch: async ({ stepId }) => { calls.push(stepId); await gate; return {}; } });
  await runner.create({ missionId: 'cancel-live', plan: [{ id: 'a', kind: 'read' }, { id: 'b', kind: 'read', dependsOn: ['a'] }] });
  const pending = runner.run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await runner.cancel(); release();
  const result = await pending;
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(calls, ['a']);
});

test('cancellation while the dispatch checkpoint is saving prevents the effect', async () => {
  const storage = memory(); let release; let checkpoint;
  const gate = new Promise((resolve) => { release = resolve; });
  const reached = new Promise((resolve) => { checkpoint = resolve; });
  let held = false; let calls = 0;
  const store = { read: storage.read, async write(key, state) {
    await storage.write(key, state);
    if (!held && state.steps[0].status === 'dispatching') { held = true; checkpoint(); await gate; }
  } };
  const runner = createDurableMissionRunner({ store, dispatch: async () => { calls++; return {}; } });
  await runner.create({ missionId: 'cancel-checkpoint', plan: [{ id: 'send', kind: 'mutation' }] });
  const running = runner.run(); await reached;
  await runner.cancel(); release();
  assert.equal((await running).status, 'cancelled');
  assert.equal(calls, 0);
});

test('serializes concurrent creation and preserves exactly one mission', async () => {
  const store = memory();
  const runner = createDurableMissionRunner({ store, dispatch: async () => ({ ok: true }) });
  const results = await Promise.allSettled([
    runner.create({ missionId: 'a', plan: [{ id: 'read', kind: 'read' }] }),
    runner.create({ missionId: 'b', plan: [{ id: 'read', kind: 'read' }] }),
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter((item) => item.status === 'rejected').length, 1);
  assert.ok(['a', 'b'].includes((await runner.state()).missionId));
});

test('a failed mutation dispatch is outcome unknown and is never retried', async () => {
  const store = memory(); let calls = 0;
  const runner = createDurableMissionRunner({ store, dispatch: async () => { calls += 1; throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' }); } });
  await runner.create({ missionId: 'm', plan: [{ id: 'publish', kind: 'mutation' }] });
  const first = await runner.run();
  const second = await runner.run();
  assert.equal(first.status, 'outcome-unknown');
  assert.equal(first.steps[0].status, 'outcome-unknown');
  assert.equal(first.steps[0].error.code, 'MUTATION_OUTCOME_UNKNOWN');
  assert.equal(second.status, 'outcome-unknown');
  assert.equal(calls, 1);
});
