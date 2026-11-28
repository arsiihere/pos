import { describe, expect, it } from 'vitest';
import { signInSummary } from './signin-summary';

// BUG-26 (02b v1.0.30 §8 QK-8): one summary toast after sign-in, never a stack of the banners that were waiting (the
// rows of the sign-in's first catch-up).

const row = (alert_id: string, kind: string) => ({ alert_id, kind });

describe('[BUG-26; 02b v1.0.30 QK-8] the sign-in summary', () => {
  it('folds every banner of the sign-in catch-up into "Waiting: 3 running late · 6 new"; later ones stay banners', () => {
    const waiting = ['L1', 'L2', 'L3', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6'];
    const banners = [...['L1', 'L2', 'L3'].map((id) => row(id, 'slip_warning')), ...['N1', 'N2', 'N3', 'N4', 'N5', 'N6'].map((id) => row(id, 'zone_stock_low')), row('AFTER', 'slip_warning')];
    const s = signInSummary(banners, new Set(waiting));
    expect(s.text).toBe('Waiting: 3 running late · 6 new');
    expect([...s.folded].sort()).toEqual(waiting.sort());
    expect(s.folded.has('AFTER')).toBe(false);
  });
  it('a part at 0 is left out; nothing waiting → no toast; before the catch-up → nothing folded', () => {
    expect(signInSummary([row('N1', 'test_alert')], new Set(['N1'])).text).toBe('Waiting: 1 new');
    expect(signInSummary([row('L1', 'slip_warning')], new Set(['L1'])).text).toBe('Waiting: 1 running late');
    expect(signInSummary([row('N1', 'test_alert')], new Set())).toEqual({ folded: new Set(), text: null });
    expect(signInSummary([row('N1', 'test_alert')], null).text).toBeNull();
  });
});
