import assert from 'node:assert/strict';
import test from 'node:test';

import { createApprovalStore } from '../../extension/approval-store.js';
import { MESSAGE_TYPES, createEnvelope, parseEnvelope } from '../../extension/protocol.js';
import { MISSION_UI_MESSAGE_TYPES } from '../../extension/mission-runtime.js';
import { createServiceWorkerController } from '../../extension/service-worker.js';
import { UI_MESSAGE_TYPES } from '../../extension/universal-runtime.js';

const EXTENSION_ID = 'toolbraid-integration-test';
const PAGE = 'https://example.test/checkout';

test('injects an activated complete tab once when persistent owner host access exists', async () => {
  let releaseInjection;
  const gate = new Promise((resolve) => { releaseInjection = resolve; });
  const injections = [];
  const api = {
    runtime: { id: EXTENSION_ID },
    tabs: { query: async () => [], get: async () => ({ id: 41, url: 'https://accounts.google.com/o/oauth2/auth', status: 'complete' }) },
    permissions: { contains: async () => true },
    scripting: {
      executeScript: async (details) => {
        injections.push(details);
        if (injections.length === 1) await gate;
        return [];
      },
    },
  };
  const controller = createServiceWorkerController({ publicRelease: false, chromeApi: api });
  const first = controller.handleActivatedTab(41);
  const duplicate = controller.handleActivatedTab(41);
  releaseInjection();
  const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
  assert.equal(firstResult.ok, true);
  assert.equal(duplicateResult.ok, true);
  assert.equal(injections.length, 2);
  assert.deepEqual(injections.map((entry) => entry.target), [
    { tabId: 41, allFrames: true },
    { tabId: 41, allFrames: true },
  ]);
});

test('arms a granted loading tab and injects it when navigation completes', async () => {
  const injections = [];
  const tab = { id: 42, url: 'https://accounts.google.com/signin/oauth', status: 'loading' };
  const api = {
    runtime: { id: EXTENSION_ID },
    tabs: { query: async () => [], get: async () => ({ ...tab }) },
    permissions: { contains: async () => true },
    scripting: { executeScript: async (details) => { injections.push(details); return []; } },
  };
  const controller = createServiceWorkerController({ publicRelease: false, chromeApi: api });
  const armed = await controller.handleActivatedTab(42);
  assert.deepEqual(armed, { ok: true, tabId: 42, pending: true });
  assert.equal(injections.length, 0);
  tab.status = 'complete';
  controller.handleTabUpdated(42, { status: 'complete' }, tab);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(injections.length, 2);
  assert.deepEqual(injections.map((entry) => entry.target), [
    { tabId: 42, allFrames: true },
    { tabId: 42, allFrames: true },
  ]);
});

test('keeps activated tabs fail-closed without persistent owner host access', async () => {
  let injections = 0;
  const api = {
    runtime: { id: EXTENSION_ID },
    tabs: { query: async () => [], get: async () => ({ id: 43, url: 'https://example.test/', status: 'complete' }) },
    permissions: { contains: async () => false },
    scripting: { executeScript: async () => { injections += 1; return []; } },
  };
  const controller = createServiceWorkerController({ publicRelease: false, chromeApi: api });
  const result = await controller.handleActivatedTab(43);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'HOST_PERMISSION_REQUIRED');
  assert.equal(injections, 0);
  controller.handleTabUpdated(43, { status: 'complete' }, { id: 43, url: 'https://example.test/', status: 'complete' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(injections, 0);
});

test('attaches a native-resolved file through the isolated target hooks and returns no local path', async () => {
  const area = makeStorage();
  const snapshot = pageSnapshot();
  snapshot.pageFingerprint = 'e'.repeat(64);
  snapshot.fileInputs = [{ ref: 'upload-video', name: 'Upload video', accept: 'video/*', multiple: false }];
  snapshot.mediaInventory = [{ ref: 'preview-video', kind: 'video', src: 'https://cdn.example.test/preview.mp4', alt: '' }];
  let marker = null;
  const isolatedCalls = [];
  const debuggerCalls = [];
  const api = {
    runtime: { id: EXTENSION_ID },
    storage: { local: area },
    tabs: {
      query: async () => [{ id: 12, windowId: 4, active: true, url: PAGE, title: 'Checkout' }],
      get: async () => ({ id: 12, windowId: 4, active: true, url: PAGE, title: 'Checkout' }),
    },
    scripting: {
      async executeScript(details) {
        const [method, payload] = details.args ?? [];
        isolatedCalls.push(method);
        if (['markFileTarget', 'revalidateFileTarget', 'verifyFileTarget', 'cleanupFileTarget'].includes(method)) {
          assert.equal(payload.pageFingerprint, snapshot.pageFingerprint);
        }
        assert.equal(JSON.stringify(details.args).includes('D:\\private'), false);
        assert.equal(details.world, 'ISOLATED');
        assert.equal(details.target.frameIds[0], 0);
        if (method === 'markFileTarget') { marker = payload.marker; return [{ result: { ok: true } }]; }
        if (method === 'revalidateFileTarget') return [{ result: { ok: true } }];
        if (method === 'verifyFileTarget') return [{ result: { ok: true, count: 1, files: [{ name: 'clip.mp4', size: 42 }] } }];
        if (method === 'cleanupFileTarget') return [{ result: { ok: true, removed: true } }];
        return [];
      },
    },
    debugger: {
      async attach() { debuggerCalls.push('attach'); },
      async sendCommand(_target, method, params) {
        debuggerCalls.push(method);
        if (method === 'DOM.getDocument') return { root: { children: [{ nodeName: 'INPUT', backendNodeId: 91, attributes: ['type', 'file', 'data-toolbraid-file-target', marker] }] } };
        if (method === 'DOM.setFileInputFiles') assert.deepEqual(params.files, ['D:\\private\\clip.mp4']);
        return {};
      },
      async detach() { debuggerCalls.push('detach'); },
    },
  };
  const sendToContentScript = async (_tabId, message) => {
    if (message.type === MESSAGE_TYPES.REGISTER_TOOLS) return { ok: true };
    if (message.type === MESSAGE_TYPES.PAGE_EXTRACT_SNAPSHOT) return { ok: true, snapshot };
    return { ok: true };
  };
  const controller = createServiceWorkerController({ publicRelease: false, chromeApi: api, sendToContentScript, cryptoRef: fakeCrypto() });
  const ready = await controller.handleRuntimeMessage({ type: MESSAGE_TYPES.PAGE_READY, pageInstanceId: 'page-file-0123456789' }, pageSender());
  await controller.handleRuntimeMessage({
    type: MESSAGE_TYPES.PAGE_SNAPSHOT,
    sessionId: ready.channel.sessionId,
    nonce: ready.channel.nonce,
    snapshot,
  }, pageSender());
  const listed = await controller.mcpEndpoint.handle('tools.list', {});
  const attach = listed.tools.find((tool) => tool._meta?.['toolbraid/fileInput'] === true);
  assert.ok(attach);
  assert.notEqual(listed.context.page.pageFingerprint, snapshot.pageFingerprint);
  const result = await controller.mcpEndpoint.handle('tools.call', {
    name: attach.name,
    arguments: {
      grantId: 'ab'.repeat(32),
      resolvedLocalPath: 'D:\\private\\clip.mp4',
      expectedFile: { name: 'clip.mp4', size: 42, count: 1, mime: 'video/mp4' },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes('D:\\private'), false);
  assert.deepEqual(isolatedCalls, ['markFileTarget', 'revalidateFileTarget', 'verifyFileTarget', 'cleanupFileTarget']);
  assert.deepEqual(debuggerCalls, ['attach', 'DOM.enable', 'Runtime.enable', 'DOM.getDocument', 'DOM.getDocument', 'DOM.setFileInputFiles', 'detach']);
});

function makeStorage() {
  const values = {};
  return {
    values,
    get(key) { return Promise.resolve({ [key]: values[key] }); },
    set(value) { Object.assign(values, value); return Promise.resolve(); },
    remove(key) { delete values[key]; return Promise.resolve(); },
  };
}

function pageSnapshot() {
  return {
    metadata: { url: PAGE, origin: 'https://example.test', title: 'Checkout' },
    mainText: 'Review before publishing.',
    forms: [{
      ref: 'notice-form',
      name: 'Publish notice',
      action: 'https://example.test/api/publish',
      method: 'POST',
      fields: [{ ref: 'message', name: 'Message', type: 'text', required: true }],
    }],
    accessibleControls: [{ ref: 'message', role: 'textbox', name: 'Message', type: 'text', formRef: 'notice-form', required: true }],
    elementRefs: [
      { ref: 'notice-form', tagName: 'form', role: 'form', name: 'Publish notice' },
      { ref: 'message', tagName: 'input', role: 'textbox', name: 'Message', type: 'text' },
    ],
  };
}

function pageSender() {
  return {
    id: EXTENSION_ID,
    tab: { id: 12, url: PAGE },
    frameId: 0,
    documentId: 'document-0123456789abcdef',
    url: PAGE,
  };
}

function panelSender() {
  return { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/sidepanel.html` };
}

function fakeCrypto() {
  let sequence = 0;
  return {
    randomUUID: () => `approval-${String(++sequence).padStart(28, '0')}`,
    subtle: globalThis.crypto.subtle,
    getRandomValues(bytes) { bytes.fill(0x27); return bytes; },
  };
}

function bindingFromChannel(channel) {
  return {
    nonce: channel.nonce,
    sessionId: channel.sessionId,
    tabId: channel.tabId,
    frameId: channel.frameId,
  };
}

test('MCP tool discovery refreshes the live page before the content watcher sends an update', async () => {
  let snapshot = pageSnapshot();
  let reads = 0;
  const api = {
    runtime: { id: EXTENSION_ID }, storage: { local: makeStorage() },
    tabs: { query: async () => [{ id: 12, windowId: 4, active: true, url: PAGE, title: 'Checkout' }] },
  };
  const controller = createServiceWorkerController({ publicRelease: false, chromeApi: api, cryptoRef: fakeCrypto(),
    sendToContentScript: async (_tabId, message) => {
      if (message.type === MESSAGE_TYPES.PAGE_EXTRACT_SNAPSHOT) { reads += 1; return { ok: true, snapshot }; }
      return { ok: true };
    },
  });
  const ready = await controller.handleRuntimeMessage({ type: MESSAGE_TYPES.PAGE_READY, pageInstanceId: 'page-fresh-0123456789' }, pageSender());
  await controller.handleRuntimeMessage({ type: MESSAGE_TYPES.PAGE_SNAPSHOT,
    sessionId: ready.channel.sessionId, nonce: ready.channel.nonce, snapshot }, pageSender());
  const before = await controller.mcpEndpoint.handle('tools.list', {});
  const readsBefore = reads;
  snapshot = { ...snapshot, mainText: 'Changed without a watcher event.' };
  const after = await controller.mcpEndpoint.handle('tools.list', {});
  assert.ok(reads > readsBefore);
  assert.notEqual(after.context.page.pageFingerprint, before.context.page.pageFingerprint);
});

test('research owner tools capture an exact listed tab and return canonical citations end to end', async () => {
  const area = makeStorage();
  const snapshot = pageSnapshot();
  snapshot.metadata.canonicalUrl = 'https://example.test/article';
  snapshot.mainText = 'Bounded research evidence from the active article.';
  const tab = { id: 12, windowId: 4, active: true, status: 'complete', url: PAGE, title: 'Research article' };
  const api = {
    runtime: { id: EXTENSION_ID },
    storage: { local: area },
    tabs: { query: async () => [{ ...tab }], get: async () => ({ ...tab }) },
    scripting: { executeScript: async () => [] },
  };
  const sendToContentScript = async (_tabId, message) => {
    if (message.type === MESSAGE_TYPES.REGISTER_TOOLS) return { ok: true };
    if (message.type === MESSAGE_TYPES.PAGE_EXTRACT_SNAPSHOT) return { ok: true, snapshot };
    return { ok: true };
  };
  const controller = createServiceWorkerController({ publicRelease: false, chromeApi: api, sendToContentScript, cryptoRef: fakeCrypto() });
  const ready = await controller.handleRuntimeMessage({ type: MESSAGE_TYPES.PAGE_READY, pageInstanceId: 'page-research-012345' }, pageSender());
  const ingested = await controller.handleRuntimeMessage({
    type: MESSAGE_TYPES.PAGE_SNAPSHOT,
    sessionId: ready.channel.sessionId,
    nonce: ready.channel.nonce,
    snapshot,
  }, pageSender());
  assert.equal(ingested.ok, true);

  const listed = await controller.mcpEndpoint.handle('tools.list', {});
  for (const name of ['toolbraid.browser.tabs_list', 'toolbraid.research.workspace_create', 'toolbraid.research.attach_tab', 'toolbraid.research.capture_tab', 'toolbraid.research.citation_bundle']) {
    assert.ok(listed.tools.some((tool) => tool.name === name), name);
  }
  const tabs = await controller.mcpEndpoint.handle('tools.call', { name: 'toolbraid.browser.tabs_list', arguments: {} });
  const workspace = await controller.mcpEndpoint.handle('tools.call', { name: 'toolbraid.research.workspace_create', arguments: {} });
  await controller.mcpEndpoint.handle('tools.call', {
    name: 'toolbraid.research.attach_tab',
    arguments: { workspace: workspace.workspace, tabHandle: tabs.tabs[0].handle },
  });
  await controller.mcpEndpoint.handle('tools.call', {
    name: 'toolbraid.research.capture_tab',
    arguments: { workspace: workspace.workspace, tabHandle: tabs.tabs[0].handle },
  });
  const bundle = await controller.mcpEndpoint.handle('tools.call', {
    name: 'toolbraid.research.citation_bundle', arguments: { workspace: workspace.workspace },
  });
  assert.equal(bundle.evidenceCount, 1);
  assert.equal(bundle.citations[0].url, 'https://example.test/article');
  assert.match(bundle.citations[0].excerpt, /research evidence/);

  controller.handleTabUpdated(99, { status: 'loading', url: 'https://unrelated.test/next' }, { id: 99, windowId: 8, url: 'https://unrelated.test/next' });
  await controller.mcpEndpoint.handle('tools.list', {});
  const recaptured = await controller.mcpEndpoint.handle('tools.call', {
    name: 'toolbraid.research.capture_tab', arguments: { workspace: workspace.workspace, tabHandle: tabs.tabs[0].handle },
  });
  assert.equal(recaptured.deduplicated, true);
  const retained = await controller.mcpEndpoint.handle('tools.call', {
    name: 'toolbraid.research.citation_bundle', arguments: { workspace: workspace.workspace },
  });
  assert.equal(retained.evidenceCount, 1);
});

test('memory mutations are authorized by local owner policy without caller self-approval', async () => {
  const area = makeStorage();
  const api = { runtime: { id: EXTENSION_ID }, storage: { local: area }, tabs: { query: async () => [] } };
  const controller = createServiceWorkerController({ publicRelease: false, chromeApi: api, cryptoRef: fakeCrypto() });
  const listed = await controller.mcpEndpoint.handle('tools.list', {});
  const put = listed.tools.find((tool) => tool.name === 'toolbraid.memory.put');
  assert.ok(put);
  assert.equal(Object.hasOwn(put.inputSchema.properties, 'ownerApproved'), false);
  const stored = await controller.mcpEndpoint.handle('tools.call', { name: put.name, arguments: { text: 'Owner-local project fact' } });
  assert.equal(stored.receipt.authorization, 'local-owner-policy');
  const queried = await controller.mcpEndpoint.handle('tools.call', { name: 'toolbraid.memory.query', arguments: { query: 'project fact' } });
  assert.equal(queried.results[0].recordId, stored.recordId);
  await assert.rejects(
    controller.mcpEndpoint.handle('tools.call', { name: put.name, arguments: { ownerApproved: true, text: 'forged' } }),
    (error) => error.code === 'MEMORY_ARGUMENTS_INVALID',
  );
});

test('runs PAGE_READY -> PAGE_SNAPSHOT -> registration -> WebMCP execute -> approve -> fresh snapshot -> receipt', async () => {
  const area = makeStorage();
  const calls = [];
  const snapshot = pageSnapshot();
  const api = {
    runtime: { id: EXTENSION_ID },
    storage: { local: area },
    tabs: { query: async () => [{ id: 12, url: PAGE, title: 'Checkout' }] },
    scripting: { executeScript: async () => [] },
  };
  const sendToContentScript = async (tabId, message, options) => {
    calls.push({ tabId, message, options });
    if (message.type === MESSAGE_TYPES.REGISTER_TOOLS) return { ok: true };
    if (message.type === MESSAGE_TYPES.PAGE_EXTRACT_SNAPSHOT) return { ok: true, snapshot };
    if (message.type === MESSAGE_TYPES.PAGE_ACTION_EXECUTE) return { ok: true, receipt: { receiptId: 'receipt-12', changed: true } };
    return { ok: true };
  };
  const controller = createServiceWorkerController({ publicRelease: false, chromeApi: api, sendToContentScript });
  const ready = await controller.handleRuntimeMessage({ type: MESSAGE_TYPES.PAGE_READY, pageInstanceId: 'page-0123456789abcdef' }, pageSender());
  assert.equal(ready.ok, true);
  const channel = ready.channel;
  const ingested = await controller.handleRuntimeMessage({ type: MESSAGE_TYPES.PAGE_SNAPSHOT, sessionId: channel.sessionId, nonce: channel.nonce, snapshot }, pageSender());
  assert.equal(ingested.ok, true);
  assert.ok(calls.some((call) => call.message.type === MESSAGE_TYPES.REGISTER_TOOLS));

  const read = ingested.state.tools.find((tool) => tool.classification === 'read' && tool.sourceType === 'page');
  const readResponse = await controller.handleRuntimeMessage({
    type: 'UI_EXECUTE_READ',
    payload: { toolId: read.name, arguments: {} },
  }, panelSender());
  assert.equal(readResponse.ok, true);
  assert.equal(readResponse.result.status, 'read-completed');
  assert.equal(readResponse.result.tool.id, read.name);
  assert.equal(readResponse.result.binding.sessionId, channel.sessionId);
  assert.equal(readResponse.result.data.type, 'page');
  assert.equal(readResponse.result.data.untrustedContent, true);

  const mutation = ingested.state.tools.find((tool) => tool.classification === 'mutate');
  assert.ok(mutation);
  const property = Object.keys(mutation.inputSchema.properties)[0];
  const pageExecute = await controller.handleRuntimeMessage({
    type: MESSAGE_TYPES.PAGE_EVENT,
    envelope: createEnvelope({
      ...channel,
      type: MESSAGE_TYPES.EXECUTE_REQUEST,
      requestId: 'req-mutation-012345',
      payload: { toolId: mutation.name, name: mutation.name, input: { [property]: 'Approved notice' } },
    }),
  }, pageSender());
  const pageResult = parseEnvelope(pageExecute.envelope, bindingFromChannel(channel));
  assert.equal(pageResult.ok, true);
  const prepared = pageResult.value.payload.result.preparedAction;
  assert.equal(pageResult.value.payload.result.status, 'approval-required');

  const localApprovals = createApprovalStore({ storageArea: area, cryptoRef: fakeCrypto() });
  const boundPrepared = {
    ...prepared,
    tabId: channel.tabId,
    frameId: channel.frameId,
    sessionId: channel.sessionId,
    origin: new URL(PAGE).origin,
  };
  const localApproval = await localApprovals.createApproval({ event: { isTrusted: true }, action: boundPrepared });
  const approved = await controller.handleRuntimeMessage({
    type: 'UI_APPROVE_ACTION',
    payload: { approval: localApproval },
  }, panelSender());
  assert.equal(approved.ok, true);
  assert.equal(approved.actionId, boundPrepared.actionId);

  const executed = await controller.handleRuntimeMessage({
    type: 'UI_EXECUTE_ACTION',
    payload: { approval: localApproval },
  }, panelSender());
  assert.equal(executed.ok, true);
  assert.equal(executed.result.status, 'dispatched');
  assert.equal(executed.result.outcome, 'postcondition-unverified');
  assert.equal(executed.result.receipt.receiptId, 'receipt-12');
  const refreshIndex = calls.findIndex((call) => call.message.type === MESSAGE_TYPES.PAGE_EXTRACT_SNAPSHOT);
  const actionIndex = calls.findIndex((call) => call.message.type === MESSAGE_TYPES.PAGE_ACTION_EXECUTE);
  assert.ok(refreshIndex >= 0);
  assert.ok(actionIndex > refreshIndex);
  assert.equal(calls[actionIndex].message.approved, true);
});

test('ToolBraid Abliterated owner route dispatches without a repeated side-panel approval', async () => {
  const area = makeStorage();
  const snapshot = pageSnapshot();
  const api = {
    runtime: { id: EXTENSION_ID },
    storage: { local: area },
    tabs: { query: async () => [{ id: 12, url: PAGE, title: 'Checkout' }] },
    scripting: { executeScript: async () => [] },
  };
  const calls = [];
  const sendToContentScript = async (tabId, message, options) => {
    calls.push({ tabId, message, options });
    if (message.type === MESSAGE_TYPES.REGISTER_TOOLS) return { ok: true };
    if (message.type === MESSAGE_TYPES.PAGE_EXTRACT_SNAPSHOT) return { ok: true, snapshot };
    if (message.type === MESSAGE_TYPES.PAGE_ACTION_EXECUTE) return { ok: true, receipt: { receiptId: 'owner-receipt', changed: true } };
    return { ok: true };
  };
  const controller = createServiceWorkerController({ publicRelease: false, chromeApi: api, sendToContentScript });
  const ready = await controller.handleRuntimeMessage(
    { type: MESSAGE_TYPES.PAGE_READY, pageInstanceId: 'page-owner-0123456789' },
    pageSender(),
  );
  const ingested = await controller.handleRuntimeMessage({
    type: MESSAGE_TYPES.PAGE_SNAPSHOT,
    sessionId: ready.channel.sessionId,
    nonce: ready.channel.nonce,
    snapshot,
  }, pageSender());
  const mutation = ingested.state.tools.find((tool) => tool.classification === 'mutate');
  const property = Object.keys(mutation.inputSchema.properties)[0];

  const response = await controller.handleRuntimeMessage({
    type: UI_MESSAGE_TYPES.UI_EXECUTE_OWNER_ACTION,
    payload: {
      sessionId: ready.channel.sessionId,
      toolName: mutation.name,
      arguments: { [property]: 'Owner dispatch' },
    },
  }, panelSender());

  assert.equal(response.ok, true);
  assert.equal(response.result.status, 'dispatched');
  assert.equal(response.result.receipt.receiptId, 'owner-receipt');
  assert.equal(calls.filter((call) => call.message.type === MESSAGE_TYPES.PAGE_ACTION_EXECUTE).length, 1);
});

test('routes a live mission into a sidepanel-created human handoff without worker browser writes', async () => {
  const local = makeStorage();
  const session = makeStorage();
  const calls = { create: 0, update: 0, inject: 0, message: 0 };
  const snapshot = pageSnapshot();
  const tabs = new Map([
    [12, { id: 12, windowId: 4, url: PAGE, title: 'Checkout' }],
    [101, { id: 101, windowId: 4, url: 'https://example.test/', title: 'Human handoff' }],
    [102, { id: 102, windowId: 4, url: 'https://example.test/', title: 'Human handoff without checkbox' }],
  ]);
  const api = {
    runtime: { id: EXTENSION_ID },
    storage: { local, session },
    tabs: {
      query: async () => [tabs.get(12)],
      get: async (tabId) => structuredClone(tabs.get(tabId)),
      create: async () => { calls.create += 1; throw new Error('worker must not create a handoff tab'); },
      update: async () => { calls.update += 1; throw new Error('worker must not navigate a handoff tab'); },
      sendMessage: async () => { calls.message += 1; throw new Error('worker must not message a handoff tab'); },
    },
    scripting: {
      executeScript: async (details) => {
        calls.inject += 1;
        if (Array.isArray(details?.target?.frameIds)
          && details.target.frameIds.length === 1
          && details.target.frameIds[0] === 0
          && typeof details.func === 'function') {
          if (details.target.tabId === 101) return [{ result: { ok: true, clicked: true } }];
          if (details.target.tabId === 102) {
            return [{ result: {
              ok: false,
              error: {
                code: 'CAPTCHA_CHECKBOX_TARGET_INVALID',
                message: 'Exactly one visible top-frame CAPTCHA checkbox is required; no click was dispatched.',
              },
            } }];
          }
        }
        throw new Error('worker injected outside the exact top-frame handoff surface');
      },
    },
  };
  const sent = [];
  const sendToContentScript = async (tabId, message, options) => {
    sent.push({ tabId, message, options });
    if (message.type === MESSAGE_TYPES.REGISTER_TOOLS) return { ok: true };
    return { ok: true, snapshot };
  };
  const controller = createServiceWorkerController({ publicRelease: false, chromeApi: api, sendToContentScript });
  const ready = await controller.handleRuntimeMessage(
    { type: MESSAGE_TYPES.PAGE_READY, pageInstanceId: 'page-0123456789abcdef' },
    pageSender(),
  );
  assert.equal(ready.ok, true);
  const ingested = await controller.handleRuntimeMessage({
    type: MESSAGE_TYPES.PAGE_SNAPSHOT,
    sessionId: ready.channel.sessionId,
    nonce: ready.channel.nonce,
    snapshot,
  }, pageSender());
  assert.equal(ingested.ok, true);

  const created = await controller.handleRuntimeMessage({
    type: 'UI_MISSION_CREATE',
    payload: { missionId: 'mission-human', objective: 'Authenticate, then resume the exact mission.' },
  }, panelSender());
  assert.equal(created.ok, true);
  const attached = await controller.handleRuntimeMessage({
    type: 'UI_MISSION_ATTACH',
    payload: { missionId: 'mission-human', memberId: 'member-source', tabId: 12, frameId: 0 },
  }, panelSender());
  assert.equal(attached.ok, true);
  const missionRuntime = await controller.ensureMissionRuntime();
  const liveBinding = missionRuntime.getBinding('mission-human', 'member-source');
  assert.equal(missionRuntime.validateBinding(liveBinding), true);

  const requested = await controller.handleRuntimeMessage({
    type: 'UI_HANDOFF_REQUEST',
    payload: {
      handoffId: 'handoff-human',
      type: 'login',
      missionId: 'mission-human',
      memberId: 'member-source',
      targetFingerprint: 'target-login-exact',
      purpose: 'Sign in on the exact approved origin.',
      credentials: { password: 'must-never-cross' },
    },
  }, panelSender());
  assert.equal(requested.ok, true, JSON.stringify(requested));
  assert.equal(requested.result.state, 'awaiting-ui-gesture');

  const opened = await controller.handleRuntimeMessage({
    type: 'UI_HANDOFF_OPEN_SURFACE',
    payload: {
      handoffId: 'handoff-human',
      surfaceTabId: 101,
      binding: { sessionId: 'forged', password: 'must-never-cross' },
    },
  }, panelSender());
  assert.equal(opened.ok, true);
  assert.equal(opened.result.state, 'human-active');
  assert.deepEqual(calls, { create: 0, update: 0, inject: 0, message: 0 });

  const wrongType = await controller.handleRuntimeMessage({
    type: 'UI_HANDOFF_CAPTCHA_ATTEMPT',
    payload: { handoffId: 'handoff-human', surfaceTabId: 999 },
  }, panelSender());
  assert.equal(wrongType.ok, false);
  assert.equal(wrongType.error.code, 'CAPTCHA_TYPE_REQUIRED');

  const completed = await controller.handleRuntimeMessage({
    type: 'UI_HANDOFF_COMPLETE',
    payload: { handoffId: 'handoff-human', proof: { password: 'must-never-cross' } },
  }, panelSender());
  assert.equal(completed.ok, true);
  assert.equal(completed.result.state, 'completed');
  assert.equal(JSON.stringify(session.values).includes('must-never-cross'), false);
  assert.deepEqual(calls, { create: 0, update: 0, inject: 0, message: 0 });

  const captchaRequested = await controller.handleRuntimeMessage({
    type: 'UI_HANDOFF_REQUEST',
    payload: {
      handoffId: 'handoff-captcha',
      type: 'captcha',
      missionId: 'mission-human',
      memberId: 'member-source',
      targetFingerprint: 'target-captcha-exact',
      purpose: 'Attempt the visible CAPTCHA checkbox once.',
    },
  }, panelSender());
  assert.equal(captchaRequested.ok, true);

  const wrongState = await controller.handleRuntimeMessage({
    type: 'UI_HANDOFF_CAPTCHA_ATTEMPT',
    payload: { handoffId: 'handoff-captcha' },
  }, panelSender());
  assert.equal(wrongState.ok, false);
  assert.equal(wrongState.error.code, 'HANDOFF_STATE_INVALID');

  const captchaOpened = await controller.handleRuntimeMessage({
    type: 'UI_HANDOFF_OPEN_SURFACE',
    payload: { handoffId: 'handoff-captcha', surfaceTabId: 101 },
  }, panelSender());
  assert.equal(captchaOpened.ok, true);
  assert.equal(captchaOpened.result.state, 'human-active');

  const attempted = await controller.handleRuntimeMessage({
    type: 'UI_HANDOFF_CAPTCHA_ATTEMPT',
    payload: { handoffId: 'handoff-captcha', surfaceTabId: 999, intent: 'forged' },
  }, panelSender());
  assert.equal(attempted.ok, true);
  assert.equal(attempted.result.state, 'human-active');
  assert.equal(attempted.result.captchaCheckboxAttempts, 1);
  assert.equal(calls.inject, 1);

  const repeated = await controller.handleRuntimeMessage({
    type: 'UI_HANDOFF_CAPTCHA_ATTEMPT',
    payload: { handoffId: 'handoff-captcha' },
  }, panelSender());
  assert.equal(repeated.ok, false);
  assert.equal(repeated.error.code, 'CAPTCHA_ATTEMPT_LIMIT');

  const noTargetRequested = await controller.handleRuntimeMessage({
    type: 'UI_HANDOFF_REQUEST',
    payload: {
      handoffId: 'handoff-captcha-no-target',
      type: 'captcha',
      missionId: 'mission-human',
      memberId: 'member-source',
      targetFingerprint: 'target-captcha-no-target',
      purpose: 'Leave control with the human when no unique checkbox is visible.',
    },
  }, panelSender());
  assert.equal(noTargetRequested.ok, true);
  const noTargetOpened = await controller.handleRuntimeMessage({
    type: 'UI_HANDOFF_OPEN_SURFACE',
    payload: { handoffId: 'handoff-captcha-no-target', surfaceTabId: 102 },
  }, panelSender());
  assert.equal(noTargetOpened.ok, true);
  const noTarget = await controller.handleRuntimeMessage({
    type: 'UI_HANDOFF_CAPTCHA_ATTEMPT',
    payload: { handoffId: 'handoff-captcha-no-target' },
  }, panelSender());
  assert.equal(noTarget.ok, false);
  assert.equal(noTarget.error.code, 'CAPTCHA_CHECKBOX_TARGET_INVALID');
  const handoffState = await controller.handleRuntimeMessage({ type: 'UI_HANDOFF_GET_STATE' }, panelSender());
  const noTargetState = handoffState.state.handoffs.find((entry) => entry.handoffId === 'handoff-captcha-no-target');
  assert.equal(noTargetState.state, 'human-active');
  assert.equal(noTargetState.captchaCheckboxAttempts, 0);

  const driftRequested = await controller.handleRuntimeMessage({
    type: 'UI_HANDOFF_REQUEST',
    payload: {
      handoffId: 'handoff-captcha-drift',
      type: 'captcha',
      missionId: 'mission-human',
      memberId: 'member-source',
      targetFingerprint: 'target-captcha-drift',
      purpose: 'Reject a checkbox attempt after surface drift.',
    },
  }, panelSender());
  assert.equal(driftRequested.ok, true);
  const driftOpened = await controller.handleRuntimeMessage({
    type: 'UI_HANDOFF_OPEN_SURFACE',
    payload: { handoffId: 'handoff-captcha-drift', surfaceTabId: 101 },
  }, panelSender());
  assert.equal(driftOpened.ok, true);
  tabs.set(101, { ...tabs.get(101), url: 'https://attacker.test/' });
  const wrongSurface = await controller.handleRuntimeMessage({
    type: 'UI_HANDOFF_CAPTCHA_ATTEMPT',
    payload: { handoffId: 'handoff-captcha-drift' },
  }, panelSender());
  assert.equal(wrongSurface.ok, false);
  assert.equal(wrongSurface.error.code, 'HANDOFF_SURFACE_DRIFT');
  assert.deepEqual(calls, { create: 0, update: 0, inject: 2, message: 0 });
});

test('binds prepared actions to the exact mission owner and clears them on execute, deny, and stage', async () => {
  const area = makeStorage();
  const snapshot = pageSnapshot();
  snapshot.accessibleControls.push({ ref: 'preview-control', role: 'button', name: 'Preview draft' });
  snapshot.elementRefs.push({ ref: 'preview-control', tagName: 'button', role: 'button', name: 'Preview draft' });
  const api = {
    runtime: { id: EXTENSION_ID },
    storage: { local: area },
    tabs: { query: async () => [{ id: 12, url: PAGE, title: 'Checkout' }] },
    scripting: { executeScript: async () => [] },
  };
  const calls = [];
  const sendToContentScript = async (tabId, message, options) => {
    calls.push({ tabId, message, options });
    if (message.type === MESSAGE_TYPES.REGISTER_TOOLS) return { ok: true };
    if (message.type === MESSAGE_TYPES.PAGE_EXTRACT_SNAPSHOT) return { ok: true, snapshot };
    if (message.type === MESSAGE_TYPES.PAGE_ACTION_EXECUTE) return { ok: true, receipt: { receiptId: `receipt-${calls.length}`, changed: true } };
    return { ok: true };
  };
  const controller = createServiceWorkerController({ publicRelease: false, chromeApi: api, sendToContentScript });
  const ready = await controller.handleRuntimeMessage({ type: MESSAGE_TYPES.PAGE_READY, pageInstanceId: 'page-0123456789abcdef' }, pageSender());
  const ingested = await controller.handleRuntimeMessage({
    type: MESSAGE_TYPES.PAGE_SNAPSHOT,
    sessionId: ready.channel.sessionId,
    nonce: ready.channel.nonce,
    snapshot,
  }, pageSender());
  assert.equal(ingested.ok, true);
  const created = await controller.handleRuntimeMessage({
    type: MISSION_UI_MESSAGE_TYPES.CREATE,
    payload: { missionId: 'mission-actions', objective: 'Review the exact page action.' },
  }, panelSender());
  assert.equal(created.ok, true);
  const attached = await controller.handleRuntimeMessage({
    type: MISSION_UI_MESSAGE_TYPES.ATTACH,
    payload: { missionId: 'mission-actions', memberId: 'member-actions', tabId: 12, frameId: 0 },
  }, panelSender());
  assert.equal(attached.ok, true);

  const mutation = ingested.state.tools.find((tool) => tool.classification === 'mutate');
  assert.ok(mutation);
  const property = Object.keys(mutation.inputSchema.properties)[0];
  const firstPrepared = await controller.handleRuntimeMessage({
    type: UI_MESSAGE_TYPES.UI_PREPARE_ACTION,
    payload: { actionId: mutation.name, arguments: { [property]: 'Execute through mission' } },
  }, panelSender());
  assert.equal(firstPrepared.ok, true);
  assert.equal(firstPrepared.result.status, 'approval-required');
  assert.equal(firstPrepared.missionBinding.status, 'bound');
  assert.equal(firstPrepared.missionBinding.missionId, 'mission-actions');

  let state = await controller.handleRuntimeMessage({ type: UI_MESSAGE_TYPES.UI_GET_STATE }, panelSender());
  assert.equal(state.ok, true);
  assert.equal(state.state.sessionId, ready.channel.sessionId);
  assert.deepEqual(state.state.missions[0].pendingActions.map((action) => action.actionId), [firstPrepared.preparedAction.actionId]);
  const bridgeStatus = await controller.mcpEndpoint.handle('bridge.status', {});
  assert.equal(bridgeStatus.missionCount, 1);
  assert.equal(bridgeStatus.pendingActionCount, 1);

  const localApprovals = createApprovalStore({ storageArea: area, cryptoRef: fakeCrypto() });
  const localApproval = await localApprovals.createApproval({ event: { isTrusted: true }, action: firstPrepared.preparedAction });
  const approved = await controller.handleRuntimeMessage({
    type: UI_MESSAGE_TYPES.UI_APPROVE_ACTION,
    payload: { decision: 'approve', approval: localApproval },
  }, panelSender());
  assert.equal(approved.ok, true);
  const executed = await controller.handleRuntimeMessage({
    type: UI_MESSAGE_TYPES.UI_EXECUTE_ACTION,
    payload: { approval: localApproval },
  }, panelSender());
  assert.equal(executed.ok, true);
  assert.equal(executed.missionBinding.status, 'resolved');
  state = await controller.handleRuntimeMessage({ type: UI_MESSAGE_TYPES.UI_GET_STATE }, panelSender());
  assert.deepEqual(state.state.missions[0].pendingActions, []);

  const secondPrepared = await controller.handleRuntimeMessage({
    type: UI_MESSAGE_TYPES.UI_PREPARE_ACTION,
    payload: { actionId: mutation.name, arguments: { [property]: 'Deny through mission' } },
  }, panelSender());
  assert.equal(secondPrepared.missionBinding.status, 'bound');
  const denied = await controller.handleRuntimeMessage({
    type: UI_MESSAGE_TYPES.UI_APPROVE_ACTION,
    payload: { decision: 'deny', action: secondPrepared.preparedAction },
  }, panelSender());
  assert.equal(denied.ok, true);
  assert.equal(denied.missionBinding.status, 'resolved');
  state = await controller.handleRuntimeMessage({ type: UI_MESSAGE_TYPES.UI_GET_STATE }, panelSender());
  assert.deepEqual(state.state.missions[0].pendingActions, []);

  // Generic page interactions are intentionally conservative mutations. A
  // verified adapter may expose a reversible stage descriptor; the
  // coordinator's resolution path is covered independently.
  state = await controller.handleRuntimeMessage({ type: UI_MESSAGE_TYPES.UI_GET_STATE }, panelSender());
  assert.deepEqual(state.state.missions[0].pendingActions, []);
});
