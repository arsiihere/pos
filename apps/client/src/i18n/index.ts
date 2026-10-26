import { en, type MessageKey } from './en';
import { ur } from './ur';

export type { MessageKey };
export type Language = 'en' | 'ur';

// S49 (as 00 M83): ?lang= first (and remembered), then the stored choice, then the device language.
const STORAGE_KEY = 'pos-lang';

function asLanguage(value: string | null | undefined): Language | null {
  return value === 'en' || value === 'ur' ? value : null;
}

export function pickLanguage(o: { search: string; stored: string | null; navigatorLanguage: string }): Language {
  return (
    asLanguage(new URLSearchParams(o.search).get('lang')) ??
    asLanguage(o.stored) ??
    (o.navigatorLanguage.toLowerCase().startsWith('ur') ? 'ur' : 'en')
  );
}

let current: Language = 'en';

export function language(): Language {
  return current;
}

export function setLanguage(lang: Language): void {
  current = lang;
}

// Called once per entry before the first render; a storage error is ignored (S49).
export function initLanguage(o: { search: string; storage: Storage | null; navigatorLanguage: string }): Language {
  let stored: string | null = null;
  try {
    stored = o.storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    // private mode or blocked storage: fall through to the device language
  }
  const lang = pickLanguage({ search: o.search, stored, navigatorLanguage: o.navigatorLanguage });
  if (asLanguage(new URLSearchParams(o.search).get('lang')) !== null) {
    try {
      o.storage?.setItem(STORAGE_KEY, lang);
    } catch {
      // not remembered; the next load picks again
    }
  }
  setLanguage(lang);
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('dir', lang === 'ur' ? 'rtl' : 'ltr');
  return lang;
}

// S49: the kit's Urdu faces are separate classes (as 00's lib/page.ts maps them).
const UR_TYPE: Record<string, string> = {
  display: 'ur-display',
  title: 'ur-title',
  heading: 'ur-title',
  'body-lg': 'ur-body',
  body: 'ur-body',
  caption: 'ur-body',
};

export function typeClass(className: string): string {
  if (current !== 'ur') return className;
  return className
    .split(' ')
    .map((name) => UR_TYPE[name] ?? name)
    .join(' ');
}

export function t(key: MessageKey): string {
  return (current === 'ur' ? ur[key] : undefined) ?? en[key];
}
