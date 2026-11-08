import { PERMISSIONS } from '@pos/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { en, fill } from './en';
import { initLanguage, language, pickLanguage, setLanguage, t, typeClass } from './index';
import { ur } from './ur';
import { referenceKey } from '../features/owner/form';
import todo from '../../../../docs/design/handoff/01b/urdu-todo.md?raw';
import todo01a from '../../../../docs/design/handoff/01a/urdu-todo.md?raw';

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

// 01b §8: the keys the 01b views rely on (tasks 50–55 add their view texts under the same prefixes).
const CODES_01B = [
  'ROLE_NOT_FOUND',
  'STAFF_NAME_TAKEN',
  'LAST_ADMIN_REQUIRED',
  'OWN_ADMIN_ACCESS',
  'STAFF_LINKED_TO_OWNER',
  'CONFIG_STALE',
  'PASSWORD_INVALID',
  'PASSWORD_UNCHANGED',
  'PASSWORD_CHANGE_REQUIRED',
];
const REASONS_01B = ['role_archived', 'not_at_branch', 'loop', 'one_lead_per_branch', 'scope_not_allowed', 'already_assigned'];

describe('[01b §8] 01b strings', () => {
  it('en defines every staff.*, roles.*, teams.* view key, perm.<key>, errors.<01b code> and reason; each is in ur or in the 01b Urdu to-do list', () => {
    const required = [
      'owner.nav.staff',
      'owner.nav.roles',
      'owner.nav.teams',
      'owner.nav.stock_counting',
      'owner.nav.branches',
      'staff.title',
      'roles.title',
      'teams.title',
      'teams.no_pin',
      'roles.approval_help',
      ...PERMISSIONS.map((key) => `perm.${key}`),
      ...CODES_01B.map((code) => `errors.${code}`),
      'errors.OWN_ADMIN_ACCESS_owner_not_linked',
      ...REASONS_01B.map((reason) => `errors.reference.${reason}`),
    ];
    for (const key of required) expect(key in en, key).toBe(true);
    const ours = Object.keys(en).filter((key) => /^(staff|roles|teams|perm)\./.test(key) || required.includes(key));
    // staff.locked and staff.locked_for predate 01b and sit in the 01a list.
    const listed = (key: string) => todo.includes(`\`${key}\``) || todo01a.includes(`\`${key}\``);
    for (const key of ours) expect(key in ur || listed(key), key).toBe(true);
  });

  it('the support texts of §8 are the spec copy', () => {
    expect(en['errors.STAFF_LINKED_TO_OWNER']).toBe("This profile is linked to the owner login and can't be marked as left.");
    expect(en['errors.CONFIG_STALE']).toBe('Someone changed this since you opened it');
    // With no support number set, {support} is empty (Q3).
    expect(fill(en['errors.OWN_ADMIN_ACCESS_owner_not_linked'], { support: '' })).toBe(
      "Your owner login isn't linked to your staff profile yet, so admin access can't be removed. Call support to link it.",
    );
    expect(en['roles.approval_help']).toBe(
      'The request goes to people with these roles. They approve on their own device with their PIN.',
    );
  });
});

// 01a v2.3 AD-7 (02p): the zone writes add three CONFIG_REFERENCE_INVALID reasons, each with its own text (S50 e).
const REASONS_01A_ZONES = ['wrong_floor', 'not_piece', 'requires_weighing'];

describe('[01a AD-7] zone reference reasons', () => {
  it('each new reason has an English and an Urdu text of its own, and form.ts picks it', () => {
    for (const reason of REASONS_01A_ZONES) {
      const key = `errors.reference.${reason}` as keyof typeof en;
      expect(key in en, key).toBe(true);
      expect(en[key]).not.toBe(en['errors.CONFIG_REFERENCE_INVALID']);
      expect(key in ur, key).toBe(true);
      expect(referenceKey({ reason })).toBe(key);
    }
  });
});

// The owner timing pages (01a v2.1 §8.1) and the shared parts they show: a browser check in Urdu found English
// on every one of them. Every message key their source names has its Urdu text, with the same placeholders.
const SOURCES = import.meta.glob(
  [
    '../features/owner/{points,stations,branches,menu}/*.{ts,tsx}',
    '../features/owner/{Shell,BranchPicker,guard,BlockedDialog}.tsx',
    '../features/owner/form.ts',
    '../components/{StaleBanner,FlashChip,Dialog,ErrorSummary,InUseDialog,MoreMenu,QuantityInput,RemovedRows,Gone}.tsx',
    '!../**/*.test.*',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

// Keys built at run time from a cloud answer (form.ts).
const DYNAMIC: readonly string[] = [
  'errors.reference.archived',
  'errors.reference.not_found',
  'errors.reference.wrong_branch',
  'errors.reference.program_not_allowed',
  'errors.reference.program_wrong_station',
  'errors.reference.stock_time_exceeds_cook_time',
  'errors.UNKNOWN',
  'errors.CONFIG_STALE',
  'errors.IDEMPOTENCY_KEY_MISMATCH',
];

// Staff-page errors that stay English until the native read; app/support.test.ts relies on that fallback.
const ENGLISH_FOR_NOW: readonly string[] = ['errors.OWN_ADMIN_ACCESS', 'errors.OWN_ADMIN_ACCESS_owner_not_linked'];

describe('[01a v2.1 §8.1; S49] Urdu on the owner timing pages', () => {
  const named = new Set(Object.values(SOURCES).flatMap((source) => [...source.matchAll(/'([a-zA-Z0-9_.]+)'/g)].map((m) => m[1]!)));
  const keys = (Object.keys(en) as (keyof typeof en)[]).filter(
    (key) => (named.has(key) || key.startsWith('owner.stations.field.') || DYNAMIC.includes(key)) && !ENGLISH_FOR_NOW.includes(key),
  );

  it('reads the pages', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(15);
    expect(keys).toContain('owner.points.add');
  });

  it('every key the pages name is in ur.ts', () => {
    expect(keys.filter((key) => ur[key] === undefined)).toEqual([]);
  });

  it('a text keeps its placeholders', () => {
    const holes = (text: string) => [...text.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort();
    expect(keys.filter((key) => ur[key] !== undefined && holes(ur[key]!).join() !== holes(en[key]).join())).toEqual([]);
  });
});
