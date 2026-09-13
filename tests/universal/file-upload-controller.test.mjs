import assert from 'node:assert/strict';
import test from 'node:test';

import { createFileUploadController, FileUploadError } from '../../extension/file-upload-controller.js';

function fixture({ nodes, confirmedNodes, verify, setFilesError } = {}) {
  const calls = [];
  let documentReads = 0;
  const chromeApi = {
    debugger: {
      async attach(target, version) { calls.push(['attach', target, version]); },
      async sendCommand(target, method, params) {
        calls.push(['command', target, method, params]);
        if (method === 'DOM.getDocument') {
          documentReads += 1;
          return { root: { nodeName: '#document', children: documentReads > 1 && confirmedNodes ? confirmedNodes : (nodes ?? []) } };
        }
        if (method === 'DOM.setFileInputFiles' && setFilesError) throw setFilesError;
        return {};
      },
      async detach(target) { calls.push(['detach', target]); },
    },
  };
  const hooks = {
    async markTarget(input) { calls.push(['mark', input]); return { ok: true }; },
    async revalidateTarget(input) { calls.push(['revalidate', input]); return { ok: true }; },
    async verifyTarget(input) { calls.push(['verify', input]); return verify ?? { ok: true, file: { name: 'clip.mp4', size: 42, count: 1 } }; },
    async cleanupTarget(input) { calls.push(['cleanup', input]); },
  };
  const randomSource = { randomUUID: () => '11111111-2222-4333-8444-555555555555' };
  return { controller: createFileUploadController({ chromeApi, randomSource }), hooks, calls };
}

const request = {
  binding: { tabId: 7, sessionId: 'tab-7-abcdefgh', nonce: '1234567890123456', frameId: 0, origin: 'https://example.test', pageFingerprint: 'a'.repeat(64) },
  targetRef: 'r-file',
  resolvedLocalPath: 'D:\\private\\clip.mp4',
  expectedFile: { name: 'clip.mp4', size: 42, count: 1 },
};

test('sets one exact marked file input through a short CDP lifecycle without returning its path', async () => {
  const marker = 'tb-11111111-2222-4333-8444-555555555555';
  const { controller, hooks, calls } = fixture({
    nodes: [{ nodeName: 'INPUT', backendNodeId: 81, attributes: ['type', 'file', 'data-toolbraid-file-target', marker] }],
  });
  const result = await controller.upload({ ...request, ...hooks });
  assert.deepEqual(result, { ok: true, file: { name: 'clip.mp4', size: 42, count: 1 } });
  assert.equal(JSON.stringify(result).includes('D:\\private'), false);
  assert.deepEqual(calls.map((entry) => entry[0] === 'command' ? entry[2] : entry[0]), [
    'mark', 'attach', 'DOM.enable', 'Runtime.enable', 'DOM.getDocument', 'revalidate', 'DOM.getDocument', 'DOM.setFileInputFiles', 'verify', 'cleanup', 'detach',
  ]);
  const setCall = calls.find((entry) => entry[2] === 'DOM.setFileInputFiles');
  assert.equal(setCall[3].backendNodeId, 81);
});

test('fails closed on ambiguous markers and always cleans up and detaches', async () => {
  const markerAttrs = ['type', 'file', 'data-toolbraid-file-target', 'tb-11111111-2222-4333-8444-555555555555'];
  const { controller, hooks, calls } = fixture({ nodes: [
    { nodeName: 'INPUT', backendNodeId: 1, attributes: markerAttrs },
    { nodeName: 'INPUT', backendNodeId: 2, attributes: markerAttrs },
  ] });
  await assert.rejects(controller.upload({ ...request, ...hooks }), (error) => error instanceof FileUploadError && error.code === 'FILE_TARGET_AMBIGUOUS');
  assert.deepEqual(calls.slice(-2).map((entry) => entry[0]), ['cleanup', 'detach']);
});

test('rejects a marker swap when the debugger node identity changes after isolated revalidation', async () => {
  const marker = 'tb-11111111-2222-4333-8444-555555555555';
  const attrs = ['type', 'file', 'data-toolbraid-file-target', marker];
  const { controller, hooks, calls } = fixture({
    nodes: [{ nodeName: 'INPUT', backendNodeId: 81, attributes: attrs }],
    confirmedNodes: [{ nodeName: 'INPUT', backendNodeId: 82, attributes: attrs }],
  });
  await assert.rejects(controller.upload({ ...request, ...hooks }), (error) => error.code === 'FILE_TARGET_BINDING_MISMATCH');
  assert.equal(calls.some((entry) => entry[2] === 'DOM.setFileInputFiles'), false);
  assert.deepEqual(calls.slice(-2).map((entry) => entry[0]), ['cleanup', 'detach']);
});

test('redacts local paths from debugger failures and still detaches', async () => {
  const marker = 'tb-11111111-2222-4333-8444-555555555555';
  const { controller, hooks, calls } = fixture({
    nodes: [{ nodeName: 'INPUT', backendNodeId: 81, attributes: ['type', 'file', 'data-toolbraid-file-target', marker] }],
    setFilesError: Object.assign(new Error('failed D:\\private\\clip.mp4'), { code: 'CDP_FAILED' }),
  });
  await assert.rejects(controller.upload({ ...request, ...hooks }), (error) => {
    assert.equal(error.code, 'CDP_FAILED');
    assert.equal(error.message.includes('D:\\private'), false);
    return true;
  });
  assert.deepEqual(calls.slice(-2).map((entry) => entry[0]), ['cleanup', 'detach']);
});

test('rejects a mismatched basename/size/count postcondition', async () => {
  const marker = 'tb-11111111-2222-4333-8444-555555555555';
  const { controller, hooks, calls } = fixture({
    nodes: [{ nodeName: 'INPUT', backendNodeId: 81, attributes: ['type', 'file', 'data-toolbraid-file-target', marker] }],
    verify: { ok: true, file: { name: 'other.mp4', size: 42, count: 1 } },
  });
  await assert.rejects(controller.upload({ ...request, ...hooks }), (error) => error.code === 'FILE_UPLOAD_POSTCONDITION_FAILED');
  const setCalls = calls.filter((entry) => entry[0] === 'command' && entry[2] === 'DOM.setFileInputFiles');
  assert.deepEqual(setCalls.map((entry) => entry[3]), [
    { files: ['D:\\private\\clip.mp4'], backendNodeId: 81 },
    { files: [], backendNodeId: 81 },
  ]);
  assert.deepEqual(calls.slice(-2).map((entry) => entry[0]), ['cleanup', 'detach']);
});

test('rejects incomplete or cross-tab bindings before marking or attaching', async () => {
  for (const binding of [
    { ...request.binding, tabId: 8 },
    { ...request.binding, frameId: -1 },
    { ...request.binding, sessionId: '' },
    { ...request.binding, origin: '' },
    { ...request.binding, pageFingerprint: '' },
  ]) {
    const { controller, hooks, calls } = fixture();
    await assert.rejects(controller.upload({ ...request, binding, tabId: request.binding.tabId, ...hooks }), (error) => error.code === 'BINDING_INVALID');
    assert.deepEqual(calls, []);
  }
});

test('finds the exact marked file input inside a selected iframe document', async () => {
  const marker = 'tb-11111111-2222-4333-8444-555555555555';
  const fileInput = { nodeName: 'INPUT', backendNodeId: 92, attributes: ['type', 'file', 'data-toolbraid-file-target', marker] };
  const { controller, hooks, calls } = fixture({
    nodes: [{ nodeName: 'IFRAME', contentDocument: { nodeName: '#document', children: [fileInput] } }],
  });
  await controller.upload({ ...request, binding: { ...request.binding, frameId: 2 }, ...hooks });
  const setCall = calls.find((entry) => entry[2] === 'DOM.setFileInputFiles');
  assert.equal(setCall[3].backendNodeId, 92);
});

test('finds the exact file input inside a pierced open shadow root', async () => {
  const marker = 'tb-11111111-2222-4333-8444-555555555555';
  const fileInput = { nodeName: 'INPUT', backendNodeId: 91, attributes: ['type', 'file', 'data-toolbraid-file-target', marker] };
  const { controller, hooks, calls } = fixture({
    nodes: [{ nodeName: 'UPLOAD-HOST', shadowRoots: [{ nodeName: '#document-fragment', children: [fileInput] }] }],
  });
  await controller.upload({ ...request, ...hooks });
  const setCall = calls.find((entry) => entry[2] === 'DOM.setFileInputFiles');
  assert.equal(setCall[3].backendNodeId, 91);
});
