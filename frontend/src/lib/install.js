// "Install app": uses the browser's own install prompt where there is one (Chrome, Edge, Samsung Internet
// on Android and computers), and shows the manual steps where there is not (iPhone/iPad Safari, Firefox,
// in-app browsers such as Telegram or Facebook).
import { emit } from './store.js';

let deferred = null;
let installedNow = false;

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
export const isIos = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/i.test(ua);
/** Telegram, Facebook, Instagram, TikTok and similar open links in their own browser, which cannot install apps. */
export const isInAppBrowser = /FBAN|FBAV|Instagram|Telegram|Line\/|TikTok|Snapchat|; wv\)/i.test(ua);
export const isStandalone = () =>
  installedNow || window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; installedNow = true; emit(); });
}

/** True when tapping "Install" can open the browser's install window directly. */
export const canPrompt = () => !!deferred;

/** Open the browser's install window. Resolves to 'accepted', 'dismissed' or null when not available. */
export async function promptInstall() {
  if (!deferred) return null;
  const e = deferred;
  deferred = null;
  e.prompt();
  const { outcome } = await e.userChoice.catch(() => ({ outcome: 'dismissed' }));
  if (outcome === 'accepted') installedNow = true;
  emit();
  return outcome;
}

/** Which manual steps to show when there is no install window. */
export function manualKind() {
  if (isInAppBrowser) return 'inapp';
  if (isIos) return /CriOS|FxiOS|EdgiOS/.test(ua) ? 'ios-other' : 'ios';
  if (isAndroid) return /Firefox/i.test(ua) ? 'android-firefox' : 'android';
  return 'desktop';
}
