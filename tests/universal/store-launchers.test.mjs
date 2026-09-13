import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { probeMcp } from '../../store/diagnostics.mjs';

const root = process.env.TOOLBRAID_STORE_TEST_ROOT;
const origin = `chrome-extension://${'a'.repeat(32)}/`;
const nativeProtocol = { protocol: 'toolbraid.native-mcp', version: 1 };

function launch(target, config, extra = []) {
  const child = spawn(path.join(root, 'bridge', 'StoreLauncherHarness.exe'),
    [path.join(root, 'bridge', target), config, ...extra], { windowsHide: true });
  child.stdin.on('error', () => {});
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stderr }));
  });
  const stop = async () => {
    child.stdin.end();
    let timer;
    try {
      return await Promise.race([exited, new Promise((_, reject) => {
        timer = setTimeout(() => { child.kill(); reject(new Error('Launcher did not exit after stdin EOF')); }, 4000);
      })]);
    } finally { clearTimeout(timer); }
  };
  return { child, exited, stop };
}

function sendNative(child, message) {
  const json = Buffer.from(JSON.stringify({ ...nativeProtocol, ...message }));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length);
  child.stdin.write(Buffer.concat([header, json]));
}

test('compiled Store launchers use the packaged runtime and authenticated native/MCP bridge', {
  skip: process.platform !== 'win32' || !root ? 'Run scripts/test-store.ps1 on Windows to compile the isolated fixture.' : false,
  timeout: 30000,
}, async (t) => {
  const data = path.join(root, 'test-data');
  await mkdir(data);
  const configPath = path.join(data, 'bridge-config.json');
  const config = { version: 1, token: randomBytes(32).toString('hex'),
    pipe: `\\\\.\\pipe\\toolbraid-mcp-${randomUUID()}`, allowedOrigins: [origin] };
  await writeFile(configPath, JSON.stringify(config));
  const original = await readFile(configPath, 'utf8');
  const probe = (file = configPath) => probeMcp(path.join(root, 'bridge', 'StoreLauncherHarness.exe'), {
    args: [path.join(root, 'bridge', 'ToolBraidNativeHost.exe'), file, '--mcp'], timeoutMs: 8000,
  });

  await t.test('MCP initialize/ping work without a connected browser', async () => {
    assert.deepEqual(await probe(), { mcp: true, connected: false, page: false, code: 'BROWSER_UNAVAILABLE' });
  });

  await t.test('native origin enforcement and child exit codes survive the launcher', async () => {
    const rejected = launch('ToolBraidNativeHost.exe', configPath, [`chrome-extension://${'b'.repeat(32)}/`]);
    rejected.child.stdout.resume();
    const result = await rejected.stop();
    assert.equal(result.code, 1);
    assert.match(result.stderr, /NATIVE_ORIGIN_REJECTED/);
  });

  await t.test('native framing, authenticated MCP status, no-page state and EOF cleanup', async () => {
    const host = launch('ToolBraidNativeHost.exe', configPath, [origin]);
    let buffer = Buffer.alloc(0), page = null;
    const methods = [];
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const readyTimer = setTimeout(() => readyReject(new Error('Native host did not send host_ready')), 5000);
    host.child.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
        const length = buffer.readUInt32LE(0);
        const message = JSON.parse(buffer.subarray(4, length + 4));
        buffer = buffer.subarray(length + 4);
        if (message.kind === 'event' && message.event === 'host_ready') {
          sendNative(host.child, { kind: 'event', event: 'extension_ready' });
          readyResolve();
        } else if (message.kind === 'request') {
          methods.push(message.method);
          sendNative(host.child, { kind: 'response', requestId: message.requestId, ok: true,
            result: { connected: true, page, toolCount: 0 } });
        }
      }
    });
    try {
      await ready;
      clearTimeout(readyTimer);
      assert.deepEqual(await probe(), { mcp: true, connected: true, page: false, code: 'OK' });
      page = { url: 'https://example.org/PRIVATE_TEST_PAGE', title: 'PRIVATE_TEST_TITLE' };
      const bound = await probe();
      assert.deepEqual(bound, { mcp: true, connected: true, page: true, code: 'OK' });
      assert.doesNotMatch(JSON.stringify(bound), /PRIVATE_TEST/);
      const wrongToken = path.join(data, 'wrong-token.json');
      await writeFile(wrongToken, JSON.stringify({ ...config, token: randomBytes(32).toString('hex') }));
      assert.deepEqual(await probe(wrongToken), { mcp: true, connected: false, page: false, code: 'AUTH_REJECTED' });
      assert.deepEqual(methods, ['bridge.status', 'bridge.status']);
    } finally {
      clearTimeout(readyTimer);
      const closed = await host.stop();
      assert.equal(closed.code, 0);
    }
    assert.deepEqual(await probe(), { mcp: true, connected: false, page: false, code: 'BROWSER_UNAVAILABLE' });
    assert.equal(await readFile(configPath, 'utf8'), original);
  });

  await t.test('missing and corrupt configuration fail without replacing it', async () => {
    for (const contents of [null, '{invalid']) {
      const file = path.join(data, contents === null ? 'missing.json' : 'corrupt.json');
      if (contents !== null) await writeFile(file, contents);
      const result = await probe(file);
      assert.equal(result.mcp, false);
      assert.equal(result.code, 'PROCESS');
      if (contents !== null) assert.equal(await readFile(file, 'utf8'), contents);
    }
  });
});
