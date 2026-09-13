import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AtomicJsonStore } from './atomic-json-store.mjs';
import { createAssistant } from './assistant.mjs';
import { createDurableControl } from './durable-control.mjs';
import { createFileGrantMethods, FileGrantStore } from './file-grants.mjs';
import { createMediaControl } from './media-control.mjs';
import { ScopedFilesystem } from './scoped-filesystem.mjs';
import { createWindowsUiaBroker } from './windows-uia.mjs';
import { createWorkflowControl } from './workflow-control.mjs';

import {
  BRIDGE_PROTOCOL,
  BRIDGE_PROTOCOL_VERSION,
  JsonLineDecoder,
  LocalBridgeError,
  MAX_BRIDGE_MESSAGE_BYTES,
  configPathFromArgs,
  loadBridgeConfig,
  messageByteLength,
  plainObject,
  safeError,
  writeJsonLine,
} from './common.mjs';

const NATIVE_PROTOCOL = 'toolbraid.native-mcp';
const NATIVE_VERSION = 1;
const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024;
const LOCAL_FILE_METHODS = new Set(['files.grant.create','files.grant.revoke','files.root.create','files.root.revoke','files.list','files.read','files.write','files.move','files.archive']);
const LOCAL_UIA_METHODS = new Set(['uia.windows.list', 'uia.controls.list', 'uia.control.invoke', 'uia.control.set_value']);
const LOCAL_DURABLE_METHODS = new Set([
  'durable.mission.create', 'durable.mission.run', 'durable.mission.state', 'durable.mission.cancel', 'durable.mission.clear',
  'durable.schedule.add', 'durable.schedule.list', 'durable.schedule.pause', 'durable.schedule.resume', 'durable.schedule.delete', 'durable.schedule.tick',
]);
const LOCAL_MEDIA_METHODS = new Set(['media.job.create', 'media.job.state', 'media.job.cancel']);
const LOCAL_WORKFLOW_METHODS = new Set([
  'workflow.demonstrations.put', 'workflow.demonstrations.list', 'workflow.demonstrations.forget',
  'workflow.adapter.draft', 'workflow.adapter.version', 'workflow.adapter.enable', 'workflow.adapter.disable', 'workflow.adapter.shadow_replay',
]);
const SAFE_METHODS = new Set([
  'bridge.status', 'tools.list', 'tools.call', ...LOCAL_FILE_METHODS, ...LOCAL_UIA_METHODS, ...LOCAL_DURABLE_METHODS,
  ...LOCAL_MEDIA_METHODS, ...LOCAL_WORKFLOW_METHODS,
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REQUEST_TIMEOUT_MS = 30_000;

function callerOrigin(args) {
  return args.find((value) => typeof value === 'string' && value.startsWith('chrome-extension://')) ?? null;
}

function nativeFrame(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  if (payload.length > MAX_NATIVE_MESSAGE_BYTES) {
    throw new LocalBridgeError('NATIVE_MESSAGE_TOO_LARGE', 'The native message exceeded Chrome\'s response limit.');
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(header);
  process.stdout.write(payload);
}

export function createLocalFileGrantRequestHandler(fileGrants = createFileGrantMethods(new FileGrantStore())) {
  return async function handleLocalFileGrant(ownerId, method, params = {}) {
    if (method === 'files.grant.create') return fileGrants.create(params, ownerId);
    if (method === 'files.grant.revoke') return fileGrants.revoke(params, ownerId);
    throw new LocalBridgeError('BRIDGE_METHOD_UNSUPPORTED', 'The local bridge method is unsupported.');
  };
}

export function createNativeFileUploadBroker(fileGrants = createFileGrantMethods(new FileGrantStore())) {
  const listedFileTools = new WeakMap();

  return Object.freeze({
    rememberTools(client, result) {
      const names = new Set();
      for (const descriptor of (Array.isArray(result?.tools) ? result.tools : [])) {
        if (typeof descriptor?.name === 'string' && descriptor?._meta?.['toolbraid/fileInput'] === true) names.add(descriptor.name);
      }
      listedFileTools.set(client, names);
    },
    clear(client) {
      if (client) listedFileTools.delete(client);
    },
    async prepare(client, method, params = {}) {
      if (method !== 'tools.call') return params;
      const args = params.arguments;
      const listed = listedFileTools.get(client)?.has(params?.name) === true;
      const reservedInternalArguments = plainObject(args)
        && (Object.hasOwn(args, 'resolvedLocalPath') || Object.hasOwn(args, 'expectedFile'));
      const fileToolName = typeof params?.name === 'string' && params.name.startsWith('toolbraid.attach_file.');
      if (!listed) {
        if (fileToolName || reservedInternalArguments) {
          throw new LocalBridgeError('FILE_GRANT_ARGUMENTS_INVALID', 'A file-input tool must be listed for this client before use.');
        }
        return params;
      }
      if (!plainObject(args) || Object.keys(args).length !== 1
        || typeof args.grantId !== 'string' || !/^[a-f0-9]{64}$/.test(args.grantId)) {
        throw new LocalBridgeError('FILE_GRANT_ARGUMENTS_INVALID', 'This file-input tool accepts exactly one opaque grantId.');
      }
      const file = await fileGrants.resolveOnce(args.grantId, client.ownerId);
      return Object.freeze({
        ...params,
        arguments: Object.freeze({
          grantId: args.grantId,
          resolvedLocalPath: file.path,
          expectedFile: Object.freeze({ name: file.basename, size: file.size, count: 1, mime: file.mime }),
        }),
      });
    },
  });
}

class NativeDecoder {
  #buffer = Buffer.alloc(0);
  #onMessage;

  constructor(onMessage) {
    this.#onMessage = onMessage;
  }

  push(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32LE(0);
      if (length < 2 || length > MAX_NATIVE_MESSAGE_BYTES) {
        throw new LocalBridgeError('NATIVE_MESSAGE_INVALID', 'Chrome sent an invalid native message length.');
      }
      if (this.#buffer.length < length + 4) return;
      const payload = this.#buffer.subarray(4, length + 4);
      this.#buffer = this.#buffer.subarray(length + 4);
      const parsed = JSON.parse(payload.toString('utf8'));
      if (!plainObject(parsed)) throw new LocalBridgeError('NATIVE_MESSAGE_INVALID', 'Chrome sent an invalid native message.');
      this.#onMessage(parsed);
    }
  }
}

export function createDurableToolDispatcher(requestExtension) {
  if (typeof requestExtension !== 'function') throw new TypeError('requestExtension is required.');
  return async function dispatchDurableTool(call) {
    const listed = await requestExtension('tools.list', {});
    const matches = (Array.isArray(listed?.tools) ? listed.tools : []).filter((tool) => tool?.name === call.toolName
      || tool?._meta?.['toolbraid/originalName'] === call.toolName);
    if (matches.length !== 1) {
      throw new LocalBridgeError('DURABLE_TOOL_UNAVAILABLE', 'The durable tool name is unavailable or ambiguous on the currently bound page.');
    }
    if (matches[0]?._meta?.['toolbraid/fileInput'] === true) {
      throw new LocalBridgeError('DURABLE_FILE_TOOL_UNSUPPORTED', 'Single-use local file grants cannot be stored in a durable mission or schedule.');
    }
    const tool = matches[0];
    const classification = tool._meta?.['toolbraid/classification'];
    const readOnly = classification ? classification === 'read' : tool.annotations?.readOnlyHint === true;
    if ((call.kind ?? call.lane ?? 'mutation') !== 'mutation' && !readOnly) {
      throw new LocalBridgeError('DURABLE_KIND_MISMATCH', 'A mutating tool cannot use a retryable read or idempotent lane.');
    }
    const response = await requestExtension('tools.call', { name: tool.name, arguments: call.arguments });
    if (response?.ok === false || response?.isError === true) {
      throw new LocalBridgeError('DURABLE_TOOL_REJECTED', 'The tool rejected the durable request.');
    }
    const result = response?.result ?? response;
    if (!readOnly && result?.verification?.status !== 'verified-success') {
      throw new LocalBridgeError('DURABLE_OUTCOME_UNVERIFIED', 'The mutation has no verified completion receipt; dependent steps are stopped and the call will not be retried.');
    }
    return Object.freeze({ completed: true, toolName: call.toolName, verification: readOnly ? 'read-completed' : 'verified-success' });
  };
}

export async function runNativeHost({
  args = process.argv.slice(2),
  fileGrants = createFileGrantMethods(new FileGrantStore()),
  scopedFilesystem = new ScopedFilesystem(),
  windowsUia = createWindowsUiaBroker(),
  durableControl = null,
  mediaControl = null,
  workflowControl = null,
} = {}) {
  const configPath = configPathFromArgs(args);
  const config = await loadBridgeConfig(configPath);
  if (!config.allowedOrigins.includes(callerOrigin(args))) {
    throw new LocalBridgeError('NATIVE_ORIGIN_REJECTED', 'The calling extension origin is not allowed.');
  }

  const clients = new Set();
  const pending = new Map();
  let extensionReady = false;
  const handleLocalFileGrant = createLocalFileGrantRequestHandler(fileGrants);
  const fileUploadBroker = createNativeFileUploadBroker(fileGrants);

  function requestExtension(method, params = {}) {
    if (!extensionReady) return Promise.reject(new LocalBridgeError('EXTENSION_UNAVAILABLE', 'ToolBraid is not connected in Chrome.'));
    const nativeRequestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const request = pending.get(nativeRequestId);
        if (!request) return;
        pending.delete(nativeRequestId);
        reject(new LocalBridgeError('EXTENSION_REQUEST_TIMEOUT', 'The Chrome extension did not complete the durable request before its deadline.'));
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
      pending.set(nativeRequestId, { internal: true, method, resolve, reject, timer });
      try {
        nativeFrame({ protocol: NATIVE_PROTOCOL, version: NATIVE_VERSION, kind: 'request', requestId: nativeRequestId, method, params });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(nativeRequestId);
        reject(error);
      }
    });
  }

  const localStateStore = new AtomicJsonStore({ filePath: path.join(path.dirname(configPath), 'durable-state.json') });
  const durable = durableControl ?? createDurableControl({
    store: localStateStore,
    dispatch: createDurableToolDispatcher(requestExtension),
  });
  const media = mediaControl ?? createMediaControl({ fileGrants, outputRoot: path.join(path.dirname(configPath), 'media-output') });
  const workflow = workflowControl ?? createWorkflowControl({ store: localStateStore });
  let assistantClosing = false;
  const assistant = createAssistant({
    store: new AtomicJsonStore({ filePath: path.join(path.dirname(configPath), 'assistant-state.json') }),
    cwd: path.join(path.dirname(configPath), 'chat-workspace'),
    requestExtension,
    emit: (event) => { if (!assistantClosing) nativeFrame({ protocol: NATIVE_PROTOCOL, version: NATIVE_VERSION, kind: 'assistant-event', event }); },
  });
  assistant.ready.catch(() => {});
  const workflowOwnerId = createHash('sha256').update(`toolbraid.workflow-owner\0${config.token}`).digest('hex');

  function sendClient(socket, message) {
    if (!socket.destroyed) writeJsonLine(socket, message);
  }

  function broadcast(message) {
    for (const client of clients) if (client.authenticated) sendClient(client.socket, message);
  }

  function closeClient(client) {
    clients.delete(client);
    for (const [requestId, request] of pending) {
      if (request.client === client) {
        clearTimeout(request.timer);
        pending.delete(requestId);
      }
    }
    try { client.socket.destroy(); } catch { /* already closed */ }
  }

  function forwardToExtension(client, message) {
    Promise.resolve().then(async () => {
      const params = await fileUploadBroker.prepare(client, message.method, message.params ?? {});
      const nativeRequestId = randomUUID();
      const timer = setTimeout(() => {
        const request = pending.get(nativeRequestId);
        if (!request) return;
        pending.delete(nativeRequestId);
        sendClient(request.client.socket, {
          protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION, kind: 'response', requestId: request.clientRequestId,
          ok: false, error: { code: 'EXTENSION_REQUEST_TIMEOUT', message: 'The Chrome extension did not complete the local request before its deadline.' },
        });
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
      pending.set(nativeRequestId, { client, clientRequestId: message.requestId, method: message.method, timer });
      try {
        nativeFrame({ protocol: NATIVE_PROTOCOL, version: NATIVE_VERSION, kind: 'request', requestId: nativeRequestId, method: message.method, params });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(nativeRequestId);
        throw error;
      }
    }).catch((error) => sendClient(client.socket, {
      protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION, kind: 'response', requestId: message.requestId,
      ok: false, error: safeError(error),
    }));
  }

  function onClientMessage(client, message) {
    if (!client.authenticated) {
      if (message.kind !== 'auth' || message.protocol !== BRIDGE_PROTOCOL
        || message.version !== BRIDGE_PROTOCOL_VERSION || message.token !== config.token) {
        sendClient(client.socket, { protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION, kind: 'auth', ok: false });
        closeClient(client);
        return;
      }
      client.authenticated = true;
      sendClient(client.socket, {
        protocol: BRIDGE_PROTOCOL,
        version: BRIDGE_PROTOCOL_VERSION,
        kind: 'auth',
        ok: true,
        extensionReady,
      });
      return;
    }
    if (message.kind !== 'request'
      || typeof message.requestId !== 'string' || !SAFE_ID.test(message.requestId)
      || !SAFE_METHODS.has(message.method)
      || !plainObject(message.params ?? {})
      || messageByteLength(message) > MAX_BRIDGE_MESSAGE_BYTES) {
      sendClient(client.socket, {
        protocol: BRIDGE_PROTOCOL,
        version: BRIDGE_PROTOCOL_VERSION,
        kind: 'response',
        requestId: typeof message.requestId === 'string' ? message.requestId.slice(0, 128) : 'invalid',
        ok: false,
        error: { code: 'BRIDGE_REQUEST_INVALID', message: 'The local bridge request is invalid.' },
      });
      return;
    }
    if (LOCAL_FILE_METHODS.has(message.method)) {
      Promise.resolve().then(() => message.method.startsWith('files.grant.') ? handleLocalFileGrant(client.ownerId, message.method, message.params ?? {}) : scopedFilesystem.call(message.method,message.params??{},client.ownerId)).then(
        (result) => sendClient(client.socket, {
          protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION, kind: 'response', requestId: message.requestId, ok: true, result,
        }),
        (error) => sendClient(client.socket, {
          protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION, kind: 'response', requestId: message.requestId, ok: false, error: safeError(error),
        }),
      );
      return;
    }
    if (LOCAL_UIA_METHODS.has(message.method)) {
      Promise.resolve().then(() => windowsUia.call(message.method.slice(4), message.params ?? {}, client.ownerId)).then(
        (result) => sendClient(client.socket, {
          protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION, kind: 'response', requestId: message.requestId, ok: true, result,
        }),
        (error) => sendClient(client.socket, {
          protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION, kind: 'response', requestId: message.requestId, ok: false, error: safeError(error),
        }),
      );
      return;
    }
    if (LOCAL_DURABLE_METHODS.has(message.method)) {
      const [group, operation] = message.method.slice('durable.'.length).split('.');
      Promise.resolve().then(() => {
        if (!extensionReady && (message.method === 'durable.mission.run' || message.method === 'durable.schedule.tick')) {
          throw new LocalBridgeError('EXTENSION_UNAVAILABLE', 'ToolBraid is not connected in Chrome.');
        }
        if (group === 'mission') return durable.mission[operation](message.params ?? {});
        if (operation === 'pause' || operation === 'resume' || operation === 'delete') return durable.schedule[operation](message.params?.id);
        return durable.schedule[operation](message.params ?? {});
      }).then(
        (result) => sendClient(client.socket, {
          protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION, kind: 'response', requestId: message.requestId, ok: true, result,
        }),
        (error) => sendClient(client.socket, {
          protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION, kind: 'response', requestId: message.requestId, ok: false, error: safeError(error),
        }),
      );
      return;
    }
    if (LOCAL_MEDIA_METHODS.has(message.method)) {
      const operation = message.method.slice('media.job.'.length);
      Promise.resolve().then(() => media[operation](message.params ?? {}, client.ownerId)).then(
        (result) => sendClient(client.socket, {
          protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION, kind: 'response', requestId: message.requestId, ok: true, result,
        }),
        (error) => sendClient(client.socket, {
          protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION, kind: 'response', requestId: message.requestId, ok: false, error: safeError(error),
        }),
      );
      return;
    }
    if (LOCAL_WORKFLOW_METHODS.has(message.method)) {
      Promise.resolve().then(() => workflow.call(message.method, message.params ?? {}, workflowOwnerId)).then(
        (result) => sendClient(client.socket, {
          protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION, kind: 'response', requestId: message.requestId, ok: true, result,
        }),
        (error) => sendClient(client.socket, {
          protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION, kind: 'response', requestId: message.requestId, ok: false, error: safeError(error),
        }),
      );
      return;
    }
    if (!extensionReady) {
      sendClient(client.socket, {
        protocol: BRIDGE_PROTOCOL,
        version: BRIDGE_PROTOCOL_VERSION,
        kind: 'response',
        requestId: message.requestId,
        ok: false,
        error: { code: 'EXTENSION_UNAVAILABLE', message: 'ToolBraid is not connected in Chrome.' },
      });
      return;
    }
    forwardToExtension(client, message);
  }

  const server = net.createServer((socket) => {
    const client = { socket, authenticated: false, ownerId: randomUUID() };
    clients.add(client);
    const decoder = new JsonLineDecoder({
      onMessage: (message) => onClientMessage(client, message),
      onError: () => closeClient(client),
    });
    socket.on('data', (chunk) => decoder.push(chunk));
    socket.on('error', () => closeClient(client));
    socket.on('close', () => closeClient(client));
  });

  if (process.platform !== 'win32') await rm(config.pipe, { force: true }).catch(() => undefined);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.pipe, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const decoder = new NativeDecoder((message) => {
    if (message.protocol !== NATIVE_PROTOCOL || message.version !== NATIVE_VERSION) return;
    if (message.kind === 'assistant-request' && typeof message.requestId === 'string' && SAFE_ID.test(message.requestId)) {
      Promise.resolve(assistant.handle(message.method, message.params)).then(
        (result) => nativeFrame({ protocol: NATIVE_PROTOCOL, version: NATIVE_VERSION, kind: 'assistant-response', requestId: message.requestId, ok: true, result }),
        (error) => nativeFrame({ protocol: NATIVE_PROTOCOL, version: NATIVE_VERSION, kind: 'assistant-response', requestId: message.requestId, ok: false, error: safeError(error, 'ASSISTANT_FAILED', 'The assistant request failed.') }),
      ).catch(() => {});
      return;
    }
    if (message.kind === 'event') {
      if (message.event === 'extension_ready') {
        extensionReady = true;
        for (const client of clients) fileUploadBroker.clear(client);
        broadcast({ protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION, kind: 'event', event: 'extension_ready' });
        void durable.schedule.start().catch(() => undefined);
      } else if (message.event === 'tools_changed') {
        for (const client of clients) fileUploadBroker.clear(client);
        broadcast({ protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION, kind: 'event', event: 'tools_changed' });
      }
      return;
    }
    if (message.kind !== 'response' || typeof message.requestId !== 'string') return;
    const request = pending.get(message.requestId);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.requestId);
    if (request.internal === true) {
      if (message.ok === true) request.resolve(message.result);
      else {
        const error = safeError(message.error, 'EXTENSION_REJECTED', 'ToolBraid rejected the durable request.');
        request.reject(new LocalBridgeError(error.code, error.message));
      }
      return;
    }
    if (request.method === 'tools.list' && message.ok === true) fileUploadBroker.rememberTools(request.client, message.result);
    let result = message.result;
    if (request.method === 'tools.call' && result?._toolbraidDownloadPath) {
      Promise.resolve(fileGrants.createFromPath(result._toolbraidDownloadPath, request.client.ownerId)).then((grant) => sendClient(request.client.socket,{protocol:BRIDGE_PROTOCOL,version:BRIDGE_PROTOCOL_VERSION,kind:'response',requestId:request.clientRequestId,ok:true,result:grant}),(error)=>sendClient(request.client.socket,{protocol:BRIDGE_PROTOCOL,version:BRIDGE_PROTOCOL_VERSION,kind:'response',requestId:request.clientRequestId,ok:false,error:safeError(error)}));
      return;
    }
    sendClient(request.client.socket, {
      protocol: BRIDGE_PROTOCOL,
      version: BRIDGE_PROTOCOL_VERSION,
      kind: 'response',
      requestId: request.clientRequestId,
      ok: message.ok === true,
      ...(message.ok === true ? { result } : { error: safeError(message.error, 'EXTENSION_REJECTED', 'ToolBraid rejected the request.') }),
    });
  });

  process.stdin.on('data', (chunk) => {
    try { decoder.push(chunk); } catch { process.exitCode = 1; process.stdin.destroy(); }
  });
  process.stdin.on('end', () => {
    assistantClosing = true;
    extensionReady = false;
    assistant.stop();
    for (const [id, request] of pending) {
      if (request.internal) { clearTimeout(request.timer); pending.delete(id); request.reject(new LocalBridgeError('EXTENSION_DISCONNECTED', 'The browser disconnected.')); }
    }
    for (const client of clients) closeClient(client);
    server.close();
  });
  process.stdin.resume();

  nativeFrame({
    protocol: NATIVE_PROTOCOL,
    version: NATIVE_VERSION,
    kind: 'event',
    event: 'host_ready',
  });
  return Object.freeze({ server, config });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runNativeHost().catch((error) => {
    process.stderr.write(`${safeError(error).code}: ${safeError(error).message}\n`);
    process.exitCode = 1;
  });
}
