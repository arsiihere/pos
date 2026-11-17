import type { Identifier } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import { tableLabel } from '../kds/details.js';
import type { ReadOrderHead } from '../orders/exports.js';
import { branchConfig } from '../sync/branch-config-holder.js';

// 04 §3.5 (task v5): which order a void request is about — `details.identifier` (≤ 40, AlertDetailsBase) on the
// signed-in approver card. 03b's helpers are not in its Exposes (B-0: 04 edits nothing in 03b), so this file holds 04's
// own copies: `identifierText` of kds/commands/ready.ts:125 (with its 40-char slice; 03c's copy has none) and the
// dine-in branch of `passIdentity` (kds/commands/handover.ts:84). Test 20c pins both against 03b's. 0 statements.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Copy of 03b's identifierText: "T4 + T5", "Family 2"; "#12", "#12 10 Nov" (earlier business date); "PARKING LEB 1234 SEDAN". ≤ 40. */
function identifierText(identifier: Identifier): string {
  let text: string;
  if (identifier.kind === 'table') text = identifier.label;
  else if (identifier.kind === 'token') {
    const m = identifier.date === null ? null : /^\d{4}-(\d{2})-(\d{2})$/.exec(identifier.date);
    text = m === null ? `#${identifier.token}` : `#${identifier.token} ${Number(m[2])} ${MONTHS[Number(m[1]) - 1] ?? ''}`;
  } else text = `PARKING ${identifier.car_number} ${identifier.car_type.toUpperCase()}`;
  return text.slice(0, 40);
}

/**
 * §3.5: the order's identifier from readOrder's head (02b row Q-2) and engine state. Token with its date when not
 * today's business date; parking car number + type; dine-in = the current tables' labels, primary first, names from
 * branch config (the id when unknown). No current table = `table_ids.length === 0` (G-14: readOrder's seatings join has
 * no state filter, so `primary_table_id` is ignored then) → the engine's table at submit.
 */
export function voidIdentifier(state: Readonly<EngineState>, order: ReadOrderHead): string {
  if (order.order_type === 'takeaway') {
    const today = state.business_day?.business_date ?? null;
    return identifierText({ kind: 'token', token: order.token ?? 0, date: order.business_date === today ? null : order.business_date });
  }
  if (order.order_type === 'parking') {
    return identifierText({ kind: 'parking', car_number: order.car_number ?? '', car_type: order.car_type ?? 'sedan' });
  }
  const primary = order.primary_table_id ?? order.table_ids[0];
  const ids =
    order.table_ids.length === 0
      ? [state.orders[order.order_id]?.table_id].filter((t): t is string => typeof t === 'string')
      : [primary, ...order.table_ids.filter((t) => t !== primary)].filter((t): t is string => typeof t === 'string');
  const names = new Map((branchConfig()?.floors ?? []).flatMap((f) => f.tables.map((t) => [t.table_id, t.name] as const)));
  return identifierText({ kind: 'table', label: ids.map((t) => tableLabel(names.get(t) ?? t)).join(' + ') });
}
