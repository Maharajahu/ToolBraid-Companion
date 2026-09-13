import test from 'node:test';
import assert from 'node:assert/strict';

import { FileGrantStore, createFileGrantMethods } from '../../bridge/file-grants.mjs';
import { ToolBraidMcpServer } from '../../bridge/mcp-server.mjs';
import { createLocalFileGrantRequestHandler, createNativeFileUploadBroker } from '../../bridge/native-host.mjs';

const FILE = 'C:\\private\\media\\clip.mp4';
const ID = 'ab'.repeat(32);
const OWNER = 'owner-client-0123456789abcdef';
const OTHER_OWNER = 'other-client-0123456789abcdef';

function details(overrides = {}) {
  return { isFile: () => true, size: 42, dev: 1, ino: 2, mtimeMs: 3, ...overrides };
}

test('creates an opaque expiring grant without exposing its path or bytes', async () => {
  const store = new FileGrantStore({
    selectFile: async () => FILE,
    realpath: async () => FILE,
    stat: async () => details(),
    now: () => 1_000,
    randomBytes: () => Buffer.from(ID, 'hex'),
  });
  const grant = await store.create(OWNER);
  assert.deepEqual(grant, { grantId: ID, basename: 'clip.mp4', size: 42, mime: 'video/mp4', expiresAt: 601_000 });
  assert.equal(JSON.stringify(grant).includes('private'), false);
});

test('atomically consumes once and revalidates file identity', async () => {
  let release;
  let calls = 0;
  const store = new FileGrantStore({
    selectFile: async () => FILE,
    realpath: async () => { calls += 1; if (calls === 2) await new Promise((resolve) => { release = resolve; }); return FILE; },
    stat: async () => details(),
    randomBytes: () => Buffer.from(ID, 'hex'),
  });
  await store.create(OWNER);
  const first = store.resolveOnce(ID, OWNER);
  await Promise.resolve();
  await assert.rejects(store.resolveOnce(ID, OWNER), (error) => error.code === 'FILE_GRANT_NOT_FOUND');
  release();
  assert.deepEqual(await first, { path: FILE, basename: 'clip.mp4', size: 42, mime: 'video/mp4' });
  await assert.rejects(store.resolveOnce(ID, OWNER), (error) => error.code === 'FILE_GRANT_NOT_FOUND');
});

test('expiry, revocation and changed files consume grants without leaking paths in errors', async () => {
  let now = 0;
  let fileDetails = details();
  let sequence = 0;
  const store = new FileGrantStore({
    selectFile: async () => FILE,
    realpath: async () => FILE,
    stat: async () => fileDetails,
    now: () => now,
    randomBytes: () => Buffer.alloc(32, ++sequence),
    ttlMs: 10,
  });
  const expired = await store.create(OWNER);
  now = 10;
  await assert.rejects(store.resolveOnce(expired.grantId, OWNER), (error) => error.code === 'FILE_GRANT_EXPIRED' && !error.message.includes('private'));
  now = 0;
  const revoked = await store.create(OWNER);
  assert.deepEqual(store.revoke(revoked.grantId, OWNER), { revoked: true });
  await assert.rejects(store.resolveOnce(revoked.grantId, OWNER), (error) => error.code === 'FILE_GRANT_NOT_FOUND');
  const changed = await store.create(OWNER);
  fileDetails = details({ size: 99 });
  await assert.rejects(store.resolveOnce(changed.grantId, OWNER), (error) => error.code === 'FILE_GRANT_CHANGED' && !error.message.includes('private'));
});

test('binds grants to one opaque client owner without cross-client revoke or consumption', async () => {
  const store = new FileGrantStore({
    selectFile: async () => FILE,
    realpath: async () => FILE,
    stat: async () => details(),
    randomBytes: () => Buffer.from(ID, 'hex'),
  });
  const grant = await store.create(OWNER);
  assert.equal(JSON.stringify(grant).includes(OWNER), false);
  assert.deepEqual(store.revoke(grant.grantId, OTHER_OWNER), { revoked: false });
  await assert.rejects(store.resolveOnce(grant.grantId, OTHER_OWNER), (error) => error.code === 'FILE_GRANT_NOT_FOUND');
  assert.deepEqual(await store.resolveOnce(grant.grantId, OWNER), { path: FILE, basename: 'clip.mp4', size: 42, mime: 'video/mp4' });
});

test('MCP always lists and locally dispatches create/revoke file-grant tools', async () => {
  const requests = [];
  const lines = [];
  const bridge = {
    onEvent: () => () => {},
    request: async (method, params) => {
      requests.push([method, params]);
      if (method === 'tools.list') throw new Error('extension offline');
      if (method === 'files.grant.create') return { grantId: ID, basename: 'clip.mp4', size: 42, mime: 'video/mp4', expiresAt: 123 };
      if (method === 'files.grant.revoke') return { revoked: true };
      throw new Error('unexpected');
    },
  };
  const output = { write: (value) => lines.push(JSON.parse(value)) };
  const server = new ToolBraidMcpServer({ bridge, output });
  await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(lines.at(-1).result.tools.map(({ name }) => name).slice(0, 3), [
    'toolbraid_status', 'toolbraid_file_grant_create', 'toolbraid_file_grant_revoke',
  ]);
  await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'toolbraid_file_grant_create', arguments: {} } });
  assert.equal(lines.at(-1).result.structuredContent.grantId, ID);
  await server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'toolbraid_file_grant_revoke', arguments: { grantId: ID } } });
  assert.equal(lines.at(-1).result.structuredContent.revoked, true);
  assert.deepEqual(requests.slice(-2), [['files.grant.create', {}], ['files.grant.revoke', { grantId: ID }]]);
});

test('native host dispatches file grants locally without involving Chrome', async () => {
  const calls = [];
  const handle = createLocalFileGrantRequestHandler({
    create: async (params, ownerId) => { calls.push(['create', params, ownerId]); return { grantId: ID }; },
    revoke: async (params, ownerId) => { calls.push(['revoke', params, ownerId]); return { revoked: true }; },
  });
  assert.deepEqual(await handle(OWNER, 'files.grant.create', {}), { grantId: ID });
  assert.deepEqual(await handle(OWNER, 'files.grant.revoke', { grantId: ID }), { revoked: true });
  assert.deepEqual(calls, [['create', {}, OWNER], ['revoke', { grantId: ID }, OWNER]]);
  await assert.rejects(handle(OWNER, 'tools.call', {}), (error) => error.code === 'BRIDGE_METHOD_UNSUPPORTED');
});

test('native broker expands a listed file-input grant internally once and never for unlisted tools', async () => {
  const client = { ownerId: OWNER };
  const calls = [];
  const broker = createNativeFileUploadBroker({
    async resolveOnce(grantId, ownerId) {
      calls.push([grantId, ownerId]);
      return { path: FILE, basename: 'clip.mp4', size: 42, mime: 'video/mp4' };
    },
  });
  broker.rememberTools(client, { tools: [
    { name: 'attach-file', _meta: { 'toolbraid/fileInput': true } },
    { name: 'ordinary-tool', _meta: {} },
  ] });
  const expanded = await broker.prepare(client, 'tools.call', { name: 'attach-file', arguments: { grantId: ID } });
  assert.deepEqual(expanded.arguments, {
    grantId: ID,
    resolvedLocalPath: FILE,
    expectedFile: { name: 'clip.mp4', size: 42, count: 1, mime: 'video/mp4' },
  });
  assert.deepEqual(calls, [[ID, OWNER]]);
  const ordinary = { name: 'ordinary-tool', arguments: { grantId: ID } };
  assert.equal(await broker.prepare(client, 'tools.call', ordinary), ordinary);
  assert.deepEqual(calls, [[ID, OWNER]]);
  assert.equal(JSON.stringify({ ok: true, result: { status: 'attached' } }).includes(FILE), false);
});

test('native broker rejects injected paths before resolving and clears stale listed descriptors', async () => {
  const client = { ownerId: OWNER };
  let resolutions = 0;
  const broker = createNativeFileUploadBroker({ async resolveOnce() { resolutions += 1; throw new Error('must not run'); } });
  broker.rememberTools(client, { tools: [{ name: 'attach-file', _meta: { 'toolbraid/fileInput': true } }] });
  await assert.rejects(
    broker.prepare(client, 'tools.call', { name: 'attach-file', arguments: { grantId: ID, resolvedLocalPath: FILE } }),
    (error) => error.code === 'FILE_GRANT_ARGUMENTS_INVALID' && !error.message.includes(FILE),
  );
  assert.equal(resolutions, 0);
  broker.clear(client);
  const stale = { name: 'attach-file', arguments: { grantId: ID } };
  assert.equal(await broker.prepare(client, 'tools.call', stale), stale);
  assert.equal(resolutions, 0);

  await assert.rejects(
    broker.prepare(client, 'tools.call', {
      name: `toolbraid.attach_file.${'cd'.repeat(8)}`,
      arguments: { grantId: ID, resolvedLocalPath: FILE, expectedFile: { name: 'clip.mp4', size: 42 } },
    }),
    (error) => error.code === 'FILE_GRANT_ARGUMENTS_INVALID' && !error.message.includes(FILE),
  );
  assert.equal(resolutions, 0);
});

test('native broker cannot resolve another authenticated client owner grant', async () => {
  const store = new FileGrantStore({
    selectFile: async () => FILE,
    realpath: async () => FILE,
    stat: async () => details(),
    randomBytes: () => Buffer.from(ID, 'hex'),
  });
  const methods = createFileGrantMethods(store);
  const broker = createNativeFileUploadBroker(methods);
  const ownerClient = { ownerId: OWNER };
  const otherClient = { ownerId: OTHER_OWNER };
  const descriptorSet = { tools: [{ name: 'attach-file', _meta: { 'toolbraid/fileInput': true } }] };
  broker.rememberTools(ownerClient, descriptorSet);
  broker.rememberTools(otherClient, descriptorSet);
  const grant = await methods.create({}, OWNER);
  await assert.rejects(
    broker.prepare(otherClient, 'tools.call', { name: 'attach-file', arguments: { grantId: grant.grantId } }),
    (error) => error.code === 'FILE_GRANT_NOT_FOUND',
  );
  const expanded = await broker.prepare(ownerClient, 'tools.call', { name: 'attach-file', arguments: { grantId: grant.grantId } });
  assert.equal(expanded.arguments.resolvedLocalPath, FILE);
  assert.equal(JSON.stringify(grant).includes(OWNER), false);
});
