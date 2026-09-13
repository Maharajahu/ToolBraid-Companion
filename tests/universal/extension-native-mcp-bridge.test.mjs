import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NATIVE_MCP_PROTOCOL,
  NATIVE_MCP_VERSION,
  createExtensionMcpEndpoint,
  installNativeMcpBridge,
} from '../../extension/native-mcp-bridge.js';

function pageState(overrides = {}) {
  return {
    tab: { id: 42, windowId: 8, url: 'https://example.test/post/7', origin: 'https://example.test', title: 'Post 7' },
    sessionId: 'session-0123456789',
    snapshot: { pageFingerprint: 'fingerprint-0123456789', extractorPageFingerprint: 'e'.repeat(64) },
    tools: [
      {
        name: 'read_post',
        title: 'Read post',
        description: 'Read the current post.',
        classification: 'read',
        requiresApproval: false,
        sourceType: 'verified-adapter',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        effect: { classification: 'read', externalStateChange: false },
      },
      {
        name: 'like_post',
        title: 'Like post',
        description: 'Prepare a like for the current post.',
        classification: 'mutate',
        requiresApproval: true,
        sourceType: 'verified-adapter',
        inputSchema: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'], additionalProperties: false },
        effect: { classification: 'mutation', externalStateChange: true },
      },
    ],
    pendingActions: [],
    receipts: [],
    ...overrides,
  };
}

test('chat page tools remain pinned across active-tab switches but reject a mismatched caller target', async () => {
  const target = { targetTabId: 42, targetWindowId: 8, targetFrameId: 0 };
  const calls = [];
  const endpoint = createExtensionMcpEndpoint({
    getState: async (scope) => ({ ok: true, state: Number.isInteger(scope.targetTabId) ? pageState() : pageState({ tab: { id: 99, windowId: 8, origin: 'https://other.test' } }) }),
    executeRead: async (payload) => { calls.push(payload); return { ok: true }; }, prepareAction: async () => ({ ok: true }), executeOwnerAction: async () => ({ ok: true }),
  });
  const { tools } = await endpoint.handle('tools.list', { target });
  const tool = tools.find((entry) => entry.annotations.readOnlyHint);
  await endpoint.handle('tools.call', { name: tool.name, arguments: {}, target });
  assert.equal(calls[0].targetTabId, 42);
  await assert.rejects(endpoint.handle('tools.call', { name: tool.name, arguments: {}, target: { ...target, targetTabId: 99 } }), { code: 'MCP_PAGE_BINDING_DRIFT' });
});

test('lists exact-bound MCP proxies and routes mutations through local owner policy', async () => {
  let state = pageState();
  const calls = [];
  const endpoint = createExtensionMcpEndpoint({
    getState: async () => ({ ok: true, state: structuredClone(state) }),
    executeRead: async (payload) => {
      calls.push({ kind: 'read', payload });
      return { ok: true, result: { status: 'read-completed', data: { text: 'hello' } } };
    },
    prepareAction: async (payload) => {
      calls.push({ kind: 'prepare', payload });
      return { ok: true, result: { status: 'approval-required' }, preparedAction: { actionId: 'action-7' } };
    },
    executeOwnerAction: async (payload) => {
      calls.push({ kind: 'owner-execute', payload });
      return { ok: true, result: { status: 'executed', receipt: { actionId: 'action-7' } } };
    },
  });

  const listed = await endpoint.handle('tools.list', {});
  assert.equal(listed.tools.length, 2);
  assert.equal(listed.context.page.origin, 'https://example.test');
  const read = listed.tools.find((tool) => tool._meta['toolbraid/originalName'] === 'read_post');
  const mutation = listed.tools.find((tool) => tool._meta['toolbraid/originalName'] === 'like_post');
  assert.match(read.name, /^toolbraid\.read_post\.[a-f0-9]{16}$/);
  assert.equal(read.annotations.readOnlyHint, true);
  assert.equal(mutation.annotations.readOnlyHint, false);
  assert.match(mutation.description, /local owner policy/i);

  const readResult = await endpoint.handle('tools.call', { name: read.name, arguments: {} });
  assert.equal(readResult.result.status, 'read-completed');
  assert.deepEqual(calls[0], {
    kind: 'read',
    payload: { targetTabId: 42, targetWindowId: 8, targetFrameId: 0, toolId: 'read_post', arguments: {} },
  });

  const prepared = await endpoint.handle('tools.call', { name: mutation.name, arguments: { enabled: true } });
  assert.equal(prepared.result.status, 'executed');
  assert.deepEqual(calls[1], {
    kind: 'owner-execute',
    payload: {
      targetTabId: 42,
      targetWindowId: 8,
      targetFrameId: 0,
      sessionId: 'session-0123456789',
      toolName: 'like_post',
      arguments: { enabled: true },
    },
  });
  assert.equal(Object.hasOwn(calls[1].payload, 'approved'), false);

  state = pageState({ snapshot: { pageFingerprint: 'fingerprint-drift-9876', extractorPageFingerprint: 'e'.repeat(64) } });
  await assert.rejects(
    endpoint.handle('tools.call', { name: mutation.name, arguments: { enabled: true } }),
    (error) => error.code === 'MCP_PAGE_BINDING_DRIFT',
  );
});

test('read handles survive content updates and retain exact page and descriptor checks', async () => {
  let state = pageState();
  const provenance = { source: 'toolbraid.verified-adapter', adapterId: 'x-post', url: state.tab.url,
    pageFingerprint: state.snapshot.pageFingerprint, snapshotFingerprint: state.snapshot.pageFingerprint };
  state.tools[0].provenance = provenance;
  let reads = 0;
  const endpoint = createExtensionMcpEndpoint({
    getState: async () => ({ ok: true, state: structuredClone(state) }),
    executeRead: async () => { reads += 1; return { ok: true }; },
    prepareAction: async () => ({ ok: true }), executeOwnerAction: async () => ({ ok: true }),
  });
  let notifications = 0;
  endpoint.onToolsChanged(() => { notifications += 1; });
  const { tools } = await endpoint.listTools();
  const read = tools.find((tool) => tool.annotations.readOnlyHint);
  state.snapshot.pageFingerprint = 'content-update-0123456789';
  state.tools[0].provenance = { ...provenance, pageFingerprint: state.snapshot.pageFingerprint, snapshotFingerprint: state.snapshot.pageFingerprint };
  endpoint.pageContentChanged();
  assert.equal(notifications, 1);
  await endpoint.handle('tools.call', { name: read.name });
  assert.equal(reads, 1);
  assert.equal((await endpoint.listTools()).tools.find((tool) => tool.annotations.readOnlyHint).name, read.name);
  state.tools[0].inputSchema = { type: 'object', properties: { other: { type: 'string' } }, additionalProperties: false };
  await assert.rejects(endpoint.handle('tools.call', { name: read.name }), { code: 'MCP_TOOL_DESCRIPTOR_DRIFT' });
  assert.equal(reads, 1);
});

test('read handles reject navigation, tab, frame, window and session changes before dispatch', async () => {
  for (const change of [
    (state) => { state.tab.url = 'https://example.test/post/8'; },
    (state) => { state.tab.id = 43; },
    (state) => { state.tab.windowId = 9; },
    (state) => { state.tab.frameId = 1; },
    (state) => { state.sessionId = 'replacement-session-12345'; },
    (state) => { state.tab.origin = 'https://other.test'; state.tab.url = 'https://other.test/post/7'; },
  ]) {
    const state = pageState();
    let reads = 0;
    const endpoint = createExtensionMcpEndpoint({
      getState: async () => ({ ok: true, state: structuredClone(state) }),
      executeRead: async () => { reads += 1; return { ok: true }; },
      prepareAction: async () => ({ ok: true }), executeOwnerAction: async () => ({ ok: true }),
    });
    const { tools } = await endpoint.listTools();
    const read = tools.find((tool) => tool.annotations.readOnlyHint);
    change(state);
    await assert.rejects(endpoint.handle('tools.call', { name: read.name }), { code: 'MCP_PAGE_BINDING_DRIFT' });
    assert.equal(reads, 0);
  }
});

test('viewport scrolling is read-only but not idempotent over MCP', async () => {
  const state = pageState();
  state.tools[0].effect.operation = 'scroll';
  const endpoint = createExtensionMcpEndpoint({
    getState: async () => ({ ok: true, state }), executeRead: async () => ({ ok: true }),
    prepareAction: async () => ({ ok: true }), executeOwnerAction: async () => ({ ok: true }),
  });
  const { tools } = await endpoint.handle('tools.list');
  const scroll = tools.find((tool) => tool.annotations.readOnlyHint);
  assert.equal(scroll.annotations.idempotentHint, false);
});

test('invalidates handles and notifies only after a listed tool surface existed', async () => {
  const endpoint = createExtensionMcpEndpoint({
    getState: async () => ({ ok: true, state: pageState() }),
    executeRead: async () => ({ ok: true }),
    prepareAction: async () => ({ ok: true }),
    executeOwnerAction: async () => ({ ok: true }),
  });
  let notifications = 0;
  endpoint.onToolsChanged(() => { notifications += 1; });
  endpoint.invalidate();
  assert.equal(notifications, 0);
  await endpoint.listTools();
  endpoint.invalidate();
  assert.equal(notifications, 1);
  assert.equal(endpoint.handleCount(), 0);
});

test('page changes retain owner tools but access invalidation makes them stale', async () => {
  let providerInvalidations = 0;
  const ownerTools = {
    descriptors: () => [{ name: 'toolbraid.browser.tab_open', inputSchema: { type: 'object' } }],
    call: async () => ({ opened: true }),
    invalidate() { providerInvalidations += 1; },
  };
  const endpoint = createExtensionMcpEndpoint({
    getState: async () => ({ ok: false, error: { code: 'ACTIVE_TAB_UNAVAILABLE', message: 'No active page.' } }),
    executeRead: async () => ({ ok: true }),
    prepareAction: async () => ({ ok: true }),
    executeOwnerAction: async () => ({ ok: true }),
    nativeOwnerToolProviders: [ownerTools],
  });
  let notifications = 0;
  endpoint.onToolsChanged(() => { notifications += 1; });

  assert.deepEqual(await endpoint.handle('bridge.status', {}), { connected: true, page: null, toolCount: 0 });
  const listed = await endpoint.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name), ['toolbraid.browser.tab_open']);
  endpoint.invalidatePage();

  assert.equal(providerInvalidations, 0);
  assert.equal(notifications, 1);
  assert.deepEqual(await endpoint.handle('tools.call', { name: 'toolbraid.browser.tab_open', arguments: { url: 'https://example.test/' } }), { opened: true });

  await endpoint.listTools();
  endpoint.invalidate();

  assert.equal(providerInvalidations, 1);
  assert.equal(notifications, 2);
  await assert.rejects(
    endpoint.handle('tools.call', { name: 'toolbraid.browser.tab_open', arguments: { url: 'https://example.test/' } }),
    { code: 'MCP_TOOL_HANDLE_STALE' },
  );
});

test('native port accepts only the bounded allowlisted protocol', async () => {
  const messageListeners = [];
  const disconnectListeners = [];
  const posted = [];
  const port = {
    onMessage: { addListener(listener) { messageListeners.push(listener); } },
    onDisconnect: { addListener(listener) { disconnectListeners.push(listener); } },
    postMessage(message) { posted.push(message); },
    disconnect() {},
  };
  const endpoint = {
    onToolsChanged() { return () => {}; },
    handle: async (method) => ({ method, connected: true }),
  };
  let disconnectErrorsRead = 0;
  const bridge = installNativeMcpBridge({
    chromeApi: { runtime: { connectNative: () => port, get lastError() { disconnectErrorsRead += 1; return { message: 'Native host closed.' }; } } },
    endpoint,
    schedule: () => 1,
  });
  assert.equal(bridge.state().connected, true);
  assert.equal(posted[0].event, 'extension_ready');

  messageListeners[0]({ protocol: 'wrong', version: 1, kind: 'request', requestId: 'x', method: 'bridge.status', params: {} });
  await Promise.resolve();
  assert.equal(posted.length, 1);

  messageListeners[0]({
    protocol: NATIVE_MCP_PROTOCOL,
    version: NATIVE_MCP_VERSION,
    kind: 'request',
    requestId: 'request-1',
    method: 'bridge.status',
    params: {},
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(posted.at(-1).kind, 'response');
  assert.equal(posted.at(-1).ok, true);
  assert.equal(posted.at(-1).result.connected, true);
  disconnectListeners[0]();
  assert.equal(disconnectErrorsRead, 1);
  assert.equal(bridge.state().connected, false);
  bridge.stop();
});

test('lists native-only browser tools before a ToolBraid page is active', async () => {
  const browserOwnerTools = {
    descriptors: () => [{ name: 'toolbraid.browser.tab_open', inputSchema: { type: 'object' } }],
    call: async () => ({ opened: true }),
    invalidate() {},
  };
  const endpoint = createExtensionMcpEndpoint({
    getState: async () => ({ ok: false, error: { code: 'ACTIVE_TAB_UNAVAILABLE', message: 'No active ToolBraid page.' } }),
    executeRead: async () => ({ ok: true }),
    prepareAction: async () => ({ ok: true }),
    executeOwnerAction: async () => ({ ok: true }),
    browserOwnerTools,
  });
  const listed = await endpoint.handle('tools.list', {});
  assert.equal(listed.context.page, null);
  assert.deepEqual(listed.tools.map((tool) => tool.name), ['toolbraid.browser.tab_open']);
  assert.deepEqual(await endpoint.handle('tools.call', { name: 'toolbraid.browser.tab_open', arguments: { url: 'https://example.test/' } }), { opened: true });
});

test('routes multiple native owner providers by exact descriptor name and rejects collisions', async () => {
  const calls = [];
  const browserOwnerTools = {
    descriptors: () => [{ name: 'toolbraid.browser.tab_open', inputSchema: { type: 'object' } }],
    call: async (name, args) => { calls.push(['browser', name, args]); return { opened: true }; },
    invalidate() {},
  };
  const downloadOwnerTools = {
    descriptors: () => [{ name: 'toolbraid.download.list', inputSchema: { type: 'object' } }],
    call: async (name, args) => { calls.push(['download', name, args]); return { downloads: [] }; },
    invalidate() {},
  };
  const endpoint = createExtensionMcpEndpoint({
    getState: async () => ({ ok: false, error: { code: 'ACTIVE_TAB_UNAVAILABLE', message: 'No active page.' } }),
    executeRead: async () => ({ ok: true }), prepareAction: async () => ({ ok: true }), executeOwnerAction: async () => ({ ok: true }),
    browserOwnerTools,
    nativeOwnerToolProviders: [downloadOwnerTools],
  });
  const listed = await endpoint.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name), ['toolbraid.download.list', 'toolbraid.browser.tab_open']);
  await endpoint.handle('tools.call', { name: 'toolbraid.download.list', arguments: { limit: 2 } });
  await endpoint.handle('tools.call', { name: 'toolbraid.browser.tab_open', arguments: { url: 'https://example.test/' } });
  assert.deepEqual(calls.map(([kind]) => kind), ['download', 'browser']);
  await assert.rejects(endpoint.handle('tools.call', { name: 'toolbraid.download.', arguments: {} }), { code: 'MCP_TOOL_HANDLE_STALE' });
  const collision = createExtensionMcpEndpoint({
    getState: async () => ({ ok: false, error: { code: 'ACTIVE_TAB_UNAVAILABLE' } }),
    executeRead: async () => ({ ok: true }), prepareAction: async () => ({ ok: true }), executeOwnerAction: async () => ({ ok: true }),
    nativeOwnerToolProviders: [browserOwnerTools, { ...downloadOwnerTools, descriptors: () => [{ name: 'toolbraid.browser.tab_open' }] }],
  });
  await assert.rejects(collision.listTools(), { code: 'MCP_TOOL_NAME_COLLISION' });
});

test('lists exact file-input handles and attaches only a locally resolved grant', async () => {
  const grantId = 'a'.repeat(64);
  let state = pageState({
    fileInputs: [{ ref: 'e-file', name: 'Upload video', accept: 'video/*', multiple: false }],
  });
  const calls = [];
  const endpoint = createExtensionMcpEndpoint({
    getState: async () => ({ ok: true, state: structuredClone(state) }),
    executeRead: async () => ({ ok: true }),
    prepareAction: async () => ({ ok: true }),
    executeOwnerAction: async () => ({ ok: true }),
    attachGrantedFile: async (payload) => { calls.push(payload); return { ok: true, localPath: 'must-not-leak' }; },
  });
  const listed = await endpoint.listTools();
  const attach = listed.tools.find((tool) => tool._meta?.['toolbraid/fileInput'] === true);
  assert.match(attach.name, /^toolbraid\.attach_file\.[a-f0-9]{16}$/);
  assert.deepEqual(attach.inputSchema.required, ['grantId']);
  assert.deepEqual(Object.keys(attach.inputSchema.properties), ['grantId']);
  assert.equal(attach.inputSchema.properties.grantId.pattern, '^[a-f0-9]{64}$');

  await assert.rejects(
    endpoint.handle('tools.call', { name: attach.name, arguments: { grantId: 'grant-1' } }),
    (error) => error.code === 'MCP_FILE_GRANT_INVALID',
  );
  const result = await endpoint.handle('tools.call', {
    name: attach.name,
    arguments: { grantId, resolvedLocalPath: 'D:\\media\\clip.mp4', expectedFile: { name: 'clip.mp4', size: 42 } },
  });
  assert.deepEqual(result, { ok: true, result: { status: 'attached', ref: 'e-file', name: 'Upload video' } });
  assert.equal(JSON.stringify(result).includes('D:\\media'), false);
  assert.equal(calls[0].tabId, 42);
  assert.equal(calls[0].sessionId, 'session-0123456789');
  assert.equal(calls[0].fileInput.ref, 'e-file');
  assert.equal(calls[0].extractorPageFingerprint, 'e'.repeat(64));
  assert.equal(calls[0].resolvedLocalPath, 'D:\\media\\clip.mp4');

  state = pageState({
    snapshot: { pageFingerprint: 'fingerprint-0123456789', extractorPageFingerprint: 'f'.repeat(64) },
    fileInputs: [{ ref: 'e-file', name: 'Upload video', accept: 'video/*', multiple: false }],
  });
  await assert.rejects(
    endpoint.handle('tools.call', { name: attach.name, arguments: { grantId, resolvedLocalPath: 'D:\\media\\clip.mp4', expectedFile: {} } }),
    (error) => error.code === 'MCP_FILE_INPUT_DRIFT',
  );

  state = pageState({ fileInputs: [{ ref: 'e-file', name: 'Upload video', accept: 'video/*', multiple: false }] });
  const refreshedAttach = (await endpoint.listTools()).tools.find((tool) => tool._meta?.['toolbraid/fileInput'] === true);
  state = pageState({ fileInputs: [{ ref: 'e-file', name: 'Different upload', accept: 'video/*', multiple: false }] });
  await assert.rejects(
    endpoint.handle('tools.call', { name: refreshedAttach.name, arguments: { grantId, resolvedLocalPath: 'D:\\media\\clip.mp4', expectedFile: {} } }),
    (error) => error.code === 'MCP_FILE_INPUT_DRIFT',
  );
});

test('budgets native and file tools before generic page tools deterministically', async () => {
  const native = {
    descriptors: () => Array.from({ length: 60 }, (_, index) => ({ name: `toolbraid.native.${String(index).padStart(2, '0')}`, inputSchema: { type: 'object' } })),
    call: async () => ({ ok: true }),
    invalidate() {},
  };
  const state = pageState({
    fileInputs: [{ ref: 'e-upload', name: 'Upload', accept: '*/*', multiple: false }],
    tools: Array.from({ length: 5 }, (_, index) => ({
      name: `read_${index}`, classification: 'read', inputSchema: { type: 'object', additionalProperties: false },
    })),
  });
  const endpoint = createExtensionMcpEndpoint({
    getState: async () => ({ ok: true, state }),
    executeRead: async () => ({ ok: true }), prepareAction: async () => ({ ok: true }), executeOwnerAction: async () => ({ ok: true }),
    attachGrantedFile: async () => ({ ok: true }), nativeOwnerToolProviders: [native],
  });
  const first = await endpoint.listTools();
  const second = await endpoint.listTools();
  assert.equal(first.tools.length, 64);
  assert.deepEqual(first.tools.map(({ name }) => name), second.tools.map(({ name }) => name));
  assert.equal(first.tools.slice(0, 60).every(({ name }) => name.startsWith('toolbraid.native.')), true);
  assert.equal(first.tools[60]._meta['toolbraid/fileInput'], true);
  assert.equal(first.tools[61]._meta['toolbraid/originalName'], 'read_0');
  assert.equal(first.tools[63]._meta['toolbraid/originalName'], 'read_2');

  const overfullNative = { ...native, descriptors: () => Array.from({ length: 80 }, (_, index) => ({ name: `toolbraid.native.${String(index).padStart(2, '0')}`, inputSchema: { type: 'object' } })) };
  const reserved = createExtensionMcpEndpoint({
    getState: async () => ({ ok: true, state }),
    executeRead: async () => ({ ok: true }), prepareAction: async () => ({ ok: true }), executeOwnerAction: async () => ({ ok: true }),
    attachGrantedFile: async () => ({ ok: true }), nativeOwnerToolProviders: [overfullNative],
  });
  const reservedList = await reserved.listTools();
  assert.equal(reservedList.tools.length, 64);
  assert.equal(reservedList.tools.at(-1)._meta['toolbraid/fileInput'], true);
  assert.equal(reservedList.tools.some((tool) => tool._meta?.['toolbraid/originalName']), false);
});
