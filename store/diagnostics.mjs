import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JsonLineDecoder, loadBridgeConfig } from '../bridge/common.mjs';

const originFor = (id) => `chrome-extension://${id}/`;
const sameOrigins = (actual, expected) => Array.isArray(actual)
  && actual.length === expected.length
  && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);

async function readJson(file) {
  const bytes = await readFile(file);
  if (bytes.length > 64 * 1024) throw new Error('Configuration too large');
  return JSON.parse(bytes.toString('utf8'));
}

// Exercise the installed MCP entry point, not a second implementation of its pipe protocol.
export function probeMcp(command, { args = [], timeoutMs = 8_000 } = {}) {
  return new Promise((resolve) => {
    let finished = false, mcp = false, expectedId = 1, received = 0, killTimer;
    const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.stdin.end();
      killTimer = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 500);
      killTimer.unref();
      resolve({ mcp, ...result });
    };
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const timer = setTimeout(() => finish({ code: 'TIMEOUT' }), timeoutMs);
    const decoder = new JsonLineDecoder({
      onError: () => finish({ code: 'PROTOCOL' }),
      onMessage: (message) => {
        if (finished) return;
        if (message?.jsonrpc !== '2.0') return finish({ code: 'PROTOCOL' });
        if (!Object.hasOwn(message, 'id')) return; // MCP notifications can interleave responses.
        if (message.id !== expectedId || message.error || !message.result) return finish({ code: 'PROTOCOL' });
        if (expectedId === 1) {
          if (message.result.serverInfo?.name !== 'toolbraid' || message.result.protocolVersion !== '2025-11-25') {
            return finish({ code: 'PROTOCOL' });
          }
          expectedId = 2;
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'ping' });
        } else if (expectedId === 2) {
          mcp = true;
          expectedId = 3;
          send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'toolbraid_status', arguments: {} } });
        } else {
          const status = message.result.structuredContent;
          if (message.result.isError || typeof status?.connected !== 'boolean') return finish({ code: 'PROTOCOL' });
          // Never return page URLs/titles, the raw response, paths or remote error messages.
          const code = status.error?.code === 'BRIDGE_AUTH_REJECTED' ? 'AUTH_REJECTED' : 'BROWSER_UNAVAILABLE';
          finish({ connected: status.connected, page: status.connected && Boolean(status.page), code: status.connected ? 'OK' : code });
        }
      },
    });
    child.once('spawn', () => send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'toolbraid-connection-check', version: '1' },
    } }));
    child.stdout.on('data', (chunk) => {
      received += chunk.length;
      if (received > 1024 * 1024) finish({ code: 'PROTOCOL' });
      else if (!finished) decoder.push(chunk);
    });
    child.stderr.resume(); // Diagnostics must not disclose launcher errors containing local paths.
    child.stdin.on('error', () => finish({ code: 'PROCESS' }));
    child.once('error', () => finish({ code: 'PROCESS' }));
    child.once('close', () => { finish({ code: 'PROCESS' }); clearTimeout(killTimer); });
  });
}

export async function diagnose({ dataRoot, aliasRoot, edgeId, chromeId, registered, mcpArgs = ['--mcp'], timeoutMs }) {
  const checks = [{ name: 'Runtime', state: 'OK', detail: 'The bundled Node.js runtime started.' }];
  const add = (name, state, detail) => checks.push({ name, state, detail });
  const report = () => {
    add('AI client', 'NOT TESTED', 'Chat is optional. This check sends no model request and does not verify account sign-in.');
    return { checks };
  };
  if (!registered) {
    add('Browser registration', 'ACTION NEEDED', 'Choose Connect browsers in the Store companion, then run this check again.');
    add('MCP and extension', 'NOT TESTED', 'The public browser registrations do not both point to this Store companion.');
    return report();
  }
  add('Browser registration', 'OK', 'The public Edge and Chrome registrations point to this Store companion.');
  const command = path.join(aliasRoot, 'ToolBraidMcp.exe');
  try {
    await Promise.all(['ToolBraidMcp.exe', 'ToolBraidNativeHost.exe'].map((name) => access(path.join(aliasRoot, name))));
  } catch {
    add('Execution aliases', 'ACTION NEEDED', 'Check ToolBraid in Windows App execution aliases, then reopen the companion.');
    return report();
  }
  try {
    if (![edgeId, chromeId].every((id) => /^[a-p]{32}$/.test(id))) throw new Error('Invalid extension ID');
    const origins = [...new Set([originFor(edgeId), originFor(chromeId)])];
    const config = await loadBridgeConfig(path.join(dataRoot, 'bridge-config.json'));
    const manifest = await readJson(path.join(dataRoot, 'com.toolbraid.bridge.json'));
    const client = (await readJson(path.join(dataRoot, 'mcp-client.json')))?.mcpServers?.toolbraid;
    if (!sameOrigins(config.allowedOrigins, origins) || !sameOrigins(manifest.allowed_origins, origins)
      || manifest.name !== 'com.toolbraid.bridge' || manifest.type !== 'stdio'
      || manifest.path !== path.join(aliasRoot, 'ToolBraidNativeHost.exe')
      || client?.command !== command || !Array.isArray(client.args) || client.args.length !== 1 || client.args[0] !== '--mcp') {
      throw new Error('Configuration mismatch');
    }
  } catch {
    add('Configuration', 'ACTION NEEDED', 'Connection files are missing, invalid or do not match this package. Existing data was not changed; do not send configuration files to support.');
    return report();
  }
  add('Configuration', 'OK', 'Connection files, exact extension IDs and stable launcher paths match.');
  const result = await probeMcp(command, { args: mcpArgs, timeoutMs });
  add('MCP', result.mcp ? 'OK' : 'ACTION NEEDED', result.mcp
    ? 'The MCP launcher answered initialize and ping.'
    : 'The MCP launcher did not complete its handshake. Check the execution alias and reopen the Store app.');
  if (result.code === 'OK') {
    add('Extension', 'CONNECTED', 'The browser extension answered the authenticated status request.');
    add('Selected page', result.page ? 'READY' : 'NOT SELECTED', result.page
      ? 'A page is bound. Its address and title are not included in this report.'
      : 'The extension is connected, but no page is bound. Open a permitted test page in the extension.');
  } else if (result.code === 'AUTH_REJECTED') {
    add('Extension', 'ACTION NEEDED', 'The local bridge rejected authentication. Close the old browser connection and reconnect the Store companion.');
  } else if (result.code === 'BROWSER_UNAVAILABLE') {
    checks.unshift({ name: 'Extension', state: 'NOT CONNECTED', detail:
      'Browser registration is not the same as enabling browser access. No live extension connection was found.\n\n'
      + '1. Keep Chrome or Edge open on https://example.org/ (not a new tab or browser settings).\n'
      + '2. Open the ToolBraid extension. If it says Paused, select Finish setup, read the disclosure and tick "I understand and allow this direct AI control."\n'
      + '3. Select "Enable on this site" (or "Connect this site" if already enabled). Approve access to this site if the browser asks.\n'
      + '4. Keep the test tab open, then select "Check again" here.\n\n'
      + 'ChatGPT sign-in is not required for this check. If already enabled and still disconnected, verify that the matching public extension is installed and reopen it. No permissions were changed by this check.' });
  } else {
    add('Extension', 'NOT VERIFIED', result.code === 'TIMEOUT'
      ? 'The status request timed out. Reopen the extension and try again.'
      : 'The status response was unavailable or invalid. Reopen the companion and extension, then try again.');
  }
  return report();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const value = (flag) => args[args.indexOf(flag) + 1];
  try {
    const result = await diagnose({ dataRoot: value('--data-root'), aliasRoot: value('--alias-root'),
      edgeId: value('--edge-id'), chromeId: value('--chrome-id'), registered: value('--registered') === 'yes' });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stdout.write(`${JSON.stringify({ checks: [{ name: 'Connection check', state: 'UNAVAILABLE', detail: 'The check could not finish. No settings were changed. Reopen the Store companion and try again.' }] })}\n`);
    process.exitCode = 1;
  }
}
