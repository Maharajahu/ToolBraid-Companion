import test from 'node:test';
import assert from 'node:assert/strict';
import { probeCodex, runCodexChat, startChatGptLogin } from '../../bridge/codex-agent.mjs';
import os from 'node:os';

function harness(type = 'chatgpt', outcome = 'completed') {
  const requests = [], notifications = [], toolResponses = [];
  let closed = 0;
  let callbacks;
  function connect(options) {
    callbacks = options;
    return { initialize: async () => {}, close: () => { closed++; }, async request(method, params) {
      requests.push({ method, params });
      if (method === 'account/read') return { account: { type, email: 'never-return-this@example.test' } };
      if (method === 'model/list') return { data: [{ model: 'test-model', displayName: 'Test' }] };
      if (method === 'config/read') return { config: { mcp_servers: { private: { command: 'must-not-run' } } } };
      if (method === 'thread/start') return { thread: { id: 'thread-1' } };
      if (method === 'account/login/start') return { authUrl: 'https://auth.openai.com/oauth/authorize?state=opaque', loginId: 'login-1' };
      if (method === 'turn/start') {
        setImmediate(async () => {
          try {
            toolResponses.push(await options.onRequest({ method: 'item/commandExecution/requestApproval', params: {} }));
            toolResponses.push(await options.onRequest({ method: 'item/tool/call', params: { threadId: 'thread-1', tool: 'toolbraid_list_tools', arguments: {} } }));
            toolResponses.push(await options.onRequest({ method: 'item/tool/call', params: { threadId: 'thread-1', tool: 'toolbraid_call_tool', arguments: { name: 'page.read', arguments: {} } } }));
            options.onNotification({ method: 'item/agentMessage/delta', params: { delta: 'Hello' } });
            options.onNotification({ method: 'turn/completed', params: { turn: { status: outcome } } });
          } catch (error) { notifications.push(error); }
        });
        return { turn: { id: 'turn-1' } };
      }
      return {};
    } };
  }
  return { connect, requests, notifications, toolResponses, closed: () => closed, notify: (message) => callbacks.onNotification(message) };
}
test('probe accepts ChatGPT, omits account email, and rejects API-key/other accounts', async () => {
  const h = harness();
  const result = await probeCodex({ cwd: os.tmpdir(), connect: h.connect });
  assert.equal(result.authenticated, true); assert.equal(result.models[0].id, 'test-model');
  assert.doesNotMatch(JSON.stringify(result), /email|example.test/);
  assert.equal(h.closed(), 1);
  for (const type of ['apiKey', 'amazonBedrock', undefined]) await assert.rejects(probeCodex({ cwd: os.tmpdir(), connect: harness(type ?? 'missing').connect }), /API-key accounts are not accepted/);
});
test('Codex protocol streams, exposes dynamic browser tools and declines other actions', async () => {
  const h = harness(); let text = ''; const calls = [];
  await runCodexChat({ cwd: os.tmpdir(), model: 'test-model', messages: [{ role: 'user', content: 'Read page' }], instructions: 'Browser only', signal: new AbortController().signal,
    listTools: async () => ({ tools: [{ name: 'page.read' }] }), callTool: async (...args) => { calls.push(args); return { text: 'page' }; }, onDelta: (delta) => { text += delta; }, onActivity: () => {}, connect: h.connect });
  assert.equal(text, 'Hello'); assert.equal(calls.length, 1);
  const start = h.requests.find((item) => item.method === 'thread/start').params;
  assert.equal(start.sandbox, 'read-only'); assert.equal(start.ephemeral, true);
  assert.equal(start.modelProvider, 'openai'); assert.equal(start.config['mcp_servers.private.enabled'], false);
  assert.equal(start.dynamicTools.length, 2);
  assert.deepEqual(h.toolResponses[0], { decision: 'decline' });
  assert.equal(h.toolResponses[2].success, true); assert.equal(h.closed(), 1);
});
test('failed Codex turns are not reported as complete', async () => {
  const h = harness('chatgpt', 'failed');
  await assert.rejects(runCodexChat({ cwd: os.tmpdir(), messages: [], signal: new AbortController().signal, listTools: async () => ({}), callTool: async () => ({}), onDelta: () => {}, onActivity: () => {}, connect: h.connect }), /turn failed/);
});
test('managed sign-in requests ChatGPT only and returns only the official URL', async () => {
  const h = harness(); let completed = false;
  const login = await startChatGptLogin({ cwd: os.tmpdir(), connect: h.connect, onComplete: (value) => { completed = value; } });
  assert.equal(new URL(login.url).origin, 'https://auth.openai.com');
  assert.deepEqual(h.requests.find((item) => item.method === 'account/login/start').params, { type: 'chatgpt' });
  h.notify({ method: 'account/login/completed', params: { success: true } });
  assert.equal(completed, true); login.close();
});
