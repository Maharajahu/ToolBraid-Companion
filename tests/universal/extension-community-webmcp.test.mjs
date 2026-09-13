import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createWebMcpOwnerTools, nativeWebMcpOperation } from '../../extension/webmcp-owner-tools.js';
import { createCommunityTools } from '../../extension/community-tools.js';

test('native WebMCP discovers and invokes actual RegisteredTool objects without exporting them', async () => {
  const registered = { name: 'site.add', description: 'Add an item', inputSchema: { type: 'object' }, origin: 'https://example.test' };
  let called = 0;
  const context = { document: { modelContext: { getTools: async () => [registered], executeTool: async (tool, input) => { assert.equal(tool, registered); called++; return JSON.stringify(input); } } }, location: { href: 'https://example.test/', origin: 'https://example.test' }, AbortController, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  const operation = vm.runInNewContext(`(${nativeWebMcpOperation.toString()})`, context);
  const listed = await operation({ operation: 'discover', url: context.location.href });
  assert.equal(listed.available, true); assert.equal(listed.tools[0].name, 'site.add');
  const result = await operation({ operation: 'execute', url: context.location.href, tool: listed.tools[0], input: { name: 'task' } });
  assert.equal(result.result, '{"name":"task"}'); assert.equal(called, 1);
  registered.description = 'Changed';
  await assert.rejects(operation({ operation: 'execute', url: context.location.href, tool: listed.tools[0], input: {} }), /WEBMCP_TOOL_CHANGED/);
  context.document.modelContext = undefined;
  assert.equal((await operation({ operation: 'discover', url: context.location.href })).available, false);
});
test('WebMCP handles bind tab, frame, URL and session; expire and execute once', async () => {
  let now = 0; let executions = 0;
  let target = { tabId: 1, windowId: 2, frameId: 0, sessionId: 'session-a', url: 'https://example.test/' };
  const provider = createWebMcpOwnerTools({ now: () => now, getTarget: async () => target, chromeApi: { scripting: { executeScript: async (details) => {
    assert.equal(details.world, 'MAIN'); assert.equal(details.target.tabId, target.tabId);
    if (details.args[0].operation === 'discover') return [{ frameId: 0, result: { available: true, tools: [{ name: 'site.add', inputSchema: { type: 'object' } }] } }];
    executions++; return [{ frameId: 0, result: { result: 'ok' } }];
  } } } });
  const discover = async () => (await provider.call('toolbraid.webmcp.discover')).tools[0].handle;
  const execute = (handle) => provider.call('toolbraid.webmcp.execute', { handle, input: {} });
  const first = await discover(); await execute(first); await assert.rejects(execute(first), { code: 'WEBMCP_HANDLE_STALE' });
  const second = await discover(); target = { ...target, sessionId: 'session-b' }; await assert.rejects(execute(second), { code: 'WEBMCP_PAGE_CHANGED' });
  const third = await discover(); now = 120001; await assert.rejects(execute(third), { code: 'WEBMCP_HANDLE_STALE' });
  assert.equal(executions, 1);
});
test('native WebMCP normalizes legacy JSON schemas and serializes input without retrying', async () => {
  const registered = { name: 'legacy.echo', inputSchema: JSON.stringify({ type: 'object', properties: { value: { type: 'string' } } }) };
  let calls = 0;
  const context = { document: { modelContext: { getTools: async () => [registered], executeTool: async (tool, input) => { calls++; assert.equal(tool, registered); assert.equal(typeof input, 'string'); return JSON.parse(input).value; } } }, location: { href: 'https://example.test/', origin: 'https://example.test' }, AbortController, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  const operation = vm.runInNewContext(`(${nativeWebMcpOperation.toString()})`, context);
  const listed = await operation({ operation: 'discover', url: context.location.href });
  assert.equal(listed.tools[0].inputSchema.type, 'object');
  const result = await operation({ operation: 'execute', url: context.location.href, tool: listed.tools[0], input: { value: 'exact-value' } });
  assert.equal(result.result, 'exact-value');
  assert.equal(calls, 1);
});

test('real native WebMCP discovers and executes the production page operation', { skip: process.env.TOOLBRAID_WEBMCP_NATIVE !== '1' }, async (t) => {
  const { createServer } = await import('node:http');
  const { resolvePlaywright, resolveChromePath } = await import('../../scripts/e2e-universal-extension.mjs');
  const server = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>ToolBraid native WebMCP test</title><output id="result" data-calls="0"></output>'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const playwright = resolvePlaywright();
  const browser = await playwright.chromium.launch({ executablePath: resolveChromePath(playwright), headless: true, args: ['--enable-blink-features=WebMCP'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(() => {
    document.modelContext.registerTool({ name: 'toolbraid_echo', description: 'Display the exact local test value without network requests', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false }, execute: ({ value }) => {
      const output = document.querySelector('#result');
      output.textContent = value;
      output.dataset.calls = String(Number(output.dataset.calls) + 1);
      return { content: [{ type: 'text', text: value }] };
    } });
  });
  const listed = await page.evaluate(nativeWebMcpOperation, { operation: 'discover', url: page.url() });
  assert.equal(listed.available, true);
  assert.equal(listed.tools.length, 1);
  assert.equal(listed.tools[0].inputSchema.type, 'object');
  const executed = await page.evaluate(nativeWebMcpOperation, { operation: 'execute', url: page.url(), tool: listed.tools[0], input: { value: 'ToolBraid-native-exact-value' } });
  assert.match(JSON.stringify(executed), /ToolBraid-native-exact-value/);
  assert.equal(await page.locator('#result').innerText(), 'ToolBraid-native-exact-value');
  assert.equal(await page.locator('#result').getAttribute('data-calls'), '1');
  t.diagnostic(`Native browser ${browser.version()}; WebMCP test flag enabled; localhost-only; no API mock; no external mutation`);
});
function communityHarness() {
  let record = {}; let time = 1;
  const tab = { id: 7, url: 'https://x.com/notifications/mentions', active: false, status: 'complete' };
  let snapshot = { account: '@developer', url: tab.url, items: [{ id: '1', author: '@friend', text: 'First', url: 'https://x.com/friend/status/1' }] };
  const notices = [], reloads = [], alarms = [];
  let authorized = true;
  const chromeApi = {
    storage: { local: { get: async (key) => ({ [key]: record[key] }), set: async (value) => { Object.assign(record, structuredClone(value)); } } },
    tabs: { query: async () => [tab], get: async () => tab, reload: async (id) => reloads.push(id) },
    scripting: { executeScript: async () => [{ result: structuredClone(snapshot) }] },
    alarms: { create: async (...args) => alarms.push(args), clear: async () => true },
    permissions: { contains: async () => true }, notifications: { create: async (...args) => notices.push(args) },
  };
  const tools = createCommunityTools({ chromeApi, now: () => ++time, delay: async () => {}, authorize: async () => { if (!authorized) throw new Error('Permission removed'); } });
  return { tools, notices, reloads, alarms, tab, set: (value) => { snapshot = { ...snapshot, ...value }; }, revoke: () => { authorized = false; } };
}
test('community monitor establishes baseline, deduplicates, stays quiet and never sends posts', async () => {
  const h = communityHarness(); await h.tools.watch({ interval: 15, notify: true });
  await h.tools.tick(); assert.equal(h.notices.length, 0);
  const next = { id: '2', author: '@friend', text: 'New reply', url: 'https://x.com/friend/status/2' };
  h.set({ items: [next] }); await h.tools.tick(); await h.tools.tick();
  assert.equal(h.notices.length, 1); assert.equal((await h.tools.state()).inbox.length, 1);
  assert.equal(h.reloads.length, 3);
  assert.doesNotMatch(JSON.stringify(h.notices), /New reply/);
  await h.tools.pause(); const count = h.reloads.length; await h.tools.tick(); assert.equal(h.reloads.length, count);
});
test('community monitor pauses on account drift, page changes, or revoked permission', async () => {
  for (const cause of ['account', 'url', 'permission']) {
    const h = communityHarness(); await h.tools.watch();
    if (cause === 'account') h.set({ account: '@different' });
    if (cause === 'url') h.tab.url = 'https://x.com/home';
    if (cause === 'permission') h.revoke();
    const result = await h.tools.tick(); assert.equal(result.enabled, false); assert.ok(result.error); assert.equal(h.notices.length, 0);
  }
});
test('community monitor never reloads an active tab or starts on a non-watch page', async () => {
  const h = communityHarness(); await h.tools.watch(); h.tab.active = true; await h.tools.tick(); assert.equal(h.reloads.length, 0);
  h.tab.url = 'https://example.test/notifications'; await assert.rejects(h.tools.watch(), { code: 'COMMUNITY_WATCH_PAGE_REQUIRED' });
  await assert.rejects(h.tools.watch({ interval: 1 }), { code: 'COMMUNITY_INTERVAL_INVALID' });
});

test('notification permission alone does not opt the user into notifications', async () => {
  const h = communityHarness(); await h.tools.watch({ notify: false });
  h.set({ items: [{ id: '2', author: '@friend', text: 'New', url: 'https://x.com/friend/status/2' }] });
  await h.tools.tick(); assert.equal(h.notices.length, 0); assert.equal((await h.tools.state()).inbox.length, 1);
});
