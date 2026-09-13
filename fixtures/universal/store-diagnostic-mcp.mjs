import { createInterface } from 'node:readline';

const mode = process.argv[2] ?? 'ready';
const input = createInterface({ input: process.stdin });
input.on('close', () => process.exit(0));
input.on('line', (line) => {
  const request = JSON.parse(line);
  if (!Object.hasOwn(request, 'id')) return;
  if (mode === 'hang') return;
  if (mode === 'malformed') return process.stdout.write('not JSON\n');
  if (mode === 'oversized') return process.stdout.write('x'.repeat(1024 * 1024 + 1));
  let result;
  if (request.method === 'initialize') {
    result = { protocolVersion: '2025-11-25', serverInfo: { name: mode === 'wrong-server' ? 'unrelated' : 'toolbraid' } };
  } else if (request.method === 'ping') result = {};
  else if (request.method === 'tools/call' && request.params.name === 'toolbraid_status') {
    const offline = mode === 'offline' || mode === 'auth';
    result = { structuredContent: { connected: !offline,
      page: mode === 'no-page' ? null : { url: 'https://private.example.invalid/secret', title: 'PRIVATE_TEST_TITLE' },
      error: { code: mode === 'auth' ? 'BRIDGE_AUTH_REJECTED' : 'ENOENT', message: 'PRIVATE_TEST_ERROR secret@example.invalid' },
    } };
  } else throw new Error('Diagnostics attempted a non-status tool');
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
});
