import type { EventDraft } from '@pos/events';
import { alerts, type CloseItem, type RaiseInput } from '../alerts/raise.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import type { ZoneAlertDrafts } from './contracts.js';

// 02b §3.10 Alerts (kinds §6.13, subject §6.19): the zone stock alert drafts of a set of count changes, for the
// commands that move a zone count (AddZoneStock, SetZoneStock, a zone-served submit / remove). Per change, with the
// item's `threshold` from the zone's config `stock_items`:
//   before > threshold, after <= threshold -> raise zone_stock_low (dedupe zone_low:<zone_id>:<item_id>)
//   before > 0, after = 0                  -> raise zone_stock_out (dedupe zone_out:<zone_id>:<item_id>), even if low is open
//   after > threshold                      -> close that item's open low / out alerts 'done'
// Statements: one alerts.listOpen per zone subject, plus raiseMany / closeMany's own (only when there is something to do).
// The kind names are strings here on purpose: the kinds are registered by zone-kinds.ts through orders/index.ts.

const LOW = 'zone_stock_low';
const OUT = 'zone_stock_out';
const subjectOf = (zone_id: string) => ({ stream_type: 'table' as const, stream_id: `zone:${zone_id}` });

export const zoneAlertDrafts: ZoneAlertDrafts = (ctx, changes) => {
  const zones = new Map((branchConfig()?.floors ?? []).flatMap((f) => f.zones).map((z) => [z.zone_id, z]));
  const raises: RaiseInput[] = [];
  const closes: CloseItem[] = [];
  const openByZone = new Map<string, ReturnType<typeof alerts.listOpen>>();
  for (const { zone_id, item_id, before, after } of changes) {
    let open = openByZone.get(zone_id);
    if (open === undefined) {
      open = alerts.listOpen(ctx.tx.db, { subject: subjectOf(zone_id) });
      openByZone.set(zone_id, open);
    }
    const threshold = zones.get(zone_id)?.stock_items.find((s) => s.item_id === item_id)?.threshold;
    if (threshold === undefined) continue; // not a zone item of this zone: no zone stock, no alert
    const values = { zone_id, item_id, on_hand: after, threshold };
    const raise = (kind: string, dedupe_key: string): void => {
      raises.push({ kind, subject: subjectOf(zone_id), target: { kind: 'permission', permission: 'manage-zone-stock' }, values, display: { kind_label_key: `alert.${kind}.lock` }, dedupe_key });
    };
    const keys = { [LOW]: `zone_low:${zone_id}:${item_id}`, [OUT]: `zone_out:${zone_id}:${item_id}` };
    if (after > threshold) {
      for (const a of open) {
        if ((a.kind === LOW || a.kind === OUT) && a.dedupe_key === keys[a.kind]) closes.push({ alert_id: a.alert_id, reason: 'done' });
      }
      continue;
    }
    if (before > threshold) raise(LOW, keys[LOW]);
    if (after === 0 && before > 0) raise(OUT, keys[OUT]);
  }
  const drafts: EventDraft[] = [];
  if (closes.length > 0) drafts.push(...alerts.closeMany(ctx, closes));
  if (raises.length > 0) for (const r of alerts.raiseMany(ctx, raises)) drafts.push(...r.events);
  return drafts;
};
