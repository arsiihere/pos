import type { CloudError, CloudResult } from '../../../api/cloud-admin';

// S51: add a range of tables with one §6.5 POST each. No endpoint; the page loops.
export const MAX_BULK_TABLES = 100;

const NAME_RE = /^(.*?)([0-9]+)$/;

// "T1" … "T12" (or "T1" … "12"): one prefix, numbers padded like the first name, at most 100 names.
export function parseRange(firstText: string, lastText: string): string[] | null {
  const first = NAME_RE.exec(firstText.trim());
  const last = NAME_RE.exec(lastText.trim());
  if (first === null || last === null) return null;
  const [, prefix = '', fromDigits = ''] = first;
  const [, lastPrefix = '', toDigits = ''] = last;
  if (lastPrefix !== '' && lastPrefix !== prefix) return null;
  const from = Number(fromDigits);
  const to = Number(toDigits);
  if (to < from || to - from + 1 > MAX_BULK_TABLES) return null;
  const width = fromDigits.startsWith('0') ? fromDigits.length : 0;
  return Array.from({ length: to - from + 1 }, (_, i) => prefix + String(from + i).padStart(width, '0'));
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RANDOM_CHARS = 16;
const RANDOM_SPACE = 1n << 80n;

// The key of the table at index i: the form's ULID with its 80-bit random part increased by i, modulo
// 2^80. The 48-bit time part is untouched, so the result is still a ULID (S51, S35 j).
export function keyAt(formKey: string, i: number): string {
  const time = formKey.slice(0, formKey.length - RANDOM_CHARS);
  let value = 0n;
  for (const char of formKey.slice(-RANDOM_CHARS)) value = value * 32n + BigInt(CROCKFORD.indexOf(char));
  value = (value + BigInt(i)) % RANDOM_SPACE;
  let random = '';
  for (let n = 0; n < RANDOM_CHARS; n++) {
    random = CROCKFORD.charAt(Number(value % 32n)) + random;
    value /= 32n;
  }
  return time + random;
}

const norm = (name: string) => name.trim().toLowerCase();

// Names of the range already used by a table at this branch (archived included, §3.3), checked before
// anything is sent.
export function takenNames(names: readonly string[], existing: readonly string[]): string[] {
  const used = new Set(existing.map(norm));
  return names.filter((name) => used.has(norm(name)));
}

// Sends names[from…] in order; stops at the first failure. `next` is the index to resume from.
export async function addTables(
  names: readonly string[],
  from: number,
  send: (name: string, index: number) => Promise<CloudResult<unknown>>,
  onProgress: (sent: number) => void,
): Promise<{ next: number; error: CloudError | null }> {
  for (let i = from; i < names.length; i++) {
    onProgress(i + 1);
    const result = await send(names[i] ?? '', i);
    if (!result.ok) return { next: i, error: result.error };
  }
  return { next: names.length, error: null };
}
