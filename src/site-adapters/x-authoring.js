import { verifiedActionDescriptor, uniqueControl } from './action.js';

export const X_AUTHORING_ACTIONS = new Set([
  'open_x_reply_composer', 'unlike_x_post', 'bookmark_x_post', 'remove_x_bookmark',
  'open_x_home', 'open_x_notifications', 'open_x_mentions', 'open_x_articles', 'open_x_compose', 'open_x_bookmarks',
  'create_x_article', 'edit_x_article', 'set_x_article_title', 'set_x_article_body',
  'save_x_article_draft', 'preview_x_article', 'publish_x_article', 'confirm_x_article_publish',
  'select_x_article_text',
  'remove_x_media', 'edit_x_media', 'set_x_media_alt_text', 'save_x_media_edit',
  'format_x_article_bold', 'format_x_article_italic', 'format_x_article_heading', 'format_x_article_list',
]);

const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const testId = (control) => text(control?.attributes?.['data-testid']).toLowerCase();
const context = (snapshot) => snapshot.metadata.xContent ?? { posts: [], editors: [], attachments: [], feedback: [], coverage: 'Only the currently rendered snapshot is available.' };
const articleRoute = (snapshot) => /^\/(?:compose\/articles|i\/articles?)(?:\/|$)/.test(new URL(snapshot.metadata.url).pathname);

export function isXContentRoute(url) {
  return !/^\/(?:messages|i\/chat|settings|account|login|signup|logout|i\/flow)(?:\/|$)/.test(url.pathname);
}

export function generateXAuthoringTools(snapshot, version, descriptor) {
  const tools = [];
  const onArticle = articleRoute(snapshot);
  const onPost = /^\/[A-Za-z0-9_]+\/status\/\d+$/.test(new URL(snapshot.metadata.url).pathname);
  const addRead = (name, title, description) => tools.push(descriptor(snapshot, version, {
    name, title, description, classification: 'read', risk: 'read-only', summary: description,
  }));
  addRead(onPost ? 'read_x_conversation' : 'read_x_timeline', onPost ? 'Read X conversation' : 'Read X timeline',
    'Read rendered post IDs, exact permalinks, authors, text, media and like/repost/bookmark state. Reports partial coverage; scroll to load more.');
  if (new URL(snapshot.metadata.url).pathname.startsWith('/notifications')) addRead('read_x_notifications', 'Read X notifications', 'Read the currently rendered notifications and mentions, with exact post links when present.');
  const data = context(snapshot);
  if (data.editors?.length) {
    addRead('read_x_composer', 'Inspect X draft', 'Read the current visible editor text and attachments before publishing. This does not change or publish the draft.');
    addRead('read_x_media_status', 'Inspect X media upload', 'Read attached image/video previews, upload progress, errors and publish-button readiness. A selected file is not proof of a completed upload.');
  }
  if (onArticle || snapshot.elementRefs.some((element) => /article.*(?:richtext|content)|longform/i.test(testId(element)))) {
    addRead('read_x_article', 'Read X article or draft', 'Read the current article page and its editable title/body when available. Reports draft and publication evidence separately.');
  }

  const addAction = (name, title, target, description, inputSchema) => {
    if (!target) return;
    const action = verifiedActionDescriptor(snapshot, { adapterId: 'x-post', adapterVersion: version, name, title,
      description, target, inputSchema, risk: 'account-content', summary: description });
    tools.push(['publish_x_article', 'confirm_x_article_publish'].includes(name) ? { ...action,
      postcondition: { version: 1, id: 'x.article.publish.v1', adapterId: 'x-post', adapterVersion: String(version), observation: 'page-snapshot' } } : action);
  };
  const button = (pattern) => uniqueControl(snapshot, (control) => ['button', 'menuitem'].includes(control.role) && pattern.test(text(control.name)));
  const field = (pattern) => uniqueControl(snapshot, (control) => control.role === 'textbox' && pattern.test(text(control.name)));
  const valueSchema = (maxLength) => ({ type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength } }, required: ['text'], additionalProperties: false });

  const navigation = new Map([
    ['/home', 'home'], ['/notifications', 'notifications'], ['/notifications/mentions', 'mentions'],
    ['/compose/articles', 'articles'], ['/i/articles', 'articles'], ['/compose/post', 'compose'], ['/compose/tweet', 'compose'], ['/i/bookmarks', 'bookmarks'],
  ]);
  const usedRoutes = new Set();
  for (const link of snapshot.links) {
    let url;
    try { url = new URL(link.href, snapshot.metadata.url); } catch { continue; }
    if (url.origin !== snapshot.metadata.origin || url.search || url.hash) continue;
    const route = navigation.get(url.pathname);
    if (!route || usedRoutes.has(route)) continue;
    usedRoutes.add(route);
    const tool = descriptor(snapshot, version, { name: `open_x_${route}`, title: `Open X ${route}`,
      description: 'Open the exact observed X navigation link. Does not create or publish content.', classification: 'mutate', risk: 'navigation', target: link, targetType: 'link', summary: `Open X ${route}.` });
    tools.push(tool);
  }

  if (onArticle) {
    addAction('create_x_article', 'Create X article draft', button(/^(?:write|write article|create|create article|new article|scrie|articol nou|creează articol)$/iu), 'Open the X article editor; do not publish.');
    addAction('edit_x_article', 'Edit X article draft', button(/^(?:edit article|edit|editează articolul|editează)$/iu), 'Open editing for the exact current article.');
    addAction('set_x_article_title', 'Set X article title', field(/^(?:title|article title|add a title|titlu|titlul articolului|adaugă un titlu)$/iu), 'Replace the current article title. X may autosave the draft; this does not publish.', valueSchema(300));
    const body = uniqueControl(snapshot, (control) => control.role === 'textbox'
      && (/^(?:body|article body|article text|start writing|write your article|content|conținut|textul articolului)$/iu.test(text(control.name))
        || context(snapshot).editors?.some((editor) => editor.ref === control.ref && editor.editable)));
    addAction('set_x_article_body', 'Set X article body', body, 'Replace the article body with plain text, including paragraph breaks. Review the resulting draft before publishing.', valueSchema(24000));
    if (body) {
      const selection = verifiedActionDescriptor(snapshot, { adapterId: 'x-post', adapterVersion: version,
        name: 'select_x_article_text', title: 'Select exact X article text', target: body, risk: 'account-content',
        inputSchema: { type: 'object', additionalProperties: false, required: ['text'], properties: {
          text: { type: 'string', minLength: 1, maxLength: 4000 }, occurrence: { type: 'integer', minimum: 1, maximum: 100 } } },
        description: 'Select the exact text occurrence in this article editor before applying a formatting control. Does not replace text or publish.', summary: 'Select exact article text.' });
      tools.push({ ...selection, effect: { ...selection.effect, operation: 'select-text' } });
    }
    addAction('save_x_article_draft', 'Save X article draft', button(/^(?:save draft|save|salvează ciorna|salvează)$/iu), 'Click the exact draft Save control. Read the draft again to inspect save status.');
    addAction('preview_x_article', 'Preview X article', uniqueControl(snapshot, (control) => ['button', 'link'].includes(control.role) && /^(?:preview|previzualizare|previzualizează)$/iu.test(text(control.name))), 'Open the article preview without publishing.');
    if (!data.uploadBusy) {
      addAction('publish_x_article', 'Review X article publication', button(/^(?:publish|publish article|publică|publică articolul)$/iu), 'Advance the exact article publication control. If X opens a review dialog, inspect it before confirming; a click alone is not proof of publication.');
      addAction('confirm_x_article_publish', 'Confirm X article publication', button(/^(?:confirm and publish|publish now|confirmă și publică|publică acum)$/iu), 'Confirm publication of the reviewed article. Verify a published URL and article content afterwards; never retry an uncertain send.');
    }
    for (const [suffix, pattern, id] of [['bold', /^(?:bold|aldin)$/iu, 'btn-bold'], ['italic', /^(?:italic|cursiv)$/iu, 'btn-italic'], ['heading', /^(?:heading|heading 1|heading 2|titlu de secțiune)$/iu, ''], ['list', /^(?:bulleted list|bullet list|listă cu marcatori)$/iu, 'btn-ul']]) {
      const target = uniqueControl(snapshot, (control) => ['button', 'menuitem'].includes(control.role) && (pattern.test(text(control.name)) || Boolean(id && testId(control) === id)));
      addAction(`format_x_article_${suffix}`, `Format X article: ${suffix}`, target, 'Apply the exact visible formatting control to the current editor selection. Inspect the draft afterwards.');
    }
  }
  if (data.editors?.length) {
    addAction('remove_x_media', 'Remove X draft media', button(/^(?:remove media|remove image|remove video|remove photo|elimină imaginea|elimină videoclipul)$/iu), 'Remove the single unambiguous draft attachment, without publishing.');
    addAction('edit_x_media', 'Edit X draft media', button(/^(?:edit media|edit image|edit photo|edit video|edit cover|add cover|add cover image|adaugă copertă|editează imaginea)$/iu), 'Open the exact draft media or article cover editor.');
    addAction('set_x_media_alt_text', 'Set X image description', field(/^(?:alt text|image description|description|text alternativ|descrierea imaginii)$/iu), 'Set an accessibility description in the open image editor.', valueSchema(1000));
    addAction('save_x_media_edit', 'Save X media edit', button(/^(?:save media|save image|save description|salvează descrierea)$/iu), 'Save the currently reviewed media edit, without publishing the post.');
  }
  return tools;
}

export function readXContext(name, snapshot) {
  const data = structuredClone(context(snapshot));
  const common = { url: snapshot.metadata.url, pageFingerprint: snapshot.pageFingerprint, untrustedContent: true, account: data.account ?? null };
  const editorControls = snapshot.accessibleControls.filter((control) => ['textbox', 'button', 'menuitem', 'link'].includes(control.role)).slice(0, 80)
    .map(({ ref, role, name, type, disabled, attributes }) => ({ ref, role, name, type, disabled, testId: attributes?.['data-testid'] ?? null }));
  if (['read_x_timeline', 'read_x_conversation', 'read_x_notifications'].includes(name)) return { ...common, type: name.slice(5), posts: data.posts ?? [], coverage: data.coverage,
    ...(name === 'read_x_notifications' ? { visibleText: snapshot.mainText } : {}) };
  if (name === 'read_x_composer') return { ...common, editors: data.editors ?? [], editorControls, attachments: data.attachments ?? [], feedback: data.feedback ?? [], uploadBusy: data.uploadBusy === true, published: false };
  if (name === 'read_x_media_status') {
    const publishEnabled = snapshot.accessibleControls.some((control) => control.disabled !== true && ['tweetbutton', 'tweetbuttoninline'].includes(testId(control)));
    return { ...common, attachments: data.attachments ?? [], processing: data.uploadBusy === true,
      feedback: data.feedback ?? [], publishEnabled, uploadState: data.uploadBusy ? 'processing' : data.attachments?.length ? 'preview-visible' : 'no-preview',
      verification: 'A visible preview is not a server-side upload receipt; inspect processing/errors and the enabled publish control.' };
  }
  if (name === 'read_x_article') return { ...common, title: data.article?.title || snapshot.metadata.title, text: data.article?.text || snapshot.mainText, editors: data.editors ?? [], editorControls, attachments: data.attachments ?? [], feedback: data.feedback ?? [], draft: articleRoute(snapshot), publicationVerified: false };
  return null;
}

export function verifyXPublication({ tool, beforeSnapshot, afterSnapshot }) {
  const article = ['publish_x_article', 'confirm_x_article_publish'].includes(tool?.name);
  if (tool?.name !== 'publish_x_post' && !article) return null;
  const before = context(beforeSnapshot);
  const after = context(afterSnapshot);
  const sameAccount = Boolean(before.account && before.account === after.account);
  const sameOrigin = beforeSnapshot.metadata.origin === afterSnapshot.metadata.origin;
  if (article) {
    const body = before.editors?.filter((editor) => editor.editable && text(editor.text));
    const publicRoute = /^\/(?:[A-Za-z0-9_]+\/status|i\/article)\/\d+$/.test(new URL(afterSnapshot.metadata.url).pathname);
    const verified = sameOrigin && sameAccount && publicRoute && after.article?.url === afterSnapshot.metadata.url
      && body?.length === 1 && !after.article.truncated && text(body[0].text) === text(after.article.text);
    return { status: verified ? 'verified-success' : 'unverified', reasonCode: verified ? 'X_PUBLISHED_ARTICLE_OBSERVED' : 'X_ARTICLE_PUBLICATION_NOT_CONFIRMED',
      evidence: { publishedUrl: verified ? after.article.url : null, accountMatched: sameAccount }, afterPageFingerprint: afterSnapshot.pageFingerprint };
  }
  const draft = before.editors?.filter((editor) => editor.editable && text(editor.text));
  const oldIds = new Set(before.posts?.map((post) => post.id));
  const candidate = sameOrigin && draft?.length === 1 && sameAccount
    ? after.posts?.filter((post) => !oldIds.has(post.id) && post.author.toLowerCase() === before.account.toLowerCase() && !post.truncated && text(post.text) === text(draft[0].text)) : [];
  const verified = candidate?.length === 1;
  return { status: verified ? 'verified-success' : 'unverified', reasonCode: verified ? 'X_PUBLISHED_POST_OBSERVED' : 'X_PUBLICATION_NOT_CONFIRMED',
    evidence: { publishedUrl: verified ? candidate[0].url : null, accountMatched: sameAccount }, afterPageFingerprint: afterSnapshot.pageFingerprint };
}
