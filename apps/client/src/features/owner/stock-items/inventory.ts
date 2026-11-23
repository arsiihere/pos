import type { MenuCost, StockUnit } from '../../../api/cloud-admin';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { shownRupees } from '../money';

// 08a §8.3–§8.5: the item page's pure texts and conversions. Exact integers only (strings and bigint), no floats.

// "= N kg / g / L / ml / piece": the units the owner may type a unit's size in, for the item's stock unit.
export type EnteredUnit = 'kg' | 'g' | 'l' | 'ml' | 'piece';
export function enteredUnits(stock: StockUnit): EnteredUnit[] {
  return stock === 'g' ? ['kg', 'g'] : stock === 'ml' ? ['l', 'ml'] : ['piece'];
}
export function enteredLabel(unit: EnteredUnit): string {
  return unit === 'kg' ? t('quantity.kg') : unit === 'l' ? t('quantity.l') : t(`stock_unit.${unit}`);
}

const DECIMAL_RE = /^([0-9]+)(?:\.([0-9]+))?$/;
const FACTOR_NUM_MAX = 1_000_000_000n;
const FACTOR_DEN_MAX = 1_000_000n;

// §6.5: "1 peti = 12 kg" → 12000 / 1; "1 piece = 182.5 g" → 1825 / 10; "1 l = 0.92 kg" → 920 / 1. kg / L become g / ml
// (× 1000), the decimals left become the den (a power of ten; the server reduces). null outside the §6.5 ranges.
export function unitFactor(amount: string, entered: EnteredUnit): { factor_num: number; factor_den: number } | null {
  const m = DECIMAL_RE.exec(amount.trim());
  if (m === null) return null;
  const frac = (m[2] ?? '').replace(/0+$/, '');
  const shift = frac.length - (entered === 'kg' || entered === 'l' ? 3 : 0);
  const digits = BigInt(`${m[1]!}${frac}`);
  const num = shift < 0 ? digits * 10n ** BigInt(-shift) : digits;
  const den = shift > 0 ? 10n ** BigInt(shift) : 1n;
  if (num < 1n || num > FACTOR_NUM_MAX || den > FACTOR_DEN_MAX) return null;
  return { factor_num: Number(num), factor_den: Number(den) };
}

// num / den as a decimal when it ends within 6 places ("182.5"), else as the fraction ("5/7").
function decimal(num: bigint, den: bigint): string {
  const whole = num / den;
  let rest = num % den;
  if (rest === 0n) return whole.toString();
  let digits = '';
  for (let i = 0; i < 6 && rest !== 0n; i++) {
    rest *= 10n;
    digits += (rest / den).toString();
    rest %= den;
  }
  if (rest !== 0n) {
    let a = num;
    let b = den;
    while (b !== 0n) [a, b] = [b, a % b];
    return `${num / a}/${den / a}`;
  }
  return `${whole}.${digits}`;
}

// An amount of the stock unit: 1 000 g / ml or more read as kg / L (as the client's other quantities, S44) unless
// `big` is false (the built-ins read in g / ml so "1 kg = 1 kg" never shows); pieces read "1 piece" / "6 pieces".
export function amountText(num: bigint, den: bigint, base: StockUnit, big = true): string {
  if (base === 'piece') return `${decimal(num, den)} ${num === den ? t('stock_unit.piece') : t('quantity.pieces')}`;
  if (big && num >= 1000n * den) return `${decimal(num, den * 1000n)} ${base === 'g' ? t('quantity.kg') : t('quantity.l')}`;
  return `${decimal(num, den)} ${t(`stock_unit.${base}`)}`;
}

// §7 risk 2: each unit is shown as a sentence, "1 peti = 12 kg".
export function unitSentence(name: string, num: bigint, den: bigint, base: StockUnit, big = true): string {
  return fill(t('stock_inv.unit_sentence'), { name, amount: amountText(num, den, base, big) });
}

// Rupees from a minor-unit decimal string ("150000" → "1,500"); BigInt-safe past 2^53 (§5.3).
export function rupeesText(minor: string): string {
  const n = Number(minor);
  if (Number.isSafeInteger(n)) return shownRupees(n);
  const big = BigInt(minor);
  const whole = (big / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const paisa = big % 100n;
  return paisa === 0n ? whole : `${whole}.${paisa.toString().padStart(2, '0')}`;
}

// §5.3 display_per, display only: "Rs 1,500 / kg"; "< Rs 0.01 / piece" when the exact value rounds to 0 (m-1).
// No menu cost is never this text: the caller shows "No price" (I7, never "Rs 0").
export function menuCostText(cost: MenuCost): string {
  const { unit, minor, below_one_minor } = cost.display_per;
  const per = unit === 'kg' ? t('quantity.kg') : unit === 'l' ? t('quantity.l') : t('stock_unit.piece');
  return fill(t(below_one_minor ? 'stock_inv.cost_below' : 'stock_inv.cost_per'), { amount: rupeesText(minor), unit: per });
}

// I8: yield_bp / 100 with one decimal, rounded half up ("71.2 %").
export function yieldText(bp: number): string {
  const tenths = Math.floor((bp + 5) / 10);
  return fill(t('stock_inv.yield_pct'), { pct: `${Math.floor(tenths / 10)}.${tenths % 10}` });
}

// "Set yield %": up to 2 decimals → basis points, 1 … 50 000 (0.01 % … 500 %), else null.
const PERCENT_RE = /^([0-9]+)(?:\.([0-9]{1,2}))?$/;
export function parseYieldPercent(text: string): number | null {
  const m = PERCENT_RE.exec(text.trim());
  if (m === null) return null;
  const bp = Number(m[1]!) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(bp) && bp >= 1 && bp <= 50_000 ? bp : null;
}
