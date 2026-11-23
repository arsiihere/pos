import { describe, expect, it } from 'vitest';
import * as root from '../index';
import { BUILTIN_UNITS, normaliseUnitName, reduceFraction, resolveUnit, toStockUnits, type ItemUnitRow } from './conversions';

const row = (id: string, name: string, base: ItemUnitRow['base_unit'], num: string, den: string, at: number): ItemUnitRow => ({
  unit_row_id: id,
  unit_name: name,
  base_unit: base,
  factor_num: BigInt(num),
  factor_den: BigInt(den),
  created_at: at,
});

describe('08a inventory conversions', () => {
  it('[08a #1] BUILTIN_UNITS: kg, pao, maund, l, darjan; names case-insensitive', () => {
    expect(BUILTIN_UNITS).toEqual({
      kg: { base: 'g', num: 1000n, den: 1n },
      pao: { base: 'g', num: 250n, den: 1n },
      maund: { base: 'g', num: 40000n, den: 1n },
      l: { base: 'ml', num: 1000n, den: 1n },
      darjan: { base: 'piece', num: 12n, den: 1n },
    });
    expect(Object.isFrozen(BUILTIN_UNITS)).toBe(true);
    expect(normaliseUnitName('  KG ')).toBe('kg');
    expect(resolveUnit({ stock_unit: 'g' }, 'Maund', [])).toEqual({ num: 40000n, den: 1n });
    expect(resolveUnit({ stock_unit: 'piece' }, 'DARJAN', [])).toEqual({ num: 12n, den: 1n });
    expect(root.BUILTIN_UNITS).toBe(BUILTIN_UNITS);
  });

  it('[08a #2] resolveUnit: own unit, item unit before built-in, base rules, latest wins, other base ignored, no chains', () => {
    // stock unit → 1/1
    expect(resolveUnit({ stock_unit: 'g' }, 'g', [])).toEqual({ num: 1n, den: 1n });
    // built-in with matching base
    expect(resolveUnit({ stock_unit: 'g' }, 'kg', [])).toEqual({ num: 1000n, den: 1n });
    // built-in with another base and no item unit → null
    expect(resolveUnit({ stock_unit: 'g' }, 'l', [])).toBeNull();
    expect(resolveUnit({ stock_unit: 'piece' }, 'kg', [])).toBeNull();
    // M-4: `l` item unit on a g item (ghee 1 l = 920 g); `kg` item unit on a piece item (1 kg = 5/7 piece)
    expect(resolveUnit({ stock_unit: 'g' }, 'l', [row('u1', 'l', 'g', '920', '1', 1)])).toEqual({ num: 920n, den: 1n });
    expect(resolveUnit({ stock_unit: 'piece' }, 'kg', [row('u1', 'kg', 'piece', '5', '7', 1)])).toEqual({ num: 5n, den: 7n });
    // item unit before built-in (the step-2 name never collides with step 3 on valid data; the order still holds)
    expect(resolveUnit({ stock_unit: 'g' }, 'kg', [row('u1', 'kg', 'g', '999', '1', 1)])).toEqual({ num: 999n, den: 1n });
    // latest row wins: created_at, then id
    const peti = [row('u1', 'peti', 'g', '12000', '1', 1), row('u3', 'peti', 'g', '10000', '1', 2), row('u2', 'peti', 'g', '11000', '1', 2)];
    expect(resolveUnit({ stock_unit: 'g' }, 'PETI', peti)).toEqual({ num: 10000n, den: 1n });
    // a row whose base_unit is not the current stock unit is ignored, and counts again after the unit changes back (m-6)
    const ghee = [row('a', 'peti', 'g', '12000', '1', 1), row('b', 'peti', 'piece', '20', '1', 2)];
    expect(resolveUnit({ stock_unit: 'g' }, 'peti', ghee)).toEqual({ num: 12000n, den: 1n });
    expect(resolveUnit({ stock_unit: 'piece' }, 'peti', ghee)).toEqual({ num: 20n, den: 1n });
    expect(resolveUnit({ stock_unit: 'ml' }, 'peti', ghee)).toBeNull();
    // no chains: `box` = 2 peti is not followed
    expect(resolveUnit({ stock_unit: 'g' }, 'box', [row('x', 'box', 'piece', '2', '1', 1), ...ghee])).toBeNull();
    // no chain through a built-in: darjan → piece → g is not followed on a g item with a `piece` unit
    expect(resolveUnit({ stock_unit: 'g' }, 'darjan', [row('p', 'piece', 'g', '365', '2', 1)])).toBeNull();
    expect(resolveUnit({ stock_unit: 'g' }, 'unknown', ghee)).toBeNull();
  });

  it('[08a #6] gcd reduction and toStockUnits', () => {
    expect(reduceFraction(1825n, 10n)).toEqual({ num: 365n, den: 2n });
    expect(reduceFraction(12000n, 1n)).toEqual({ num: 12000n, den: 1n });
    expect(reduceFraction(360000n, 12000n)).toEqual({ num: 30n, den: 1n });
    expect(() => reduceFraction(1n, 0n)).toThrow(RangeError);
    // 3 peti of 12 kg → 36 000 g; 3 pieces of 365/2 g → 1095/2 g
    expect(toStockUnits(3n, { num: 12000n, den: 1n })).toEqual({ num: 36000n, den: 1n });
    expect(toStockUnits(3n, { num: 365n, den: 2n })).toEqual({ num: 1095n, den: 2n });
  });
});
