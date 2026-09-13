import { spawn } from 'node:child_process';
import { mkdir, readdir, access } from 'node:fs/promises';
import path from 'node:path';

const error = (message) => new Error(message);
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
async function resolveExecutable(executable = 'codex') {
  if (executable !== 'codex' || process.platform !== 'win32') return executable;
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(directory, 'codex.exe');
    try { await access(candidate); return candidate; } catch { /* Try the desktop installation next. */ }
  }
  if (process.env.LOCALAPPDATA) {
    const root = path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    for (const entry of (await readdir(root, { withFileTypes: true }).catch(() => [])).reverse()) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(root, entry.name, 'codex.exe');
      try { await access(candidate); return candidate; } catch { /* Incomplete version directory. */ }
    }
  }
  return executable;
}
const dynamicTools = [
  { type: 'function', name: 'toolbraid_list_tools', description: 'List current tools and context for the browser page explicitly selected in ToolBraid. Refresh after navigation.', inputSchema: schema() },
  { type: 'function', name: 'toolbraid_call_tool', description: 'Call one exact currently listed ToolBraid tool. Mutations require separate confirmation in the ToolBraid panel.', inputSchema: schema({ name: { type: 'string' }, arguments: { type: 'object' } }, ['name', 'arguments']) },
];

export function createCodexConnection({ executable = 'codex', cwd, spawnImpl = spawn, onNotification = () => {}, onRequest = async () => { throw error('Unsupported request.'); } }) {
  if (executable !== 'codex' && (!path.isAbsolute(executable) || (process.platform === 'win32' && !executable.toLowerCase().endsWith('.exe')))) throw error('Select codex on PATH or an absolute Codex executable path.');
  const args = ['app-server', '--listen', 'stdio://'];
  for (const feature of ['shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'computer_use', 'browser_use', 'multi_agent', 'image_generation']) args.push('--disable', feature);
  args.push('-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0', '-c', 'forced_login_method="chatgpt"');
  const env = { ...process.env };
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL']) delete env[key];
  const child = spawnImpl(executable, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
  let sequence = 0;
  let buffer = '';
  let closed = false;
  const pending = new Map();
  const write = (message) => {
    if (closed) throw error('Codex App Server disconnected.');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  function failAll(message) {
    closed = true;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error(message)); }
    pending.clear();
    onNotification({ method: 'toolbraid/disconnected' });
  }
  child.on('error', () => failAll('Codex could not start. Install Codex, sign in with codex login, and check its executable path.'));
  child.on('exit', () => failAll('Codex App Server stopped. Reconnect before continuing.'));
  child.stdin.on('error', () => failAll('Codex input disconnected.'));
  child.stderr.resume(); // Never forward potentially private diagnostic logs to the browser.
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > 4 * 1024 * 1024) { close(); return; }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { close(); return; }
      if (message.method && message.id !== undefined) {
        Promise.resolve(onRequest(message)).then((result) => write({ id: message.id, result }), () => write({ id: message.id, error: { code: -32601, message: 'This action is not available in ToolBraid chat.' } })).catch(() => {});
      } else if (message.id !== undefined) {
        const entry = pending.get(message.id);
        if (!entry) continue;
        clearTimeout(entry.timer); pending.delete(message.id);
        if (message.error) {
          const failure = error(`Codex rejected ${entry.method}. Check sign-in, installed CLI compatibility and model access.`);
          failure.cause = message.error;
          entry.reject(failure);
        }
        else entry.resolve(message.result);
      } else onNotification(message);
    }
  });
  function request(method, params = {}) {
    if (closed) return Promise.reject(error('Codex App Server is not connected.'));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(error(`Codex ${method} timed out.`)); }, 10000);
      pending.set(id, { resolve, reject, timer, method });
      try { write({ id, method, params }); } catch (failure) { clearTimeout(timer); pending.delete(id); reject(failure); }
    });
  }
  function close() {
    if (closed) return;
    failAll('Codex connection closed.');
    child.stdin.end();
    const timer = setTimeout(() => { child.kill(); child.stdout.destroy(); child.stderr.destroy(); }, 2000);
    timer.unref();
    child.once('exit', () => clearTimeout(timer));
  }
  async function initialize() {
    await request('initialize', { clientInfo: { name: 'toolbraid', title: 'ToolBraid', version: '0.3.0' }, capabilities: { experimentalApi: true } });
    write({ method: 'initialized' });
  }
  return { request, initialize, close };
}

export async function probeCodex({ executable, cwd, connect = createCodexConnection }) {
  await mkdir(cwd, { recursive: true });
  const client = connect({ executable: await resolveExecutable(executable), cwd });
  try {
    await client.initialize();
    const account = await client.request('account/read', { refreshToken: false });
    if (account.account?.type !== 'chatgpt') throw error('Sign in to Codex with your ChatGPT account using codex login. API-key accounts are not accepted by ToolBraid chat.');
    const result = await client.request('model/list', { limit: 100 });
    return { authenticated: true, models: (result.data ?? []).map((model) => ({ id: model.model ?? model.id, name: model.displayName ?? model.model ?? model.id })).slice(0, 100) };
  } finally { client.close(); }
}

export async function startChatGptLogin({ executable, cwd, onComplete = () => {}, connect = createCodexConnection }) {
  await mkdir(cwd, { recursive: true });
  let timer;
  const client = connect({ executable: await resolveExecutable(executable), cwd, onNotification(message) {
    if (message.method !== 'account/login/completed') return;
    clearTimeout(timer);
    onComplete(message.params?.success === true);
    client.close();
  } });
  try {
    await client.initialize();
    const result = await client.request('account/login/start', { type: 'chatgpt' });
    const url = new URL(result.authUrl);
    if (url.origin !== 'https://auth.openai.com' || url.username || url.password) throw error('Codex returned an unexpected sign-in URL. Use codex login directly.');
    timer = setTimeout(() => { client.close(); onComplete(false); }, 300000);
    return { url: url.href, close() { clearTimeout(timer); client.close(); } };
  } catch (failure) { client.close(); throw failure; }
}

export async function runCodexChat({ executable, cwd, model, messages, instructions, signal, listTools, callTool, onDelta, onActivity, connect = createCodexConnection }) {
  await mkdir(cwd, { recursive: true });
  signal.throwIfAborted();
  let threadId;
  let turnId;
  let finished = false;
  let resolveTurn;
  let rejectTurn;
  let toolQueue = Promise.resolve();
  const completion = new Promise((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject; });
  // Notifications can arrive before the turn/start response.
  completion.catch(() => {});
  const client = connect({ executable: await resolveExecutable(executable), cwd,
    onNotification(message) {
      if (message.method === 'item/agentMessage/delta') {
        try { onDelta(String(message.params?.delta ?? '')); } catch (failure) { rejectTurn(failure); }
      }
      if (message.method === 'turn/completed') {
        finished = true;
        const turn = message.params?.turn;
        if (turn?.status === 'completed') resolveTurn();
        else rejectTurn(error(turn?.status === 'interrupted' ? 'Codex turn stopped.' : 'Codex turn failed. Check account limits and model availability.'));
      }
      if (message.method === 'toolbraid/disconnected' && !finished) rejectTurn(error('Codex disconnected before the turn completed.'));
    },
    async onRequest(message) {
      if (message.method === 'item/tool/call') {
        const work = toolQueue.then(async () => {
          signal.throwIfAborted();
          const request = message.params;
          if (request.threadId !== threadId) throw error('Tool call belongs to another thread.');
          try {
            const result = request.tool === 'toolbraid_list_tools' ? await listTools()
              : request.tool === 'toolbraid_call_tool' ? await callTool(request.arguments?.name, request.arguments?.arguments ?? {})
                : (() => { throw error('Unknown ToolBraid tool.'); })();
            return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(result).slice(0, 64000) }] };
          } catch (failure) { return { success: false, contentItems: [{ type: 'inputText', text: String(failure.message).slice(0, 500) }] }; }
        });
        toolQueue = work.catch(() => {});
        return work;
      }
      if (message.method.endsWith('/requestApproval')) {
        onActivity('Blocked an action outside the selected ToolBraid browser tools.');
        return message.method.includes('permissions') ? { permissions: {}, scope: 'turn' } : { decision: 'decline' };
      }
      if (message.method === 'item/tool/requestUserInput') return { answers: {} };
      throw error('Unsupported Codex server request.');
    },
  });
  const stop = () => {
    if (threadId && turnId) client.request('turn/interrupt', { threadId, turnId }).catch(() => {});
    rejectTurn(error('Stopped. Already dispatched browser actions cannot be undone.'));
    client.close();
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    await client.initialize();
    const account = await client.request('account/read', { refreshToken: false });
    if (account.account?.type !== 'chatgpt') throw error('ToolBraid chat requires ChatGPT sign-in in Codex. API-key accounts are not accepted.');
    const effective = await client.request('config/read', { includeLayers: false });
    // Disable configured MCP servers for this thread only; never edit the user's config.
    const config = { web_search: 'disabled', project_doc_max_bytes: 0 };
    for (const name of Object.keys(effective.config?.mcp_servers ?? {})) config[`mcp_servers.${name}.enabled`] = false;
    const thread = await client.request('thread/start', { model: model || null, modelProvider: 'openai', cwd, sandbox: 'read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user', ephemeral: true, baseInstructions: instructions, config, dynamicTools });
    threadId = thread.thread.id;
    signal.throwIfAborted();
    onActivity('Codex is working on the selected browser page.');
    const text = messages.map((message) => `${message.role === 'user' ? 'USER' : 'ASSISTANT'}: ${message.content}`).join('\n\n');
    const turn = await client.request('turn/start', { threadId, input: [{ type: 'text', text, text_elements: [] }] });
    turnId = turn.turn.id;
    await completion;
  } finally { signal.removeEventListener('abort', stop); client.close(); }
}
