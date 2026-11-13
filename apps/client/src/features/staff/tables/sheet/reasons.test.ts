import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../../../../i18n';
import { FORCE_MOVE_REASONS, FORCE_RELEASE_REASONS, MOVE_REASONS, REASON_MAX, encodeReason, reasonText } from './reasons';

// 02a §8 Table sheet (Q-18): Force release, Force move and Move send `reason` = `<chip_token>` or
// `<chip_token>: <note>`, cut to 120; on display a known token is localised, any other text raw.

afterEach(() => setLanguage('en'));

describe('[02a Q-18] reason tokens', () => {
  it('[02a Q-18] the chip sets of the three dialogs (handoff CHANGES Q9)', () => {
    expect(FORCE_RELEASE_REASONS).toEqual(['went_home', 'tablet_dead', 'left_table', 'other']);
    expect(FORCE_MOVE_REASONS).toEqual(['shift_ended', 'went_home', 'rebalance', 'other']);
    expect(MOVE_REASONS).toEqual(['ac', 'bigger_table', 'guest_asked', 'other']);
  });

  it('[02a Q-18] encodeReason: token alone, or "token: note" trimmed, cut to 120', () => {
    expect(encodeReason('went_home', '')).toBe('went_home');
    expect(encodeReason('went_home', '   ')).toBe('went_home');
    expect(encodeReason('went_home', '  left early ')).toBe('went_home: left early');
    const long = encodeReason('tablet_dead', 'x'.repeat(200));
    expect(long).toHaveLength(REASON_MAX);
    expect(long.startsWith('tablet_dead: xxx')).toBe(true);
    // never ends on half a surrogate pair
    const emoji = encodeReason('other', `${'y'.repeat(112)}😀😀`);
    expect(emoji.length).toBeLessThanOrEqual(REASON_MAX);
    expect(/[\uD800-\uDBFF]$/.test(emoji)).toBe(false);
  });

  it('[02a Q-18] reasonText: known tokens localised (en / ur), other text raw', () => {
    expect(reasonText('went_home')).toBe('Went home');
    expect(reasonText('went_home: left early')).toBe('Went home: left early');
    expect(reasonText('other: tablet stolen')).toBe('Other: tablet stolen');
    expect(reasonText('Went home early')).toBe('Went home early');
    expect(reasonText('unknown_token: x')).toBe('unknown_token: x');
    expect(reasonText(null)).toBeNull();
    expect(reasonText('')).toBeNull();
    setLanguage('ur');
    expect(reasonText('shift_ended')).toBe('شفٹ ختم');
    expect(reasonText('ac: too cold')).toBe('اے سی: too cold');
  });
});
