import { normalizedControlText, uniqueControl, verifiedActionDescriptor } from './action.js';

export const TIKTOK_STUDIO_HOSTS = Object.freeze(['studio.tiktok.com', 'www.tiktok.com']);

function exactUploadPage(snapshot) {
  try {
    const url = new URL(snapshot.metadata.url);
    return url.protocol === 'https:' && TIKTOK_STUDIO_HOSTS.includes(url.hostname.toLowerCase())
      && !url.port && !url.username && !url.password && /(?:^|\/)(?:upload|creator-center\/upload)(?:\/|$)/i.test(url.pathname);
  } catch { return false; }
}

function caption(control) {
  const role = String(control?.role ?? '').toLowerCase();
  const type = String(control?.type ?? '').toLowerCase();
  const name = normalizedControlText(control);
  return (role === 'textbox' || type === 'textarea' || type === 'text') && /^(?:caption|description|descriere|legendă|legenda)(?:\s|$)/iu.test(name);
}

function publish(control) {
  return String(control?.role ?? '').toLowerCase() === 'button'
    && /^(?:publish|post|publică|publica)$/iu.test(normalizedControlText(control));
}

export function createTikTokStudioAdapter({ version = '1' } = {}) {
  return Object.freeze({
    id: 'tiktok-studio', version, priority: 120,
    matches: exactUploadPage,
    generateTools(snapshot) {
      const tools = [];
      const editor = uniqueControl(snapshot, caption);
      if (editor) tools.push(verifiedActionDescriptor(snapshot, {
        adapterId: 'tiktok-studio', adapterVersion: version, name: 'prepare_tiktok_caption',
        title: 'Prepare TikTok caption', description: 'Set the caption in the exact visible TikTok upload editor.',
        classification: 'mutate', risk: 'account-content', target: editor,
        inputSchema: { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: 4_000 } }, required: ['text'], additionalProperties: false },
        summary: 'Set the caption for the visible TikTok upload.',
      }));
      const button = uniqueControl(snapshot, publish);
      if (button) tools.push(verifiedActionDescriptor(snapshot, {
        adapterId: 'tiktok-studio', adapterVersion: version, name: 'publish_tiktok_video',
        title: 'Publish TikTok video', description: 'Publish using the exact visible unambiguous TikTok control.',
        target: button, summary: 'Publish the currently prepared TikTok video.',
      }));
      return Object.freeze(tools);
    },
  });
}
