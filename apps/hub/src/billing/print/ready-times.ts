import type { FiscalSaleInvoiceFields } from '@pos/domain';
import type { EngineLine, EngineState } from '@pos/engine';
import { clock12 } from '../../print/render/jobs.js';
import { branchConfig } from '../../sync/branch-config-holder.js';

// 05 v1.0.33 §3.16 (STAB-5; proposal §6 Q2, 01a v2.7.3 `show_part_times_to_customers`, default on): the ready times a
// takeaway receipt prints, from the engine state at the print (memory only, no statement):
// - the order's together lines (`sync`): "Ready ~2:40 PM", the latest of their times;
// - an as-ready line or a split line's as-ready parts (one entry per `part_of`): "Karahi: 4 ready ~2:20 PM · 1 ready
//   ~2:40 PM" (parts bucketed by the minute, earliest first), with one time "Karahi: ready ~2:20 PM";
// - a line's time = its land (done_at, else the booked cook end; + carry_ms) + the order's padding
//   (promise_ms − target_land_ms), 12-hour clock in the branch zone;
// - only the invoice's own lines that are still in the engine and not served; nothing for another order type, or when
//   the setting is off (the receipt is as before).

const LIVE = new Set<EngineLine['stage']>(['added', 'cooking', 'done']);

function landOf(state: EngineState, l: EngineLine): number | null {
  if (l.done_at !== null) return l.done_at + l.carry_ms;
  const booked = l.booked ?? (l.load_id === null ? null : (state.stations[l.station_id]?.loads[l.load_id]?.booked ?? null));
  if (booked !== null) return booked.end + l.carry_ms;
  const start = l.started_at ?? l.fired_at ?? l.fire_ms;
  return start === null ? null : start + l.cook_ms + l.carry_ms;
}

export function customerReadyTimes(state: EngineState, invoice: Pick<FiscalSaleInvoiceFields, 'order_type' | 'lines'>, utc_offset_ms: number): string[] {
  if (invoice.order_type !== 'takeaway') return [];
  if ((branchConfig()?.engine_settings.show_part_times_to_customers ?? true) === false) return [];
  const together: number[] = [];
  const entries = new Map<string, { name: string; times: number[] }>();
  for (const il of invoice.lines) {
    const l = state.lines[il.order_item_id];
    if (l === undefined || !LIVE.has(l.stage)) continue;
    const order = state.orders[l.order_id];
    const land = landOf(state, l);
    if (order === undefined || land === null) continue;
    const at = land + (order.promise_ms - order.target_land_ms);
    if (l.serve_mode === 'sync') {
      together.push(at);
      continue;
    }
    const key = il.part_of ?? il.order_item_id;
    const e = entries.get(key) ?? { name: il.name, times: [] };
    for (let u = 0; u < il.units; u += 1) e.times.push(at);
    entries.set(key, e);
  }
  const out: string[] = [];
  if (together.length > 0) out.push(`Ready ~${clock12(Math.max(...together), utc_offset_ms)}`);
  for (const { name, times } of entries.values()) {
    const buckets = new Map<string, { at: number; n: number }>();
    for (const at of [...times].sort((a, b) => a - b)) {
      const text = clock12(at, utc_offset_ms);
      const b = buckets.get(text);
      if (b === undefined) buckets.set(text, { at, n: 1 });
      else b.n += 1;
    }
    const list = [...buckets];
    out.push(list.length === 1 ? `${name}: ready ~${list[0]![0]}` : `${name}: ${list.map(([text, b]) => `${b.n} ready ~${text}`).join(' · ')}`);
  }
  return out;
}
