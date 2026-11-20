import { defaultBillingSettings } from '@pos/events';
import { describe, expect, it } from 'vitest';
import { currentRule, previewText } from './receipt';

const { receipt } = defaultBillingSettings({ currency_code: 'PKR', currency_exponent: 2 });

describe('[01a v2.7.1 §8.1 A-1 (6), 03c §3.6] receipt preview text (renderText)', () => {
  it('lays the sample bill out at 32 columns: centered header, rows padded to the edge, footer after a rule', () => {
    const text = previewText(
      {
        receipt: { ...receipt, header_lines: ['Arif Chatkhara'], footer_lines: ['Thank you'], invoice_prefix: 'AC-', address: '12 Mall Road' },
        dineInServiceBp: 500,
        fiscal: null,
      },
      32,
    );
    expect(text.split('\n')).toEqual([
      '         Arif Chatkhara',
      '          12 Mall Road',
      '--------------------------------',
      'Bill: AC-0001',
      'Order: 12',
      'Cashier: Sample',
      '--------------------------------',
      '2 x Sample dish            1,000',
      'Service charge 5%             50',
      'Total                      1,050',
      '--------------------------------',
      '           Thank you',
    ]);
  });

  it('[G-23] the defaults (empty header, footer and prefix) still print a bill', () => {
    const text = previewText({ receipt, dineInServiceBp: 0, fiscal: null }, 48);
    expect(text).toContain('Bill: 0001');
    expect(text).toContain('Total');
    expect(text).not.toContain('Service charge');
  });

  it('currentRule picks the latest rule not after today, else the earliest', () => {
    const rule = (effective_from: string) => ({ effective_from }) as never;
    const j = { rules: [rule('2026-06-01'), rule('2025-01-01')] } as never;
    expect(currentRule(j, '2026-07-01')?.effective_from).toBe('2026-06-01');
    expect(currentRule(j, '2025-03-01')?.effective_from).toBe('2025-01-01');
    expect(currentRule(j, '2020-01-01')?.effective_from).toBe('2025-01-01');
    expect(currentRule(undefined, '2026-01-01')).toBeUndefined();
  });
});
