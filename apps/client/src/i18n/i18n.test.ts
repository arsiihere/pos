import { afterEach, describe, expect, it } from 'vitest';
import { en, fill } from './en';
import { initLanguage, language, pickLanguage, setLanguage, t, typeClass } from './index';
import { ur } from './ur';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

afterEach(() => {
  setLanguage('en');
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('dir');
});

describe('[01a §10 #159] language (S49)', () => {
  it('picks ?lang first, then the stored value, then navigator.language', () => {
    expect(pickLanguage({ search: '?lang=ur', stored: 'en', navigatorLanguage: 'en-US' })).toBe('ur');
    expect(pickLanguage({ search: '?lang=en', stored: 'ur', navigatorLanguage: 'ur-PK' })).toBe('en');
    expect(pickLanguage({ search: '', stored: 'en', navigatorLanguage: 'ur-PK' })).toBe('en');
    expect(pickLanguage({ search: '', stored: null, navigatorLanguage: 'ur-PK' })).toBe('ur');
    expect(pickLanguage({ search: '', stored: null, navigatorLanguage: 'en-US' })).toBe('en');
    expect(pickLanguage({ search: '?lang=fr', stored: 'xx', navigatorLanguage: 'en-US' })).toBe('en');
  });

  it('?lang=ur sets <html lang="ur" dir="rtl"> and stores pos-lang', () => {
    const storage = memoryStorage();
    expect(initLanguage({ search: '?lang=ur', storage, navigatorLanguage: 'en-US' })).toBe('ur');
    expect(document.documentElement.getAttribute('lang')).toBe('ur');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(storage.getItem('pos-lang')).toBe('ur');
    expect(language()).toBe('ur');

    expect(initLanguage({ search: '', storage, navigatorLanguage: 'en-US' })).toBe('ur');
    expect(initLanguage({ search: '?lang=en', storage, navigatorLanguage: 'ur-PK' })).toBe('en');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('a storage that throws is ignored', () => {
    const storage = memoryStorage();
    storage.getItem = () => {
      throw new Error('blocked');
    };
    storage.setItem = () => {
      throw new Error('blocked');
    };
    expect(initLanguage({ search: '?lang=ur', storage, navigatorLanguage: 'en-US' })).toBe('ur');
  });

  it('a key missing from ur.ts renders the English text; every ur key exists in en', () => {
    for (const key of Object.keys(ur)) expect(key in en, key).toBe(true);
    const missing = (Object.keys(en) as (keyof typeof en)[]).find((k) => !(k in ur));
    if (missing === undefined) throw new Error('every key is translated; pick another fallback check');
    setLanguage('ur');
    expect(t(missing)).toBe(en[missing]);
  });

  it('fill() fills placeholders in both languages', () => {
    expect(fill(t('menu.branches_of'), { n: '1', m: '2' })).toBe('1 of 2 branches');
    setLanguage('ur');
    expect(fill(t('menu.branches_of'), { n: '1', m: '2' })).toBe('2 میں سے 1 برانچ');
  });

  it('in Urdu, Latin type classes map to the kit ur-* classes', () => {
    expect(typeClass('title')).toBe('title');
    setLanguage('ur');
    expect(typeClass('title')).toBe('ur-title');
    expect(typeClass('heading pos-ltr')).toBe('ur-title pos-ltr');
    expect(typeClass('display')).toBe('ur-display');
    expect(typeClass('body-lg')).toBe('ur-body');
    expect(typeClass('caption')).toBe('ur-body');
  });
});
