import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose, probeMcp } from '../../store/diagnostics.mjs';

const fixture = fileURLToPath(new URL('../../fixtures/universal/store-diagnostic-mcp.mjs', import.meta.url));

test('Store probe checks MCP and redacts all page and error content', async (t) => {
  for (const [mode, expected] of [
    ['ready', { mcp: true, connected: true, page: true, code: 'OK' }],
    ['no-page', { mcp: true, connected: true, page: false, code: 'OK' }],
    ['offline', { mcp: true, connected: false, page: false, code: 'BROWSER_UNAVAILABLE' }],
    ['auth', { mcp: true, connected: false, page: false, code: 'AUTH_REJECTED' }],
    ['wrong-server', { mcp: false, code: 'PROTOCOL' }],
    ['malformed', { mcp: false, code: 'PROTOCOL' }],
    ['oversized', { mcp: false, code: 'PROTOCOL' }],
    ['hang', { mcp: false, code: 'TIMEOUT' }],
  ]) {
    await t.test(mode, async () => {
      const result = await probeMcp(process.execPath, { args: [fixture, mode], timeoutMs: mode === 'hang' ? 200 : 4000 });
      assert.deepEqual(result, expected);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TEST|secret|private\.example/);
    });
  }
});

test('Store probe reports an unavailable executable without exposing its path', async () => {
  assert.deepEqual(await probeMcp(path.join(os.tmpdir(), 'toolbraid-nonexistent-command.exe')), { mcp: false, code: 'PROCESS' });
});

test('Store diagnostics validate registration, exact IDs and config before a read-only probe', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'toolbraid-store-diagnostics-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, 'data'), aliasRoot = path.join(root, 'aliases');
  await Promise.all([mkdir(dataRoot), mkdir(aliasRoot)]);
  const edgeId = 'a'.repeat(32), chromeId = 'b'.repeat(32);
  const origins = [edgeId, chromeId].map((id) => `chrome-extension://${id}/`);
  const configPath = path.join(dataRoot, 'bridge-config.json');
  const config = { version: 1, token: 'c'.repeat(64),
    pipe: process.platform === 'win32' ? '\\\\.\\pipe\\toolbraid-mcp-12345678' : path.join(root, 'unused.sock'),
    allowedOrigins: origins, allowedOrigin: origins[0] };
  const manifestPath = path.join(dataRoot, 'com.toolbraid.bridge.json');
  const manifest = { name: 'com.toolbraid.bridge', type: 'stdio', path: path.join(aliasRoot, 'ToolBraidNativeHost.exe'), allowed_origins: origins };
  const options = { dataRoot, aliasRoot, edgeId, chromeId, registered: true, mcpArgs: [fixture, 'ready'] };
  const check = (result, name) => result.checks.find((item) => item.name === name);
  await writeFile(configPath, JSON.stringify(config));
  await writeFile(manifestPath, JSON.stringify(manifest));
  const clientPath = path.join(dataRoot, 'mcp-client.json');
  const client = { mcpServers: { toolbraid: { command: path.join(aliasRoot, 'ToolBraidMcp.exe'), args: ['--mcp'] } } };
  await writeFile(clientPath, JSON.stringify(client));
  assert.equal(check(await diagnose({ ...options, registered: false }), 'MCP and extension').state, 'NOT TESTED');
  assert.equal(check(await diagnose(options), 'Execution aliases').state, 'ACTION NEEDED');
  // An executable fixture stands in for the alias here; real compiled launchers have separate tests.
  await copyFile(process.execPath, path.join(aliasRoot, 'ToolBraidMcp.exe'));
  await writeFile(manifest.path, 'test-only sentinel');
  const before = await readFile(configPath, 'utf8');
  const good = await diagnose(options);
  assert.equal(check(good, 'MCP').state, 'OK');
  assert.equal(check(good, 'Extension').state, 'CONNECTED');
  assert.equal(check(good, 'AI client').state, 'NOT TESTED');
  assert.doesNotMatch(JSON.stringify(good), /PRIVATE_TEST|secret|private\.example|cccccccc/);
  assert.equal(await readFile(configPath, 'utf8'), before);
  const offline = await diagnose({ ...options, mcpArgs: [fixture, 'offline'] });
  assert.equal(offline.checks[0].name, 'Extension');
  assert.equal(offline.checks[0].state, 'NOT CONNECTED');
  assert.match(offline.checks[0].detail, /https:\/\/example\.org\//);
  assert.match(offline.checks[0].detail, /Finish setup/);
  assert.match(offline.checks[0].detail, /tick "I understand and allow this direct AI control\."/);
  assert.match(offline.checks[0].detail, /Enable on this site/);
  assert.match(offline.checks[0].detail, /Check again/);
  assert.match(offline.checks[0].detail, /ChatGPT sign-in is not required/);
  assert.equal(check(offline, 'MCP').state, 'OK');
  assert.doesNotMatch(JSON.stringify(offline), /PRIVATE_TEST|secret|private\.example|cccccccc/);
  const noPage = await diagnose({ ...options, mcpArgs: [fixture, 'no-page'] });
  assert.equal(check(noPage, 'Extension').state, 'CONNECTED');
  assert.equal(check(noPage, 'Selected page').state, 'NOT SELECTED');
  const rejected = await diagnose({ ...options, mcpArgs: [fixture, 'auth'] });
  assert.equal(check(rejected, 'Extension').state, 'ACTION NEEDED');
  assert.match(check(rejected, 'Extension').detail, /rejected authentication/);
  assert.equal(await readFile(configPath, 'utf8'), before);
  await writeFile(clientPath, JSON.stringify({ mcpServers: { toolbraid: { ...client.mcpServers.toolbraid, args: [] } } }));
  assert.equal(check(await diagnose(options), 'Configuration').state, 'ACTION NEEDED');
  await writeFile(clientPath, JSON.stringify(client));
  await writeFile(manifestPath, JSON.stringify({ ...manifest, allowed_origins: ['chrome-extension://wrong/'] }));
  assert.equal(check(await diagnose(options), 'Configuration').state, 'ACTION NEEDED');
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(configPath, '{broken');
  assert.equal(check(await diagnose(options), 'Configuration').state, 'ACTION NEEDED');
  assert.equal(await readFile(configPath, 'utf8'), '{broken');
});
