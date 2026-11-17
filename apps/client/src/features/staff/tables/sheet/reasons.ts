import { t, type MessageKey } from '../../../../i18n';

// 02a §8 Table sheet (Q-18): Force release, Force move and Move send `reason` = `<chip_token>` or
// `<chip_token>: <note>`, cut to 120 characters (the hub's 1–120). A stable token reads the same on an Urdu and an
// English screen: a known token is shown localised, anything else raw. Lane D's lock banners show it with reasonText.

export const REASON_TOKENS = ['went_home', 'tablet_dead', 'left_table', 'shift_ended', 'rebalance', 'ac', 'bigger_table', 'guest_asked', 'other'] as const;
export type ReasonToken = (typeof REASON_TOKENS)[number];

/** handoff CHANGES Q9 */
export const FORCE_RELEASE_REASONS: readonly ReasonToken[] = ['went_home', 'tablet_dead', 'left_table', 'other'];
export const FORCE_MOVE_REASONS: readonly ReasonToken[] = ['shift_ended', 'went_home', 'rebalance', 'other'];
export const MOVE_REASONS: readonly ReasonToken[] = ['ac', 'bigger_table', 'guest_asked', 'other'];

export const REASON_MAX = 120;

const isToken = (s: string): s is ReasonToken => (REASON_TOKENS as readonly string[]).includes(s);

export function reasonLabel(token: ReasonToken): string {
  return t(`tables.reason.${token}` as MessageKey);
}

/** `<token>` or `<token>: <note>`, never longer than 120 UTF-16 units and never ending on half a surrogate pair. */
export function encodeReason(token: ReasonToken, note: string): string {
  const n = note.trim();
  let s = n === '' ? token : `${token}: ${n}`;
  if (s.length > REASON_MAX) {
    s = s.slice(0, REASON_MAX);
    if (/[\uD800-\uDBFF]$/.test(s)) s = s.slice(0, -1);
    s = s.trimEnd();
  }
  return s;
}

/** A stored reason for display: "Went home" / "Went home: left early"; any other text as it is. */
export function reasonText(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const match = /^([a-z_]+)(?::\s?([\s\S]*))?$/.exec(raw);
  if (match === null || !isToken(match[1]!)) return raw;
  const label = reasonLabel(match[1]);
  const note = match[2]?.trim() ?? '';
  return note === '' ? label : `${label}: ${note}`;
}
