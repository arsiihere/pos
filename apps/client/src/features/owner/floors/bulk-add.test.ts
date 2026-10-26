import { ULID_RE } from '@pos/domain';
import { describe, expect, it, vi } from 'vitest';
import { addTables, keyAt, parseRange, takenNames } from './bulk-add';

describe('[01a S51] bulk add helpers', () => {
  it('parseRange: prefix + numbers, padding from the first name, at most 100', () => {
    expect(parseRange('T1', 'T4')).toEqual(['T1', 'T2', 'T3', 'T4']);
    expect(parseRange('F9', '12')).toEqual(['F9', 'F10', 'F11', 'F12']);
    expect(parseRange('T08', 'T11')).toEqual(['T08', 'T09', 'T10', 'T11']);
    expect(parseRange(' 5 ', '6')).toEqual(['5', '6']);
    expect(parseRange('T1', 'T100')).toHaveLength(100);
    expect(parseRange('T1', 'T101')).toBeNull();
    expect(parseRange('T5', 'T4')).toBeNull();
    expect(parseRange('T1', 'F4')).toBeNull();
    expect(parseRange('Hall', 'T4')).toBeNull();
  });

  it('keyAt adds i to the 80-bit random part, modulo 2^80; the time part never changes', () => {
    const key = '01JC0000000000000000000000';
    expect(keyAt(key, 0)).toBe(key);
    expect(keyAt(key, 1)).toBe('01JC0000000000000000000001');
    expect(keyAt(key, 33)).toBe('01JC0000000000000000000011');
    const top = '01JC000000ZZZZZZZZZZZZZZZZ';
    expect(keyAt(top, 1)).toBe('01JC0000000000000000000000');
    for (let i = 0; i < 12; i++) expect(keyAt(top, i)).toMatch(ULID_RE);
  });

  it('takenNames compares trimmed and case-blind', () => {
    expect(takenNames(['T1', 'T5', 't6'], ['t5', 'T6 ', 'X'])).toEqual(['T5', 't6']);
  });

  it('addTables sends in order, reports progress, stops at the first error and says where', async () => {
    const send = vi.fn(async (_name: string, i: number) =>
      i === 4 ? { ok: false as const, error: { kind: 'network' as const } } : { ok: true as const, data: {} },
    );
    const progress: number[] = [];
    const outcome = await addTables(['T1', 'T2', 'T3', 'T4', 'T5', 'T6'], 0, send, (i) => progress.push(i));
    expect(send.mock.calls.map((c) => c[0])).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
    expect(outcome).toEqual({ next: 4, error: { kind: 'network' } });

    send.mockClear();
    const again = await addTables(['T1', 'T2', 'T3', 'T4', 'T5', 'T6'], 5, send, () => {});
    expect(send.mock.calls.map((c) => [c[0], c[1]])).toEqual([['T6', 5]]);
    expect(again).toEqual({ next: 6, error: null });
  });
});
