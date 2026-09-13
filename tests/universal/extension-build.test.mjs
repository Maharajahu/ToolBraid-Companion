import assert from 'node:assert/strict';
import { access, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildUniversalExtension } from '../../scripts/build-universal-extension.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTPUT = path.join(PROJECT_ROOT, 'dist', 'test-toolbraid-extension');
const PUBLIC_OUTPUT = path.join(PROJECT_ROOT, 'dist', 'test-toolbraid-public-extension');

test('builds the public edition without changing its source identity', async (t) => {
  t.after(async () => rm(PUBLIC_OUTPUT, { recursive: true, force: true }));
  const sourcePath = path.join(PROJECT_ROOT, 'extension', 'manifest.json');
  const before = await readFile(sourcePath, 'utf8');
  const result = await buildUniversalExtension({ outputDir: PUBLIC_OUTPUT, edition: 'public' });
  const manifest = JSON.parse(await readFile(path.join(PUBLIC_OUTPUT, 'manifest.json'), 'utf8'));
  assert.equal(result.edition, 'public');
  assert.equal(manifest.name, 'ToolBraid');
  assert.equal(manifest.key, JSON.parse(before).key);
  assert.ok(manifest.description.length <= 132);
  assert.equal(manifest.permissions.includes('debugger'), true);
  assert.equal(manifest.optional_permissions.includes('debugger'), false);
  assert.match(await readFile(path.join(PUBLIC_OUTPUT, 'product.js'), 'utf8'), /PUBLIC_RELEASE = true/);
  assert.match(await readFile(path.join(PUBLIC_OUTPUT, 'product.js'), 'utf8'), /com\.toolbraid\.bridge/);
  assert.match(await readFile(path.join(PUBLIC_OUTPUT, 'privacy.html'), 'utf8'), /starts with AI control paused/);
  assert.equal(await readFile(sourcePath, 'utf8'), before);
});

test('builds a load-unpacked MV3 extension with runtime source dependencies', async (t) => {
  t.after(async () => rm(OUTPUT, { recursive: true, force: true }));
  const result = await buildUniversalExtension({ outputDir: OUTPUT });
  assert.equal(result.manifestVersion, 3);

  const manifest = JSON.parse(await readFile(path.join(OUTPUT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.background.service_worker, 'service-worker.js');
  assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
  assert.equal(manifest.permissions.includes('debugger'), true);
  assert.equal(manifest.optional_permissions.includes('debugger'), false);
  assert.equal(manifest.permissions.includes('downloads'), true);
  assert.equal('content_scripts' in manifest, false);
  assert.equal('externally_connectable' in manifest, false);
  assert.equal('update_url' in manifest, false);
  await access(path.join(OUTPUT, 'src', 'runtime', 'universal-session.js'));
  await access(path.join(OUTPUT, 'src', 'universal', 'snapshot.js'));
  await access(path.join(OUTPUT, 'multimodal-provider.js'));
  await assert.rejects(access(path.join(OUTPUT, 'src', 'site-adapters', 'github.js')));
  await assert.rejects(access(path.join(OUTPUT, 'src', 'site-adapters', 'vercel.js')));
  await assert.rejects(access(path.join(OUTPUT, 'src', 'providers', 'recovery')));
  await assert.rejects(access(path.join(OUTPUT, 'src', 'packs', 'recovery')));

  const worker = await readFile(path.join(OUTPUT, 'service-worker.js'), 'utf8');
  assert.doesNotMatch(worker, /from ['"]\.\.\/src\//);
  assert.match(worker, /createXPostAdapter\(\)/, 'production worker must register X postcondition verification');
  assert.doesNotMatch(worker, /site-adapters\/(?:index|github|vercel)|create(?:GitHub|Vercel)Adapter/);
  const universalRuntime = await readFile(path.join(OUTPUT, 'universal-runtime.js'), 'utf8');
  const multimodalProvider = await readFile(path.join(OUTPUT, 'multimodal-provider.js'), 'utf8');
  assert.doesNotMatch(universalRuntime, /from ['"]\.\.\/src\//);
  assert.doesNotMatch(multimodalProvider, /from ['"]\.\.\/src\//);
  assert.match(universalRuntime, /from ['"]\.\/src\/runtime\/index\.js['"]/);
  assert.doesNotMatch(universalRuntime, /site-adapters\/(?:index|github|vercel)|create(?:GitHub|Vercel)Adapter/);
});
