import assert from 'node:assert/strict';
import test from 'node:test';
import { createDownloadOwnerTools } from '../../extension/download-owner-tools.js';

function fixture(overrides = {}) {
  let counter = 0;
  const calls = [];
  const item = {
    id: 7,
    url: 'https://user:secret@example.com/file.zip#secret',
    finalUrl: 'https://example.com/file.zip#done',
    filename: 'C:\\Users\\owner\\Downloads\\file.zip',
    state: 'complete',
    bytesReceived: 12,
    totalBytes: 12,
    startTime: '2026-08-31T01:00:00Z',
    ...overrides,
  };
  const chromeApi = { downloads: {
    search: async (query) => { calls.push(['search', query]); return [item]; },
    cancel: async (id) => calls.push(['cancel', id]),
    show: async (id) => calls.push(['show', id]),
  } };
  const tools = createDownloadOwnerTools({
    chromeApi,
    cryptoRef: { getRandomValues(bytes) { bytes.fill(++counter); } },
    setTimeoutRef: (resolve) => { resolve(); return 0; },
  });
  return { tools, item, calls };
}

test('lists bounded sanitized downloads with opaque handles and no local path', async () => {
  const { tools, calls } = fixture();
  const result = await tools.call('toolbraid.download.list', { limit: 5 });
  assert.deepEqual(calls[0], ['search', { orderBy: ['-startTime'], limit: 5 }]);
  assert.equal(result.downloads.length, 1);
  assert.match(result.downloads[0].handle, /^[0-9a-f]{32}$/);
  assert.equal(result.downloads[0].filename, 'file.zip');
  assert.equal(result.downloads[0].url, 'https://example.com/file.zip');
  assert.equal(JSON.stringify(result).includes('Users'), false);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('show requires a completed download from the latest listing', async () => {
  const { tools, calls } = fixture();
  const { downloads } = await tools.call('toolbraid.download.list');
  await tools.call('toolbraid.download.show', { handle: downloads[0].handle });
  assert.deepEqual(calls.filter(([name]) => name === 'show'), [['show', 7]]);
  tools.invalidate();
  await assert.rejects(() => tools.call('toolbraid.download.show', { handle: downloads[0].handle }), { code: 'DOWNLOAD_HANDLE_STALE' });
});

test('download handles survive concurrent listings and the oldest capabilities are evicted at the bound', async () => {
  const { tools } = fixture();
  const first = await tools.call('toolbraid.download.list');
  const second = await tools.call('toolbraid.download.list');
  await tools.call('toolbraid.download.show', { handle: first.downloads[0].handle });
  await tools.call('toolbraid.download.show', { handle: second.downloads[0].handle });

  let sequence = 0;
  const item = { id: 7, url: 'https://example.test/file', filename: 'C:\\secret\\file', state: 'complete', startTime: 'now' };
  const bounded = createDownloadOwnerTools({
    chromeApi: { downloads: { search: async () => [item], show: async () => {} } },
    cryptoRef: { getRandomValues(bytes) { bytes.fill(++sequence); } },
    handleLimit: 3,
  });
  const oldest = (await bounded.call('toolbraid.download.list')).downloads[0].handle;
  await bounded.call('toolbraid.download.list');
  await bounded.call('toolbraid.download.list');
  await bounded.call('toolbraid.download.list');
  assert.equal(bounded.handleCount(), 3);
  await assert.rejects(
    bounded.call('toolbraid.download.show', { handle: oldest }),
    (error) => error.code === 'DOWNLOAD_HANDLE_STALE',
  );
});

test('tolerates redirect metadata changes but rejects stable identity replacement', async () => {
  const { tools, item, calls } = fixture({ state: 'in_progress' });
  const { downloads } = await tools.call('toolbraid.download.list');
  item.filename = 'C:\\Users\\owner\\Downloads\\different.zip';
  item.finalUrl = 'https://cdn.example.com/different.zip';
  await tools.call('toolbraid.download.cancel', { handle: downloads[0].handle });
  assert.deepEqual(calls.at(-1), ['cancel', 7]);

  const fresh = await tools.call('toolbraid.download.list');
  item.startTime = '2026-08-31T02:00:00Z';
  await assert.rejects(() => tools.call('toolbraid.download.cancel', { handle: fresh.downloads[0].handle }), { code: 'DOWNLOAD_HANDLE_STALE' });
});

test('wait observes completion and enforces the 20 second bound', async () => {
  const { tools, item } = fixture({ state: 'in_progress' });
  const { downloads } = await tools.call('toolbraid.download.list');
  let polls = 0;
  const originalState = item.state;
  Object.defineProperty(item, 'state', {
    configurable: true,
    get() { polls += 1; return polls >= 3 ? 'complete' : originalState; },
  });
  const result = await tools.call('toolbraid.download.wait', { handle: downloads[0].handle, timeoutMs: 100 });
  assert.equal(result.completed, true);
  await assert.rejects(() => tools.call('toolbraid.download.wait', { handle: downloads[0].handle, timeoutMs: 20_001 }), { code: 'DOWNLOAD_TIMEOUT_INVALID' });
});

test('descriptors expose only the bounded owner-native download surface', () => {
  const { tools } = fixture();
  assert.deepEqual(tools.descriptors().map(({ name }) => name), [
    'toolbraid.download.list',
    'toolbraid.download.wait',
    'toolbraid.download.cancel',
    'toolbraid.download.show',
    'toolbraid.download.grant_upload',
  ]);
  assert.ok(tools.descriptors().every((descriptor) => descriptor._meta['toolbraid/ownerOnly'] === true));
});
