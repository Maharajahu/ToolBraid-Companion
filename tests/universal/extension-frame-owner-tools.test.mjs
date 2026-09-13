import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrameOwnerTools } from '../../extension/frame-owner-tools.js';

function fixture() {
  let now = 1_000;
  let active = { id: 7, windowId: 2 };
  const sessions = new Map([
    ['7:0', { tabId: 7, frameId: 0, sessionId: 'top-session', url: 'https://example.test/', state: 'active' }],
    ['7:3', { tabId: 7, frameId: 3, sessionId: 'frame-session', url: 'https://frame.test/app', state: 'active' }],
    ['7:4', { tabId: 7, frameId: 4, sessionId: 'chrome-frame', url: 'chrome://settings/', state: 'active' }],
  ]);
  const registry = { list: (tabId) => [...sessions.values()].filter((item) => item.tabId === tabId), get: (tabId, frameId) => sessions.get(`${tabId}:${frameId}`) ?? null };
  let byte = 0;
  const changes = [];
  const tools = createFrameOwnerTools({ chromeApi: { tabs: { query: async () => [active] } }, lifecycleRegistry: registry, nowRef: () => now, cryptoRef: { getRandomValues(array) { array.fill(++byte); } }, onSelectionChanged: (value) => changes.push(value) });
  return { tools, sessions, changes, setActive: (value) => { active = value; }, advance: (value) => { now += value; } };
}

test('lists only accessible HTTP(S) active-tab sessions and selects exact handle', async () => {
  const h = fixture();
  const listed = await h.tools.call('toolbraid.frame.list');
  assert.deepEqual(listed.frames.map((frame) => [frame.frameId, frame.top]), [[0, true], [3, false]]);
  assert.equal(listed.frames[0].url, 'https://example.test/');
  assert.deepEqual(await h.tools.call('toolbraid.frame.select', { handle: listed.frames[1].handle }), { selected: true, frameId: 3, top: false });
  assert.equal(h.tools.selectedFrameId(), 3);
  assert.equal(h.changes.length, 1);
});

test('selection survives provider handle invalidation but fails closed on session drift', async () => {
  const h = fixture();
  const listed = await h.tools.call('toolbraid.frame.list');
  await h.tools.call('toolbraid.frame.select', { handle: listed.frames[1].handle });
  h.tools.invalidate();
  assert.equal(h.tools.selectedFrameId(), 3);
  h.sessions.set('7:3', { ...h.sessions.get('7:3'), sessionId: 'replacement-session' });
  assert.equal(h.tools.selectedFrameId(), 0);
  assert.equal(h.changes.at(-1), null);
});

test('rejects expired handles and active-tab drift', async () => {
  const h = fixture();
  let listed = await h.tools.call('toolbraid.frame.list');
  h.advance(300_001);
  await assert.rejects(h.tools.call('toolbraid.frame.select', { handle: listed.frames[1].handle }), { code: 'FRAME_HANDLE_STALE' });
  listed = await h.tools.call('toolbraid.frame.list');
  h.setActive({ id: 8, windowId: 2 });
  await assert.rejects(h.tools.call('toolbraid.frame.select', { handle: listed.frames[1].handle }), { code: 'FRAME_ACTIVE_TAB_DRIFT' });
});

test('reset binds the current top session and descriptors match owner-provider API', async () => {
  const h = fixture();
  assert.deepEqual(h.tools.descriptors().map((tool) => tool.name), ['toolbraid.frame.list', 'toolbraid.frame.select', 'toolbraid.frame.reset']);
  assert.deepEqual(await h.tools.call('toolbraid.frame.reset'), { selected: true, frameId: 0, top: true });
  assert.equal(h.tools.selectedFrameId(), 0);
});
