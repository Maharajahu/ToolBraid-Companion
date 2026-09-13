// Real Chromium DOM + production ToolBraid MCP endpoint/executor integration.
// X requests are fulfilled from a local fixture; no account or live X write is used.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolvePlaywright, resolveChromePath } from './e2e-universal-extension.mjs';
import { createServiceWorkerController } from '../extension/service-worker.js';
import { MESSAGE_TYPES } from '../extension/protocol.js';
import { inspectXCommunityPage } from '../extension/community-tools.js';

const playwright = resolvePlaywright();
const browser = await playwright.chromium.launch({ executablePath: resolveChromePath(playwright), headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const html = await readFile(new URL('../fixtures/universal/x-content-stack.html', import.meta.url), 'utf8');
const extractor = await readFile(new URL('../extension/page-extractor.js', import.meta.url), 'utf8');
const executor = await readFile(new URL('../extension/action-executor.js', import.meta.url), 'utf8');
await context.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: html }));
const page = await context.newPage();
const checks = [];
try {
  for (const path of ['/fixture/status/1', '/compose/post', '/compose/articles/123']) {
    await page.goto(`https://x.com${path}`);
    await page.evaluate(() => {
      for (let index = 0; index < 650; index += 1) document.head.appendChild(document.createElement('meta'));
      globalThis.fixtureNativeInputs = [];
      document.addEventListener('input', (event) => {
        if (event.target.isContentEditable && event.isTrusted) fixtureNativeInputs.push(event.inputType);
      });
    });
    await page.addScriptTag({ content: extractor });
    await page.addScriptTag({ content: executor });
    if (path === '/compose/post') await page.evaluate(() => {
      const main = document.querySelector('main');
      const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
      const close = document.createElement('button'); close.textContent = 'Close reply'; dialog.append(close);
      dialog.append(document.querySelector('#post-editor')); document.body.append(dialog);
      main.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 650; i++) main.prepend(document.createElement('div'));
      dialog.querySelector('[data-testid="tweetButton"]').addEventListener('click', () => {
        main.removeAttribute('aria-hidden'); main.append(document.querySelector('#post-editor')); dialog.remove();
      }, { once: true });
    });
    const values = {};
    const tab = async () => ({ id: 7, windowId: 1, active: true, url: page.url(), title: await page.title() });
    const raw = () => page.evaluate(() => ToolBraidUniversalPageExtractor.extract({ documentRef: document }));
    const chromeApi = { runtime: { id: 'x-content-e2e' }, storage: { local: {
      async get(key) { return { [key]: values[key] }; }, async set(value) { Object.assign(values, value); }, async remove(key) { delete values[key]; },
    } }, tabs: { query: async () => [await tab()], get: tab }, scripting: { executeScript: async () => [] } };
    const controller = createServiceWorkerController({ chromeApi, publicRelease: true, sendToContentScript: async (_tabId, message) => {
      if (message.type === MESSAGE_TYPES.PAGE_EXTRACT_SNAPSHOT) return { ok: true, snapshot: await raw() };
      if (message.type !== MESSAGE_TYPES.PAGE_ACTION_EXECUTE) return { ok: true };
      return page.evaluate(async (message) => {
        const prepared = message.preparedAction;
        const binding = { ...prepared.target.binding, ref: prepared.target.ref, canonicalPageFingerprint: prepared.pageFingerprint,
          extractorFingerprint: message.extractorPageFingerprint };
        const api = ToolBraidUniversalActionExecutor;
        const request = { documentRef: document, approved: message.approved, classification: prepared.classification,
          preparedAction: prepared, arguments: prepared.arguments, binding,
          operation: prepared.effect.operation === 'select-text' ? 'select-text' : prepared.target.binding?.role === 'textbox' ? 'set' : 'click' };
        const result = prepared.effect.operation === 'scroll' ? await api.safeScroll(request)
          : request.operation === 'set' && binding.type === 'contenteditable' ? await api.safeEdit(request) : api.safeExecute(request);
        return result.ok ? { ok: true, receipt: result } : result;
      }, message);
    } });
    const sender = { id: 'x-content-e2e', tab: await tab(), frameId: 0, documentId: 'fixture-document', url: page.url() };
    const panel = { id: 'x-content-e2e', url: 'chrome-extension://x-content-e2e/sidepanel.html' };
    await controller.handleRuntimeMessage({ type: 'UI_SET_ACCESS', payload: { enabled: true } }, panel);
    const ready = await controller.handleRuntimeMessage({ type: MESSAGE_TYPES.PAGE_READY, pageInstanceId: 'fixture-page-x-content-e2e' }, sender);
    assert.equal(ready.ok, true, JSON.stringify(ready));
    const refresh = async () => {
      const result = await controller.handleRuntimeMessage({ type: MESSAGE_TYPES.PAGE_SNAPSHOT, sessionId: ready.channel.sessionId,
        nonce: ready.channel.nonce, snapshot: await raw() }, sender);
      assert.equal(result.ok, true, JSON.stringify(result));
      return result.state;
    };
    const call = async (name, args = {}) => {
      const state = await refresh();
      const listed = await controller.mcpEndpoint.handle('tools.list');
      const tool = listed.tools.find((entry) => entry._meta?.['toolbraid/originalName'] === name);
      assert.ok(tool, `Missing ${name}: ${JSON.stringify({ tools: listed.tools.map((entry) => entry._meta?.['toolbraid/originalName']).filter(Boolean), quarantined: state.quarantined ?? state.quarantinedTools })}`);
      const result = await controller.mcpEndpoint.handle('tools.call', { name: tool.name, arguments: args });
      assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`);
      return result.result?.data ?? result.result;
    };
    if (path.includes('/status/')) {
      assert.equal((await call('read_x_conversation')).posts[0].id, '1');
      const scroll = await call('universal_scroll_page', { direction: 'down', pixels: 800 });
      assert.equal(scroll.moved, true, JSON.stringify(scroll));
      const conversation = await call('read_x_conversation');
      assert.equal(conversation.posts.find((post) => post.id === '3').liked, true);
      checks.push('MCP page scroll loads and reads a real DOM reply with its exact ID and like state');
      const state = await refresh();
      const container = state.tools.find((tool) => tool.title === 'Scroll Scrollable replies');
      assert.ok(container);
      assert.equal((await call(container.name, { direction: 'right', pixels: 200 })).after.left, 200);
      checks.push('MCP exact nested-container scrolling');
      await call('universal_scroll_page', { direction: 'top' });
      await page.evaluate(() => {
        const quote = document.createElement('article'); quote.dataset.testid = 'tweet';
        quote.innerHTML = '<a href="/quoted/status/99"><time datetime="2026-09-13T00:00:00Z">Quoted time</time></a><div data-testid="tweetText">Quoted text is not the parent</div><button data-testid="unlike">Unlike</button>';
        document.querySelector('#post').prepend(quote);
        for (let i = 0; i < 650; i++) document.querySelector('main').prepend(document.createElement('div'));
      });
      const quoted = await call('read_x_conversation');
      assert.equal(quoted.posts.find(post => post.id === '1').text, 'A local test post');
      assert.equal(quoted.posts.find(post => post.id === '1').liked, false);
      const community = await page.evaluate(inspectXCommunityPage);
      assert.equal(community.items.find(post => post.id === '1').text, 'A local test post');
      checks.push('Quoted post identity, text and like state cannot replace their parent');
      await page.evaluate(() => {
        const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
        editor.addEventListener('focus', () => {
          document.querySelector('#status').textContent = 'Replying to @fixture';
          fixtureActions.push('reply-expanded');
        }, { once: true });
        editor.addEventListener('paste', (event) => {
          event.preventDefault();
          editor.textContent = event.clipboardData.getData('text/plain');
        });
      });
      await call('prepare_x_reply', { text: 'Exact MCP reply' });
      const draft = await call('read_x_composer');
      assert.ok(draft.editors.some((editor) => editor.text === 'Exact MCP reply'));
      assert.equal((await page.evaluate(() => fixtureActions)).filter(action => action === 'reply-expanded').length, 1);
      checks.push('Fresh X reply editor may expand on focus without invalidating its own text entry');
      const published = await call('publish_x_post');
      assert.equal(published.verification?.status, 'verified-success', JSON.stringify(published));
      assert.equal((await page.evaluate(() => fixtureActions)).filter((action) => action === 'publish').length, 1);
      checks.push('MCP inline draft and one verified publish beyond the bounded main-page prefix');
    } else if (path === '/compose/post') {
      const draft = await call('read_x_composer');
      assert.ok(draft.editorControls.some(control => control.name === 'Close reply'));
      await call('prepare_x_post', { text: 'Exact modal reply' });
      assert.equal((await call('read_x_composer')).editors.find(editor => editor.editable).text, 'Exact modal reply');
      const published = await call('publish_x_post');
      assert.equal(published.verification?.status, 'verified-success', JSON.stringify(published));
      assert.equal((await page.evaluate(() => fixtureActions)).filter(action => action === 'publish').length, 1);
      checks.push('MCP dialog draft and one verified publish despite a large aria-hidden background');
    } else {
      await call('set_x_article_title', { text: 'ToolBraid article' });
      await call('set_x_article_body', { text: 'First paragraph.\n\nSecond paragraph.' });
      assert.ok((await page.evaluate(() => fixtureNativeInputs)).includes('insertText'));
      await page.evaluate(() => {
        const editor = document.querySelector('[aria-label="Article body"]');
        editor.dataset.testid = 'composer';
        editor.innerHTML = '<span data-offset-key="fixture-0-0">Previous draft text</span>';
        let selectedText = '';
        editor.addEventListener('mouseup', () => {
          const selection = window.getSelection();
          selectedText = selection.anchorNode?.nodeType === Node.TEXT_NODE && selection.focusNode?.nodeType === Node.TEXT_NODE ? selection.toString() : '';
        });
        editor.addEventListener('paste', (event) => {
          event.preventDefault();
          fixtureActions.push('editor-paste');
          if (selectedText.replace(/\s+/g, ' ').trim() !== editor.innerText.replace(/\s+/g, ' ').trim()) throw new Error('Editor selection state was not synchronized.');
          editor.innerText = event.clipboardData.getData('text/plain');
        });
      });
      await call('set_x_article_body', { text: 'First paragraph.\n\nSecond paragraph.' });
      assert.equal((await page.evaluate(() => fixtureActions)).filter(action => action === 'editor-paste').length, 1);
      assert.equal(await page.locator('[aria-label="Article body"]').innerText(), 'First paragraph.\n\nSecond paragraph.');
      await call('select_x_article_text', { text: 'First paragraph.Second paragraph.' });
      await call('select_x_article_text', { text: 'First paragraph.' });
      await call('format_x_article_bold');
      assert.ok(await page.locator('[aria-label="Article body"] b, [aria-label="Article body"] strong').count());
      await call('save_x_article_draft');
      await call('preview_x_article');
      const article = await call('read_x_article');
      assert.equal(article.draft, true);
      assert.ok(article.editors.some((editor) => editor.text === 'ToolBraid article'));
      assert.ok(article.editors.some((editor) => editor.formatting?.some(mark => mark.kind === 'bold' && mark.text === 'First paragraph.')));
      assert.equal((await page.evaluate(() => fixtureActions)).includes('publish'), false);
      checks.push('MCP article title/body, exact selection, bold, save draft and preview without publishing');
      await call('open_x_notifications');
      await page.waitForURL('https://x.com/notifications');
      checks.push('MCP navigation follows the exact observed X link');
    }
  }
  console.log(JSON.stringify({ ok: true, browser: 'Chromium', liveX: false, transport: 'production MCP endpoint with a real DOM test adapter', checks }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
