import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UNIVERSAL_BUILTIN_CAPABILITY_PACKS,
  UNIVERSAL_DISCORD_CAPABILITY_PACK,
  UNIVERSAL_GOOGLE_ACCOUNT_CAPABILITY_PACK,
  UNIVERSAL_INSTAGRAM_CAPABILITY_PACK,
  UNIVERSAL_REDDIT_CAPABILITY_PACK,
  UNIVERSAL_TELEGRAM_CAPABILITY_PACK,
  UNIVERSAL_TIKTOK_CAPABILITY_PACK,
  UNIVERSAL_WHATSAPP_CAPABILITY_PACK,
  UNIVERSAL_X_CAPABILITY_PACK,
  UNIVERSAL_YOUTUBE_CAPABILITY_PACK,
  createInternalUniversalBuiltinCapabilityPackCatalog,
  createUniversalBuiltinCapabilityPackCatalog,
} from '../../src/packs/universal/builtins.js';
import { createCapabilityPackRegistry } from '../../src/packs/universal/registry.js';
import { createSiteAdapterRegistry } from '../../src/site-adapters/registry.js';
import { createXPostAdapter } from '../../src/site-adapters/x.js';

function snapshot(url) {
  return {
    metadata: { url, title: 'Built-in pack fixture' },
    mainText: 'Bounded fixture content.',
    headings: [],
    links: [],
    forms: [],
    accessibleControls: [],
    elementRefs: [],
  };
}

test('built-in manifests are bounded, deterministic, and use exact HTTPS hosts', () => {
  assert.deepEqual(
    UNIVERSAL_BUILTIN_CAPABILITY_PACKS.map(({ id, version, priority, maxTools }) => ({ id, version, priority, maxTools })),
    [
      { id: 'site.discord', version: '1', priority: 130, maxTools: 4 },
      { id: 'site.google-account', version: '1', priority: 130, maxTools: 4 },
      { id: 'site.instagram', version: '1', priority: 115, maxTools: 8 },
      { id: 'site.reddit', version: '1', priority: 115, maxTools: 8 },
      { id: 'site.telegram', version: '1', priority: 130, maxTools: 4 },
      { id: 'site.tiktok', version: '1', priority: 120, maxTools: 4 },
      { id: 'site.whatsapp', version: '1', priority: 130, maxTools: 4 },
      { id: 'site.x', version: '1', priority: 100, maxTools: 32 },
      { id: 'site.youtube', version: '1', priority: 115, maxTools: 8 },
    ],
  );
  for (const manifest of UNIVERSAL_BUILTIN_CAPABILITY_PACKS) {
    assert.ok(manifest.hints.pathPrefixes.length > 0);
    assert.ok(manifest.hints.hosts.every((host) => !host.includes('://') && !host.includes('*')));
    assert.ok(manifest.hints.objectiveTokens.length > 0);
    assert.ok(manifest.maxTools >= 1 && manifest.maxTools <= (manifest.id === 'site.x' ? 32 : 8));
    assert.equal(Object.hasOwn(manifest, 'load'), false);
    assert.equal(Object.values(manifest).some((value) => typeof value === 'function'), false);
  }
  assert.deepEqual(createUniversalBuiltinCapabilityPackCatalog(), UNIVERSAL_BUILTIN_CAPABILITY_PACKS);
  const internal = createInternalUniversalBuiltinCapabilityPackCatalog();
  assert.equal(internal.length, UNIVERSAL_BUILTIN_CAPABILITY_PACKS.length);
  assert.equal(internal.every((manifest) => typeof manifest.load === 'function'), true);
});

test('built-in selection is exact by HTTPS host and adapter route', () => {
  const registry = createCapabilityPackRegistry({
    catalog: createInternalUniversalBuiltinCapabilityPackCatalog(),
  });
  assert.deepEqual(registry.select(snapshot('https://x.com/alice/status/123')).map(({ id }) => id), ['site.x']);
  assert.deepEqual(registry.select(snapshot('https://accounts.google.com/o/oauth2/v2/auth')).map(({ id }) => id), ['site.google-account']);
  assert.deepEqual(registry.select(snapshot('https://studio.tiktok.com/upload')).map(({ id }) => id), ['site.tiktok']);
  assert.deepEqual(registry.select(snapshot('https://www.youtube.com/watch?v=abc')).map(({ id }) => id), ['site.youtube']);
  assert.deepEqual(registry.select(snapshot('https://www.instagram.com/p/abc/')).map(({ id }) => id), ['site.instagram']);
  assert.deepEqual(registry.select(snapshot('https://www.reddit.com/r/test/comments/abc/post/')).map(({ id }) => id), ['site.reddit']);
  assert.deepEqual(registry.select(snapshot('https://web.whatsapp.com/')).map(({ id }) => id), ['site.whatsapp']);
  assert.deepEqual(registry.select(snapshot('https://web.telegram.org/a/')).map(({ id }) => id), ['site.telegram']);
  assert.deepEqual(registry.select(snapshot('https://discord.com/channels/@me/123')).map(({ id }) => id), ['site.discord']);
  assert.deepEqual(registry.select(snapshot('https://github.com/acme/tool')), []);
  assert.deepEqual(registry.select(snapshot('https://vercel.com/acme/tool')), []);
  assert.deepEqual(registry.select(snapshot('http://x.com/alice/status/123')), []);
  assert.deepEqual(registry.select(snapshot('https://evil-x.com/alice/status/123')), []);
  assert.deepEqual(registry.select(snapshot('https://github.com.evil.test/acme/tool')), []);
  assert.deepEqual(registry.select(snapshot('https://accounts.google.com.evil.test/login')), []);
  assert.deepEqual(registry.select(snapshot('https://studio.tiktok.com.evil.test/upload')), []);
});

test('each lazy loader invokes the existing adapter creator and exposes only its current read surface', async () => {
  const expected = [
    ['site.google-account', UNIVERSAL_GOOGLE_ACCOUNT_CAPABILITY_PACK, 'google-account'],
    ['site.discord', UNIVERSAL_DISCORD_CAPABILITY_PACK, 'discord-web'],
    ['site.instagram', UNIVERSAL_INSTAGRAM_CAPABILITY_PACK, 'instagram-content', 'read_instagram_content', 'https://www.instagram.com/p/abc/'],
    ['site.reddit', UNIVERSAL_REDDIT_CAPABILITY_PACK, 'reddit-content', 'read_reddit_content', 'https://www.reddit.com/r/test/comments/abc/post/'],
    ['site.telegram', UNIVERSAL_TELEGRAM_CAPABILITY_PACK, 'telegram-web'],
    ['site.tiktok', UNIVERSAL_TIKTOK_CAPABILITY_PACK, 'tiktok-studio'],
    ['site.whatsapp', UNIVERSAL_WHATSAPP_CAPABILITY_PACK, 'whatsapp-web'],
    ['site.x', UNIVERSAL_X_CAPABILITY_PACK, 'x-post', 'read_x_post', 'https://x.com/alice/status/123'],
    ['site.youtube', UNIVERSAL_YOUTUBE_CAPABILITY_PACK, 'youtube-content', 'read_youtube_content', 'https://www.youtube.com/watch?v=abc'],
  ];
  const trusted = createInternalUniversalBuiltinCapabilityPackCatalog();
  for (const [packId, publicManifest, adapterId, toolName, url] of expected) {
    const manifest = trusted.find((entry) => entry.id === packId);
    assert.equal(Object.hasOwn(publicManifest, 'load'), false);
    const adapter = await manifest.load();
    assert.equal(adapter.id, adapterId);
    assert.equal(adapter.version, '1');
    assert.equal(typeof adapter.matches, 'function');
    assert.equal(typeof adapter.generateTools, 'function');
    if (!url) continue;
    const result = await createCapabilityPackRegistry({ catalog: [manifest] }).resolve(snapshot(url));
    assert.deepEqual(result.tools.map(({ name }) => name), packId === 'site.x' ? ['read_x_conversation', toolName] : [toolName]);
    assert.equal(result.tools[0].adapter.id, adapterId);
    assert.equal(result.tools[0].adapter.version, '1');
    assert.equal(result.tools.some((tool) => typeof tool.execute === 'function'), false);
    assert.equal(result.tools.some((tool) => tool.classification === 'mutate'), false);
  }
});

test('built-in descriptors execute through the existing Universal verified-read runtime without duplication', async () => {
  const cases = [
    ['site.x', 'https://x.com/alice/status/123', createXPostAdapter(), 'x-post', 'x-post'],
  ];
  const trusted = createInternalUniversalBuiltinCapabilityPackCatalog();
  for (const [packId, url, adapter, adapterId, resultType] of cases) {
    const packRegistry = createCapabilityPackRegistry({
      catalog: [trusted.find((manifest) => manifest.id === packId)],
    });
    const page = snapshot(url);
    const resolved = await packRegistry.resolve(page, { sessionId: `${packId}-runtime` });
    assert.equal(resolved.tools.length, 2);
    assert.equal(new Set(resolved.tools.map(({ name }) => name)).size, resolved.tools.length);
    assert.deepEqual(resolved.tools[0].adapter, { id: adapterId, version: '1' });
    const runtime = createSiteAdapterRegistry({ adapters: [adapter] });
    const read = runtime.executeRead(resolved.tools.find((tool) => tool.name === 'read_x_post'), page);
    assert.equal(read.type, resultType);
  }
});
