import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import test from 'node:test';

import {
  BRIDGE_PROTOCOL,
  BRIDGE_PROTOCOL_VERSION,
  JsonLineDecoder,
  validateBridgeConfig,
  writeJsonLine,
} from '../../bridge/common.mjs';
import { BridgeClient, ToolBraidMcpServer } from '../../bridge/mcp-server.mjs';

function outputCollector() {
  const messages = [];
  let pending = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      pending += chunk.toString('utf8');
      while (pending.includes('\n')) {
        const index = pending.indexOf('\n');
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        if (line) messages.push(JSON.parse(line));
      }
      callback();
    },
  });
  return { output, messages };
}

function dynamicTool(index) {
  return {
    name: `toolbraid.dynamic_${String(index).padStart(2, '0')}`,
    description: `Dynamic tool ${index}.`,
    inputSchema: { type: 'object', additionalProperties: false },
  };
}

const durableToolNames = [
  'toolbraid_mission_create', 'toolbraid_mission_run', 'toolbraid_mission_state', 'toolbraid_mission_cancel', 'toolbraid_mission_clear',
  'toolbraid_schedule_add', 'toolbraid_schedule_list', 'toolbraid_schedule_pause', 'toolbraid_schedule_resume', 'toolbraid_schedule_delete', 'toolbraid_schedule_tick',
];
const mediaToolNames = ['toolbraid_media_create', 'toolbraid_media_state', 'toolbraid_media_cancel'];
const workflowToolNames = [
  'toolbraid_workflow_demonstration_put', 'toolbraid_workflow_demonstration_list', 'toolbraid_workflow_demonstration_forget',
  'toolbraid_workflow_adapter_draft', 'toolbraid_workflow_adapter_version', 'toolbraid_workflow_adapter_enable',
  'toolbraid_workflow_adapter_disable', 'toolbraid_workflow_shadow_replay',
];

test('bridge config accepts the private installer pipe namespace', () => {
  if (process.platform !== 'win32') return;
  const config = validateBridgeConfig({
    version: 1,
    token: 'a'.repeat(64),
    pipe: `\\\\.\\pipe\\toolbraid-personal-mcp-${'b'.repeat(32)}`,
    allowedOrigin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/',
  });
  assert.match(config.pipe, /toolbraid-personal-mcp/);
});

test('bridge config accepts explicit Chrome and Edge origins, never wildcard callers', () => {
  const origins = [
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop/',
    'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/',
  ];
  const config = {
    version: 1, token: 'a'.repeat(64),
    pipe: process.platform === 'win32' ? `\\\\.\\pipe\\toolbraid-mcp-${'b'.repeat(32)}` : '/tmp/toolbraid-mcp-test.sock',
    allowedOrigins: origins,
  };
  assert.deepEqual(validateBridgeConfig(config).allowedOrigins, origins);
  assert.deepEqual(validateBridgeConfig({ ...config, allowedOrigins: undefined, allowedOrigin: origins[0] }).allowedOrigins, [origins[0]]);
  for (const allowedOrigins of [[], ['chrome-extension://*/'], ['https://example.test'], [null], 'invalid']) {
    assert.throws(() => validateBridgeConfig({ ...config, allowedOrigins }), /invalid/);
  }
});

test('MCP lifecycle lists live page tools and delegates effectful calls to local owner policy', async () => {
  let eventListener = null;
  let pageChanged = false;
  const bridgeCalls = [];
  const dynamicTool = {
    name: 'toolbraid.read_post.0123456789abcdef',
    title: 'Read post',
    description: 'Read the current post from the exact active page.',
    inputSchema: { type: 'object', additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
  };
  const bridge = {
    onEvent(listener) { eventListener = listener; return () => { eventListener = null; }; },
    async request(method, params) {
      bridgeCalls.push({ method, params });
      if (method === 'tools.list') return { tools: pageChanged ? [] : [dynamicTool] };
      if (method === 'bridge.status') return { connected: true, page: { origin: 'https://example.test' } };
      if (method === 'tools.call') return { ok: true, result: { status: 'read-completed', data: { text: 'hello' } } };
      throw new Error('unexpected method');
    },
    close() {},
  };
  const { output, messages } = outputCollector();
  const server = new ToolBraidMcpServer({ bridge, output });

  await server.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  });
  assert.equal(messages[0].result.capabilities.tools.listChanged, true);
  assert.match(messages[0].result.instructions, /local owner policy/i);
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.deepEqual(messages[1].result.tools.map((tool) => tool.name).filter((name) => !name.startsWith('toolbraid_files_')), [
    'toolbraid_status', 'toolbraid_file_grant_create', 'toolbraid_file_grant_revoke',
    'toolbraid_windows_list', 'toolbraid_windows_controls', 'toolbraid_windows_invoke', 'toolbraid_windows_set_value',
    ...durableToolNames,
    ...mediaToolNames,
    ...workflowToolNames,
    dynamicTool.name,
  ]);

  await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: dynamicTool.name, arguments: {} } });
  assert.equal(messages[2].result.isError, false);
  assert.equal(messages[2].result.structuredContent.result.status, 'read-completed');
  assert.equal(bridgeCalls.at(-1).method, 'tools.call');

  eventListener('tools_changed');
  assert.equal(messages.at(-1).method, 'notifications/tools/list_changed');
  await server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: dynamicTool.name, arguments: {} } });
  assert.equal(messages.at(-1).result.isError, false);
  assert.equal(bridgeCalls.at(-1).method, 'tools.call');
  const callCount = bridgeCalls.length;
  await server.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'toolbraid.never_listed', arguments: {} } });
  assert.equal(messages.at(-1).result.structuredContent.code, 'MCP_TOOL_NOT_LISTED');
  assert.equal(bridgeCalls.length, callCount + 1);
  assert.equal(bridgeCalls.at(-1).method, 'tools.list');
  eventListener('extension_ready');
  await server.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: dynamicTool.name, arguments: {} } });
  assert.equal(messages.at(-1).result.isError, false);
  assert.deepEqual(bridgeCalls.slice(-2).map((call) => call.method), ['tools.list', 'tools.call']);
  pageChanged = true;
  eventListener('extension_ready');
  await server.handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: dynamicTool.name, arguments: {} } });
  assert.equal(messages.at(-1).result.isError, true);
  assert.equal(messages.at(-1).result.structuredContent.code, 'MCP_TOOL_NOT_LISTED');
  server.close();
});

test('status remains callable and truthful while Chrome is disconnected', async () => {
  const bridge = {
    onEvent() { return () => {}; },
    async request() { throw Object.assign(new Error('offline detail'), { code: 'BRIDGE_DISCONNECTED' }); },
    close() {},
  };
  const { output, messages } = outputCollector();
  const server = new ToolBraidMcpServer({ bridge, output });
  await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.deepEqual(messages[1].result.tools.map((tool) => tool.name).filter((name) => !name.startsWith('toolbraid_files_')), [
    'toolbraid_status', 'toolbraid_file_grant_create', 'toolbraid_file_grant_revoke',
    'toolbraid_windows_list', 'toolbraid_windows_controls', 'toolbraid_windows_invoke', 'toolbraid_windows_set_value',
    ...durableToolNames,
    ...mediaToolNames,
    ...workflowToolNames,
  ]);
  await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'toolbraid_status', arguments: {} } });
  assert.equal(messages[2].result.isError, false);
  assert.equal(messages[2].result.structuredContent.connected, false);
  assert.equal(messages[2].result.structuredContent.error.code, 'BRIDGE_DISCONNECTED');
  server.close();
});

test('MCP delegates durable, media, and workflow tools to the local control plane', async () => {
  const calls = [];
  const bridge = {
    onEvent() { return () => {}; },
    async request(method, params) {
      calls.push({ method, params });
      if (method === 'tools.list') return { tools: [] };
      if (method === 'durable.mission.state') return { missionId: 'm1', status: 'pending', steps: [] };
      if (method === 'durable.schedule.pause') return { id: params.id, paused: true };
      if (method === 'media.job.state') return { jobId: params.jobId, status: 'running' };
      if (method === 'workflow.demonstrations.list') return [];
      throw new Error('unexpected method');
    },
    close() {},
  };
  const { output, messages } = outputCollector();
  const server = new ToolBraidMcpServer({ bridge, output });
  await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'toolbraid_mission_state', arguments: {} } });
  await server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'toolbraid_schedule_pause', arguments: { id: 'daily' } } });
  await server.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'toolbraid_media_state', arguments: { jobId: `media-${'a'.repeat(32)}` } } });
  await server.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'toolbraid_workflow_demonstration_list', arguments: {} } });
  assert.equal(messages[2].result.structuredContent.status, 'pending');
  assert.equal(messages[3].result.structuredContent.paused, true);
  assert.equal(messages[4].result.structuredContent.status, 'running');
  assert.deepEqual(messages[5].result.structuredContent, { result: [] });
  assert.deepEqual(calls.slice(-4), [
    { method: 'durable.mission.state', params: {} },
    { method: 'durable.schedule.pause', params: { id: 'daily' } },
    { method: 'media.job.state', params: { jobId: `media-${'a'.repeat(32)}` } },
    { method: 'workflow.demonstrations.list', params: {} },
  ]);
  server.close();
});

test('MCP exposes exactly 64 validated dynamic tools and truncates overflow deterministically', async () => {
  const candidates = Array.from({ length: 70 }, (_, index) => dynamicTool(index));
  candidates.splice(2, 0,
    { ...dynamicTool(99), name: 'invalid name' },
    dynamicTool(1),
    { ...dynamicTool(98), name: 'toolbraid_status' },
  );
  const bridge = {
    onEvent() { return () => {}; },
    async request(method) {
      if (method === 'tools.list') return { tools: candidates };
      throw new Error('unexpected method');
    },
    close() {},
  };
  const { output, messages } = outputCollector();
  const server = new ToolBraidMcpServer({ bridge, output });

  await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

  const names = messages[1].result.tools.map((tool) => tool.name);
  assert.equal(names.length, 100);
  assert.deepEqual(names.slice(0, 36).filter((name) => !name.startsWith('toolbraid_files_')), [
    'toolbraid_status', 'toolbraid_file_grant_create', 'toolbraid_file_grant_revoke',
    'toolbraid_windows_list', 'toolbraid_windows_controls', 'toolbraid_windows_invoke', 'toolbraid_windows_set_value',
    ...durableToolNames,
    ...mediaToolNames,
    ...workflowToolNames,
  ]);
  assert.deepEqual(names.slice(36), Array.from({ length: 64 }, (_, index) => dynamicTool(index).name));
  assert.equal(new Set(names).size, names.length);
  server.close();
});

test('authenticated named-pipe client rejects ambient unauthenticated access', async (context) => {
  const token = randomBytes(32).toString('hex');
  const pipe = process.platform === 'win32'
    ? `\\\\.\\pipe\\toolbraid-mcp-${randomBytes(16).toString('hex')}`
    : `/tmp/toolbraid-mcp-${randomBytes(16).toString('hex')}.sock`;
  const config = validateBridgeConfig({
    version: 1,
    token,
    pipe,
    allowedOrigin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/',
  });
  const server = net.createServer((socket) => {
    let authenticated = false;
    const decoder = new JsonLineDecoder({
      onMessage(message) {
        if (!authenticated) {
          authenticated = message.kind === 'auth' && message.token === token;
          writeJsonLine(socket, { protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION, kind: 'auth', ok: authenticated });
          if (!authenticated) socket.end();
          return;
        }
        writeJsonLine(socket, {
          protocol: BRIDGE_PROTOCOL,
          version: BRIDGE_PROTOCOL_VERSION,
          kind: 'response',
          requestId: message.requestId,
          ok: true,
          result: { connected: true },
        });
      },
      onError() { socket.destroy(); },
    });
    socket.on('data', (chunk) => decoder.push(chunk));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipe, resolve);
  });
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const client = new BridgeClient(config, { timeoutMs: 2_000 });
  const result = await client.request('bridge.status', {});
  assert.deepEqual(result, { connected: true });
  client.close();

  const wrong = new BridgeClient({ ...config, token: '0'.repeat(64) }, { timeoutMs: 2_000 });
  await assert.rejects(wrong.request('bridge.status', {}), (error) => error.code === 'BRIDGE_AUTH_REJECTED');
  wrong.close();
});

test('a running MCP client reconnects with updated configuration without replaying an interrupted command', async (context) => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'toolbraid-reconnect-'));
  const configPath = path.join(work, 'bridge-config.json');
  const servers = [];
  const sockets = new Set();
  const requests = [];
  const connections = [];
  let client;
  context.after(async () => {
    client?.close();
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    await rm(work, { recursive: true, force: true });
  });
  async function startBridge(generation) {
    const config = validateBridgeConfig({
      version: 1,
      token: randomBytes(32).toString('hex'),
      pipe: process.platform === 'win32'
        ? `\\\\.\\pipe\\toolbraid-mcp-${randomBytes(16).toString('hex')}`
        : path.join(work, `bridge-${generation}.sock`),
      allowedOrigin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/',
    });
    const server = net.createServer(socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      connections.push(generation);
      let authenticated = false;
      const decoder = new JsonLineDecoder({
        onMessage(message) {
          if (!authenticated) {
            authenticated = message.kind === 'auth' && message.token === config.token;
            writeJsonLine(socket, { protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION, kind: 'auth', ok: authenticated });
            if (!authenticated) socket.end();
            return;
          }
          requests.push({ generation, method: message.method });
          if (message.method === 'tools.call') { socket.destroy(); return; }
          writeJsonLine(socket, {
            protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION,
            kind: 'response', requestId: message.requestId, ok: true,
            result: { connected: true, generation },
          });
        },
        onError() { socket.destroy(); },
      });
      socket.on('data', chunk => decoder.push(chunk));
    });
    servers.push(server);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.pipe, resolve); });
    return config;
  }
  const first = await startBridge(1);
  await writeFile(configPath, JSON.stringify(first));
  client = new BridgeClient(first, { timeoutMs: 2_000, configPath });
  assert.deepEqual(await client.request('bridge.status'), { connected: true, generation: 1 });
  await assert.rejects(client.request('tools.call', { name: 'test-mutation' }), error => error.code === 'BRIDGE_DISCONNECTED');
  const second = await startBridge(2);
  await writeFile(configPath, JSON.stringify(second));
  const statuses = await Promise.all(Array.from({ length: 4 }, () => client.request('bridge.status')));
  assert.deepEqual(statuses, Array.from({ length: 4 }, () => ({ connected: true, generation: 2 })));
  assert.equal(connections.filter(generation => generation === 2).length, 1, 'reconnect must be single-flight');
  assert.deepEqual(requests.filter(request => request.method === 'tools.call'), [{ generation: 1, method: 'tools.call' }]);

  client.close();
  await writeFile(configPath, '{invalid');
  await assert.rejects(client.request('bridge.status'), error => error.code === 'BRIDGE_CONFIG_INVALID');
  await writeFile(configPath, JSON.stringify(second));
  assert.deepEqual(await client.request('bridge.status'), { connected: true, generation: 2 });
});
