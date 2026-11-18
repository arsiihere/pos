import { AUDIT_ACTIONS, VOID_REASON_CODES, type AuditAction } from '@pos/domain';
import { t, type MessageKey } from '../../i18n';
import { fill } from '../../i18n/en';
import type { AuditEntryView } from './api';
import type { AuditIconName } from './icons';

// 04 §3.6 action table → the words, tone and icon of an audit row (frames Audit, AuditActions); integrator O5: every
// AUDIT_ACTIONS value has an en / ur label and a group. The two drawn groups ("Voids and comps", "Requests") keep the
// frame's members; the rest are grouped by what the act touches. Never a staff id or ULID, except the unknown-actor id
// the frame draws (O1).

export type AuditTone = 'danger' | 'info' | 'ok' | 'warn' | 'mute' | 'brand';

export type AuditGroup = 'voids_comps' | 'requests' | 'orders_tables' | 'day_stock' | 'kitchen' | 'screens_pins';

export const AUDIT_GROUPS: readonly AuditGroup[] = ['voids_comps', 'requests', 'orders_tables', 'day_stock', 'kitchen', 'screens_pins'];

interface ActionMeta {
  group: AuditGroup;
  tone: AuditTone;
  icon: AuditIconName;
}

export const ACTION_META: Record<AuditAction, ActionMeta> = {
  // Voids and comps (frame AuditActions, in its order)
  void_requested: { group: 'voids_comps', tone: 'danger', icon: 'hourglass' },
  void_answered: { group: 'voids_comps', tone: 'info', icon: 'shield' },
  item_voided: { group: 'voids_comps', tone: 'danger', icon: 'trashx' },
  item_moved_to_stock: { group: 'voids_comps', tone: 'ok', icon: 'box' },
  comp_requested: { group: 'voids_comps', tone: 'brand', icon: 'gift' },
  comp_answered: { group: 'voids_comps', tone: 'info', icon: 'shield' },
  line_comped: { group: 'voids_comps', tone: 'brand', icon: 'gift' },
  // Requests (frame AuditActions)
  request_answered: { group: 'requests', tone: 'info', icon: 'shield' },
  request_withdrawn: { group: 'requests', tone: 'mute', icon: 'undo' },
  request_pin_failed: { group: 'requests', tone: 'warn', icon: 'lock' },
  request_closed: { group: 'requests', tone: 'mute', icon: 'x' },
  // Orders and tables
  item_removed: { group: 'orders_tables', tone: 'mute', icon: 'trash' },
  item_returned: { group: 'orders_tables', tone: 'warn', icon: 'undo' },
  line_weight_set: { group: 'orders_tables', tone: 'info', icon: 'check' },
  order_boosted: { group: 'orders_tables', tone: 'brand', icon: 'clock' },
  order_cancelled: { group: 'orders_tables', tone: 'danger', icon: 'x' },
  table_lock_force_released: { group: 'orders_tables', tone: 'warn', icon: 'lock' },
  table_holder_changed: { group: 'orders_tables', tone: 'info', icon: 'user' },
  // Day and stock
  day_opened: { group: 'day_stock', tone: 'ok', icon: 'cal' },
  day_closed: { group: 'day_stock', tone: 'mute', icon: 'cal' },
  stock_set: { group: 'day_stock', tone: 'info', icon: 'box' },
  stock_added: { group: 'day_stock', tone: 'ok', icon: 'box' },
  zone_stock_set: { group: 'day_stock', tone: 'info', icon: 'box' },
  zone_stock_added: { group: 'day_stock', tone: 'ok', icon: 'box' },
  stock_transferred_out: { group: 'day_stock', tone: 'warn', icon: 'box' },
  // Kitchen and menu
  station_paused: { group: 'kitchen', tone: 'warn', icon: 'clock' },
  station_capacity_set: { group: 'kitchen', tone: 'info', icon: 'clock' },
  item_availability_set: { group: 'kitchen', tone: 'info', icon: 'check' },
  // Screens and PINs
  pin_locked_out: { group: 'screens_pins', tone: 'warn', icon: 'lock' },
  device_pin_locked_out: { group: 'screens_pins', tone: 'warn', icon: 'lock' },
  pin_lockout_cleared: { group: 'screens_pins', tone: 'ok', icon: 'lock' },
  device_paired: { group: 'screens_pins', tone: 'info', icon: 'tablet' },
  device_revoked: { group: 'screens_pins', tone: 'danger', icon: 'tablet' },
  pairing_token_generated: { group: 'screens_pins', tone: 'info', icon: 'tablet' },
};

/** The actions of a group, in AUDIT_ACTIONS order except the two drawn groups (frame order). */
export function groupActions(g: AuditGroup): AuditAction[] {
  return (Object.keys(ACTION_META) as AuditAction[]).filter((a) => ACTION_META[a].group === g);
}

/** The "Voids" preset (frame AuditEmpty: 4 actions). */
export const VOIDS_PRESET: readonly AuditAction[] = ['void_requested', 'void_answered', 'item_voided', 'item_moved_to_stock'];

export const isAuditAction = (a: string): a is AuditAction => (AUDIT_ACTIONS as readonly string[]).includes(a);

const key = (k: string) => k as MessageKey;

export function actionText(action: string): string {
  return isAuditAction(action) ? t(key(`audit.action.${action}`)) : action;
}

export function actionMeta(action: string): ActionMeta {
  return isAuditAction(action) ? ACTION_META[action] : { group: 'requests', tone: 'mute', icon: 'dot' };
}

export function groupText(g: AuditGroup): string {
  return t(key(`audit.actions.group.${g}`));
}

// ------------------------------------------------------------------------------------------------ outcome

const OUTCOME: Record<string, { tone: AuditTone; icon: AuditIconName }> = {
  moved: { tone: 'ok', icon: 'box' },
  wastage: { tone: 'danger', icon: 'trashx' },
  staff_meal: { tone: 'brand', icon: 'user' },
  other: { tone: 'mute', icon: 'dot' },
  approved: { tone: 'ok', icon: 'check' },
  accepted: { tone: 'ok', icon: 'check' },
  rejected: { tone: 'danger', icon: 'x' },
  declined: { tone: 'danger', icon: 'x' },
  withdrawn: { tone: 'mute', icon: 'undo' },
  pin_invalid: { tone: 'warn', icon: 'lock' },
  answer_failed: { tone: 'warn', icon: 'x' },
  done: { tone: 'ok', icon: 'check' },
  obsolete: { tone: 'mute', icon: 'x' },
  overridden: { tone: 'mute', icon: 'x' },
  undone: { tone: 'mute', icon: 'undo' },
  expired: { tone: 'mute', icon: 'clock' },
  remake: { tone: 'warn', icon: 'undo' },
  fix: { tone: 'warn', icon: 'undo' },
  manual: { tone: 'danger', icon: 'tablet' },
  owner_removed: { tone: 'danger', icon: 'tablet' },
  paused: { tone: 'warn', icon: 'clock' },
  resumed: { tone: 'ok', icon: 'clock' },
  available: { tone: 'ok', icon: 'check' },
  unavailable: { tone: 'danger', icon: 'x' },
};

export const OUTCOMES: readonly string[] = Object.keys(OUTCOME);

/** The outcome pill (frame Audit), or null for an unknown value (shown as plain text). */
export function outcomeOf(outcome: string | null): { text: string; tone: AuditTone; icon: AuditIconName } | null {
  if (outcome === null) return null;
  const o = OUTCOME[outcome];
  if (o === undefined) return null;
  return { text: t(key(`audit.out.${outcome}`)), ...o };
}

// ------------------------------------------------------------------------------------------------ reason

const HOLDER_REASONS = ['take_over', 'handover', 'force_move'];

/**
 * §5 `reason` = `reason_code[: note]`: a V12 void code shows its words (the note after it); a comp reason is the
 * branch's chip label already (02b Q-19) and shows as stored; a table hand-over reason shows its words.
 */
export function reasonText(action: string, reason: string | null): string | null {
  if (reason === null || reason === '') return null;
  if (action === 'table_holder_changed' && HOLDER_REASONS.includes(reason)) return t(key(`audit.reason.${reason}`));
  const at = reason.indexOf(': ');
  const code = at < 0 ? reason : reason.slice(0, at);
  const note = at < 0 ? null : reason.slice(at + 2);
  if (!(VOID_REASON_CODES as readonly string[]).includes(code)) return reason;
  const words = t(key(`audit.reason.${code}`));
  return note === null ? words : fill(t('audit.reason.with_note'), { reason: words, note });
}

// ------------------------------------------------------------------------------------------------ who, target

/** "01JDQ…G7Q2": the frame's shortened id for an actor with no name (O1). */
export function shortId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 5)}…${id.slice(-4)}`;
}

export function detailOf(e: AuditEntryView): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(e.detail_json);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Target (frame Audit): the table chip and "item ×units" when the row holds them; a device name for screen rows. */
export function targetOf(e: AuditEntryView, detail: Record<string, unknown> = detailOf(e)): { table: string | null; text: string | null } {
  const table = e.table_name ?? e.table_code;
  const item = typeof detail['item'] === 'string' ? detail['item'] : typeof detail['device_name'] === 'string' ? detail['device_name'] : null;
  const units = typeof detail['units'] === 'number' ? detail['units'] : null;
  const parts = [item, units === null ? null : `×${units}`].filter((p): p is string => p !== null);
  return { table, text: parts.length === 0 ? null : parts.join(' ') };
}

/** The approver's method tag (§8: "in person", "on requester's device"; O3: the tag in sentence case). */
export type MethodTag = 'in_person' | 'on_requester_device';

export function methodOf(e: AuditEntryView, detail: Record<string, unknown> = detailOf(e)): MethodTag | null {
  if (e.method === 'in_person') return 'in_person';
  if (detail['on_requester_device'] === true) return 'on_requester_device';
  return null;
}
