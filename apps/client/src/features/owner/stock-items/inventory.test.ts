import { describe, expect, it } from 'vitest';
import { en } from '../../../i18n/en';
import todo08a from '../../../../../../docs/design/handoff/08a/urdu-todo.md?raw';
import { amountText, menuCostText, parseYieldPercent, unitFactor, unitSentence, yieldText } from './inventory';

describe('[08a §8.3 Units] the unit sentence input', () => {
  it('[08a #39] "1 peti = 12 kg" → 12000/1; "1 piece = 182.5 g" → 1825/10; "1 l = 0.92 kg" → 920/1', () => {
    expect(unitFactor('12', 'kg')).toEqual({ factor_num: 12000, factor_den: 1 });
    expect(unitFactor('182.5', 'g')).toEqual({ factor_num: 1825, factor_den: 10 });
    expect(unitFactor('0.92', 'kg')).toEqual({ factor_num: 920, factor_den: 1 });
    // L → ml as kg → g; trailing zeros add no decimals; pieces stay pieces.
    expect(unitFactor('1.5', 'l')).toEqual({ factor_num: 1500, factor_den: 1 });
    expect(unitFactor('182.50', 'g')).toEqual({ factor_num: 1825, factor_den: 10 });
    expect(unitFactor(' 24 ', 'piece')).toEqual({ factor_num: 24, factor_den: 1 });
    expect(unitFactor('0.5', 'piece')).toEqual({ factor_num: 5, factor_den: 10 });
  });

  it('[08a #39] zero, text, a den above 1 000 000 or a num above 1 000 000 000 is refused', () => {
    expect(unitFactor('0', 'kg')).toBeNull();
    expect(unitFactor('0.000', 'g')).toBeNull();
    expect(unitFactor('', 'g')).toBeNull();
    expect(unitFactor('12 kg', 'g')).toBeNull();
    expect(unitFactor('-1', 'g')).toBeNull();
    expect(unitFactor('0.0000001', 'g')).toBeNull();
    expect(unitFactor('1000001', 'kg')).toBeNull();
    expect(unitFactor('1000000', 'kg')).toEqual({ factor_num: 1_000_000_000, factor_den: 1 });
  });

  it('[08a §7 risk 2] each unit reads as a sentence in the stock unit (kg / L from 1 000 g / ml)', () => {
    expect(unitSentence('peti', 12000n, 1n, 'g')).toBe('1 peti = 12 kg');
    expect(unitSentence('piece', 365n, 2n, 'g')).toBe('1 piece = 182.5 g');
    expect(unitSentence('l', 920n, 1n, 'g')).toBe('1 l = 920 g');
    expect(unitSentence('bottle', 1500n, 1n, 'ml')).toBe('1 bottle = 1.5 L');
    expect(unitSentence('kg', 5n, 7n, 'piece')).toBe('1 kg = 5/7 pieces');
    expect(unitSentence('tray', 30n, 1n, 'piece')).toBe('1 tray = 30 pieces');
    // Built-ins read in the small unit, so "1 kg = 1 kg" never shows.
    expect(amountText(1000n, 1n, 'g', false)).toBe('1000 g');
    expect(amountText(1n, 1n, 'piece')).toBe('1 piece');
  });
});

describe('[08a §5.3 display_per, I12] menu cost and yield texts', () => {
  it('[08a #38] "Rs 1,500 / kg"; "< Rs 0.01 / piece" when below_one_minor; L as "L"', () => {
    const cost = (unit: 'kg' | 'l' | 'piece', minor: string, below_one_minor = false) => ({
      branch_id: null,
      price_id: 'P1',
      per_stock_unit: { num: '150', den: '1' },
      display_per: { unit, minor, below_one_minor },
    });
    expect(menuCostText(cost('kg', '150000'))).toBe('Rs 1,500 / kg');
    expect(menuCostText(cost('piece', '1', true))).toBe('< Rs 0.01 / piece');
    expect(menuCostText(cost('l', '250050'))).toBe('Rs 2,500.50 / L');
    // BigInt-safe: a value past 2^53 keeps every digit.
    expect(menuCostText(cost('kg', '123456789012345678'))).toBe('Rs 1,234,567,890,123,456.78 / kg');
  });

  it('[08a §8.3 Yield] yield_bp as a percentage with one decimal; "Set yield %" parses to basis points', () => {
    expect(yieldText(7120)).toBe('71.2 %');
    expect(yieldText(24000)).toBe('240.0 %');
    expect(yieldText(7125)).toBe('71.3 %');
    expect(yieldText(1)).toBe('0.0 %');
    expect(parseYieldPercent('71.2')).toBe(7120);
    expect(parseYieldPercent('240')).toBe(24000);
    expect(parseYieldPercent('0.01')).toBe(1);
    expect(parseYieldPercent('0')).toBeNull();
    expect(parseYieldPercent('500.01')).toBeNull();
    expect(parseYieldPercent('7.123')).toBeNull();
  });
});

describe('[08a §8.4] strings', () => {
  it('"Today\'s cost" is used only in the Menu cost help line (I12); every 08a key is on the 08a Urdu to-do list', () => {
    const today = Object.entries(en).filter(([, text]) => text.includes("Today's cost"));
    expect(today.map(([key]) => key)).toEqual(['stock_inv.menu_cost_help']);
    expect(en['stock_inv.menu_cost_help']).toBe("Price you set. Today's cost from deliveries is on the hub (coming)");
    const ours = Object.keys(en).filter(
      (k) =>
        k.startsWith('stock_inv.') ||
        k.startsWith('stock_items.tab_') ||
        k.startsWith('stock_items.col_08a_') ||
        k.startsWith('stock_item.f08a_') ||
        ['errors.reference.wrong_kind', 'errors.reference.packet_unit', 'errors.reference.not_convertible', 'errors.reference.branch_not_found', 'errors.CONFIG_NAME_TAKEN_stock_item_code'].includes(k),
    );
    expect(ours.length).toBeGreaterThan(40);
    for (const key of ours) expect(todo08a.includes(`| \`${key}\` |`), key).toBe(true);
  });
});
