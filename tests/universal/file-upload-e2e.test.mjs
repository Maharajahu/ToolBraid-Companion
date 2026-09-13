import assert from 'node:assert/strict';
import test from 'node:test';

import { FileGrantStore, createFileGrantMethods } from '../../bridge/file-grants.mjs';
import { createNativeFileUploadBroker } from '../../bridge/native-host.mjs';
import { createFileUploadController } from '../../extension/file-upload-controller.js';
import { createExtensionMcpEndpoint } from '../../extension/native-mcp-bridge.js';

const LOCAL_PATH = 'D:\\owner-private\\media\\clip.mp4';
const GRANT_ID = 'ab'.repeat(32);
const MARKER = 'tb-11111111-2222-4333-8444-555555555555';
const OWNER_ID = 'owner-e2e-0123456789abcdef';

function fileDetails() {
  return { isFile: () => true, size: 42, dev: 1, ino: 2, mtimeMs: 3 };
}

function pageState(fileInput = { ref: 'file-1', name: 'Upload video', accept: 'video/*', multiple: false }) {
  return {
    tab: { id: 42, windowId: 8, url: 'https://studio.test/upload', origin: 'https://studio.test', title: 'Studio' },
    sessionId: 'session-0123456789',
    snapshot: { pageFingerprint: 'a'.repeat(64), extractorPageFingerprint: 'b'.repeat(64) },
    tools: [], pendingActions: [], receipts: [], fileInputs: [fileInput],
  };
}

function harness({ setFilesError = null } = {}) {
  let state = pageState();
  let idByte = 0xab;
  const publicOutput = [];
  const internalCalls = [];
  const store = new FileGrantStore({
    selectFile: async () => LOCAL_PATH,
    realpath: async () => LOCAL_PATH,
    stat: async () => fileDetails(),
    randomBytes: () => Buffer.alloc(32, idByte++),
  });
  const grants = createFileGrantMethods(store);
  const broker = createNativeFileUploadBroker(grants);
  const client = { ownerId: OWNER_ID };
  const chromeApi = {
    debugger: {
      async attach(target, version) { internalCalls.push(['attach', target, version]); },
      async sendCommand(target, method, params) {
        internalCalls.push(['command', target, method, params]);
        if (method === 'DOM.getDocument') {
          return { root: { nodeName: '#document', children: [
            { nodeName: 'INPUT', backendNodeId: 81, attributes: ['type', 'file', 'data-toolbraid-file-target', MARKER] },
          ] } };
        }
        if (method === 'DOM.setFileInputFiles' && setFilesError) throw setFilesError;
        return {};
      },
      async detach(target) { internalCalls.push(['detach', target]); },
    },
  };
  const controller = createFileUploadController({
    chromeApi,
    randomSource: { randomUUID: () => '11111111-2222-4333-8444-555555555555' },
  });
  const endpoint = createExtensionMcpEndpoint({
    getState: async () => ({ ok: true, state: structuredClone(state) }),
    executeRead: async () => ({ ok: true }),
    prepareAction: async () => ({ ok: true }),
    executeOwnerAction: async () => ({ ok: true }),
    attachGrantedFile: async (payload) => {
      const result = await controller.upload({
        binding: payload,
        targetRef: payload.fileInput.ref,
        resolvedLocalPath: payload.resolvedLocalPath,
        expectedFile: payload.expectedFile,
        markTarget: async (request) => { internalCalls.push(['mark', request]); return { ok: true }; },
        revalidateTarget: async (request) => { internalCalls.push(['revalidate', request]); return { ok: true }; },
        verifyTarget: async (request) => {
          internalCalls.push(['verify', request]);
          return { ok: true, file: { name: 'clip.mp4', size: 42, count: 1 } };
        },
        cleanupTarget: async (request) => { internalCalls.push(['cleanup', request]); },
      });
      publicOutput.push({ event: 'file-attached', ok: result.ok, file: result.file });
      return result;
    },
  });
  return { broker, client, endpoint, grants, internalCalls, publicOutput, setState: (next) => { state = next; } };
}

test('opaque grant expands only inside native broker and completes exact pathless MCP upload', async () => {
  const h = harness();
  const grant = await h.grants.create({}, OWNER_ID);
  const listed = await h.endpoint.listTools();
  h.broker.rememberTools(h.client, listed);
  const descriptor = listed.tools.find((tool) => tool._meta?.['toolbraid/fileInput'] === true);
  assert.deepEqual(Object.keys(descriptor.inputSchema.properties), ['grantId']);

  const externalCall = { name: descriptor.name, arguments: { grantId: grant.grantId } };
  const expanded = await h.broker.prepare(h.client, 'tools.call', externalCall);
  assert.equal(expanded.arguments.resolvedLocalPath, LOCAL_PATH);
  const result = await h.endpoint.handle('tools.call', expanded);

  assert.deepEqual(result, { ok: true, result: { status: 'attached', ref: 'file-1', name: 'Upload video' } });
  const setFiles = h.internalCalls.find((entry) => entry[2] === 'DOM.setFileInputFiles');
  assert.deepEqual(setFiles[3], { files: [LOCAL_PATH], backendNodeId: 81 });
  assert.deepEqual(h.internalCalls.map((entry) => entry[0] === 'command' ? entry[2] : entry[0]), [
    'mark', 'attach', 'DOM.enable', 'Runtime.enable', 'DOM.getDocument', 'revalidate', 'DOM.getDocument', 'DOM.setFileInputFiles', 'verify', 'cleanup', 'detach',
  ]);

  const externallyVisible = { grant, listed, externalCall, result, audit: h.publicOutput };
  assert.equal(JSON.stringify(externallyVisible).includes(LOCAL_PATH), false);
  await assert.rejects(
    h.broker.prepare(h.client, 'tools.call', externalCall),
    (error) => error.code === 'FILE_GRANT_NOT_FOUND' && !error.message.includes(LOCAL_PATH),
  );
});

test('descriptor drift consumes the grant but prevents marking, attaching, and CDP', async () => {
  const h = harness();
  const grant = await h.grants.create({}, OWNER_ID);
  const listed = await h.endpoint.listTools();
  h.broker.rememberTools(h.client, listed);
  const descriptor = listed.tools.find((tool) => tool._meta?.['toolbraid/fileInput'] === true);
  const expanded = await h.broker.prepare(h.client, 'tools.call', { name: descriptor.name, arguments: { grantId: grant.grantId } });
  h.setState(pageState({ ref: 'file-1', name: 'Changed upload', accept: 'video/*', multiple: false }));

  await assert.rejects(
    h.endpoint.handle('tools.call', expanded),
    (error) => error.code === 'MCP_FILE_INPUT_DRIFT' && !error.message.includes(LOCAL_PATH),
  );
  assert.deepEqual(h.internalCalls, []);
  await assert.rejects(h.grants.resolveOnce(grant.grantId, OWNER_ID), (error) => error.code === 'FILE_GRANT_NOT_FOUND');
});

test('internal CDP failures remain pathless externally and always clean marker and debugger state', async () => {
  const h = harness({ setFilesError: new Error(`CDP rejected ${LOCAL_PATH}`) });
  const grant = await h.grants.create({}, OWNER_ID);
  const listed = await h.endpoint.listTools();
  h.broker.rememberTools(h.client, listed);
  const descriptor = listed.tools.find((tool) => tool._meta?.['toolbraid/fileInput'] === true);
  const expanded = await h.broker.prepare(h.client, 'tools.call', { name: descriptor.name, arguments: { grantId: grant.grantId } });

  await assert.rejects(h.endpoint.handle('tools.call', expanded), (error) => {
    assert.equal(error.code, 'FILE_UPLOAD_FAILED');
    assert.equal(error.message.includes(LOCAL_PATH), false);
    return true;
  });
  assert.deepEqual(h.internalCalls.slice(-2).map((entry) => entry[0]), ['cleanup', 'detach']);
  await assert.rejects(h.grants.resolveOnce(grant.grantId, OWNER_ID), (error) => error.code === 'FILE_GRANT_NOT_FOUND');
});
