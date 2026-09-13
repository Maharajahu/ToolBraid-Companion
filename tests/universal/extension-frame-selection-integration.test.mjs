import assert from 'node:assert/strict';
import test from 'node:test';

import { MESSAGE_TYPES } from '../../extension/protocol.js';
import { createServiceWorkerController } from '../../extension/service-worker.js';

const EXTENSION_ID = 'toolbraid-frame-integration';
const TOP_URL = 'https://example.test/host';
const FRAME_URL = 'https://widget.example.test/editor';

function storage() {
  const values = {};
  return {
    get: async (key) => ({ [key]: values[key] }),
    set: async (value) => { Object.assign(values, value); },
    remove: async (key) => { delete values[key]; },
  };
}

function cryptoRef() {
  let sequence = 0;
  return {
    randomUUID: () => `frame-test-${String(++sequence).padStart(26, '0')}`,
    subtle: globalThis.crypto.subtle,
    getRandomValues(bytes) { bytes.fill((++sequence % 250) + 1); return bytes; },
  };
}

function sender(frameId, url, documentId) {
  return { id: EXTENSION_ID, tab: { id: 21, windowId: 5, active: true, url: TOP_URL }, frameId, documentId, url };
}

function snapshot(url, title, text) {
  return {
    metadata: { url, origin: new URL(url).origin, title },
    mainText: text,
    forms: [],
    links: [],
    accessibleControls: [],
    elementRefs: [],
  };
}

test('native frame selection exposes and calls the selected subframe tool end to end', async () => {
  const sent = [];
  const topSnapshot = snapshot(TOP_URL, 'Host page', 'Top document content.');
  const frameSnapshot = snapshot(FRAME_URL, 'Embedded editor', 'Subframe-only readable content.');
  const activeTab = { id: 21, windowId: 5, active: true, url: TOP_URL, title: 'Host page', status: 'complete' };
  const chromeApi = {
    runtime: { id: EXTENSION_ID },
    storage: { local: storage() },
    tabs: {
      query: async () => [activeTab],
      get: async (tabId) => ({ ...activeTab, id: tabId }),
    },
    scripting: { executeScript: async () => [] },
  };
  const sendToContentScript = async (tabId, message, options = {}) => {
    sent.push({ tabId, message, options });
    if (message.type === MESSAGE_TYPES.REGISTER_TOOLS) return { ok: true };
    if (message.type === MESSAGE_TYPES.PAGE_EXTRACT_SNAPSHOT) {
      return { ok: true, snapshot: options.frameId === 3 ? frameSnapshot : topSnapshot };
    }
    return { ok: true };
  };
  const controller = createServiceWorkerController({ publicRelease: false, chromeApi, sendToContentScript, cryptoRef: cryptoRef() });

  const topReady = await controller.handleRuntimeMessage(
    { type: MESSAGE_TYPES.PAGE_READY, pageInstanceId: 'top-page-instance-0001' },
    sender(0, TOP_URL, 'top-document-0001'),
  );
  const frameReady = await controller.handleRuntimeMessage(
    { type: MESSAGE_TYPES.PAGE_READY, pageInstanceId: 'frame-page-instance-001' },
    sender(3, FRAME_URL, 'frame-document-001'),
  );
  assert.equal(topReady.ok, true);
  assert.equal(frameReady.ok, true);

  const topIngest = await controller.handleRuntimeMessage({
    type: MESSAGE_TYPES.PAGE_SNAPSHOT,
    sessionId: topReady.channel.sessionId,
    nonce: topReady.channel.nonce,
    snapshot: topSnapshot,
  }, sender(0, TOP_URL, 'top-document-0001'));
  const frameIngest = await controller.handleRuntimeMessage({
    type: MESSAGE_TYPES.PAGE_SNAPSHOT,
    sessionId: frameReady.channel.sessionId,
    nonce: frameReady.channel.nonce,
    snapshot: frameSnapshot,
  }, sender(3, FRAME_URL, 'frame-document-001'));
  assert.equal(topIngest.ok, true);
  assert.equal(frameIngest.ok, true);
  assert.ok(sent.some((entry) => entry.message.type === MESSAGE_TYPES.REGISTER_TOOLS && entry.options.frameId === 3));

  let listed = await controller.mcpEndpoint.handle('tools.list', {});
  const frameList = listed.tools.find((tool) => tool.name === 'toolbraid.frame.list');
  assert.ok(frameList);
  const frames = await controller.mcpEndpoint.handle('tools.call', { name: frameList.name, arguments: {} });
  const subframe = frames.frames.find((entry) => entry.frameId === 3);
  assert.ok(subframe);
  await controller.mcpEndpoint.handle('tools.call', { name: 'toolbraid.frame.select', arguments: { handle: subframe.handle } });

  listed = await controller.mcpEndpoint.handle('tools.list', {});
  assert.equal(listed.context.page.frameId, 3);
  assert.equal(listed.context.page.origin, 'https://widget.example.test');
  const dynamicRead = listed.tools.find((tool) => tool._meta?.['toolbraid/originalName']?.startsWith('universal_read_'));
  assert.ok(dynamicRead, 'selected subframe page-read tool should be exposed');

  const result = await controller.mcpEndpoint.handle('tools.call', { name: dynamicRead.name, arguments: {} });
  assert.equal(result.ok, true);
  assert.equal(result.result.binding.frameId, 3);
  assert.equal(result.result.binding.sessionId, frameReady.channel.sessionId);
  assert.equal(result.result.data.mainText, 'Subframe-only readable content.');
});
