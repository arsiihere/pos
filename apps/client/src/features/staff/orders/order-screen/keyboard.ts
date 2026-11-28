import type { BranchConfig } from '@pos/events';

// 02b-TK A2 item 2 (frame KeyboardMode; MAPPING TK-S02; CHANGES §3 Menu "Keyboard: / focuses search, 4n Enter adds 4
// naan"): the menu search of the keyboard speed mode. Pure.
// - A leading number is the quantity ("4n", "4 naan"; 1–99), the rest the search.
// - The search finds, best first: the whole name, the start of the name, the start of a later word ("n" → Roghni
//   Naan), the initials of the words in order (2+ letters: "mk" → Mutton Karahi, "ckh" → Chicken Karahi — Half; a
//   variant also by its variant then group name: "hk" → Half · Chicken Karahi), then inside a name (3+ letters).
//   A tie keeps the menu order. The exact short codes of 01a v2.11 are Part B: not here.

const MAX_QTY = 99;

export const MAX_KEY_QTY = MAX_QTY;

/** ⚠️ 02b v1.0.30 QK-7 (BUG-24): `over` — the typed quantity was above 99 (99 is added, the search says "Max 99"). */
export function parseKeyQuery(raw: string): { qty: number | null; term: string; over?: true } {
  const m = /^\s*(\d+)\s*(.*)$/.exec(raw);
  if (m === null) return { qty: null, term: raw.trim().toLowerCase() };
  const n = Number(m[1]);
  return { qty: n < 1 ? null : Math.min(n, MAX_QTY), term: m[2]!.trim().toLowerCase(), ...(n > MAX_QTY ? { over: true as const } : {}) };
}

export interface KeyEntry {
  kind: 'item' | 'deal';
  /** item_id or deal_id */
  id: string;
  name: string;
  price_minor: number;
  sort: number;
  /** lower-case words of the name */
  words: string[];
  /** initials in name order, and (a variant) variant + group order */
  initials: string[];
}

const wordsOf = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');
const initialsOf = (ws: readonly string[]) => ws.map((w) => [...w][0]!).join('');

/** Every item (each variant on its own) and deal of the menu, in menu order. */
export function keyEntries(config: BranchConfig): KeyEntry[] {
  const items = [...config.items].sort((a, b) => a.sort_order - b.sort_order);
  const out: KeyEntry[] = items.map((item, i) => {
    const words = wordsOf(item.name);
    const initials = [initialsOf(words)];
    if (item.variant_group_id !== null && item.variant_name !== null) {
      const group = config.variant_groups.find((v) => v.variant_group_id === item.variant_group_id)?.name ?? '';
      initials.push(initialsOf([...wordsOf(item.variant_name), ...wordsOf(group)]));
    }
    return { kind: 'item', id: item.item_id, name: item.name, price_minor: item.price_minor, sort: i, words, initials };
  });
  [...config.deals]
    .sort((a, b) => a.sort_order - b.sort_order)
    .forEach((deal, i) => {
      const words = wordsOf(deal.name);
      out.push({ kind: 'deal', id: deal.deal_id, name: deal.name, price_minor: deal.price_minor, sort: items.length + i, words, initials: [initialsOf(words)] });
    });
  return out;
}

/** a ⊆ b as a subsequence, starting at b's first letter */
function initialsMatch(term: string, initials: string): boolean {
  if (term.length < 2 || initials[0] !== term[0]) return false;
  let j = 0;
  for (const c of initials) if (c === term[j]) j += 1;
  return j === term.length;
}

/** 0 best … 4; null = no match. */
export function keyScore(e: KeyEntry, raw: string): number | null {
  const term = raw.trim().toLowerCase();
  if (term === '') return null;
  const name = e.name.toLowerCase();
  if (name === term) return 0;
  if (name.startsWith(term)) return 1;
  if (e.words.some((w, i) => i > 0 && w.startsWith(term))) return 2;
  if (e.initials.some((x) => initialsMatch(term.replace(/\s+/g, ''), x))) return 3;
  if (term.length >= 3 && name.includes(term)) return 4;
  return null;
}

/** Every match, best first (a tie in menu order). */
export function keyMatches(entries: readonly KeyEntry[], term: string): KeyEntry[] {
  return entries
    .map((e) => ({ e, s: keyScore(e, term) }))
    .filter((x): x is { e: KeyEntry; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || a.e.sort - b.e.sort)
    .map((x) => x.e);
}

/** The suggestion rows under the search (three, as the frame). */
export function suggest(entries: readonly KeyEntry[], term: string, limit = 3): KeyEntry[] {
  return keyMatches(entries, term).slice(0, limit);
}
