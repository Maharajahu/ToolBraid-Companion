import { sha256Hex } from './approval-store.js';
import { NATIVE_MCP_HOST } from './product.js';

export { NATIVE_MCP_HOST };
export const NATIVE_MCP_PROTOCOL = 'toolbraid.native-mcp';
export const NATIVE_MCP_VERSION = 1;

const MAX_TOOLS = 64;
const MAX_MESSAGE_BYTES = 256 * 1024;
const MAX_TOOL_DESCRIPTION = 1_200;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_METHODS = new Set(['bridge.status', 'tools.list', 'tools.call']);

export class NativeMcpBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NativeMcpBridgeError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new NativeMcpBridgeError(code, message);
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function byteLength(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function boundedText(value, fallback = '', max = 512) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : fallback;
}

function exactOrigin(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)
      || url.username || url.password || url.origin !== value) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function safeSchema(value) {
  if (!plainObject(value) || value.type !== 'object' || byteLength(value) > 32 * 1024) {
    return Object.freeze({ type: 'object', additionalProperties: false });
  }
  return Object.freeze(clone(value));
}

function currentBinding(state) {
  const tabId = state?.tab?.id;
  const windowId = state?.tab?.windowId;
  const frameId = state?.tab?.frameId ?? 0;
  const sessionId = state?.sessionId;
  const origin = exactOrigin(state?.tab?.origin);
  const pageFingerprint = state?.snapshot?.pageFingerprint;
  if (!Number.isInteger(tabId) || tabId < 0
    || !Number.isInteger(windowId) || windowId < 0
    || !Number.isInteger(frameId) || frameId < 0
    || typeof sessionId !== 'string' || sessionId.length < 8
    || !origin
    || typeof pageFingerprint !== 'string' || pageFingerprint.length < 8) {
    fail('MCP_CONTEXT_INVALID', 'The active ToolBraid page binding is incomplete.');
  }
  const url = typeof state.tab.url === 'string' ? state.tab.url : null;
  return Object.freeze({ tabId, windowId, frameId, sessionId, origin, url, pageFingerprint });
}

function samePage(left, right) {
  return left?.tabId === right?.tabId
    && left?.windowId === right?.windowId
    && left?.frameId === right?.frameId
    && left?.sessionId === right?.sessionId
    && left?.origin === right?.origin
    && left?.url === right?.url;
}

function sameBinding(left, right) {
  return samePage(left, right) && left?.pageFingerprint === right?.pageFingerprint;
}

function publicContext(state) {
  return Object.freeze({
    connected: true,
    toolTransport: state.toolTransport ?? null,
    page: Object.freeze({
      tabId: state.tab.id,
      windowId: state.tab.windowId,
      frameId: state.tab.frameId ?? 0,
      url: boundedText(state.tab.url, '', 2_048),
      origin: exactOrigin(state.tab.origin),
      title: boundedText(state.tab.title, '', 512),
      pageFingerprint: boundedText(state.snapshot?.pageFingerprint, '', 128),
    }),
    toolCount: Array.isArray(state.tools) ? state.tools.length : 0,
    pendingActionCount: Array.isArray(state.pendingActions) ? state.pendingActions.length : 0,
    receiptCount: Array.isArray(state.receipts) ? state.receipts.length : 0,
    missionCount: Array.isArray(state.missions) ? state.missions.length : 0,
    humanStepCount: Array.isArray(state.handoffs) ? state.handoffs.length : 0,
  });
}

async function proxyName(tool, binding) {
  const original = boundedText(tool?.name, 'page_tool', 128);
  const readable = original.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[^A-Za-z0-9]+/, '').slice(0, 72) || 'page_tool';
  const digest = await sha256Hex({
    tabId: binding.tabId,
    windowId: binding.windowId,
    frameId: binding.frameId,
    sessionId: binding.sessionId,
    origin: binding.origin,
    url: binding.url,
    pageFingerprint: tool.classification === 'read' && binding.url ? null : binding.pageFingerprint,
    name: original,
  });
  return `toolbraid.${readable}.${digest.slice(0, 16)}`.slice(0, 128);
}

async function toolFingerprint(tool) {
  const provenance = clone(tool?.provenance ?? null);
  if (tool?.classification === 'read' && plainObject(provenance)) {
    delete provenance.pageFingerprint;
    delete provenance.snapshotFingerprint;
  }
  return sha256Hex({
    name: tool?.name ?? null,
    title: tool?.title ?? null,
    description: tool?.description ?? null,
    classification: tool?.classification ?? null,
    requiresApproval: tool?.requiresApproval ?? null,
    inputSchema: tool?.inputSchema ?? null,
    effect: tool?.effect ?? null,
    provenance,
  });
}

function mcpDescriptor(name, tool, binding) {
  const classification = tool.classification === 'read' ? 'read' : (tool.classification === 'stage' ? 'stage' : 'mutation');
  const directExecution = classification !== 'read' && tool.directExecution === true;
  const approval = classification === 'read' || directExecution
    ? ''
    : ' This requests owner-policy execution of the exact page-bound action; if the local owner policy does not authorize it, the result remains approval-required.';
  const source = boundedText(tool.sourceType ?? tool.provenance, 'ToolBraid', 96);
  return Object.freeze({
    name,
    title: boundedText(tool.title, tool.name, 256),
    description: `${boundedText(tool.description, tool.title ?? tool.name, MAX_TOOL_DESCRIPTION - approval.length - 96)}${approval} Source: ${source}; active origin: ${binding.origin}.`.slice(0, MAX_TOOL_DESCRIPTION),
    inputSchema: safeSchema(tool.inputSchema),
    annotations: Object.freeze({
      readOnlyHint: classification === 'read',
      destructiveHint: false,
      idempotentHint: classification === 'read' && tool.effect?.operation !== 'scroll',
      openWorldHint: classification !== 'stage',
    }),
    _meta: Object.freeze({
      'toolbraid/originalName': boundedText(tool.name, '', 128),
      'toolbraid/classification': classification,
      'toolbraid/requiresApproval': classification !== 'read' && !directExecution,
      ...(directExecution ? { 'toolbraid/authorization': 'x-direct-control' } : {}),
      'toolbraid/origin': binding.origin,
      'toolbraid/frameId': binding.frameId,
      'toolbraid/pageFingerprint': binding.pageFingerprint,
    }),
  });
}

async function fileInputFingerprint(input) {
  return sha256Hex({ ref: input.ref, name: input.name, accept: input.accept, multiple: input.multiple === true });
}

function fileInputDescriptor(name, input, binding) {
  return Object.freeze({
    name,
    title: `Attach file to ${boundedText(input.name, 'file input', 180)}`,
    description: `Attach a previously granted local file to the exact visible file input on ${binding.origin}. The grant is resolved only by the local native host.`,
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({ grantId: Object.freeze({ type: 'string', pattern: '^[a-f0-9]{64}$' }) }),
      required: Object.freeze(['grantId']),
      additionalProperties: false,
    }),
    annotations: Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }),
    _meta: Object.freeze({
      'toolbraid/fileInput': true,
      'toolbraid/origin': binding.origin,
      'toolbraid/pageFingerprint': binding.pageFingerprint,
      'toolbraid/fileInputRef': input.ref,
    }),
  });
}

function requireOk(response) {
  if (response?.ok === true) return response;
  fail(
    boundedText(response?.error?.code, 'MCP_EXTENSION_REJECTED', 64),
    boundedText(response?.error?.message, 'ToolBraid rejected the MCP request.', 320),
  );
}

export function createExtensionMcpEndpoint({
  getState,
  executeRead,
  prepareAction,
  executeOwnerAction,
  attachGrantedFile = null,
  browserOwnerTools = null,
  nativeOwnerToolProviders = null,
  authorize = async () => {},
} = {}) {
  if (typeof getState !== 'function' || typeof executeRead !== 'function'
      || typeof prepareAction !== 'function' || typeof executeOwnerAction !== 'function') {
    throw new TypeError('getState, executeRead, prepareAction, and executeOwnerAction are required.');
  }

  const handles = new Map();
  const changeListeners = new Set();
  const ownerProviders = [
    ...(Array.isArray(nativeOwnerToolProviders) ? nativeOwnerToolProviders : []),
    ...(browserOwnerTools ? [browserOwnerTools] : []),
  ].filter((provider) => provider && typeof provider.descriptors === 'function' && typeof provider.call === 'function');
  const ownerTools = new Map();

  function ownerDescriptors(limit = MAX_TOOLS) {
    ownerTools.clear();
    const descriptors = [];
    for (const provider of ownerProviders) {
      const listed = provider.descriptors();
      if (!Array.isArray(listed)) continue;
      for (const descriptor of listed) {
        if (descriptors.length >= limit) break;
        if (!plainObject(descriptor) || typeof descriptor.name !== 'string' || !descriptor.name) {
          fail('MCP_OWNER_TOOL_INVALID', 'A native owner tool descriptor is invalid.');
        }
        if (ownerTools.has(descriptor.name)) {
          fail('MCP_TOOL_NAME_COLLISION', `Two native owner tools produced the same MCP name: ${descriptor.name}.`);
        }
        ownerTools.set(descriptor.name, provider);
        descriptors.push(descriptor);
      }
    }
    return descriptors;
  }

  async function stateFor(target = {}) {
    const response = requireOk(await getState(target));
    if (!plainObject(response.state)) fail('MCP_STATE_INVALID', 'ToolBraid returned an invalid public state.');
    return response.state;
  }

  async function listTools(params = {}) {
    await authorize();
    let state;
    try {
      state = await stateFor(params.target ?? {});
    } catch (error) {
      if (!ownerProviders.length) throw error;
      handles.clear();
      return Object.freeze({
        tools: Object.freeze(ownerDescriptors()),
        context: Object.freeze({ connected: true, page: null, toolCount: 0 }),
      });
    }
    const binding = currentBinding(state);
    const extractorPageFingerprint = typeof state.snapshot?.extractorPageFingerprint === 'string'
      && /^[a-f0-9]{64}$/.test(state.snapshot.extractorPageFingerprint)
      ? state.snapshot.extractorPageFingerprint
      : null;
    const tools = Array.isArray(state.tools) ? state.tools : [];
    const nextHandles = new Map();
    const fileInputs = typeof attachGrantedFile === 'function' && extractorPageFingerprint
      ? (Array.isArray(state.fileInputs) ? state.fileInputs.slice(0, 24) : []).filter((input) => plainObject(input) && typeof input.ref === 'string' && input.ref)
      : [];
    const descriptors = params.target ? ownerDescriptors().filter((tool) => /^toolbraid\.(webmcp\.|community\.|browser\.active_)/.test(tool.name)) : ownerDescriptors(Math.max(0, MAX_TOOLS - fileInputs.length));
    if (fileInputs.length) {
      for (const input of fileInputs) {
        if (descriptors.length >= MAX_TOOLS) break;
        const normalized = Object.freeze({
          ref: boundedText(input.ref, '', 256),
          name: boundedText(input.name, '', 512),
          accept: boundedText(input.accept, '', 512),
          multiple: input.multiple === true,
        });
        if (!normalized.ref) continue;
        const fingerprint = await fileInputFingerprint(normalized);
        const name = `toolbraid.attach_file.${fingerprint.slice(0, 16)}`;
        if (nextHandles.has(name)) fail('MCP_TOOL_NAME_COLLISION', 'Two active file inputs produced the same MCP name.');
        nextHandles.set(name, Object.freeze({ name, kind: 'file-input', binding, extractorPageFingerprint, fingerprint, input: normalized }));
        descriptors.push(fileInputDescriptor(name, normalized, binding));
      }
    }
    for (const tool of tools) {
      if (descriptors.length >= MAX_TOOLS) break;
      if (!plainObject(tool) || typeof tool.name !== 'string') continue;
      const name = await proxyName(tool, binding);
      if (nextHandles.has(name)) fail('MCP_TOOL_NAME_COLLISION', 'Two active page tools produced the same MCP name.');
      const fingerprint = await toolFingerprint(tool);
      nextHandles.set(name, Object.freeze({
        name,
        toolName: tool.name,
        classification: tool.classification,
        scoped: !!params.target,
        binding,
        fingerprint,
      }));
      descriptors.push(mcpDescriptor(name, tool, binding));
    }
    handles.clear();
    for (const [name, handle] of nextHandles) handles.set(name, handle);
    return Object.freeze({ tools: Object.freeze(descriptors), context: publicContext(state) });
  }

  async function callTool(params) {
    if (!plainObject(params)
      || typeof params.name !== 'string'
      || !plainObject(params.arguments ?? {})) {
      fail('MCP_TOOL_CALL_INVALID', 'An exact MCP tool name and object arguments are required.');
    }
    const ownerProvider = ownerTools.get(params.name);
    if (ownerProvider) {
      return ownerProvider.call(params.name, clone(params.arguments ?? {}), params.target ?? {});
    }
    const handle = handles.get(params.name);
    if (!handle) fail('MCP_TOOL_HANDLE_STALE', 'Refresh ToolBraid tools before calling this page tool.');
    const target = {
      targetTabId: handle.binding.tabId,
      targetWindowId: handle.binding.windowId,
      targetFrameId: handle.binding.frameId,
    };
    if (handle.scoped && (params.target?.targetTabId !== target.targetTabId || params.target?.targetWindowId !== target.targetWindowId || params.target?.targetFrameId !== target.targetFrameId)) fail('MCP_PAGE_BINDING_DRIFT', 'This tool belongs to a different chat page.');
    const state = await stateFor(handle.scoped ? target : {});
    const binding = currentBinding(state);
    const refreshableRead = handle.classification === 'read' && handle.binding.url;
    if (!(refreshableRead ? samePage(handle.binding, binding) : sameBinding(handle.binding, binding))) {
      handles.delete(params.name);
      fail('MCP_PAGE_BINDING_DRIFT', 'The active ToolBraid page changed after this MCP tool was listed.');
    }
    if (handle.kind === 'file-input') {
      const args = params.arguments ?? {};
      const allowed = new Set(['grantId', 'resolvedLocalPath', 'expectedFile']);
      if (Object.keys(args).some((key) => !allowed.has(key))
        || typeof args.grantId !== 'string' || !/^[a-f0-9]{64}$/.test(args.grantId)
        || typeof args.resolvedLocalPath !== 'string' || !args.resolvedLocalPath || args.resolvedLocalPath.length > 32_768
        || !plainObject(args.expectedFile) || byteLength(args.expectedFile) > 8 * 1024) {
        fail('MCP_FILE_GRANT_INVALID', 'A locally resolved file grant is required for this exact file input.');
      }
      const live = (Array.isArray(state.fileInputs) ? state.fileInputs : []).find((entry) => entry?.ref === handle.input.ref);
      const liveExtractorPageFingerprint = state.snapshot?.extractorPageFingerprint;
      if (typeof liveExtractorPageFingerprint !== 'string'
        || !/^[a-f0-9]{64}$/.test(liveExtractorPageFingerprint)
        || liveExtractorPageFingerprint !== handle.extractorPageFingerprint
        || !live || await fileInputFingerprint(live) !== handle.fingerprint) {
        handles.delete(params.name);
        fail('MCP_FILE_INPUT_DRIFT', 'The bound file input changed after this MCP tool was listed.');
      }
      const result = await attachGrantedFile(Object.freeze({
        ...handle.binding,
        extractorPageFingerprint: handle.extractorPageFingerprint,
        fileInput: clone(handle.input),
        grantId: args.grantId,
        resolvedLocalPath: args.resolvedLocalPath,
        expectedFile: clone(args.expectedFile),
      }));
      if (result?.ok === false) return requireOk(result);
      return Object.freeze({ ok: true, result: Object.freeze({ status: 'attached', ref: handle.input.ref, name: handle.input.name }) });
    }
    const tool = state.tools.find((candidate) => candidate?.name === handle.toolName);
    if (!tool || await toolFingerprint(tool) !== handle.fingerprint) {
      handles.delete(params.name);
      fail('MCP_TOOL_DESCRIPTOR_DRIFT', 'The live ToolBraid descriptor changed after this MCP tool was listed.');
    }
    const payload = {
      ...target,
      ...(tool.classification === 'read' ? { toolId: tool.name } : { actionId: tool.name }),
      arguments: clone(params.arguments ?? {}),
    };
    const response = tool.classification === 'read'
      ? await executeRead(payload)
      : await executeOwnerAction({
        ...target,
        sessionId: handle.binding.sessionId,
        toolName: tool.name,
        arguments: clone(params.arguments ?? {}),
      });
    return requireOk(response);
  }

  async function handle(method, params = {}) {
    await authorize();
    if (!SAFE_METHODS.has(method)) fail('MCP_METHOD_UNSUPPORTED', 'The native bridge method is not allowed.');
    if (!plainObject(params) || byteLength(params) > MAX_MESSAGE_BYTES) {
      fail('MCP_PARAMS_INVALID', 'The native bridge parameters are invalid or too large.');
    }
    if (method === 'bridge.status') {
      try {
        return publicContext(await stateFor());
      } catch (error) {
        if (!ownerProviders.length) throw error;
        return Object.freeze({ connected: true, page: null, toolCount: 0 });
      }
    }
    if (method === 'tools.list') return listTools(params);
    return callTool(params);
  }

  function invalidatePage() {
    const changed = handles.size > 0 || ownerTools.size > 0;
    handles.clear();
    if (changed) for (const listener of changeListeners) listener();
  }

  function pageContentChanged() {
    // Content refreshes keep handles available for live binding validation;
    // navigation, access revocation and extension shutdown still invalidate.
    if (handles.size || ownerTools.size) for (const listener of changeListeners) listener();
  }

  function invalidate() {
    const changed = handles.size > 0 || ownerTools.size > 0;
    handles.clear();
    ownerTools.clear();
    for (const provider of ownerProviders) provider.invalidate?.();
    if (changed) for (const listener of changeListeners) listener();
  }

  function onToolsChanged(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function.');
    changeListeners.add(listener);
    return () => changeListeners.delete(listener);
  }

  return Object.freeze({ handle, listTools, pageContentChanged, invalidatePage, invalidate, onToolsChanged, handleCount: () => handles.size });
}

function nativeRequest(message) {
  return plainObject(message)
    && message.protocol === NATIVE_MCP_PROTOCOL
    && message.version === NATIVE_MCP_VERSION
    && message.kind === 'request'
    && typeof message.requestId === 'string'
    && SAFE_REQUEST_ID.test(message.requestId)
    && SAFE_METHODS.has(message.method)
    && plainObject(message.params ?? {})
    && byteLength(message) <= MAX_MESSAGE_BYTES;
}

function nativeError(error) {
  return Object.freeze({
    code: boundedText(error?.code, 'MCP_EXTENSION_FAILED', 64),
    message: boundedText(error?.message, 'ToolBraid rejected the native MCP request.', 320),
  });
}

export function installNativeMcpBridge({
  chromeApi = globalThis.chrome,
  endpoint,
  hostName = NATIVE_MCP_HOST,
  reconnectDelayMs = 5_000,
  schedule = globalThis.setTimeout?.bind(globalThis),
  enabled = true,
  onAssistantEvent = () => {},
} = {}) {
  if (!endpoint || typeof endpoint.handle !== 'function') throw new TypeError('endpoint is required.');
  let port = null;
  let stopped = false;
  let reconnectTimer = null;
  let connected = false;
  const assistantPending = new Map();

  function rejectAssistantRequests() {
    for (const pending of assistantPending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new NativeMcpBridgeError('ASSISTANT_DISCONNECTED', 'The Windows companion disconnected. Reconnect before continuing.'));
    }
    assistantPending.clear();
  }

  function requestAssistant(method, params = {}) {
    if (!['state', 'configure', 'models', 'login', 'send', 'stop', 'approve', 'clear'].includes(method) || !plainObject(params) || byteLength(params) > MAX_MESSAGE_BYTES) return Promise.reject(new NativeMcpBridgeError('ASSISTANT_REQUEST_INVALID', 'Invalid assistant request.'));
    if (!enabled || stopped || !port) return Promise.reject(new NativeMcpBridgeError('ASSISTANT_UNAVAILABLE', 'Enable ToolBraid and install the matching Windows companion to use chat.'));
    const requestId = globalThis.crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { assistantPending.delete(requestId); reject(new NativeMcpBridgeError('ASSISTANT_TIMEOUT', 'The companion did not respond. Check the connection before retrying.')); }, 35000);
      assistantPending.set(requestId, { resolve, reject, timer });
      if (!post({ protocol: NATIVE_MCP_PROTOCOL, version: NATIVE_MCP_VERSION, kind: 'assistant-request', requestId, method, params })) {
        clearTimeout(timer); assistantPending.delete(requestId); reject(new NativeMcpBridgeError('ASSISTANT_UNAVAILABLE', 'The companion is unavailable.'));
      }
    });
  }

  function post(message) {
    if (!port) return false;
    try {
      port.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }

  function toolsChanged() {
    post({
      protocol: NATIVE_MCP_PROTOCOL,
      version: NATIVE_MCP_VERSION,
      kind: 'event',
      event: 'tools_changed',
    });
  }
  const unsubscribe = endpoint.onToolsChanged(toolsChanged);

  function scheduleReconnect() {
    if (stopped || !enabled || reconnectTimer || typeof schedule !== 'function') return;
    reconnectTimer = schedule(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
  }

  function connect() {
    if (stopped || !enabled || port || typeof chromeApi?.runtime?.connectNative !== 'function') return false;
    try {
      const candidate = chromeApi.runtime.connectNative(hostName);
      if (!candidate?.onMessage?.addListener || !candidate?.onDisconnect?.addListener) return false;
      port = candidate;
      connected = true;
      candidate.onMessage.addListener((message) => {
        if (enabled && port === candidate && message?.protocol === NATIVE_MCP_PROTOCOL && message.version === NATIVE_MCP_VERSION) {
          if (message.kind === 'assistant-event') { onAssistantEvent(message.event); return; }
          if (message.kind === 'assistant-response') {
            const pending = assistantPending.get(message.requestId);
            if (!pending) return;
            clearTimeout(pending.timer); assistantPending.delete(message.requestId);
            if (message.ok === true) pending.resolve(message.result);
            else pending.reject(new NativeMcpBridgeError(message.error?.code ?? 'ASSISTANT_FAILED', message.error?.message ?? 'Chat request failed.'));
            return;
          }
        }
        if (!enabled || port !== candidate || !nativeRequest(message)) return;
        Promise.resolve(endpoint.handle(message.method, message.params ?? {}))
          .then((result) => post({
            protocol: NATIVE_MCP_PROTOCOL,
            version: NATIVE_MCP_VERSION,
            kind: 'response',
            requestId: message.requestId,
            ok: true,
            result,
          }))
          .catch((error) => post({
            protocol: NATIVE_MCP_PROTOCOL,
            version: NATIVE_MCP_VERSION,
            kind: 'response',
            requestId: message.requestId,
            ok: false,
            error: nativeError(error),
          }));
      });
      candidate.onDisconnect.addListener(() => {
        void chromeApi.runtime.lastError;
        if (port !== candidate) return;
        port = null;
        connected = false;
        rejectAssistantRequests();
        scheduleReconnect();
      });
      post({
        protocol: NATIVE_MCP_PROTOCOL,
        version: NATIVE_MCP_VERSION,
        kind: 'event',
        event: 'extension_ready',
      });
      return true;
    } catch {
      port = null;
      connected = false;
      scheduleReconnect();
      return false;
    }
  }

  function setEnabled(value) {
    enabled = value === true;
    if (enabled) return connect();
    if (reconnectTimer && typeof globalThis.clearTimeout === 'function') globalThis.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const previous = port;
    port = null;
    connected = false;
    rejectAssistantRequests();
    try { previous?.disconnect?.(); } catch { /* already disconnected */ }
    return true;
  }

  function stop() {
    stopped = true;
    unsubscribe();
    setEnabled(false);
  }

  connect();
  return Object.freeze({ connect, stop, setEnabled, requestAssistant, state: () => Object.freeze({ connected, enabled, hostName }) });
}
