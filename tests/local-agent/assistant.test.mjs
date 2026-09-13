import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssistant, validateAssistantSettings } from '../../bridge/assistant.mjs';

const target = { targetTabId: 7, targetWindowId: 2, targetFrameId: 0 };
const tool = { name: 'toolbraid.test', title: 'Reply to the post', _meta: { 'toolbraid/originalName': 'reply' }, inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } };
async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out'); await new Promise(setImmediate); }
}
function harness(codexRun) {
  const events = [], calls = [];
  let stored = null;
  let page = { url: 'https://x.com/test/status/1', pageFingerprint: 'first' };
  const store = { read: async () => stored, write: async (_, value) => { stored = structuredClone(value); } };
  const assistant = createAssistant({ store, cwd: 'unused', codexRun, emit: (event) => events.push(event), requestExtension: async (method, params) => {
    assert.deepEqual(params.target, target);
    if (method === 'tools.list') return { tools: [tool, { name: 'toolbraid.files.write' }], context: { page } };
    calls.push(params); return { ok: true, result: 'sent once' };
  } });
  return { assistant, events, calls, store, stored: () => stored, drift: () => { page = { ...page, pageFingerprint: 'changed' }; }, approval: () => events.findLast((event) => event.type === 'state' && event.state.active?.approval)?.state.active };
}
test('chat accepts only subscription-backed Codex settings', () => {
  assert.deepEqual(validateAssistantSettings(), { model: '', codexExecutable: 'codex' });
  for (const settings of [{ apiKey: 'secret' }, { endpoint: 'https://api.example' }, { provider: 'local' }, { model: 'bad\nmodel' }]) assert.throws(() => validateAssistantSettings(settings));
});
test('streams and persists local history, reuses it, and exposes no tools without page consent', async () => {
  const histories = [];
  const h = harness(async ({ messages, listTools, onDelta }) => { histories.push(messages); assert.deepEqual((await listTools()).tools, []); onDelta('Hello'); onDelta(' developer'); });
  await h.assistant.handle('send', { message: 'Hi' });
  await until(() => h.stored()?.messages.at(-1)?.status === 'completed');
  assert.equal(h.stored().messages.at(-1).content, 'Hello developer');
  assert.equal(h.events.filter((event) => event.type === 'delta').length, 2);
  await h.assistant.handle('send', { message: 'Continue' });
  await until(() => h.stored()?.messages.length === 4 && h.stored().messages.at(-1).status === 'completed');
  assert.equal(histories[1][1].content, 'Hello developer');
  await h.assistant.handle('clear'); assert.equal(h.stored().messages.length, 0);
});
test('mutations require an exact one-use approval and pinned page context', async () => {
  const h = harness(async ({ listTools, callTool, onDelta }) => { assert.equal((await listTools()).tools.length, 1); await callTool(tool.name, { text: 'Thanks!' }); onDelta('Sent.'); });
  const run = await h.assistant.handle('send', { message: 'Reply Thanks!', target });
  await until(() => h.approval());
  assert.equal(h.calls.length, 0);
  const approvalId = h.approval().approval.id;
  await assert.rejects(h.assistant.handle('approve', { runId: run.runId, approvalId: 'forged', approved: true }), /stale/);
  await h.assistant.handle('approve', { runId: run.runId, approvalId, approved: true });
  await until(() => h.stored()?.messages.at(-1)?.status === 'completed');
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].arguments, { text: 'Thanks!' });
  await assert.rejects(h.assistant.handle('approve', { runId: run.runId, approvalId, approved: true }), /stale/);
});
test('reject and Stop both prevent a waiting mutation from executing', async () => {
  for (const action of ['reject', 'stop']) {
    const h = harness(async ({ callTool }) => { await callTool(tool.name, { text: 'Do not send' }); });
    const run = await h.assistant.handle('send', { message: 'Test', target });
    await until(() => h.approval());
    if (action === 'stop') await h.assistant.handle('stop');
    else await h.assistant.handle('approve', { runId: run.runId, approvalId: h.approval().approval.id, approved: false });
    await until(() => ['stopped', 'error'].includes(h.stored()?.messages.at(-1)?.status));
    assert.equal(h.calls.length, 0);
  }
});
test('page drift after approval fails closed', async () => {
  const h = harness(async ({ callTool }) => callTool(tool.name, { text: 'Exact text' }));
  const run = await h.assistant.handle('send', { message: 'Reply', target });
  await until(() => h.approval()); h.drift();
  await h.assistant.handle('approve', { runId: run.runId, approvalId: h.approval().approval.id, approved: true });
  await until(() => h.stored()?.messages.at(-1)?.status === 'error');
  assert.match(h.stored().messages.at(-1).notice, /changed after approval/);
  assert.equal(h.calls.length, 0);
});
test('a running conversation rejects configuration, clearing, and concurrent sends', async () => {
  const h = harness(async ({ signal, onDelta }) => { onDelta('Partial'); await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true })); });
  await h.assistant.handle('send', { message: 'Start' });
  await until(() => h.events.some((event) => event.type === 'delta'));
  for (const method of ['configure', 'clear', 'send']) await assert.rejects(h.assistant.handle(method), /current turn/);
  await h.assistant.handle('stop');
  await until(() => h.stored()?.messages.at(-1)?.status === 'stopped');
  assert.equal(h.stored().messages.at(-1).content, 'Partial');
});

test('a failed initial save does not leave chat stuck or retain an unsent message', async () => {
  let runs = 0;
  const h = harness(async ({ onDelta }) => { runs++; onDelta('Saved turn'); });
  const write = h.store.write;
  h.store.write = async () => { throw new Error('Storage unavailable'); };
  await assert.rejects(h.assistant.handle('send', { message: 'Must not start' }), /Storage unavailable/);
  assert.equal(runs, 0);
  assert.equal((await h.assistant.handle('state')).active, null);
  assert.deepEqual((await h.assistant.handle('state')).messages, []);
  h.store.write = write;
  await h.assistant.handle('send', { message: 'Try once storage works' });
  await until(() => h.stored()?.messages.at(-1)?.status === 'completed');
  assert.equal(runs, 1);
  assert.equal(h.stored().messages.length, 2);
});
