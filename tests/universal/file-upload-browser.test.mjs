import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolvePlaywright, resolveChromePath } from '../../scripts/e2e-universal-extension.mjs';
import { createFileUploadController } from '../../extension/file-upload-controller.js';

const browserCheck = { timeout: 30_000, skip: process.env.TOOLBRAID_BROWSER_LIVE !== '1' && 'Set TOOLBRAID_BROWSER_LIVE=1 with Playwright and Chromium installed.' };

test('real CDP selection produces one trusted receipt even when the page clears and removes its input', browserCheck, async () => {
  const playwright = resolvePlaywright();
  const browser = await playwright.chromium.launch({ executablePath: resolveChromePath(playwright), headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<main><input id="upload" type="file"><p id="status">Waiting</p></main>' }));
    const cdp = await page.context().newCDPSession(page);
    const sources = await Promise.all(['page-extractor.js', 'action-executor.js'].map((file) => readFile(new URL(`../../extension/${file}`, import.meta.url), 'utf8')));
    const filePath = fileURLToPath(new URL('../../package.json', import.meta.url));
    const expected = { name: path.basename(filePath), size: (await stat(filePath)).size, count: 1 };
    for (const [removeInput, shadow] of [[false, false], [true, false], [true, true]]) {
      await page.goto('https://upload.fixture.test/');
      await page.evaluate(({ remove, shadow }) => {
        window.selectionEvents = [];
        const input = document.querySelector('input');
        if (shadow) {
          const host = document.createElement('div'); document.querySelector('main').append(host);
          host.attachShadow({ mode: 'open' }).append(input);
        }
        for (const type of ['input', 'change']) input.addEventListener(type, (event) => {
          window.selectionEvents.push({ type: event.type, trusted: event.isTrusted });
          if (type === 'change') {
            document.querySelector('#status').textContent = 'Attachment ready';
            if (remove) { input.value = ''; input.remove(); }
          }
        });
      }, { remove: removeInput, shadow });
      const { frameTree } = await cdp.send('Page.getFrameTree');
      const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'toolbraid-upload-test' });
      const run = async (expression) => {
        const result = await cdp.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
      };
      await run(sources.join('\n'));
      const snapshot = await run('ToolBraidUniversalPageExtractor.extract({ documentRef: document })');
      const binding = { tabId: 7, frameId: 0, sessionId: 'test-upload-session', origin: 'https://upload.fixture.test', pageFingerprint: snapshot.pageFingerprint };
      const hook = (method) => async ({ marker }) => run(`ToolBraidUniversalActionExecutor.${method}({ documentRef: document, ...${JSON.stringify({ ref: 'id:upload', pageFingerprint: snapshot.pageFingerprint })}, marker: ${JSON.stringify(marker)} })`);
      const controller = createFileUploadController({ chromeApi: { debugger: {
        attach: async () => {}, detach: async () => {}, sendCommand: (_target, method, params) => cdp.send(method, params),
      } } });
      const result = await controller.upload({ binding, targetRef: 'id:upload', resolvedLocalPath: filePath, expectedFile: expected,
        markTarget: hook('markFileTarget'), revalidateTarget: hook('revalidateFileTarget'), cleanupTarget: hook('cleanupFileTarget'),
        verifyTarget: async (request) => { const receipt = await hook('verifyFileTarget')(request); return { ok: receipt.ok, file: { ...receipt.files[0], count: receipt.count } }; },
      });
      assert.deepEqual(result, { ok: true, file: expected });
      assert.deepEqual(await page.evaluate(() => window.selectionEvents), [{ type: 'input', trusted: true }, { type: 'change', trusted: true }]);
      assert.equal(await page.locator('#status').textContent(), 'Attachment ready');
      assert.equal(await page.locator('[data-toolbraid-file-target]').count(), 0);
    }
  } finally { await browser.close(); }
});

test('playback clock changes do not stale actions; post, editor and recipient changes still do', browserCheck, async () => {
  const playwright = resolvePlaywright();
  const browser = await playwright.chromium.launch({ executablePath: resolveChromePath(playwright), headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<main><article><p id="post">Post at 0:03</p><a href="/author/status/1">Author</a><div data-testid="videoPlayer"><span id="clock">0:03</span></div></article><div role="textbox" contenteditable="true">Draft</div></main>' }));
    await page.goto('https://x.com/author/status/1');
    await page.addScriptTag({ content: await readFile(new URL('../../extension/page-extractor.js', import.meta.url), 'utf8') });
    const snapshot = () => page.evaluate(() => ToolBraidUniversalPageExtractor.extract({ documentRef: document }));
    const before = await snapshot();
    await page.locator('#clock').evaluate((node) => { node.textContent = '0:02'; });
    const after = await snapshot();
    assert.equal(after.pageFingerprint, before.pageFingerprint);
    assert.ok(after.mainText.includes('Post at 0:03'));
    for (const [selector, text] of [['#post', 'Changed post at 0:02'], ['[role="textbox"]', 'Different draft'], ['a', 'Different recipient']]) {
      const original = await snapshot();
      await page.locator(selector).evaluate((node, value) => { node.textContent = value; }, text);
      assert.notEqual((await snapshot()).pageFingerprint, original.pageFingerprint);
    }
  } finally { await browser.close(); }
});
