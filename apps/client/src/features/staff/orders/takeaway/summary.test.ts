import { describe, expect, it } from 'vitest';
import { groupedSummary } from './book';

// 02b-TK L-CLIENT-6a item 4 (frame HomeKiosk): a queue row's one-line summary groups the same name.
describe('[02b-TK L-CLIENT-6a item 4] groupedSummary', () => {
  it('adds up the same name in first-seen order; "n× " above 1', () => {
    const naan = { name: 'Naan', qty: 1 };
    expect(groupedSummary([naan, { name: 'Chicken Karahi — Half', qty: 2 }, naan, naan])).toBe('3× Naan · 2× Chicken Karahi — Half');
    expect(groupedSummary([{ name: 'Raita', qty: 1 }])).toBe('Raita');
    expect(groupedSummary([])).toBe('');
  });
});
