// 03a §10.6: the generated day, ported from docs/stories/03a-sim/replay_cost.py (rush_times, the MENU draw) with a
// seeded PRNG in test code only. Same distributions and same counts as the drill; not Python's Mersenne Twister, so
// not its exact day (the drill's seed 7 has 14 412 lines; this one is within sampling noise of it). One deliberate
// difference: the drill draws arrivals and menus from two generators with the same seed, which correlates them; here
// each has its own stream.
export const TICK_MS = 500; // 01d's tick loop, §3.6

const SECOND = 1_000;
const HOUR = 3_600 * SECOND;
const DAY_MS = 18 * HOUR;
// A round instant on the 500 ms grid; every simulated time is an offset of it.
const START_MS = 1_761_000_000_000;
const TARGET_EXTRA_MS = 300 * SECOND; // §10.6: target = max cook + 300 s
const OVERLOAD = 1.25; // §10.6: tandoor at 125 %

export type SimStation = {
  station_id: string;
  type: 'slot' | 'batch';
  capacity: number;
  cook_ms: number;
  freshness_window_ms: number | null;
};

export type SimLine = { order_item_id: string; station_id: string };

export type SimOrder = {
  order_id: string;
  at_ms: number;
  order_type: 'dine_in' | 'takeaway';
  follow_up: boolean;
  table_id: string | null;
  table_key: string;
  pickup_at_ms: number;
  lines: SimLine[];
};

export type SimDay = { seed: number; start_ms: number; stations: SimStation[]; orders: SimOrder[] };

export type GenerateOptions = {
  overload?: boolean;
  // Default 2 000 (§10.6); fewer orders of the same distributions for a faster test.
  orders?: number;
  start_ms?: number;
};

// §10.6, by station id.
// Proposed (implementer, overnight): §10.6 gives degh "batch 100 × 60 s" and no freshness window. A load books the whole
// station, so the 01a default window 0 would give every order its own 60 s load: 60 loads/h against ~150 orders/h with a
// degh line at peak, a queue the drill's 100-a-minute degh never has. Window 60 s (= max_early_ms, which caps it per line,
// = one load's cook) keeps the stated throughput of 100 units per 60 s.
function stations(): SimStation[] {
  return [
    { station_id: 'bbq', type: 'slot', capacity: 30, cook_ms: 900 * SECOND, freshness_window_ms: null },
    { station_id: 'degh', type: 'batch', capacity: 100, cook_ms: 60 * SECOND, freshness_window_ms: 60 * SECOND },
    { station_id: 'karahi', type: 'slot', capacity: 50, cook_ms: 1_200 * SECOND, freshness_window_ms: null },
    { station_id: 'tandoor', type: 'slot', capacity: 60, cook_ms: 180 * SECOND, freshness_window_ms: null },
    { station_id: 'tawa', type: 'slot', capacity: 8, cook_ms: 300 * SECOND, freshness_window_ms: null },
  ];
}

// The drill's MENU, in its order, with its weights formula ported as is. The numbers are the drill's labels ("avg lines per
// order"), not what the formula gives: realised ≈ 2.60 / 1.35 / 1.09 / 1.21 / 0.99 lines per order, which is the drill's
// 14 412 lines (§10.6). See the task 18a report: at these rates karahi, BBQ and tawa are asked for ~200 % at peak.
const MENU: ReadonlyArray<readonly [string, number]> = [
  ['tandoor', 3.0],
  ['karahi', 0.6],
  ['bbq', 0.4],
  ['degh', 0.5],
  ['tawa', 0.3],
];
const LINE_COUNTS = [0, 1, 2, 3, 4, 6];
const lineWeights = (avg: number): number[] => [Math.max(0.01, 1 - avg / 1.6), 1, avg / 2, avg / 3, avg / 5, avg / 8];

// mulberry32: small, seedable, good enough for arrivals.
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function gauss(r: () => number, mean: number, sd: number): number {
  const u = 1 - r(); // (0, 1]
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

function pick(r: () => number, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = r() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i]!;
    if (x < 0) return i;
  }
  return weights.length - 1;
}

// rush_times: 65 % dinner gauss(13 h, 9 000 s), 25 % lunch gauss(6 h, 3 600 s), 10 % uniform over 18 h, clamped, sorted.
function rushTimes(r: () => number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = r();
    const t = u < 0.65 ? gauss(r, 13 * HOUR, 9_000 * SECOND) : u < 0.9 ? gauss(r, 6 * HOUR, 3_600 * SECOND) : r() * DAY_MS;
    out.push(Math.round(Math.min(Math.max(t, 0), DAY_MS)));
  }
  return out.sort((a, b) => a - b);
}

// The most units a station is asked for in any one-hour window (windows every 10 minutes).
function peakHourUnits(orders: readonly SimOrder[], start_ms: number, station_id: string): number {
  const perHour = new Map<number, number>();
  for (const o of orders) {
    const n = o.lines.filter((l) => l.station_id === station_id).length;
    for (let w = 0; w < 6; w++) {
      const k = Math.floor((o.at_ms - start_ms + (w * HOUR) / 6) / HOUR) * 6 - w;
      perHour.set(k, (perHour.get(k) ?? 0) + n);
    }
  }
  return Math.max(0, ...perHour.values());
}

export function generateDay(seed: number, o: GenerateOptions = {}): SimDay {
  const n = o.orders ?? 2_000;
  const start_ms = o.start_ms ?? START_MS;
  const arrivals = prng(seed);
  const menu = prng(seed ^ 0x9e3779b9);
  const kinds = prng(seed ^ 0x517cc1b7);
  const list = stations();
  const cookOf = new Map(list.map((s) => [s.station_id, s.cook_ms]));
  let nextLine = 1;
  const orders = rushTimes(arrivals, n).map((offset, i): SimOrder => {
    const order_id = `O${String(i + 1).padStart(6, '0')}`;
    const lines: SimLine[] = [];
    const names: string[] = [];
    for (const [station_id, avg] of MENU) {
      const count = LINE_COUNTS[pick(menu, lineWeights(avg))]!;
      for (let k = 0; k < count; k++) names.push(station_id);
    }
    if (names.length === 0) names.push('tandoor');
    for (const station_id of names) lines.push({ order_item_id: `L${String(nextLine++).padStart(7, '0')}`, station_id });
    const at_ms = start_ms + offset;
    // Proposed (implementer, overnight): the replay_cost drill has no order types and the policy report (D22) reports
    // by type, so the mix is tandoor_sim.py's: 55 % dine in, 33 % takeaway, 12 % follow-up (a dine-in order). Dine-in
    // tables come from a pool of 60, so table keys are shared as they are on a real floor (slip upkeep, §7.1).
    const x = kinds();
    const dine = x < 0.55 || x >= 0.88;
    const table = dine ? `T${1 + Math.floor(kinds() * 60)}` : null;
    return {
      order_id,
      at_ms,
      order_type: dine ? 'dine_in' : 'takeaway',
      follow_up: x >= 0.88,
      table_id: table,
      table_key: dine ? `dine_in:${table}` : `takeaway:${order_id}`,
      // Proposed (implementer, overnight): §10.6 "target = max cook + 300 s" is the drill's target for every order. The
      // engine's only input for a target later than its loop result is pickup_at_ms (§3.5.1 step 4: T = max(pickup, loop
      // result), D3), so every order carries it, whatever its type. Without it no tandoor order is held at all and the
      // day has far fewer hidden lines than the drill: it would under-drive the 50 ms gate.
      pickup_at_ms: at_ms + Math.max(...names.map((s) => cookOf.get(s)!)) + TARGET_EXTRA_MS,
      lines,
    };
  });
  // Proposed (implementer, overnight): "tandoor at 125 %" = the same orders, with the tandoor capacity at which its
  // busiest hour asks for 125 % of what it can cook (the §10.6 tandoor is sized well above its peak).
  const sized = o.overload !== true ? list : list.map((s) => {
    if (s.station_id !== 'tandoor') return s;
    const capacity = Math.max(1, Math.round((peakHourUnits(orders, start_ms, 'tandoor') * s.cook_ms) / (OVERLOAD * HOUR)));
    return { ...s, capacity };
  });
  return { seed, start_ms, stations: sized, orders };
}
