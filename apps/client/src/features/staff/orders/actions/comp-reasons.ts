import { t } from '../../../../i18n';
import type { CompLinePayload } from '../contracts';

// 02b v1.0.11 §3.9, §6.8 (owner rulings Q-19, Q-28): the comp reason chips are the branch's `comp_reason_chips`
// (owner-edited labels), each sent as `reason_code` = its label, plus ONE fixed "Other" chip that sends 'other' with
// a required note (≤ 120). H9 fallback (cloud default still has "Other"): a config chip whose label lower-cases to
// `other` is not drawn, so only the fixed Other shows.

export const OTHER_CODE = 'other';
export const NOTE_MAX = 120;

export interface ReasonChip {
  /** what the chip shows */
  label: string;
  /** what `reason_code` carries */
  code: string;
  other: boolean;
}

export function reasonChips(configChips: readonly string[]): ReasonChip[] {
  const seen = new Set<string>();
  const chips: ReasonChip[] = [];
  for (const raw of configChips) {
    const label = raw.trim();
    if (label === '' || label.toLowerCase() === OTHER_CODE || seen.has(label)) continue;
    seen.add(label);
    chips.push({ label, code: label, other: false });
  }
  chips.push({ label: t('comp.other'), code: OTHER_CODE, other: true });
  return chips;
}

/** The CompLine payload, or null while it cannot be sent (no chip, Other without a note, units out of range). */
export function compPayload(o: { order_item_id: string; units: number; max_units: number; chip: ReasonChip | null; note: string }): CompLinePayload | null {
  if (o.chip === null || !Number.isSafeInteger(o.units) || o.units < 1 || o.units > o.max_units) return null;
  const note = o.note.trim().slice(0, NOTE_MAX);
  if (o.chip.other) return note === '' ? null : { order_item_id: o.order_item_id, units: o.units, reason_code: OTHER_CODE, note };
  // a config chip carries no note: a note typed for Other is not sent once another chip is picked
  return { order_item_id: o.order_item_id, units: o.units, reason_code: o.chip.code };
}
