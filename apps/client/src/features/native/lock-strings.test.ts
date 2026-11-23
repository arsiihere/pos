import { afterEach, describe, expect, it } from 'vitest';
import type { AlertFamily } from '@pos/domain';
import { REQUEST_OUTCOMES, type RequestOutcome } from '@pos/events';
import {
  buildLockStrings,
  isSilentKind,
  readCommitted,
  renderLock,
  serialize,
  soundOf,
  type LockView,
} from '../../../../tablet/scripts/gen-lock-strings.mjs';
import { setLanguage, type Language } from '../../i18n';
import { lockText } from '../alerts/labels';
import { SILENT_KINDS, soundFor } from '../alerts/sounds';

// 05b M-9: the tablet's native notification text and sounds come from the generated lock-strings.json.

afterEach(() => setLanguage('en'));

const data = buildLockStrings();

describe('[05b test 10, M-9] lock-strings.json', () => {
  it('the committed file equals a fresh generator run', () => {
    expect(readCommitted(), 'lock-strings.json is stale: run `node apps/tablet/scripts/gen-lock-strings.mjs`').toBe(serialize(data));
  });

  it('carries the client SILENT_KINDS and every request outcome', () => {
    expect(new Set(data.silent_kinds)).toEqual(new Set(SILENT_KINDS));
    expect(data.outcome.outcomes).toEqual([...REQUEST_OUTCOMES]);
  });
});

// The generator's reference renderer is the rule LockStrings.kt implements; here it must equal the page's own F01
// lock line (labels.ts lockText) for every lock key, in EN and UR.
describe('[05b M-9] the native lock line equals the page lock line', () => {
  const lockKinds = Object.keys(data.languages.en ?? {})
    .map((k) => /^alert\.([a-z0-9_]+)\.lock$/.exec(k)?.[1])
    .filter((k): k is string => k !== undefined);
  const locks: LockView['lock'][] = [
    { table_code: '12', point_code: null, requester_name: 'Hamza', device_name: null },
    { table_code: 'Patio 3', point_code: 'Pass', requester_name: 'Ali', device_name: 'Till 1' },
    { table_code: null, point_code: null, requester_name: null, device_name: null },
    { table_code: '', point_code: 'Pass', requester_name: 'Sana' },
    { table_code: 'F4 + F5', requester_name: null, device_name: 'Tab 2' },
    {},
  ].map((l) => ({ kind_label_key: '', ...l }));

  const cases: Array<{ view: LockView; name: string }> = [];
  for (const kind of [...lockKinds, 'mystery_kind']) {
    for (const family of ['urgent', 'action', 'info'] as const) {
      const outcomes: Array<string | null> = kind === 'request_result' ? [null, ...REQUEST_OUTCOMES] : [null];
      for (const outcome of outcomes) {
        for (const lock of locks) {
          cases.push({
            name: `${kind}/${family}/${String(outcome)}/${JSON.stringify(lock)}`,
            view: { kind, family, outcome, lock: { ...lock, kind_label_key: `alert.${kind}.lock` } },
          });
        }
      }
    }
  }
  // a 03b kind with a key the table does not have
  for (const lock of locks) cases.push({ name: 'ready_to_serve/unknown key', view: { kind: 'ready_to_serve', family: 'urgent', lock: { ...lock, kind_label_key: 'alert.nope.lock' } } });

  for (const lang of ['en', 'ur'] as Language[]) {
    it(`${lang}: ${cases.length} views`, () => {
      setLanguage(lang);
      for (const { name, view } of cases) {
        const page = lockText({
          kind: view.kind,
          family: view.family as AlertFamily,
          outcome: (view.outcome ?? null) as RequestOutcome | null,
          lock: view.lock as never,
        });
        expect(renderLock(data, view, lang), name).toBe(page);
      }
    });
  }

  it('an unknown key reports itself and reads the generic text, never the key', () => {
    const seen: string[] = [];
    const line = renderLock(data, { kind: 'mystery_kind', family: 'urgent', lock: { kind_label_key: 'alert.mystery_kind.lock', table_code: '7' } }, 'en', (k) => seen.push(k));
    expect(seen).toEqual(['alert.mystery_kind.lock']);
    expect(line).not.toContain('alert.');
  });
});

describe('[05b M-9] native sound family equals the page sound', () => {
  const asNative = (s: ReturnType<typeof soundFor>) =>
    s === null ? 'none' : s === 'rising' ? 'result_approved' : s === 'falling' ? 'result_rejected' : s;

  it('request_result by outcome; silent kinds none; others by family', () => {
    for (const kind of ['request_result', 'approval_receipt', 'void_approval', 'test_alert']) {
      for (const family of ['urgent', 'action', 'info'] as const) {
        for (const outcome of [null, undefined, ...REQUEST_OUTCOMES]) {
          expect(soundOf(data, kind, family, outcome), `${kind}/${family}/${String(outcome)}`).toBe(asNative(soundFor({ kind, family, outcome })));
        }
      }
      expect(isSilentKind(data, kind)).toBe(SILENT_KINDS.has(kind));
    }
  });
});
