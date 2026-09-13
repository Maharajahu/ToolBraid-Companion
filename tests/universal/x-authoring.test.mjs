import assert from 'node:assert/strict';
import test from 'node:test';
import { createPageSnapshot, prepareAction } from '../../src/universal/index.js';
import { createXPostAdapter, isXDirectAction, extractXPost } from '../../src/site-adapters/x.js';
import { readXContext, verifyXPublication } from '../../src/site-adapters/x-authoring.js';

const adapter = createXPostAdapter();
const button = (ref, name, id = '') => ({ ref, name, role: 'button', type: 'button', attributes: { 'data-testid': id } });
const field = (ref, name, type = 'text') => ({ ref, name, role: 'textbox', type });
function snapshot(path, overrides = {}) {
  return createPageSnapshot({ metadata: { url: `https://x.com${path}`, origin: 'https://x.com', title: 'X content fixture', xContent: overrides.content ?? { posts: [], editors: [] } },
    mainText: 'Rendered content', accessibleControls: overrides.controls ?? [], links: overrides.links ?? [], elementRefs: overrides.elements ?? [] });
}

test('community reads return exact post IDs, like states and partial coverage without confusing parent and reply', () => {
  const source = snapshot('/owner/status/1', { content: { account: '@owner', coverage: 'Rendered only', posts: [
    { id: '2', author: '@friend', url: 'https://x.com/friend/status/2', text: 'A reply', liked: true },
  ] } });
  const tools = adapter.generateTools(source);
  assert.ok(tools.some((tool) => tool.name === 'read_x_conversation'));
  assert.equal(extractXPost(source).available, false);
  const result = readXContext('read_x_conversation', source);
  assert.equal(result.posts[0].liked, true);
  assert.equal(result.posts[0].url, 'https://x.com/friend/status/2');
  assert.equal(result.coverage, 'Rendered only');
});

test('X navigation links remain exact-bound and settings/DM routes are excluded', () => {
  const source = snapshot('/home', { links: [{ ref: 'notifications', href: 'https://x.com/notifications', text: 'Notifications' },
    { ref: 'phishing', href: 'https://example.test/notifications', text: 'Notifications' },
    { ref: 'settings', href: 'https://x.com/settings', text: 'Settings' }] });
  const tools = adapter.generateTools(source);
  const tool = tools.find((entry) => entry.name === 'open_x_notifications');
  assert.equal(isXDirectAction(tool), true);
  assert.equal(prepareAction({ snapshot: source, descriptor: tool, input: {} }).target.ref, 'notifications');
  assert.equal(tools.some((entry) => entry.target?.ref === 'phishing' || entry.target?.ref === 'settings'), false);
  assert.equal(adapter.matches(snapshot('/messages')), false);
  assert.equal(adapter.matches(snapshot('/settings/profile')), false);
});

test('article authoring exposes distinct draft, title/body, preview and publish tools only for exact controls', () => {
  const source = snapshot('/compose/articles/123', { controls: [field('title', 'Title'), field('body', 'Article body', 'contenteditable'),
    button('save', 'Save draft'), button('preview', 'Preview'), button('publish', 'Publish'), button('bold', 'Bold')],
  content: { editors: [{ ref: 'title', text: 'Title' }, { ref: 'body', editable: true, text: 'First paragraph' }], attachments: [], posts: [] } });
  const tools = adapter.generateTools(source);
  for (const name of ['read_x_article', 'set_x_article_title', 'set_x_article_body', 'save_x_article_draft', 'preview_x_article', 'publish_x_article', 'format_x_article_bold']) assert.ok(tools.some((tool) => tool.name === name), name);
  const body = tools.find((tool) => tool.name === 'set_x_article_body');
  assert.equal(prepareAction({ snapshot: source, descriptor: body, input: { text: 'One\n\nTwo' } }).arguments.text, 'One\n\nTwo');
  assert.equal(body.requiresApproval, true);
  assert.equal(isXDirectAction(body), true);
  assert.equal(readXContext('read_x_article', source).publicationVerified, false);
});

test('real X create label is supported only on article routes and only when unambiguous', () => {
  const controls = [button('new-article', 'create')];
  const source = snapshot('/compose/articles', { controls });
  const create = adapter.generateTools(source).find((tool) => tool.name === 'create_x_article');
  assert.equal(prepareAction({ snapshot: source, descriptor: create, input: {} }).target.ref, 'new-article');
  assert.equal(isXDirectAction(create), true);
  assert.equal(adapter.generateTools(snapshot('/home', { controls })).some((tool) => tool.name === 'create_x_article'), false);
  assert.equal(adapter.generateTools(snapshot('/compose/articles', { controls: [...controls, button('other', 'create')] })).some((tool) => tool.name === 'create_x_article'), false);
});

test('real Romanian article title and unlabeled formatting buttons bind by exact test IDs', () => {
  const source = snapshot('/compose/articles/edit/123', { controls: [field('title', 'Adaugă un titlu', 'textarea'),
    button('bold', '', 'btn-bold'), button('italic', '', 'btn-italic'), button('list', '', 'btn-ul'),
    { ref: 'preview', role: 'link', name: 'Previzualizează', href: 'https://x.com/compose/articles/preview/123' }] });
  const tools = adapter.generateTools(source);
  for (const name of ['set_x_article_title', 'format_x_article_bold', 'format_x_article_italic', 'format_x_article_list', 'preview_x_article']) assert.ok(tools.some(tool => tool.name === name), name);
});

test('upload progress prevents exposing publication and ambiguous attachment removal is not guessed', () => {
  const source = snapshot('/compose/post', { controls: [field('editor', 'Post text'), button('publish', 'Post', 'tweetButton'),
    button('remove-a', 'Remove image'), button('remove-b', 'Remove image')],
  content: { editors: [{ ref: 'editor', text: 'Caption' }], attachments: [{ kind: 'video' }], uploadBusy: true, feedback: ['Processing video'] } });
  const tools = adapter.generateTools(source);
  assert.equal(tools.some((tool) => tool.name === 'publish_x_post' || tool.name === 'remove_x_media'), false);
  assert.equal(readXContext('read_x_media_status', source).uploadState, 'processing');
});

test('publishing requires a new matching post from the same account, not a click or cleared editor', () => {
  const before = snapshot('/compose/post', { content: { account: '@owner', editors: [{ editable: true, text: 'Exact reply' }], posts: [{ id: '1' }] } });
  const after = snapshot('/home', { content: { account: '@owner', editors: [], posts: [{ id: '2', author: '@owner', text: 'Exact reply', url: 'https://x.com/owner/status/2' }] } });
  assert.equal(verifyXPublication({ tool: { name: 'publish_x_post' }, beforeSnapshot: before, afterSnapshot: after }).status, 'verified-success');
  assert.equal(verifyXPublication({ tool: { name: 'publish_x_post' }, beforeSnapshot: before, afterSnapshot: before }).status, 'unverified');
  const other = snapshot('/home', { content: { ...after.metadata.xContent, account: '@other' } });
  assert.equal(verifyXPublication({ tool: { name: 'publish_x_post' }, beforeSnapshot: before, afterSnapshot: other }).status, 'unverified');
});

test('unlike is an explicit separate action and verifies the opposite state transition', () => {
  const before = snapshot('/owner/status/1', { controls: [button('unlike', 'Unlike', 'unlike')] });
  const after = snapshot('/owner/status/1', { controls: [button('like', 'Like', 'like')] });
  const tools = adapter.generateTools(before);
  assert.equal(tools.some((tool) => tool.name === 'like_x_post'), false);
  const unlike = tools.find((tool) => tool.name === 'unlike_x_post');
  assert.ok(unlike);
  assert.equal(adapter.verifyPostcondition({ tool: unlike, beforeSnapshot: before, afterSnapshot: after }).reasonCode, 'X_UNLIKE_STATE_CONFIRMED');
});

test('article publication needs matching public article content and account, not a review dialog', () => {
  const before = snapshot('/compose/articles/123', { content: { account: '@owner', editors: [{ editable: true, text: 'The full article body.' }] } });
  const after = snapshot('/owner/status/456', { content: { account: '@owner', article: { url: 'https://x.com/owner/status/456', text: 'The full article body.', truncated: false } } });
  const verify = (afterSnapshot) => verifyXPublication({ tool: { name: 'publish_x_article' }, beforeSnapshot: before, afterSnapshot });
  assert.equal(verify(after).status, 'verified-success');
  assert.equal(verify(before).status, 'unverified');
  assert.equal(verify(snapshot('/owner/status/456', { content: { ...after.metadata.xContent, account: '@other' } })).status, 'unverified');
  assert.equal(verify(snapshot('/owner/status/456', { content: { ...after.metadata.xContent, article: { ...after.metadata.xContent.article, text: 'Different article' } } })).status, 'unverified');
});
