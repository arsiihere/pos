// S44: every quantity is an integer in the smallest unit (pieces, g, ml).
// The UI shows and accepts kg / L with up to 3 decimals. Browser-safe: no node:* import.

export type Unit = 'piece' | 'g' | 'ml';

const PIECE_RE = /^[0-9]+$/;
const THOUSANDTHS_RE = /^([0-9]+)(?:\.([0-9]{1,3}))?$/;

export function parseQuantity(text: string, unit: Unit): { ok: true; value: number } | { ok: false } {
  const t = text.trim();
  if (unit === 'piece') {
    if (!PIECE_RE.test(t)) return { ok: false };
    const value = Number(t);
    return Number.isSafeInteger(value) ? { ok: true, value } : { ok: false };
  }
  const m = THOUSANDTHS_RE.exec(t);
  if (m === null) return { ok: false };
  const whole = m[1] as string;
  const frac = (m[2] ?? '').padEnd(3, '0');
  const value = Number(whole + frac);
  return Number.isSafeInteger(value) ? { ok: true, value } : { ok: false };
}

export function formatQuantity(n: number, unit: Unit): string {
  if (unit === 'piece') return String(n);
  const whole = Math.trunc(n / 1000);
  const frac = String(n % 1000).padStart(3, '0').replace(/0+$/, '');
  const label = unit === 'g' ? 'kg' : 'L';
  return `${frac === '' ? whole : `${whole}.${frac}`} ${label}`;
}
