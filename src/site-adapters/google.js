import { normalizedControlText, uniqueControl, verifiedActionDescriptor } from './action.js';

export const GOOGLE_ACCOUNT_HOSTS = Object.freeze(['accounts.google.com']);

function exactGooglePage(snapshot) {
  try {
    const url = new URL(snapshot.metadata.url);
    return url.protocol === 'https:' && GOOGLE_ACCOUNT_HOSTS.includes(url.hostname.toLowerCase()) && !url.port && !url.username && !url.password;
  } catch { return false; }
}

function role(control, values) {
  return values.includes(String(control?.role ?? '').toLowerCase());
}

function accountChoice(control) {
  const text = normalizedControlText(control);
  const testId = String(control?.attributes?.['data-identifier'] ?? control?.attributes?.['data-email'] ?? '').trim();
  const looksAccount = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testId);
  return role(control, ['button', 'link', 'option', 'radio']) && looksAccount;
}

function positiveConsent(control) {
  if (!role(control, ['button'])) return false;
  return /^(?:continue|allow|confirm|yes,? continue|accept|permite|continuă|continua|confirmă|confirma)$/iu.test(normalizedControlText(control));
}

function requiresHumanAuthentication(snapshot) {
  return snapshot.accessibleControls.some((control) => {
    const type = String(control?.type ?? '').toLowerCase();
    const text = normalizedControlText(control);
    return type === 'password'
      || /\b(?:verification code|one[- ]time code|authenticator|captcha|not a robot|passkey|security key|parol[ăa]|cod de verificare)\b/iu.test(text);
  });
}

export function createGoogleAccountAdapter({ version = '1' } = {}) {
  return Object.freeze({
    id: 'google-account', version, priority: 130,
    matches: exactGooglePage,
    generateTools(snapshot) {
      if (requiresHumanAuthentication(snapshot)) return Object.freeze([]);
      const tools = [];
      const accounts = snapshot.accessibleControls.filter((control) => control?.disabled !== true && accountChoice(control)).slice(0, 8);
      for (const [index, account] of accounts.entries()) {
        const label = normalizedControlText(account)
          || String(account?.attributes?.['data-identifier'] ?? account?.attributes?.['data-email'] ?? '').trim();
        tools.push(verifiedActionDescriptor(snapshot, {
          adapterId: 'google-account', adapterVersion: version,
          name: accounts.length === 1 ? 'choose_google_account' : `choose_google_account_${index + 1}`,
          title: `Choose Google account: ${label}`.slice(0, 180),
          description: `Select the exact visible already-authenticated Google account labelled ${label}.`,
          target: account, summary: 'Select the exact visible Google account for this sign-in.',
        }));
      }
      const consent = uniqueControl(snapshot, positiveConsent);
      if (consent) tools.push(verifiedActionDescriptor(snapshot, {
        adapterId: 'google-account', adapterVersion: version, name: 'confirm_google_sign_in',
        title: 'Confirm Google sign-in', description: 'Activate the exact visible positive Google OAuth consent control.',
        target: consent, summary: 'Confirm the visible Google sign-in or OAuth consent step.',
      }));
      return Object.freeze(tools);
    },
  });
}
