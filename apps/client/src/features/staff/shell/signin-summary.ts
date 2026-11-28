import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';

// ⚠️ 02b v1.0.28 QK-8 (BUG-26): after a sign-in the alert banners that were waiting (the rows of the sign-in's first
// catch-up) are not stacked over the screen —
// one summary toast "Waiting: {n} running late · {m} new" says what is waiting (tap → Inbox); alerts that come after it show
// as banners as before (01d §8.1 B01). "Running late" = the 03a `slip_warning` rows (the late cards, "≈ N min late"). Pure.

/** 03a §3.8: the kind of the late cards ("running late") */
export const LATE_KINDS: ReadonlySet<string> = new Set(['slip_warning']);

export interface SummaryRow {
  alert_id: string;
  kind: string;
}

/** The banners folded into the summary (those of the sign-in's first catch-up, `waiting`) and its text, null when none. */
export function signInSummary(banners: readonly SummaryRow[], waiting: ReadonlySet<string> | null): { folded: ReadonlySet<string>; text: string | null } {
  if (waiting === null) return { folded: new Set(), text: null };
  const before = banners.filter((b) => waiting.has(b.alert_id));
  if (before.length === 0) return { folded: new Set(), text: null };
  const late = before.filter((b) => LATE_KINDS.has(b.kind)).length;
  const rest = before.length - late;
  const parts = [late > 0 ? fill(t('shell.signin.late'), { n: String(late) }) : null, rest > 0 ? fill(t('shell.signin.new'), { n: String(rest) }) : null].filter((x): x is string => x !== null);
  return { folded: new Set(before.map((b) => b.alert_id)), text: fill(t('shell.signin.summary'), { parts: parts.join(' · ') }) };
}
