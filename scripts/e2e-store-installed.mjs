import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { resolvePlaywright, resolveChromePath, waitForWorker, openTrustedSidePanel, fixtureFormArguments } from './e2e-universal-extension.mjs';
import { startUniversalFixtureServer } from './serve-universal-fixtures.mjs';
import { createPowerShellUiaAdapter } from '../bridge/windows-uia.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.equal(process.env.GITHUB_REPOSITORY, 'Maharajahu/ToolBraid-Companion');
assert.match(process.env.GITHUB_REF ?? '', /^refs\/heads\/test\/store-e2e-/);
const root = path.resolve(import.meta.dirname, '..');
const evidence = process.env.TOOLBRAID_E2E_EVIDENCE;
const installedRoot = process.env.TOOLBRAID_INSTALLED_ROOT;
const extension = path.join(root, 'dist/release-0.3.1/companion/extension');
const browserName = process.env.TOOLBRAID_E2E_BROWSER ?? 'msedge';
assert.ok(['msedge', 'chrome'].includes(browserName));
const browserWindowTitle = browserName === 'msedge' ? 'Microsoft Edge' : 'Google Chrome';
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
assert.equal(manifest.host_permissions, undefined, 'Use the unchanged production permissions.');
const dataRoot = path.join(process.env.LOCALAPPDATA, 'ToolBraid/store');
const aliasRoot = path.join(process.env.LOCALAPPDATA, 'Microsoft/WindowsApps');
const fixture = await startUniversalFixtureServer({ port: 0 });
const results = [];
let app, context, panel, client;
const powershell = path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const uia = createPowerShellUiaAdapter({ powershell, timeoutMs: 30000 });
const execFileAsync = promisify(execFile);
let passed = false;
let phase = 'packaged-app-activation';
const save = (name, value) => writeFile(path.join(evidence, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
function record(name, details = {}) { results.push({ name, ...details }); console.log(`PASS: ${name}`); }
async function until(label, predicate, timeout = 20000) {
  const end = Date.now() + timeout;
  let lastError;
  while (Date.now() < end) {
    try { const value = await predicate(); if (value) return value; } catch (error) { lastError = error; }
    await delay(200);
  }
  throw new Error(`${label}: ${lastError?.message ?? 'timed out'}`);
}
async function desktopTest(action, imageName) {
  const args = ['-NoProfile', '-NonInteractive', '-File', path.join(import.meta.dirname, 'store-e2e-desktop.ps1'), '-Action', action];
  if (imageName) args.push('-ImageName', imageName);
  const { stdout } = await execFileAsync(powershell, args, { windowsHide: true, timeout: 30000 });
  return JSON.parse(stdout.trim());
}
const screenshot = (name) => desktopTest('capture', name);
async function click(window, name) {
  const control = (await uia.listControls(window)).find(item => item.name === name && item.controlType === 'ControlType.Button' && item.enabled);
  assert.ok(control?.enabled, `Enabled native button not found: ${name}`);
  await uia.invoke(control);
}
async function checkDialog(expected, name) {
  await click(app, 'Check connection');
  const text = await until(`companion dialog ${expected}`, async () => {
    const { text: value } = await desktopTest('diagnostic');
    return value.includes(expected) && value;
  });
  await save(`${name}.txt`, text);
  await screenshot(`${name}.png`);
  await click(app, 'Close');
  return text;
}
async function startClient() {
  const config = JSON.parse(await readFile(path.join(dataRoot, 'mcp-client.json'), 'utf8')).mcpServers.toolbraid;
  assert.equal(config.command.toLowerCase(), path.join(aliasRoot, 'ToolBraidMcp.exe').toLowerCase());
  assert.deepEqual(config.args, ['--mcp']);
  const child = spawn(config.command, config.args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let sequence = 0;
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  child.on('error', (error) => { for (const request of pending.values()) request.reject(error); });
  lines.on('line', (line) => {
    const message = JSON.parse(line), request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'ToolBraid-installed-e2e', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  return { request, async close() { child.stdin.end(); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]); if (child.exitCode === null) child.kill(); lines.close(); } };
}
async function enableSite(worker, origin) {
  await until('selected site and ready connection button', () => panel.evaluate((expected) =>
    document.querySelector('#access-site')?.textContent === expected && document.querySelector('#access-enable')?.disabled === false, origin));
  await panel.clickSelector('#access-enable');
  let promptClicked = false;
  await until('browser site permission and public enablement', async () => {
    const granted = await worker.evaluate((expected) => chrome.permissions.contains({ origins: [`${expected}/*`] }), origin);
    if (granted && await panel.evaluate(() => document.querySelector('#access-status')?.textContent === 'Enabled')) return true;
    if (!promptClicked) {
      const browserWindow = (await uia.listWindows()).find(window => window.name.includes(browserWindowTitle));
      const allow = browserWindow && (await uia.listControls(browserWindow)).find(control => control.name === 'Allow' && control.supportsInvoke);
      if (allow) { await uia.invoke(allow); promptClicked = true; }
    }
    return false;
  });
  const permissions = await worker.evaluate(() => chrome.permissions.getAll());
  record('site-opt-in', { nativePermissionPromptClicked: promptClicked, grantedOrigins: permissions.origins ?? [], manifestUnchanged: true });
}
try {
  await desktopTest('prepare');
  await desktopTest('launch');
  app = await until('activated packaged Companion', async () => (await uia.listWindows()).find(window => window.name === 'ToolBraid Companion'));
  await screenshot('01-installed-companion.png');
  await click(app, 'Connect browsers');
  await until('real companion configuration', () => readFile(path.join(dataRoot, 'mcp-client.json'), 'utf8'));
  record('packaged-activation-and-connect');
  phase = 'paused-diagnostics';
  const paused = await checkDialog('Extension — NOT CONNECTED', '02-paused-guidance');
  assert.match(paused, /Finish setup/);
  assert.match(paused, /MCP — OK/);
  record('paused-diagnostic-guidance');
  client = await startClient();
  const status = async () => (await client.request('tools/call', { name: 'toolbraid_status', arguments: {} })).structuredContent;
  assert.equal((await status()).connected, false);

  phase = 'browser-first-run';
  const playwright = resolvePlaywright();
  const executablePath = browserName === 'msedge'
    ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync)
    : resolveChromePath();
  assert.ok(executablePath, `${browserWindowTitle} is not installed on the test runner.`);
  const profile = await mkdtemp(path.join(os.tmpdir(), 'toolbraid-installed-'));
  const launch = async () => {
    context = await playwright.chromium.launchPersistentContext(profile, { executablePath, headless: false,
      ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check'],
      viewport: { width: 1280, height: 900 } });
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: extension });
    const worker = await waitForWorker(context, 20000);
    const extensionId = new URL(worker.url()).host;
    assert.equal(extensionId, 'gpjhdlbjfhlaeakphfognpijgmclecmn');
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto('https://example.org/');
    await page.bringToFront();
    const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true })).find(tab => tab.url?.startsWith('https://example.org/'))?.id);
    const launcher = await context.newPage();
    await launcher.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    panel = await openTrustedSidePanel({ context, worker, launcherPage: launcher, tabId, extensionId, timeoutMs: 20000 });
    await page.bringToFront();
    return { worker, page, tabId };
  };
  let { worker, page, tabId } = await launch();
  const access = () => panel.evaluate(() => ({ state: document.querySelector('#access-status')?.textContent,
    checked: document.querySelector('#access-consent')?.checked, disabled: document.querySelector('#access-enable')?.disabled }));
  await until('initial paused state', async () => (await access()).state === 'Paused');
  assert.equal((await access()).checked, false);
  assert.equal((await access()).disabled, true);
  await panel.clickSelector('#access-setup');
  assert.equal((await access()).checked, false, 'Finish setup cannot grant consent.');
  await panel.clickSelector('#access-consent');
  await enableSite(worker, 'https://example.org');
  await until('authenticated live example.org connection', async () => {
    const state = await status(); return state.connected && state.page?.url === 'https://example.org/' && state.page?.tabId === tabId;
  });
  const readTool = await until('live page read tool', async () => (await client.request('tools/list')).tools.find(tool => tool._meta?.['toolbraid/classification'] === 'read'));
  const read = await client.request('tools/call', { name: readTool.name, arguments: {} });
  assert.equal(read.isError, false);
  assert.match(JSON.stringify(read), /Example Domain/);
  await panel.captureScreenshot(path.join(evidence, '03-enabled-extension.png'));
  await checkDialog('Selected page — READY', '04-connected-diagnostic');
  record('real-site-read-through-installed-mcp-alias', { browser: browserName, version: context.browser().version(), page: 'https://example.org/', textVerified: 'Example Domain' });

  phase = 'browser-restart';
  await panel.close(); await context.close(); context = null;
  ({ worker, page, tabId } = await launch());
  await until('persisted enabled preference', async () => (await access()).state === 'Enabled');
  await enableSite(worker, 'https://example.org');
  await until('connection after browser restart', async () => (await status()).page?.tabId === tabId);
  record('browser-restart');

  phase = 'real-form-action';
  await page.goto(`${fixture.origin}/form`);
  await page.bringToFront();
  await enableSite(worker, fixture.origin);
  const form = await until('local form tool', async () => (await client.request('tools/list')).tools.find(tool =>
    tool._meta?.['toolbraid/classification'] === 'mutation' && Object.keys(tool.inputSchema?.properties ?? {}).some(key => /title/i.test(key)) &&
    Object.values(tool.inputSchema?.properties ?? {}).some(field => field?.type === 'boolean')));
  const input = fixtureFormArguments(form);
  const submitted = await client.request('tools/call', { name: form.name, arguments: input.arguments });
  assert.equal(submitted.isError, false, JSON.stringify(submitted));
  const receipt = await until('one actual HTTP form submission', async () => {
    const state = await (await fetch(`${fixture.origin}/api/state`)).json();
    return state.submissions.length === 1 && state.submissions[0];
  });
  assert.deepEqual({ title: receipt.title, message: receipt.message, audience: receipt.audience, confirm: receipt.confirm }, { ...input.expected, confirm: 'yes' });
  record('form-action-through-installed-mcp-alias', { submissions: 1, exactArguments: true, target: 'local test server, not a public account' });

  phase = 'pause-and-disconnect';
  await panel.clickSelector('#access-pause');
  await until('pause disconnects MCP', async () => (await status()).connected === false);
  assert.equal((await client.request('tools/call', { name: form.name, arguments: input.arguments })).isError, true);
  await checkDialog('Extension — NOT CONNECTED', '05-paused-again');
  record('pause-blocks-stale-tools');
  await panel.close(); await context.close(); context = null;
  await client.close(); client = null;
  await click(app, 'Disconnect browsers');
  const registrations = spawnSync(powershell, ['-NoProfile', '-Command', "@('Google\\Chrome','Microsoft\\Edge') | ForEach-Object { Test-Path -LiteralPath \"HKCU:\\Software\\$_\\NativeMessagingHosts\\com.toolbraid.bridge\" }"], { encoding: 'utf8', windowsHide: true });
  assert.equal(registrations.status, 0);
  assert.doesNotMatch(registrations.stdout, /True/);
  record('disconnect-restores-browser-registration');
  passed = true;
} catch (error) {
  await save('failure.json', { phase, error: error.message, stack: error.stack });
  if (panel) {
    await panel.captureScreenshot(path.join(evidence, 'failure-extension.png')).catch(() => {});
    await save('failure-panel-state.json', await panel.evaluate(() => ({ state: document.querySelector('#access-status')?.textContent,
      site: document.querySelector('#access-site')?.textContent, disabled: document.querySelector('#access-enable')?.disabled,
      toast: document.querySelector('#toast')?.textContent })).catch(() => null));
  }
  await screenshot('failure-desktop.png').catch(() => {});
  const windows = await uia.listWindows().catch(() => []);
  await save('failure-ui.json', { windows, controls: await Promise.all(windows.filter(window => /ToolBraid|Google Chrome|Microsoft Edge/.test(window.name)).map(async window => ({ name: window.name, controls: await uia.listControls(window).catch(() => []) }))) });
  throw error;
} finally {
  await client?.close().catch(() => {});
  await context?.close().catch(() => {});
  await fixture.close();
  await save('result.json', { passed, phase, results, browser: browserName, storeSigned: false, microsoftSubmitted: false,
    optionalAiAccountNotTested: true, browserHarness: 'headed system browser, stable-ID public unpacked ZIP; no host pregrant or manifest edits; Edge Add-ons delivery not tested' });
}
