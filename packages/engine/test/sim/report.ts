// 03a §10.6 policy report (D22, not a gate), from the log alone: % promises kept, max late, mean wait by order type,
// cold time, utilisation. tandoor_sim.py's definitions at order level:
//   land      = the order's last Done (carry is 0 on the generated day);
//   late      = land − promise;
//   wait      = land − placed_at;
//   cold      = land − the line's Done, the drill's main_ready − done, over every line.
// Proposed (implementer, overnight): a promise counts as kept when land < promise + one tick (500 ms): the tick fires a
// line on its grid, up to 499 ms after its planned fire, and FIFO / EDF have padding 0 (§3.5.1), so a literal comparison
// would count the tick's own rounding as a broken promise. max_late_ms is the raw number, with no such allowance.
// Utilisation: unit-time in use / (capacity × time), mean over the station's first Start to last Done, and the busiest
// clock hour of that span (peak_hour_pct, reported). peak_window_pct is the busiest hour on demandPeakPct's windows, every
// 10 minutes, the one AD-27's 90–100 % is asserted on (AD-29 Q1), because a clock hour can split a rush. A batch load counts
// once, as the whole station (§3.3).
import type { EngineConfig } from '@pos/events';
import { TICK_MS } from './generate';
import type { Policy, SimResult } from './run';

const HOUR = 3_600_000;
const WINDOW_STEP = 600_000;
const round2 = (x: number): number => Math.round(x * 100) / 100;

export type Utilisation = { mean_pct: number; peak_hour_pct: number; peak_window_pct: number };

export type PolicyReport = {
  policy: Policy;
  orders: number;
  lines: number;
  promises_kept_pct: number;
  max_late_ms: number;
  mean_wait_ms: Record<string, number>; // dine_in, takeaway, …, follow_up (the drill's third type)
  mean_cold_ms: number;
  max_target_ahead_ms: number; // AD-27: the largest T − now at a submit, how far ahead the kitchen is promising
  utilisation: Record<string, Utilisation>;
  breaches: number; // diagnostics other than the over_capacity warning; a strict run throws first
};

type OrderRow = { type: string; placed_at: number; promise: number; lines: string[] };
type LineRow = { station_id: string; units: number; load_id: string | null; started: number | null; done: number | null };
type Usage = { start: number; end: number; units: number };

// The busiest hour on a 10-minute grid: steps hold the unit-time of each 10 minutes, a window is 6 steps in a row.
function peakWindow(usage: readonly Usage[], capacity: number): number {
  const steps = new Map<number, number>();
  for (const u of usage) {
    for (let k = Math.floor(u.start / WINDOW_STEP); k * WINDOW_STEP < u.end; k++) {
      const overlap = Math.min(u.end, (k + 1) * WINDOW_STEP) - Math.max(u.start, k * WINDOW_STEP);
      steps.set(k, (steps.get(k) ?? 0) + overlap * u.units);
    }
  }
  let peak = 0;
  for (const k of steps.keys()) {
    let used = 0;
    for (let i = 0; i < 6; i++) used += steps.get(k + i) ?? 0;
    peak = Math.max(peak, used);
  }
  return round2((100 * peak) / (capacity * HOUR));
}

function utilisationOf(usage: readonly Usage[], capacity: number): Utilisation {
  if (usage.length === 0) return { mean_pct: 0, peak_hour_pct: 0, peak_window_pct: 0 };
  const first = Math.min(...usage.map((u) => u.start));
  const last = Math.max(...usage.map((u) => u.end));
  const hours = new Map<number, number>();
  let busy = 0;
  for (const u of usage) {
    busy += (u.end - u.start) * u.units;
    for (let h = Math.floor(u.start / HOUR); h * HOUR < u.end; h++) {
      const overlap = Math.min(u.end, (h + 1) * HOUR) - Math.max(u.start, h * HOUR);
      hours.set(h, (hours.get(h) ?? 0) + overlap * u.units);
    }
  }
  let peak = 0;
  for (const [h, used] of hours) {
    // Only the part of the hour inside the span counts, so the peak is never below the mean.
    const span = Math.min(last, (h + 1) * HOUR) - Math.max(first, h * HOUR);
    peak = Math.max(peak, used / (capacity * span));
  }
  return { mean_pct: round2((100 * busy) / (capacity * (last - first))), peak_hour_pct: round2(100 * peak), peak_window_pct: peakWindow(usage, capacity) };
}

export function policyReport(result: SimResult): PolicyReport {
  const orders = new Map<string, OrderRow>();
  const lines = new Map<string, LineRow>();
  let config: EngineConfig | null = null;
  let targetAhead = 0;
  for (const e of result.events) {
    const p = e.payload as Record<string, never>;
    switch (e.event_type) {
      case 'EngineConfigApplied':
        config = e.payload as unknown as EngineConfig;
        break;
      case 'OrderPlaced': {
        const groups = p.groups as unknown as Array<{ promise_ms: number; target_land_ms: number }>;
        for (const g of groups) targetAhead = Math.max(targetAhead, g.target_land_ms - e.recorded_at);
        orders.set(p.order_id, {
          type: p.follow_up ? 'follow_up' : p.order_type,
          placed_at: e.recorded_at,
          promise: Math.max(...groups.map((g) => g.promise_ms)),
          lines: p.order_item_ids,
        });
        break;
      }
      case 'ItemAdded':
        lines.set(p.order_item_id, { station_id: p.station_id, units: p.quantity, load_id: null, started: null, done: null });
        break;
      case 'FireDispatched':
        for (const id of p.order_item_ids as unknown as string[]) lines.get(id)!.load_id = p.load_id;
        break;
      case 'ItemStarted':
        lines.get(p.order_item_id)!.started = p.started_at;
        break;
      case 'ItemDone':
        lines.get(p.order_item_id)!.done = p.done_at;
        break;
      default:
    }
  }
  if (config === null) throw new Error('policyReport: the log has no EngineConfigApplied');

  let kept = 0;
  let maxLate = 0; // never negative: an order that lands early is 0 late
  let cold = 0;
  let coldLines = 0;
  const waits = new Map<string, { sum: number; n: number }>();
  for (const o of orders.values()) {
    const done = o.lines.map((id) => lines.get(id)!.done!);
    const land = Math.max(...done);
    const late = land - o.promise;
    if (late < TICK_MS) kept++;
    maxLate = Math.max(maxLate, late);
    for (const d of done) cold += land - d;
    coldLines += done.length;
    const w = waits.get(o.type) ?? { sum: 0, n: 0 };
    waits.set(o.type, { sum: w.sum + (land - o.placed_at), n: w.n + 1 });
  }

  const utilisation: PolicyReport['utilisation'] = {};
  for (const s of config.stations) {
    const usage: Usage[] = [];
    const loadsSeen = new Set<string>();
    for (const l of lines.values()) {
      if (l.station_id !== s.station_id || l.started === null || l.done === null) continue;
      if (s.station_type === 'batch' && l.load_id !== null) {
        const key = `${l.load_id}@${l.started}`;
        if (loadsSeen.has(key)) continue;
        loadsSeen.add(key);
        usage.push({ start: l.started, end: l.done, units: s.capacity });
      } else {
        usage.push({ start: l.started, end: l.done, units: l.units });
      }
    }
    utilisation[s.station_id] = utilisationOf(usage, s.capacity);
  }

  return {
    policy: config.stations[0]!.policy,
    orders: orders.size,
    lines: lines.size,
    promises_kept_pct: orders.size === 0 ? 100 : round2((100 * kept) / orders.size),
    max_late_ms: maxLate,
    mean_wait_ms: Object.fromEntries([...waits].map(([k, v]) => [k, Math.round(v.sum / v.n)])),
    mean_cold_ms: coldLines === 0 ? 0 : Math.round(cold / coldLines),
    max_target_ahead_ms: targetAhead,
    utilisation,
    breaches: result.liveState.diagnostics.filter((d) => d.kind !== 'over_capacity').length,
  };
}
