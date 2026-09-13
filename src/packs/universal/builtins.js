import {
  createCapabilityPackCatalog,
  publicCapabilityPackManifest,
} from './catalog.js';
import { createXPostAdapter } from '../../site-adapters/x.js';
import { createGoogleAccountAdapter } from '../../site-adapters/google.js';
import { createTikTokStudioAdapter } from '../../site-adapters/tiktok.js';
import { createYouTubeAdapter } from '../../site-adapters/youtube.js';
import { createInstagramAdapter } from '../../site-adapters/instagram.js';
import { createRedditAdapter } from '../../site-adapters/reddit.js';
import { createWhatsAppWebAdapter } from '../../site-adapters/whatsapp.js';
import { createTelegramWebAdapter } from '../../site-adapters/telegram.js';
import { createDiscordWebAdapter } from '../../site-adapters/discord.js';

// ServiceWorkerGlobalScope forbids import(), so the trusted creators are
// statically bundled while adapter instances are still created only after an
// exact catalog selector matches the active page.
const rawBuiltins = [
  {
    id: 'site.google-account', version: '1', priority: 130, maxTools: 4,
    hints: { hosts: ['accounts.google.com'], pathPrefixes: ['/'], objectiveTokens: ['google', 'login', 'sign-in', 'oauth', 'account', 'consent'] },
    load: () => createGoogleAccountAdapter(),
  },
  {
    id: 'site.whatsapp', version: '1', priority: 130, maxTools: 4,
    hints: { hosts: ['web.whatsapp.com'], pathPrefixes: ['/'], objectiveTokens: ['whatsapp', 'message', 'chat', 'send'] },
    load: () => createWhatsAppWebAdapter(),
  },
  {
    id: 'site.telegram', version: '1', priority: 130, maxTools: 4,
    hints: { hosts: ['web.telegram.org'], pathPrefixes: ['/'], objectiveTokens: ['telegram', 'message', 'chat', 'send'] },
    load: () => createTelegramWebAdapter(),
  },
  {
    id: 'site.discord', version: '1', priority: 130, maxTools: 4,
    hints: { hosts: ['discord.com'], pathPrefixes: ['/channels/'], objectiveTokens: ['discord', 'message', 'channel', 'chat', 'send'] },
    load: () => createDiscordWebAdapter(),
  },
  {
    id: 'site.tiktok', version: '1', priority: 120, maxTools: 4,
    hints: { hosts: ['studio.tiktok.com', 'www.tiktok.com'], pathPrefixes: ['/upload', '/creator-center/upload'], objectiveTokens: ['tiktok', 'upload', 'caption', 'publish', 'video'] },
    load: () => createTikTokStudioAdapter(),
  },
  {
    id: 'site.youtube', version: '1', priority: 115, maxTools: 8,
    hints: { hosts: ['youtube.com', 'www.youtube.com', 'studio.youtube.com'], pathPrefixes: ['/'], objectiveTokens: ['youtube', 'video', 'comment', 'reply', 'subscribe'] },
    load: () => createYouTubeAdapter(),
  },
  {
    id: 'site.instagram', version: '1', priority: 115, maxTools: 8,
    hints: { hosts: ['instagram.com', 'www.instagram.com'], pathPrefixes: ['/'], objectiveTokens: ['instagram', 'post', 'comment', 'reply', 'follow'] },
    load: () => createInstagramAdapter(),
  },
  {
    id: 'site.reddit', version: '1', priority: 115, maxTools: 8,
    hints: { hosts: ['reddit.com', 'www.reddit.com'], pathPrefixes: ['/'], objectiveTokens: ['reddit', 'post', 'comment', 'reply', 'upvote', 'community'] },
    load: () => createRedditAdapter(),
  },
  {
    id: 'site.x',
    version: '1',
    priority: 100,
    maxTools: 32,
    hints: {
      hosts: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
      pathPrefixes: ['/'],
      objectiveTokens: ['x', 'post', 'tweet', 'reply', 'like', 'repost', 'social'],
    },
    load: () => createXPostAdapter(),
  },
];

const trustedBuiltinCatalog = createCapabilityPackCatalog(rawBuiltins);

// Public built-in projections intentionally contain no executable loader.  A
// caller that needs to construct the trusted registry uses the explicitly
// internal factory below, never a page/provider payload.
export const UNIVERSAL_BUILTIN_CAPABILITY_PACKS = Object.freeze(
  trustedBuiltinCatalog.map(publicCapabilityPackManifest),
);

export const UNIVERSAL_X_CAPABILITY_PACK = UNIVERSAL_BUILTIN_CAPABILITY_PACKS.find((pack) => pack.id === 'site.x');
export const UNIVERSAL_GOOGLE_ACCOUNT_CAPABILITY_PACK = UNIVERSAL_BUILTIN_CAPABILITY_PACKS.find((pack) => pack.id === 'site.google-account');
export const UNIVERSAL_TIKTOK_CAPABILITY_PACK = UNIVERSAL_BUILTIN_CAPABILITY_PACKS.find((pack) => pack.id === 'site.tiktok');
export const UNIVERSAL_YOUTUBE_CAPABILITY_PACK = UNIVERSAL_BUILTIN_CAPABILITY_PACKS.find((pack) => pack.id === 'site.youtube');
export const UNIVERSAL_INSTAGRAM_CAPABILITY_PACK = UNIVERSAL_BUILTIN_CAPABILITY_PACKS.find((pack) => pack.id === 'site.instagram');
export const UNIVERSAL_REDDIT_CAPABILITY_PACK = UNIVERSAL_BUILTIN_CAPABILITY_PACKS.find((pack) => pack.id === 'site.reddit');
export const UNIVERSAL_WHATSAPP_CAPABILITY_PACK = UNIVERSAL_BUILTIN_CAPABILITY_PACKS.find((pack) => pack.id === 'site.whatsapp');
export const UNIVERSAL_TELEGRAM_CAPABILITY_PACK = UNIVERSAL_BUILTIN_CAPABILITY_PACKS.find((pack) => pack.id === 'site.telegram');
export const UNIVERSAL_DISCORD_CAPABILITY_PACK = UNIVERSAL_BUILTIN_CAPABILITY_PACKS.find((pack) => pack.id === 'site.discord');

export function createUniversalBuiltinCapabilityPackCatalog() {
  return UNIVERSAL_BUILTIN_CAPABILITY_PACKS;
}

/**
 * Internal bridge for trusted application wiring.  It is deliberately not
 * re-exported from the public universal pack index.
 */
export function createInternalUniversalBuiltinCapabilityPackCatalog() {
  return createCapabilityPackCatalog(trustedBuiltinCatalog);
}
