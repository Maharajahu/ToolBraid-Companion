import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemoryKeyValueStore, createPersistentApprovalLedger } from '../../src/persistence/index.js';
import { createLocalOwnerLease, createOwnerAutonomyPolicy } from '../../src/policy/index.js';
import { createUniversalSessionRuntime } from '../../src/runtime/index.js';

function page(title = 'Owner fixture') {
  return {
    metadata: { url: 'https://example.test/form', origin: 'https://example.test', title },
    mainText: 'Post a message.',
    forms: [{
      ref: 'post-form', name: 'Post message', action: 'https://example.test/post', method: 'POST',
      fields: [{ ref: 'message', name: 'Message', type: 'text', required: true }],
    }],
    elementRefs: [{ ref: 'post-form', tagName: 'form', role: 'form', name: 'Post message' }],
  };
}

async function fixture({ policy, ownerPolicy, clock = '2026-08-31T10:00:00.000Z' } = {}) {
  let tools;
  const calls = [];
  const runtime = createUniversalSessionRuntime({
    approvalLedger: await createPersistentApprovalLedger({ store: createMemoryKeyValueStore(), key: `owner-${Math.random()}` }),
    authorizationPolicy: policy,
    ...(ownerPolicy ? { ownerAuthorizationPolicy: ownerPolicy } : {}),
    registerTools: async (request) => { tools = request.tools; return { ok: true }; },
    executePageAction: async (request) => { calls.push(request); return { receiptId: 'owner-receipt' }; },
    now: () => new Date(clock),
  });
  await runtime.ingest({ tabId: 20, sessionId: 'owner-session', snapshot: page() });
  const tool = tools.find((entry) => entry.classification === 'mutate');
  return { runtime, tool, calls };
}

test('human-gated remains the default and never dispatches a mutation', async () => {
  const { runtime, tool, calls } = await fixture();
  const property = Object.keys(tool.inputSchema.properties)[0];
  const result = await runtime.executeTool({ tabId: 20, sessionId: 'owner-session', name: tool.name, input: { [property]: 'hello' } });
  assert.equal(result.status, 'approval-required');
  assert.equal(calls.length, 0);
});

test('owner lease auto-authorizes through exact approval claim and dispatch', async () => {
  const lease = createLocalOwnerLease({ now: new Date('2026-08-31T10:00:00.000Z'), ttlMs: 60_000 });
  const policy = createOwnerAutonomyPolicy({
    profile: 'owner-autonomous',
    lease,
    now: () => new Date('2026-08-31T10:00:00.000Z'),
  });
  const { runtime, tool, calls } = await fixture({ ownerPolicy: policy });
  const property = Object.keys(tool.inputSchema.properties)[0];
  const result = await runtime.executeOwnerAction({
    tabId: 20,
    sessionId: 'owner-session',
    name: tool.name,
    input: { [property]: 'owner post' },
    snapshot: page(),
  });
  assert.equal(result.status, 'dispatched');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].approved, true);
  assert.match(calls[0].approvalClaim.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(runtime.state(20).pendingActions.length, 0);
});

test('expired or out-of-scope owner leases fall back to manual approval', async () => {
  const lease = createLocalOwnerLease({
    now: new Date('2026-08-31T09:00:00.000Z'),
    ttlMs: 1_000,
    origins: ['https://other.test'],
  });
  const policy = createOwnerAutonomyPolicy({
    profile: 'owner-autonomous',
    lease,
    now: () => new Date('2026-08-31T10:00:00.000Z'),
  });
  const { runtime, tool, calls } = await fixture({ ownerPolicy: policy });
  const property = Object.keys(tool.inputSchema.properties)[0];
  const result = await runtime.executeOwnerAction({
    tabId: 20, sessionId: 'owner-session', name: tool.name, input: { [property]: 'blocked' }, snapshot: page(),
  });
  assert.equal(result.status, 'approval-required');
  assert.equal(calls.length, 0);
});

test('owner policy cannot bypass refreshed page drift validation', async () => {
  const lease = createLocalOwnerLease({ now: new Date('2026-08-31T10:00:00.000Z'), ttlMs: 60_000 });
  const policy = createOwnerAutonomyPolicy({
    profile: 'owner-autonomous', lease, now: () => new Date('2026-08-31T10:00:00.000Z'),
  });
  const { runtime, tool, calls } = await fixture({ ownerPolicy: policy });
  const property = Object.keys(tool.inputSchema.properties)[0];
  await assert.rejects(runtime.executeOwnerAction({
    tabId: 20,
    sessionId: 'owner-session',
    name: tool.name,
    input: { [property]: 'must not post' },
    snapshot: page('Drifted page'),
  }), /changed|drift/i);
  assert.equal(calls.length, 0);
});
