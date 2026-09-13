import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../../extension/manifest.json', import.meta.url), 'utf8'));
const serviceWorker = await readFile(new URL('../../extension/service-worker.js', import.meta.url), 'utf8');

test('ToolBraid is the public MV3 extension with site opt-in', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, 'service-worker.js');
  assert.equal(manifest.background.type, 'module');
  assert.deepEqual(manifest.permissions, ['activeTab', 'alarms', 'debugger', 'downloads', 'nativeMessaging', 'scripting', 'storage', 'sidePanel', 'tabs']);
  assert.deepEqual(manifest.optional_permissions, ['notifications']);
  assert.equal('host_permissions' in manifest, false);
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*']);
  assert.equal('content_scripts' in manifest, false);
  assert.equal('externally_connectable' in manifest, false);
  assert.equal('update_url' in manifest, false);
  assert.equal(manifest.permissions.includes('tabs'), true);
  assert.equal(manifest.permissions.includes('storage'), true);
  assert.equal(manifest.permissions.includes('sidePanel'), true);
  assert.equal(manifest.permissions.includes('nativeMessaging'), true);
  assert.equal(manifest.permissions.includes('debugger'), true);
  assert.equal(manifest.optional_permissions.includes('debugger'), false);
  assert.equal(manifest.permissions.includes('downloads'), true);
  assert.equal(typeof manifest.key, 'string');
  assert.equal(manifest.action.default_title, 'Connect ToolBraid');
});

test('the worker scopes dynamic injection to the activated tab and explicit worlds', () => {
  assert.match(serviceWorker, /files:\s*\['protocol-runtime\.js', 'injector-main\.js'\]/);
  assert.match(serviceWorker, /world:\s*'MAIN'/);
  assert.match(serviceWorker, /files:\s*\['protocol-runtime\.js', 'page-extractor\.js', 'action-executor\.js', 'rendered-media-capture\.js', 'content-script\.js'\]/);
  assert.match(serviceWorker, /world:\s*'ISOLATED'/);
  assert.doesNotMatch(serviceWorker, /<all_urls>/);
});
