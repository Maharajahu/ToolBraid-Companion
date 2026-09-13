import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import {
  BRIDGE_PROTOCOL,
  BRIDGE_PROTOCOL_VERSION,
  JsonLineDecoder,
  LocalBridgeError,
  configPathFromArgs,
  loadBridgeConfig,
  plainObject,
  safeError,
  writeJsonLine,
} from './common.mjs';

const SERVER_NAME = 'toolbraid';
const SERVER_VERSION = '0.1.0';
const SUPPORTED_PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);
const DEFAULT_PROTOCOL = '2025-11-25';
const MAX_MCP_LINE_BYTES = 2 * 1024 * 1024;
const SAFE_TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const STATIC_TOOL_COUNT = 36;
const MAX_DYNAMIC_TOOLS = 64;
const MAX_LISTED_TOOLS = STATIC_TOOL_COUNT + MAX_DYNAMIC_TOOLS;

function statusTool() {
  return Object.freeze({
    name: 'toolbraid_status',
    title: 'ToolBraid bridge status',
    description: 'Read the secure local ToolBraid bridge status and the currently bound Chrome page. This never changes browser or external state.',
    inputSchema: Object.freeze({ type: 'object', additionalProperties: false }),
    annotations: Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }),
  });
}

function fileGrantTools() {
  return [
    Object.freeze({
      name: 'toolbraid_file_grant_create',
      title: 'Select a local file',
      description: 'Open the local Windows file picker and create a short-lived, single-use opaque file grant. File paths and bytes are never returned.',
      inputSchema: Object.freeze({ type: 'object', additionalProperties: false }),
      annotations: Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }),
    }),
    Object.freeze({
      name: 'toolbraid_file_grant_revoke',
      title: 'Revoke a local file grant',
      description: 'Revoke an opaque local file grant before it is consumed.',
      inputSchema: Object.freeze({
        type: 'object', additionalProperties: false, required: ['grantId'],
        properties: Object.freeze({ grantId: Object.freeze({ type: 'string', pattern: '^[a-f0-9]{64}$' }) }),
      }),
      annotations: Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }),
    }),
  ];
}

const OPAQUE_ID = Object.freeze({ type: 'string', pattern: '^[a-f0-9]{64}$' });
function scopedFilesystemTools() {
  const tool = (name, title, description, properties = {}, required = [], annotations = {}) => Object.freeze({
    name, title, description,
    inputSchema: Object.freeze({ type: 'object', properties: Object.freeze(properties), required: Object.freeze(required), additionalProperties: false }),
    annotations: Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, ...annotations }),
  });
  return [
    tool('toolbraid_files_root_create','Grant filesystem root','Open the owner folder picker and create a time-limited opaque root grant.'),
    tool('toolbraid_files_root_revoke','Revoke filesystem root','Revoke one opaque root grant.',{rootId:OPAQUE_ID},['rootId'],{idempotentHint:true}),
    tool('toolbraid_files_list','List scoped files','List bounded files below an explicitly granted root; local paths are never returned.',{rootId:OPAQUE_ID,relativePath:{type:'string',maxLength:2048},depth:{type:'integer',minimum:1,maximum:3},count:{type:'integer',minimum:1,maximum:100}},['rootId'],{readOnlyHint:true,idempotentHint:true}),
    tool('toolbraid_files_read','Read scoped file chunk','Read a pathless file up to 1 MiB in transport-safe chunks of at most 256 KiB.',{handle:OPAQUE_ID,offset:{type:'integer',minimum:0,maximum:1048576},maxBytes:{type:'integer',minimum:1,maximum:262144}},['handle'],{readOnlyHint:true,idempotentHint:true}),
    tool('toolbraid_files_write','Write new scoped file','Atomically create a new file of at most 512 KiB below a granted root. Existing destinations are never overwritten.',{rootId:OPAQUE_ID,relativePath:{type:'string',minLength:1,maxLength:2048},content:{type:'string',maxLength:699052},encoding:{type:'string',enum:['utf8','base64']},overwrite:{type:'boolean'}},['rootId','relativePath','content']),
    tool('toolbraid_files_move','Move scoped file','Move an opaque file within its granted root without overwriting.',{handle:OPAQUE_ID,destinationRelative:{type:'string',minLength:1,maxLength:2048},overwrite:{type:'boolean'}},['handle','destinationRelative']),
    tool('toolbraid_files_archive','Archive scoped file','Move an opaque file into the root local archive without exposing its path.',{handle:OPAQUE_ID},['handle']),
  ];
}

const SCOPED_METHODS = Object.freeze({
  toolbraid_files_root_create:'files.root.create',toolbraid_files_root_revoke:'files.root.revoke',toolbraid_files_list:'files.list',toolbraid_files_read:'files.read',toolbraid_files_write:'files.write',toolbraid_files_move:'files.move',toolbraid_files_archive:'files.archive',
});

function windowsUiaTools() {
  const handle = Object.freeze({ type: 'string', pattern: '^[a-f0-9]{48}$' });
  const tool = (name, title, description, properties = {}, required = [], annotations = {}) => Object.freeze({
    name, title, description,
    inputSchema: Object.freeze({ type: 'object', properties: Object.freeze(properties), required: Object.freeze(required), additionalProperties: false }),
    annotations: Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, ...annotations }),
  });
  return [
    tool('toolbraid_windows_list', 'List Windows applications', 'List visible enabled desktop windows through local Windows UI Automation and issue opaque handles.', {}, [], { readOnlyHint: true }),
    tool('toolbraid_windows_controls', 'List Windows controls', 'List bounded visible enabled controls for one exact opaque desktop-window handle.', { window: handle }, ['window'], { readOnlyHint: true }),
    tool('toolbraid_windows_invoke', 'Invoke Windows control', 'Invoke one exact revalidated Windows UI Automation control.', { control: handle }, ['control']),
    tool('toolbraid_windows_set_value', 'Set Windows control value', 'Set a bounded value on one exact revalidated non-sensitive Windows UI Automation control.', { control: handle, value: { type: 'string', maxLength: 4096 } }, ['control', 'value']),
  ];
}

const UIA_METHODS = Object.freeze({
  toolbraid_windows_list: 'uia.windows.list',
  toolbraid_windows_controls: 'uia.controls.list',
  toolbraid_windows_invoke: 'uia.control.invoke',
  toolbraid_windows_set_value: 'uia.control.set_value',
});

function durableControlTools() {
  const id = Object.freeze({ type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,128}$' });
  const exactCall = Object.freeze({
    type: 'object', additionalProperties: false, required: ['toolName', 'arguments'],
    properties: Object.freeze({ toolName: id, arguments: Object.freeze({ type: 'object' }) }),
  });
  const step = Object.freeze({
    type: 'object', additionalProperties: false, required: ['id', 'kind', 'input'],
    properties: Object.freeze({
      id, kind: Object.freeze({ type: 'string', enum: ['read', 'idempotent', 'mutation'] }),
      dependsOn: Object.freeze({ type: 'array', maxItems: 64, items: id }), input: exactCall,
      idempotencyKey: id,
    }),
  });
  const handleTool = (name, title, description, properties = {}, required = [], annotations = {}) => Object.freeze({
    name, title, description,
    inputSchema: Object.freeze({ type: 'object', properties: Object.freeze(properties), required: Object.freeze(required), additionalProperties: false }),
    annotations: Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, ...annotations }),
  });
  return [
    handleTool('toolbraid_mission_create', 'Create durable mission', 'Persist a bounded exact-tool DAG before any step is dispatched.', { missionId: id, plan: Object.freeze({ type: 'array', minItems: 1, maxItems: 64, items: step }) }, ['missionId', 'plan']),
    handleTool('toolbraid_mission_run', 'Run durable mission', 'Run or resume the local durable mission with before/after checkpoints.'),
    handleTool('toolbraid_mission_state', 'Read durable mission', 'Read bounded public durable mission state.', {}, [], { readOnlyHint: true, idempotentHint: true }),
    handleTool('toolbraid_mission_cancel', 'Cancel durable mission', 'Durably cancel the current mission before another step starts.', {}, [], { idempotentHint: true }),
    handleTool('toolbraid_mission_clear', 'Clear terminal mission', 'Clear a completed, failed, blocked, cancelled, or outcome-unknown mission.', {}, [], { destructiveHint: true, idempotentHint: true }),
    handleTool('toolbraid_schedule_add', 'Add local schedule', 'Add a bounded one-shot or recurring exact tool call to the durable local scheduler.', {
      id, type: Object.freeze({ type: 'string', enum: ['once', 'recurring'] }), at: Object.freeze({ type: 'number' }),
      intervalMs: Object.freeze({ type: 'integer', minimum: 1000, maximum: 2592000000 }),
      missedRunPolicy: Object.freeze({ type: 'string', enum: ['skip', 'run-once'] }),
      lane: Object.freeze({ type: 'string', enum: ['read', 'mutation'] }), payload: exactCall,
    }, ['id', 'type', 'lane', 'payload']),
    handleTool('toolbraid_schedule_list', 'List local schedules', 'List bounded durable schedules and their last/next run state.', {}, [], { readOnlyHint: true, idempotentHint: true }),
    handleTool('toolbraid_schedule_pause', 'Pause local schedule', 'Pause one exact local schedule.', { id }, ['id'], { idempotentHint: true }),
    handleTool('toolbraid_schedule_resume', 'Resume local schedule', 'Resume one exact local schedule.', { id }, ['id'], { idempotentHint: true }),
    handleTool('toolbraid_schedule_delete', 'Delete local schedule', 'Delete one exact local schedule.', { id }, ['id'], { destructiveHint: true, idempotentHint: true }),
    handleTool('toolbraid_schedule_tick', 'Run due local schedules', 'Run schedules that are due now through the serialized durable scheduler lane.'),
  ];
}

const DURABLE_METHODS = Object.freeze({
  toolbraid_mission_create: 'durable.mission.create', toolbraid_mission_run: 'durable.mission.run',
  toolbraid_mission_state: 'durable.mission.state', toolbraid_mission_cancel: 'durable.mission.cancel',
  toolbraid_mission_clear: 'durable.mission.clear', toolbraid_schedule_add: 'durable.schedule.add',
  toolbraid_schedule_list: 'durable.schedule.list', toolbraid_schedule_pause: 'durable.schedule.pause',
  toolbraid_schedule_resume: 'durable.schedule.resume', toolbraid_schedule_delete: 'durable.schedule.delete',
  toolbraid_schedule_tick: 'durable.schedule.tick',
});

function mediaJobTools() {
  const grantId = Object.freeze({ type: 'string', pattern: '^[a-f0-9]{64}$' });
  const jobId = Object.freeze({ type: 'string', pattern: '^media-[a-f0-9]{32}$' });
  return [
    Object.freeze({
      name: 'toolbraid_media_create', title: 'Create local media job',
      description: 'Start one bounded allowlisted local FFmpeg job. Input grants are consumed once; output is returned only as a new opaque file grant.',
      inputSchema: Object.freeze({
        type: 'object', additionalProperties: false, required: ['operation', 'inputGrantIds', 'expectedOutput'],
        properties: Object.freeze({
          operation: Object.freeze({ type: 'string', enum: ['trim', 'concat', 'transcode', 'burn-subtitles', 'thumbnail'] }),
          inputGrantIds: Object.freeze({ type: 'array', minItems: 1, maxItems: 32, uniqueItems: true, items: grantId }),
          expectedOutput: Object.freeze({
            type: 'object', additionalProperties: false, required: ['maxBytes'],
            properties: Object.freeze({
              maxBytes: Object.freeze({ type: 'number', minimum: 1, maximum: 21474836480 }),
              durationSeconds: Object.freeze({ type: 'number', minimum: 0, maximum: 21600 }),
              format: Object.freeze({ type: 'string', enum: ['mp4', 'mov', 'mkv', 'webm', 'png', 'jpg', 'jpeg', 'webp'] }),
            }),
          }),
          timeoutMs: Object.freeze({ type: 'number', minimum: 100, maximum: 1200000 }),
          startSeconds: Object.freeze({ type: 'number', minimum: 0, maximum: 21600 }),
          durationSeconds: Object.freeze({ type: 'number', exclusiveMinimum: 0, maximum: 21600 }),
          codec: Object.freeze({ type: 'string', enum: ['h264', 'h265', 'vp9', 'av1'] }),
          atSeconds: Object.freeze({ type: 'number', minimum: 0, maximum: 21600 }),
        }),
      }),
      annotations: Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }),
    }),
    Object.freeze({
      name: 'toolbraid_media_state', title: 'Read local media job', description: 'Read one owner-bound local media job state without exposing filesystem paths.',
      inputSchema: Object.freeze({ type: 'object', additionalProperties: false, required: ['jobId'], properties: Object.freeze({ jobId }) }),
      annotations: Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }),
    }),
    Object.freeze({
      name: 'toolbraid_media_cancel', title: 'Cancel local media job', description: 'Cancel one exact owner-bound local media job.',
      inputSchema: Object.freeze({ type: 'object', additionalProperties: false, required: ['jobId'], properties: Object.freeze({ jobId }) }),
      annotations: Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }),
    }),
  ];
}

const MEDIA_METHODS = Object.freeze({
  toolbraid_media_create: 'media.job.create', toolbraid_media_state: 'media.job.state', toolbraid_media_cancel: 'media.job.cancel',
});

function workflowTools() {
  const id = Object.freeze({ type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,128}$' });
  const fingerprint = Object.freeze({ type: 'string', pattern: '^[a-f0-9]{64}$' });
  const step = Object.freeze({
    type: 'object', additionalProperties: false, required: ['tool', 'role', 'name', 'parameters', 'preFingerprint', 'postFingerprint'],
    properties: Object.freeze({
      tool: Object.freeze({ type: 'string', minLength: 1, maxLength: 256 }), role: Object.freeze({ type: 'string', minLength: 1, maxLength: 128 }),
      name: Object.freeze({ type: 'string', minLength: 1, maxLength: 512 }), parameters: Object.freeze({ type: 'object' }),
      preFingerprint: fingerprint, postFingerprint: fingerprint,
    }),
  });
  const observation = Object.freeze({
    type: 'object', additionalProperties: false, required: ['tool', 'role', 'name', 'preFingerprint', 'postFingerprint'],
    properties: Object.freeze({
      tool: Object.freeze({ type: 'string', minLength: 1, maxLength: 256 }), role: Object.freeze({ type: 'string', minLength: 1, maxLength: 128 }),
      name: Object.freeze({ type: 'string', minLength: 1, maxLength: 512 }), preFingerprint: fingerprint, postFingerprint: fingerprint,
    }),
  });
  const tool = (name, title, description, properties = {}, required = [], annotations = {}) => Object.freeze({
    name, title, description,
    inputSchema: Object.freeze({ type: 'object', additionalProperties: false, properties: Object.freeze(properties), required: Object.freeze(required) }),
    annotations: Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, ...annotations }),
  });
  return [
    tool('toolbraid_workflow_demonstration_put', 'Store workflow demonstration', 'Persist bounded semantic demonstration steps; secret and volatile values become placeholders.', { demonstrationId: id, name: { type: 'string', maxLength: 256 }, steps: { type: 'array', minItems: 1, maxItems: 128, items: step } }, ['steps']),
    tool('toolbraid_workflow_demonstration_list', 'List workflow demonstrations', 'List stored local demonstration metadata.', {}, [], { readOnlyHint: true, idempotentHint: true }),
    tool('toolbraid_workflow_demonstration_forget', 'Forget workflow demonstration', 'Forget one local workflow demonstration.', { demonstrationId: id }, ['demonstrationId'], { destructiveHint: true, idempotentHint: true }),
    tool('toolbraid_workflow_adapter_draft', 'Draft learned workflow adapter', 'Create a disabled versioned declarative adapter from one stored demonstration.', { adapterId: id, demonstrationId: id, name: { type: 'string', maxLength: 256 } }, ['demonstrationId']),
    tool('toolbraid_workflow_adapter_version', 'Read workflow adapter', 'Read one local adapter version and its semantic steps.', { adapterId: id }, ['adapterId'], { readOnlyHint: true, idempotentHint: true }),
    tool('toolbraid_workflow_adapter_enable', 'Enable workflow adapter', 'Mark one exact local adapter version enabled; this does not execute it.', { adapterId: id }, ['adapterId'], { idempotentHint: true }),
    tool('toolbraid_workflow_adapter_disable', 'Disable workflow adapter', 'Disable one exact local adapter version.', { adapterId: id }, ['adapterId'], { idempotentHint: true }),
    tool('toolbraid_workflow_shadow_replay', 'Shadow replay workflow', 'Compare live semantic observations with a learned adapter without executing or mutating anything.', { adapterId: id, observations: { type: 'array', minItems: 1, maxItems: 128, items: observation } }, ['adapterId', 'observations'], { readOnlyHint: true, idempotentHint: true }),
  ];
}

const WORKFLOW_METHODS = Object.freeze({
  toolbraid_workflow_demonstration_put: 'workflow.demonstrations.put', toolbraid_workflow_demonstration_list: 'workflow.demonstrations.list',
  toolbraid_workflow_demonstration_forget: 'workflow.demonstrations.forget', toolbraid_workflow_adapter_draft: 'workflow.adapter.draft',
  toolbraid_workflow_adapter_version: 'workflow.adapter.version', toolbraid_workflow_adapter_enable: 'workflow.adapter.enable',
  toolbraid_workflow_adapter_disable: 'workflow.adapter.disable', toolbraid_workflow_shadow_replay: 'workflow.adapter.shadow_replay',
});

function validTool(tool) {
  return plainObject(tool)
    && typeof tool.name === 'string' && SAFE_TOOL_NAME.test(tool.name)
    && typeof tool.description === 'string' && tool.description.length <= 1_200
    && plainObject(tool.inputSchema) && tool.inputSchema.type === 'object';
}

function resultContent(value, isError = false) {
  const structuredContent = plainObject(value) ? value : { result: value ?? null };
  let text;
  try { text = JSON.stringify(structuredContent); } catch { text = '{"error":"Result could not be serialized."}'; }
  if (Buffer.byteLength(text, 'utf8') > 512 * 1024) {
    text = JSON.stringify({ error: 'ToolBraid result exceeded the MCP response limit.' });
    return { content: [{ type: 'text', text }], structuredContent: JSON.parse(text), isError: true };
  }
  return { content: [{ type: 'text', text }], structuredContent, isError };
}

export class BridgeClient {
  #config;
  #configPath;
  #socket = null;
  #decoder = null;
  #authenticated = false;
  #connecting = null;
  #pending = new Map();
  #listeners = new Set();
  #timeoutMs;

  constructor(config, { timeoutMs = 30_000, configPath = null } = {}) {
    this.#config = config;
    this.#configPath = configPath;
    this.#timeoutMs = timeoutMs;
  }

  onEvent(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #close(error = new LocalBridgeError('BRIDGE_DISCONNECTED', 'The ToolBraid native bridge disconnected.'), socket = this.#socket) {
    if (socket !== this.#socket) return;
    this.#socket = null;
    this.#decoder = null;
    this.#authenticated = false;
    this.#connecting = null;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    try { socket?.destroy(); } catch { /* already closed */ }
  }

  #onMessage(message, authResolve, authReject) {
    if (message.protocol !== BRIDGE_PROTOCOL || message.version !== BRIDGE_PROTOCOL_VERSION) return;
    if (!this.#authenticated && message.kind === 'auth') {
      if (message.ok === true) {
        this.#authenticated = true;
        authResolve();
      } else authReject(new LocalBridgeError('BRIDGE_AUTH_REJECTED', 'The ToolBraid native bridge rejected authentication.'));
      return;
    }
    if (message.kind === 'event') {
      for (const listener of this.#listeners) listener(message.event);
      return;
    }
    if (message.kind !== 'response' || typeof message.requestId !== 'string') return;
    const pending = this.#pending.get(message.requestId);
    if (!pending) return;
    this.#pending.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.ok === true) pending.resolve(message.result);
    else {
      const error = safeError(message.error, 'BRIDGE_REQUEST_FAILED', 'The ToolBraid bridge request failed.');
      pending.reject(new LocalBridgeError(error.code, error.message));
    }
  }

  async connect() {
    if (this.#socket && this.#authenticated) return;
    if (this.#connecting) return this.#connecting;
    const connecting = Promise.resolve().then(async () => {
      const config = this.#configPath ? await loadBridgeConfig(this.#configPath) : this.#config;
      if (this.#connecting !== connecting) throw new LocalBridgeError('BRIDGE_DISCONNECTED', 'The ToolBraid native bridge connection was closed.');
      this.#config = config;
      return new Promise((resolve, reject) => {
        const socket = net.createConnection(config.pipe);
        this.#socket = socket;
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          callback(value);
        };
        const timer = setTimeout(() => {
          finish(reject, new LocalBridgeError('BRIDGE_CONNECT_TIMEOUT', 'Timed out connecting to the ToolBraid native bridge.'));
          this.#close(undefined, socket);
        }, Math.min(this.#timeoutMs, 5_000));
        const authResolve = () => {
          clearTimeout(timer);
          finish(resolve);
        };
        const authReject = (error) => {
          clearTimeout(timer);
          finish(reject, error);
          this.#close(error, socket);
        };
        this.#decoder = new JsonLineDecoder({
          onMessage: (message) => this.#onMessage(message, authResolve, authReject),
          onError: authReject,
        });
        socket.on('connect', () => writeJsonLine(socket, {
          protocol: BRIDGE_PROTOCOL,
          version: BRIDGE_PROTOCOL_VERSION,
          kind: 'auth',
          token: config.token,
        }));
        socket.on('data', (chunk) => {
          if (socket === this.#socket) this.#decoder?.push(chunk);
        });
        socket.on('error', authReject);
        socket.on('close', () => authReject(new LocalBridgeError('BRIDGE_DISCONNECTED', 'The ToolBraid native bridge disconnected.')));
      });
    }).finally(() => {
      if (this.#connecting === connecting) this.#connecting = null;
    });
    this.#connecting = connecting;
    return connecting;
  }

  async request(method, params = {}) {
    await this.connect();
    if (!this.#socket || !this.#authenticated) throw new LocalBridgeError('BRIDGE_DISCONNECTED', 'The ToolBraid native bridge is unavailable.');
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new LocalBridgeError('BRIDGE_REQUEST_TIMEOUT', 'The ToolBraid bridge request timed out.'));
      }, this.#timeoutMs);
      this.#pending.set(requestId, { resolve, reject, timer });
      try {
        writeJsonLine(this.#socket, {
          protocol: BRIDGE_PROTOCOL,
          version: BRIDGE_PROTOCOL_VERSION,
          kind: 'request',
          requestId,
          method,
          params,
        });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(requestId);
        reject(error);
      }
    });
  }

  close() {
    this.#close();
  }
}

export class ToolBraidMcpServer {
  #bridge;
  #output;
  #initialized = false;
  #listedTools = new Map();
  #unsubscribe;

  constructor({ bridge, output = process.stdout } = {}) {
    if (!bridge || typeof bridge.request !== 'function') throw new TypeError('bridge is required.');
    this.#bridge = bridge;
    this.#output = output;
    this.#unsubscribe = bridge.onEvent?.((event) => {
      if (event !== 'tools_changed' && event !== 'extension_ready') return;
      // Page notifications do not revoke a previously listed capability. The
      // extension revalidates its exact page and descriptor before dispatch.
      if (event === 'extension_ready') this.#listedTools.clear();
      if (this.#initialized) this.#send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    });
  }

  #send(message) {
    writeJsonLine(this.#output, message);
  }

  async #listTools() {
    const tools = [statusTool(), ...fileGrantTools(), ...scopedFilesystemTools(), ...windowsUiaTools(), ...durableControlTools(), ...mediaJobTools(), ...workflowTools()];
    const listedNames = new Set(tools.map((tool) => tool.name));
    try {
      const result = await this.#bridge.request('tools.list', {});
      for (const tool of Array.isArray(result?.tools) ? result.tools : []) {
        if (tools.length >= MAX_LISTED_TOOLS) break;
        if (!validTool(tool) || listedNames.has(tool.name)) continue;
        tools.push(tool);
        listedNames.add(tool.name);
      }
    } catch { /* status remains callable while Chrome is disconnected */ }
    this.#listedTools = new Map(tools.map((tool) => [tool.name, tool]));
    return tools;
  }

  async #callTool(params) {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (typeof name !== 'string' || !plainObject(args)) {
      return resultContent({ code: 'MCP_TOOL_CALL_INVALID', message: 'A tool name and object arguments are required.' }, true);
    }
    if (name === 'toolbraid_status') {
      try {
        return resultContent(await this.#bridge.request('bridge.status', {}));
      } catch (error) {
        return resultContent({ connected: false, error: safeError(error) });
      }
    }
    if (name === 'toolbraid_file_grant_create' || name === 'toolbraid_file_grant_revoke') {
      try {
        const method = name === 'toolbraid_file_grant_create' ? 'files.grant.create' : 'files.grant.revoke';
        return resultContent(await this.#bridge.request(method, args));
      } catch (error) {
        return resultContent(safeError(error), true);
      }
    }
    if (SCOPED_METHODS[name]) {
      try { return resultContent(await this.#bridge.request(SCOPED_METHODS[name], args)); }
      catch (error) { return resultContent(safeError(error), true); }
    }
    if (UIA_METHODS[name]) {
      try { return resultContent(await this.#bridge.request(UIA_METHODS[name], args)); }
      catch (error) { return resultContent(safeError(error), true); }
    }
    if (DURABLE_METHODS[name]) {
      try { return resultContent(await this.#bridge.request(DURABLE_METHODS[name], args)); }
      catch (error) { return resultContent(safeError(error), true); }
    }
    if (MEDIA_METHODS[name]) {
      try { return resultContent(await this.#bridge.request(MEDIA_METHODS[name], args)); }
      catch (error) { return resultContent(safeError(error), true); }
    }
    if (WORKFLOW_METHODS[name]) {
      try { return resultContent(await this.#bridge.request(WORKFLOW_METHODS[name], args)); }
      catch (error) { return resultContent(safeError(error), true); }
    }
    // Clients may retain their catalog across a native reconnect. Refresh once,
    // resolving only the exact live name; never remap or replay a page action.
    if (!this.#listedTools.has(name)) await this.#listTools();
    if (!this.#listedTools.has(name)) {
      return resultContent({ code: 'MCP_TOOL_NOT_LISTED', message: 'Refresh the ToolBraid tool list before calling this page tool.' }, true);
    }
    try {
      return resultContent(await this.#bridge.request('tools.call', { name, arguments: args }));
    } catch (error) {
      return resultContent(safeError(error), true);
    }
  }

  async handle(message) {
    if (!plainObject(message) || message.jsonrpc !== '2.0') {
      this.#send({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid Request' } });
      return;
    }
    if (message.method === 'notifications/initialized') {
      this.#initialized = true;
      return;
    }
    if (message.method === 'notifications/cancelled') return;
    if (!Object.prototype.hasOwnProperty.call(message, 'id')) return;
    try {
      if (message.method === 'initialize') {
        const requested = message.params?.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : DEFAULT_PROTOCOL;
        this.#send({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion,
            capabilities: { tools: { listChanged: true } },
            serverInfo: {
              name: SERVER_NAME,
              title: 'ToolBraid Chrome Bridge',
              version: SERVER_VERSION,
              description: 'Secure local access to the exact ToolBraid tools active in Chrome.',
            },
            instructions: 'Tools are bound to the exact active Chrome page. Read tools run directly; effectful tools request execution through the local owner policy and remain approval-required when that policy does not authorize them.',
          },
        });
        return;
      }
      if (!this.#initialized) {
        this.#send({ jsonrpc: '2.0', id: message.id, error: { code: -32002, message: 'Server not initialized' } });
        return;
      }
      if (message.method === 'ping') {
        this.#send({ jsonrpc: '2.0', id: message.id, result: {} });
        return;
      }
      if (message.method === 'tools/list') {
        this.#send({ jsonrpc: '2.0', id: message.id, result: { tools: await this.#listTools() } });
        return;
      }
      if (message.method === 'tools/call') {
        this.#send({ jsonrpc: '2.0', id: message.id, result: await this.#callTool(message.params) });
        return;
      }
      this.#send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
    } catch (error) {
      this.#send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: safeError(error).message } });
    }
  }

  close() {
    this.#unsubscribe?.();
    this.#bridge.close?.();
  }
}

export async function runMcpServer({ args = process.argv.slice(2), input = process.stdin, output = process.stdout } = {}) {
  const configPath = configPathFromArgs(args);
  const config = await loadBridgeConfig(configPath);
  const bridge = new BridgeClient(config, { configPath });
  const server = new ToolBraidMcpServer({ bridge, output });
  let bufferedBytes = 0;
  const decoder = new JsonLineDecoder({
    onMessage: (message) => { bufferedBytes = 0; void server.handle(message); },
    onError: () => {
      bufferedBytes = 0;
      writeJsonLine(output, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    },
  });
  input.on('data', (chunk) => {
    bufferedBytes += chunk.length;
    if (bufferedBytes > MAX_MCP_LINE_BYTES) {
      writeJsonLine(output, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      input.destroy();
      return;
    }
    decoder.push(chunk);
  });
  input.on('end', () => server.close());
  input.resume();
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runMcpServer().catch((error) => {
    const safe = safeError(error);
    process.stderr.write(`${safe.code}: ${safe.message}\n`);
    process.exitCode = 1;
  });
}
