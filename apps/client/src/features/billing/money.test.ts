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

// task 37 review MAJOR 1 (money): the typed-money parsers and the rate / amount texts, at every exponent.
import { amountText, currencySymbol, parseMinor, parsePercentBp, rateText } from './money';

describe('[05 §8 i18n; row F-6] parseMinor (typed major units → minor units)', () => {
  it('exponents 0, 2, 3 by string arithmetic (no float drift)', () => {
    expect(parseMinor('19.99', 2)).toBe(1_999);
    expect(parseMinor('0.29', 2)).toBe(29);
    expect(parseMinor('12.05', 2)).toBe(1_205);
    expect(parseMinor('4,000.00', 2)).toBe(400_000);
    expect(parseMinor('1,234,567', 0)).toBe(1_234_567);
    expect(parseMinor('1.5', 3)).toBe(1_500);
    expect(parseMinor('6.624', 3)).toBe(6_624);
    expect(parseMinor('12', 0)).toBe(12);
  });
  it('trailing zeros past the exponent are fine; other extra decimals are refused', () => {
    expect(parseMinor('12.0', 0)).toBe(12);
    expect(parseMinor('1.500', 2)).toBe(150);
    expect(parseMinor('1.234', 2)).toBeNull();
    expect(parseMinor('1.5', 0)).toBeNull();
  });
  it('malformed, zero, negative and out-of-range input is refused', () => {
    for (const bad of ['', ' ', '12.', '.5', '1,2,3', '12,34', '1,2345', '-3', '+3', 'abc', '1e3', '0', '0.00'])
      expect(parseMinor(bad, 2), JSON.stringify(bad)).toBeNull();
    expect(parseMinor('10000000000', 2)).toBe(1e12);
    expect(parseMinor('10000000000.01', 2)).toBeNull();
    expect(parseMinor('9'.repeat(20), 0)).toBeNull();
  });
});

describe('[05 §6.6] parsePercentBp (typed percent → basis points 1–10 000)', () => {
  it('two decimals at most, no float drift', () => {
    expect(parsePercentBp('0.29')).toBe(29);
    expect(parsePercentBp('12.05')).toBe(1_205);
    expect(parsePercentBp('12.5')).toBe(1_250);
    expect(parsePercentBp('10')).toBe(1_000);
    expect(parsePercentBp('100.00')).toBe(10_000);
    expect(parsePercentBp('0.01')).toBe(1);
  });
  it('refuses 0, above 100 %, more than 2 decimals and malformed input', () => {
    for (const bad of ['0', '0.00', '100.01', '101', '10.555', '', '12.', '-5', 'x']) expect(parsePercentBp(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe('rateText, amountText, currencySymbol', () => {
  it('bp → "n %" without float noise; the amount without its symbol at each exponent; the symbol', () => {
    expect(rateText(29)).toBe('0.29 %');
    expect(rateText(1_205)).toBe('12.05 %');
    expect(rateText(10_000)).toBe('100 %');
    expect(rateText(500)).toBe('5 %');
    expect(amountText(15_000, 'PKR')).toBe('150.00');
    expect(amountText(-57_100, 'PKR')).toBe('-571.00');
    expect(amountText(6_624, 'KWD')).toBe('6.624');
    expect(amountText(1_234_567, 'JPY')).toBe('1,234,567');
    expect(currencySymbol('PKR')).toBe('Rs');
    expect(currencySymbol('KWD')).toBe('KWD');
  });
});
