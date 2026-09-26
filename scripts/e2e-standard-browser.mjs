import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { buildUniversalExtension } from './build-universal-extension.mjs';
import { startUniversalFixtureServer } from './serve-universal-fixtures.mjs';
import {
  resolvePlaywright, resolveChromePath, prepareLaunchBundle,
  waitForWorker, pageRuntimeState, openTrustedSidePanel, fixtureFormArguments,
} from './e2e-universal-extension.mjs';

const playwright = resolvePlaywright();
const executablePath = resolveChromePath(playwright);
const build = process.env.E2E_EXTENSION_DIR
  ? { loadUnpackedDirectory: path.resolve(process.env.E2E_EXTENSION_DIR) }
  : await buildUniversalExtension({ edition: 'public' });
const requireNativeWebMcp = process.env.TOOLBRAID_WEBMCP_NATIVE === '1';
const webmcpFlags = requireNativeWebMcp ? ['--enable-blink-features=WebMCP'] : [];
const manifest = JSON.parse(await readFile(path.join(build.loadUnpackedDirectory, 'manifest.json'), 'utf8'));
const fixture = await startUniversalFixtureServer({ port: 0 });
// Native permission dialogs are not actionable in headless Chromium. Only the
// fixture hosts are pregranted; public consent still uses real UI clicks.
const hostPregranted = process.env.TOOLBRAID_TEST_PREGRANT_HOST !== '0';
const bundle = await prepareLaunchBundle({ sourceExtensionDir: build.loadUnpackedDirectory, sourceManifest: manifest, fixtureOrigin: fixture.origin, hostOrigins: hostPregranted ? [fixture.origin, 'https://x.com'] : [] });
const profile = await mkdtemp(path.join(os.tmpdir(), 'toolbraid-standard-e2e-'));
const installRoot = path.join(profile, 'companion-install');
const companion = process.env.TOOLBRAID_COMPANION_DIR ?? fileURLToPath(new URL(`../dist/release-${manifest.version}/companion`, import.meta.url));
const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
function runPowerShell(args) {
  const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  return result.stdout.trim();
}
async function startMcpClient() {
  const config = JSON.parse(await readFile(path.join(installRoot, 'mcp-client.json'), 'utf8')).mcpServers.toolbraid;
  const child = spawn(config.command, config.args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let sequence = 0;
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    const response = JSON.parse(line);
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    clearTimeout(request.timer);
    if (response.error) request.reject(new Error(response.error.message));
    else request.resolve(response.result);
  });
  child.stderr.on('data', () => {});
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'ToolBraid-local-e2e', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  return {
    request,
    async close() {
      const exited = once(child, 'exit');
      child.stdin.end();
      await exited;
      lines.close();
    },
  };
}
const results = [];
let context;
let client;
let installed = false;
async function until(label, predicate, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function verifyLocalXControl({ context, page, panel, client }) {
  const html = await readFile(new URL('../fixtures/universal/x-direct-control.html', import.meta.url), 'utf8');
  const actions = [];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await context.route('https://x.com/**', async (route) => {
    if (route.request().method() === 'POST' && new URL(route.request().url()).pathname === '/api/toolbraid-fixture') {
      actions.push(route.request().postDataJSON());
      return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    }
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  const call = async (originalName, args = {}) => {
    const tool = await until(originalName, async () => (await client.request('tools/list')).tools.find((entry) => entry._meta?.['toolbraid/originalName'] === originalName));
    assert.equal(tool._meta['toolbraid/requiresApproval'], false);
    assert.equal(tool.annotations.readOnlyHint, false);
    const result = await client.request('tools/call', { name: tool.name, arguments: args });
    assert.equal(result.isError, false, `${originalName}: ${JSON.stringify(result)}`);
    assert.notEqual(result.structuredContent?.result?.status, 'approval-required');
    return result;
  };
  await page.goto('https://x.com/fixture/status/42');
  await page.bringToFront();
  await page.evaluate(() => { const account = document.createElement('button'); account.dataset.testid = 'SideNav_AccountSwitcher_Button'; account.textContent = '@fixture'; document.body.append(account); });
  await until('X direct action in real side panel', () => panel.evaluate(() => {
    const action = document.querySelector('[data-action-id="like_x_post"]');
    return action?.textContent.includes('X direct control · enabled') && action?.textContent.includes('Run X action');
  }));
  await panel.clickSelector('#community-inspect');
  await until('community inspection result', () => panel.evaluate(() => document.querySelector('#community-status')?.textContent.includes('visible or saved posts')));
  const communityState = await panel.evaluate(async () => chrome.runtime.sendMessage({ type: 'UI_COMMUNITY', operation: 'watch', payload: { interval: 15 } }));
  assert.equal(communityState.ok, true, JSON.stringify(communityState));
  assert.equal(communityState.result.account, '@fixture');
  assert.equal(communityState.result.enabled, true);
  await panel.evaluate(async () => chrome.runtime.sendMessage({ type: 'UI_COMMUNITY', operation: 'pause' }));
  if (process.env.TOOLBRAID_SCREENSHOT_DIR) {
    await until('side-panel navigation message settled', () => panel.evaluate(() => !document.querySelector('#toast')?.classList.contains('toast-visible')));
    await panel.captureScreenshot(path.join(process.env.TOOLBRAID_SCREENSHOT_DIR, 'toolbraid-x-direct-control.png'));
    if (process.env.TOOLBRAID_STORE_CAPTURE_DIR) await panel.captureScreenshot(path.join(process.env.TOOLBRAID_STORE_CAPTURE_DIR, 'x-control.png'), { fullPage: false, selector: '[data-action-id="like_x_post"]' });
  }
  await panel.clickSelector('article[data-action-id="like_x_post"] button[data-action="prepare-action"]');
  try {
    await until('one UI like', async () => actions.filter((entry) => entry.action === 'like').length === 1);
  } catch (error) {
    throw new Error(`${error.message}: ${JSON.stringify({ actions, pageErrors, url: page.url(), panel: await panel.evaluate(() => ({ toast: document.querySelector('#toast')?.textContent })) })}`);
  }
  await until('like state reflected in discovered tools', async () => !(await client.request('tools/list')).tools.some((tool) => tool._meta?.['toolbraid/originalName'] === 'like_x_post'));
  await call('open_x_repost_menu');
  await call('repost_x_post');
  await until('one repost', async () => actions.filter((entry) => entry.action === 'repost').length === 1);
  await until('repost state reflected in discovered tools', async () => !(await client.request('tools/list')).tools.some((tool) => tool._meta?.['toolbraid/originalName'] === 'repost_x_post'));
  await call('open_x_repost_menu');
  await call('open_x_quote_composer');
  await call('prepare_x_post', { text: 'Exact quote from the local test.' });
  await call('publish_x_post');
  await until('one quote', async () => actions.filter((entry) => entry.action === 'quote').length === 1);
  const quoteFingerprint = (await client.request('tools/call', { name: 'toolbraid_status', arguments: {} })).structuredContent.page?.pageFingerprint;
  await page.goto('https://x.com/compose/post');
  await until('standalone composer session', async () => {
    const state = (await client.request('tools/call', { name: 'toolbraid_status', arguments: {} })).structuredContent;
    return state.page?.url === 'https://x.com/compose/post' && state.page.pageFingerprint && state.page.pageFingerprint !== quoteFingerprint;
  });
  await call('prepare_x_post', { text: 'Exact standalone local post.' });
  await call('publish_x_post');
  await until('one post', async () => actions.filter((entry) => entry.action === 'post').length === 1);
  assert.deepEqual(actions, [
    { action: 'like', target: 'https://x.com/fixture/status/42' },
    { action: 'repost', target: 'https://x.com/fixture/status/42' },
    { action: 'quote', text: 'Exact quote from the local test.', target: 'https://x.com/fixture/status/42' },
    { action: 'post', text: 'Exact standalone local post.' },
  ]);
  return { pass: 'x-direct-control', offlineFixture: true, liveXRequests: 0, actions: ['like', 'repost', 'quote', 'post'], perActionApproval: false, exactTargetsAndText: true };
}
try {
  assert.equal(process.platform, 'win32', 'This test covers the Windows native companion.');
  const existing = runPowerShell(['-Command', `@('Google\\Chrome','Microsoft\\Edge') | ForEach-Object { Test-Path -LiteralPath "HKCU:\\Software\\$_\\NativeMessagingHosts\\com.toolbraid.bridge" }`]);
  assert.equal(existing.includes('True'), false, 'An existing public companion must not be replaced by the test.');
  runPowerShell(['-File', path.join(companion, 'scripts/install-mcp-bridge.ps1'), '-Edition', 'public', '-Client', 'None', '-InstallRoot', installRoot]);
  installed = true;
  for (let pass = 0; pass < 3; pass += 1) {
    context = await playwright.chromium.launchPersistentContext(profile, {
      executablePath, headless: true, ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check', ...webmcpFlags],
      viewport: { width: 1280, height: 900 },
    });
    const page = context.pages().find((candidate) => candidate.url() === 'about:blank') ?? await context.newPage();
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: bundle.tempExtensionDir });
    const worker = await waitForWorker(context, 20_000);
    client = await startMcpClient();
    await page.goto(`${fixture.origin}/article`);
    await page.bringToFront();
    const tabId = await worker.evaluate(async (origin) => {
      const tabs = await chrome.tabs.query({ active: true });
      return tabs.find((tab) => tab.url?.startsWith(origin))?.id;
    }, fixture.origin);
    assert.ok(Number.isInteger(tabId));
    const extensionId = new URL(worker.url()).host;
    const launcher = await context.newPage();
    await launcher.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const panel = await openTrustedSidePanel({ context, worker, launcherPage: launcher, tabId, extensionId, timeoutMs: 15_000 });
    await page.bringToFront();
    const access = () => panel.evaluate(() => ({
      status: document.querySelector('#access-status')?.textContent,
      site: document.querySelector('#access-site')?.textContent,
      checked: document.querySelector('#access-consent')?.checked,
      disabled: document.querySelector('#access-enable')?.disabled,
      toast: document.querySelector('#toast')?.textContent,
    }));
    await until('side-panel active site', async () => (await access()).site === fixture.origin);
    if (pass !== 1) {
      assert.equal((await access()).status, 'Paused');
      assert.equal((await access()).checked, false);
      assert.equal((await access()).disabled, true);
      const paused = (await client.request('tools/call', { name: 'toolbraid_status', arguments: {} })).structuredContent;
      assert.equal(paused.connected, false);
      if (pass === 2) {
        results.push({ pass: 'paused-browser-restart', controlPaused: true, mcpDisconnected: true });
        await panel.close();
        await client.close(); client = null;
        await context.close(); context = null;
        continue;
      }
      if (process.env.TOOLBRAID_SCREENSHOT_DIR) await panel.captureScreenshot(path.join(process.env.TOOLBRAID_SCREENSHOT_DIR, 'toolbraid-public-paused.png'));
      if (process.env.TOOLBRAID_STORE_CAPTURE_DIR) await panel.captureScreenshot(path.join(process.env.TOOLBRAID_STORE_CAPTURE_DIR, 'access.png'), { fullPage: false });
      await panel.clickSelector('#access-consent');
      assert.equal((await access()).checked, true);
    } else assert.equal((await access()).status, 'Enabled');
    await panel.clickSelector('#access-enable');
    try {
      await until('explicit public access enablement', async () => (await access()).status === 'Enabled');
    } catch (error) {
      throw new Error(`${error.message}: ${JSON.stringify(await access())}`);
    }
    let state;
    let tools;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      tools = (await client.request('tools/list')).tools;
      state = (await client.request('tools/call', { name: 'toolbraid_status', arguments: {} })).structuredContent;
      if (state.page && tools.some((tool) => tool._meta?.['toolbraid/classification'] === 'read')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(state.page?.tabId, tabId, 'The endpoint must bind the real fixture tab.');
    let read = tools.find((tool) => tool._meta?.['toolbraid/classification'] === 'read');
    assert.ok(read, 'The browser must expose a page read tool.');
    const result = await client.request('tools/call', { name: read.name, arguments: {} });
    assert.equal(result.isError, false);
    assert.ok(JSON.stringify(result).includes('completed'), 'The page read must execute, not only list.');
    const runtime = await pageRuntimeState(page, { worker, tabId });
    assert.ok(runtime.content.session && runtime.main.session, 'Both production page worlds must be connected.');
    const transport = state.toolTransport;
    assert.equal(transport, runtime.webmcp.available ? 'native-webmcp' : 'extension-mcp');
    results.push({ pass: pass === 0 ? 'fresh-profile-opt-in' : 'enabled-browser-restart', nativeWebMcp: runtime.webmcp.available, transport, toolCount: tools.length, readExecuted: true });
    if (pass === 0) {
      const assistantState = await until('native assistant round-trip', () => panel.evaluate(async () => {
        const response = await chrome.runtime.sendMessage({ type: 'UI_ASSISTANT', method: 'state' });
        return response?.ok ? response.result : null;
      }));
      assert.deepEqual(Object.keys(assistantState.settings).sort(), ['codexExecutable', 'model']);
      assert.deepEqual(assistantState.messages, []);
      const forged = await page.evaluate(async () => {
        // The page itself cannot call extension runtime APIs.
        return typeof globalThis.chrome?.runtime?.sendMessage;
      });
      assert.notEqual(forged, 'function');
      await panel.clickSelector('#assistant-connect');
      await until('Codex connection result', () => panel.evaluate(() => /Connected with ChatGPT|Sign in to Codex|could not start/.test(document.querySelector('#assistant-status')?.textContent ?? '')), 30000);
      const subscriptionConnected = await panel.evaluate(() => document.querySelector('#assistant-status')?.textContent.startsWith('Connected with ChatGPT'));
      if (process.env.TOOLBRAID_CHAT_LIVE === '1') {
        assert.equal(subscriptionConnected, true, 'A ChatGPT-authenticated Codex account is required for the optional live smoke.');
        await panel.fillSelector('#assistant-message', 'Call toolbraid_list_tools, then call one listed read-only page tool through toolbraid_call_tool to inspect this test page. You must execute the read tool, not just list tools. After the read succeeds, reply with the page title only. Do not navigate, modify, submit or use other tools.');
        await panel.clickSelector('#assistant-use-page');
        await panel.clickSelector('#assistant-send');
        await until('live subscription chat completion', () => panel.evaluate(async () => {
          const response = await chrome.runtime.sendMessage({ type: 'UI_ASSISTANT', method: 'state' });
          if (!response?.ok || response.result.active) return false;
          const answer = response.result.messages.at(-1);
          if (answer?.status === 'error') throw new Error(answer.notice);
          return answer?.status === 'completed' && !!answer.content;
        }), 120000);
        const live = await panel.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'UI_ASSISTANT', method: 'state' })).result);
        assert.ok(live.messages.at(-1).content.toLowerCase().includes((await page.title()).toLowerCase()), 'The live model must return the actual selected page title.');
        assert.equal(await panel.evaluate(() => [...document.querySelectorAll('#assistant-activity li')].some((item) => item.textContent.includes('Result:'))), true, 'The live read must execute a browser tool.');
        results.push({ pass: 'live-chatgpt-subscription-chat', readOnly: true, apiKeyUsed: false, selectedPageRead: true });
      }
      const nativeSupport = await page.evaluate(async () => {
        const api = document.modelContext;
        if (!api?.getTools || !api?.executeTool) return false;
        const output = document.createElement('output');
        output.id = 'toolbraid-native-result';
        output.dataset.calls = '0';
        document.body.append(output);
        await api.registerTool({ name: 'toolbraid_native_fixture', description: 'Harmless native WebMCP echo fixture', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, execute: async (input) => {
          output.textContent = input.text;
          output.dataset.calls = String(Number(output.dataset.calls) + 1);
          return JSON.stringify({ echo: input.text });
        } });
        return true;
      });
      if (requireNativeWebMcp) assert.equal(nativeSupport, true, 'The native WebMCP release gate must execute, not silently skip.');
      const nativeResult = (await client.request('tools/call', { name: 'toolbraid.webmcp.discover', arguments: {} })).structuredContent;
      assert.equal(nativeResult.available, nativeSupport, JSON.stringify(nativeResult));
      if (nativeSupport) {
        const nativeTool = nativeResult.tools.find((entry) => entry.name === 'toolbraid_native_fixture');
        assert.ok(nativeTool);
        const executed = await client.request('tools/call', { name: 'toolbraid.webmcp.execute', arguments: { handle: nativeTool.handle, input: { text: 'native echo' } } });
        assert.equal(executed.isError, false, JSON.stringify(executed));
        assert.match(JSON.stringify(executed), /native echo/);
        assert.equal(await page.locator('#toolbraid-native-result').innerText(), 'native echo');
        assert.equal(await page.locator('#toolbraid-native-result').getAttribute('data-calls'), '1');
      }
      results.push({ pass: 'assistant-native-round-trip', subscriptionOnlySettings: true, subscriptionConnected, nativeSiteToolsAvailable: nativeSupport, nativeSiteToolExecuted: nativeSupport });
      if (process.env.TOOLBRAID_SCREENSHOT_DIR) await panel.captureScreenshot(path.join(process.env.TOOLBRAID_SCREENSHOT_DIR, 'toolbraid-chat.png'), { fullPage: false, selector: '.assistant-panel' });
    }
    if (pass === 0 && process.env.TOOLBRAID_SCREENSHOT_DIR) {
      await until('connected public panel', () => panel.evaluate(() => document.querySelector('#connection-badge')?.textContent === 'Connected'));
      await panel.captureScreenshot(path.join(process.env.TOOLBRAID_SCREENSHOT_DIR, 'toolbraid-public-active.png'));
    }
    if (pass === 1) {
      await page.goto(`${fixture.origin}/form`);
      const form = await until('MCP fixture form tool', async () => {
        const listed = (await client.request('tools/list')).tools;
        return listed.find((tool) => tool._meta?.['toolbraid/classification'] === 'mutation'
          && Object.keys(tool.inputSchema?.properties ?? {}).some((key) => /title/i.test(key))
          && Object.values(tool.inputSchema?.properties ?? {}).some((field) => field?.type === 'boolean'));
      });
      const input = fixtureFormArguments(form);
      const submitted = await client.request('tools/call', { name: form.name, arguments: input.arguments });
      assert.equal(submitted.isError, false, JSON.stringify(submitted));
      const receipt = await until('one local form submission', async () => {
        const state = await (await fetch(`${fixture.origin}/api/state`)).json();
        return state.submissions.length === 1 && state.submissions[0];
      });
      assert.deepEqual({ title: receipt.title, message: receipt.message, audience: receipt.audience, confirm: receipt.confirm }, { ...input.expected, confirm: 'yes' });
      results.push({ pass: 'local-form-action', submissions: 1, exactArguments: true, repeatedApproval: false });
      results.push(await verifyLocalXControl({ context, page, panel, client }));
      read = (await client.request('tools/list')).tools.find((tool) => tool._meta?.['toolbraid/classification'] === 'read');
      assert.ok(read);
      assert.equal((await client.request('tools/call', { name: read.name, arguments: {} })).isError, false);
      await panel.clickSelector('#access-pause');
      await until('pause control', async () => (await access()).status === 'Paused');
      await until('native MCP disconnection', async () => (await client.request('tools/call', { name: 'toolbraid_status', arguments: {} })).structuredContent.connected === false);
      const denied = await client.request('tools/call', { name: read.name, arguments: {} });
      assert.equal(denied.isError, true, 'A previously listed tool must not execute after pause.');
      const deniedDesktop = await client.request('tools/call', { name: 'toolbraid_windows_list', arguments: {} });
      assert.equal(deniedDesktop.isError, true, 'Companion desktop tools must also be disconnected.');
      results.push({ pass: 'pause-control', mcpDisconnected: true, staleToolBlocked: true, desktopToolBlocked: true });
    }
    await panel.close();
    await client.close();
    client = null;
    await context.close();
    context = null;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, executablePath, webmcpFlags, extensionDebugging: true, fixtureHostPregranted: hostPregranted, xNetworkFullyIntercepted: true, fixtureDebuggerPregranted: true, nativeCompanionTested: true, results }, null, 2)}\n`);
} finally {
  await client?.close();
  await context?.close();
  if (installed) runPowerShell(['-File', path.join(installRoot, 'uninstall.ps1'), '-InstallRoot', installRoot]);
  await fixture.close();
  for (const directory of [profile, bundle.launchBundleRoot]) {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('toolbraid-'));
    await rm(directory, { recursive: true, force: true });
  }
}
