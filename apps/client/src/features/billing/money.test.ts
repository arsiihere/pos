import { describe, expect, it } from 'vitest';
import { billMoney, durationText } from './money';

// 05 §8 i18n: amounts formatted only in the client (D47) with the currency's exponent (J-1, row F-6: never a
// hard-coded 2 decimals); Latin digits in Urdu (R20). Brief §3.1.1: "Rs 6,624.00", "Open 46 min", "4 h 12 min".

describe('[05 §8 i18n; row F-6] billMoney', () => {
  it('PKR (exponent 2): "Rs" with grouped whole part and 2 decimals', () => {
    expect(billMoney(662_400, 'PKR')).toBe('Rs 6,624.00');
    expect(billMoney(6_078_400, 'PKR')).toBe('Rs 60,784.00');
    expect(billMoney(5, 'PKR')).toBe('Rs 0.05');
    expect(billMoney(0, 'PKR')).toBe('Rs 0.00');
    expect(billMoney(-146_200, 'PKR')).toBe('-Rs 1,462.00');
  });

  it('the exponent comes from the currency (3, 0), with the ISO code as the symbol', () => {
    expect(billMoney(6_624, 'KWD')).toBe('KWD 6.624');
    expect(billMoney(1_234_567, 'JPY')).toBe('JPY 1,234,567');
  });

  it('an unknown currency or a non-integer amount is refused (never a guessed 2)', () => {
    expect(() => billMoney(100, 'PKX')).toThrow();
    expect(() => billMoney(1.5, 'PKR')).toThrow();
  });
});

describe('[05 §8; brief §3.1.1] durationText', () => {
  it('minutes under an hour as "n min", else "h h mm min"', () => {
    expect(durationText(0)).toBe('0 min');
    expect(durationText(46)).toBe('46 min');
    expect(durationText(65)).toBe('1 h 05 min');
    expect(durationText(252)).toBe('4 h 12 min');
    expect(durationText(-3)).toBe('0 min');
  });
});
