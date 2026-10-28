// §8.1, S40 N7: the one place the owner page turns typed rupees into paisa (minor units).
// Trim spaces, drop every comma (so "1,20,000" and even "1,2,3" are harmless), then the rest must be
// ASCII digits with at most 2 decimals. Ranges are the server's (§3.3).
const RUPEES_RE = /^([0-9]+)(?:\.([0-9]{1,2}))?$/;

export function parseRupees(text: string): { ok: true; value: number } | { ok: false } {
  const m = RUPEES_RE.exec(text.trim().replaceAll(',', ''));
  if (m === null) return { ok: false };
  const value = Number((m[1] as string) + (m[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(value) ? { ok: true, value } : { ok: false };
}

// The edit form's starting text: whole rupees without decimals, otherwise two decimals.
export function formatRupees(minor: number): string {
  const whole = Math.trunc(minor / 100);
  const paisa = minor % 100;
  return paisa === 0 ? String(whole) : `${whole}.${String(paisa).padStart(2, '0')}`;
}

// Prices shown in lists and the staff preview: thousands grouped ("2,200").
export function shownRupees(minor: number): string {
  const [whole = '', paisa] = formatRupees(minor).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return paisa === undefined ? grouped : `${grouped}.${paisa}`;
}
