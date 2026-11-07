// 03a §10.6, AD-27: the generated days, from docs/stories/03a-sim/replay_cost.py (rush_times, the MENU draw) with a seeded
// PRNG in test code only. Developer ruling AD-27 redefined the day: the drill's day asks for about 300 % at peak.
//   normal peak day (the default): every station's busiest hour asks for 90–100 % of what it can cook, R6's volume;
//   overload day: the same day, plus demand at 125 % for one hour of the dinner rush, then back to normal.
// Arrivals and menus draw from separate streams (the drill's two generators share a seed, which correlates them).
export const TICK_MS = 500; // 01d's tick loop, §3.6

const SECOND = 1_000;
const HOUR = 3_600 * SECOND;
const DAY_MS = 18 * HOUR;
// A round instant on the 500 ms grid; every simulated time is an offset of it.
const START_MS = 1_761_000_000_000;
const TARGET_EXTRA_MS = 300 * SECOND; // §10.6: target = max cook + 300 s
const OVERLOAD_EXTRA = 0.25; // AD-27: 125 % for one hour of the rush
const WINDOWS_PER_HOUR = 6;

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

// overload_hour: only on an overload day, the hour its extra orders fall in, [from_ms, to_ms).
export type SimDay = { seed: number; start_ms: number; stations: SimStation[]; orders: SimOrder[]; overload_hour?: { from_ms: number; to_ms: number } };

export type GenerateOptions = {
  overload?: boolean; // AD-27's overload day; default the normal peak day
  // Default 2 000 (§10.6); fewer orders of the same distributions for a faster test.
  orders?: number;
  start_ms?: number;
  // Prepended to order and line ids, so the days of one log never share an id (twoDayLog).
  id_prefix?: string;
};

// §10.6's stations and cooks, capacities by AD-27 (01a's range 1–100, none above §10.6's value). Karahi, BBQ and tawa keep
// §10.6's capacity and their demand comes down. Tandoor (60) and degh (100) sit below §10.6's value: at those capacities
// they were idle at peak (25 %, 50 %), and lowering them raises no demand.
// Proposed (implementer, overnight): §10.6 gives degh no freshness window. A load books the whole station, so the 01a
// default window 0 would give every order its own 60 s load. Window 60 s (= max_early_ms, which caps it per line, = one
// load's cook) lets one load serve a minute of landings.
function stations(): SimStation[] {
  return [
    { station_id: 'bbq', type: 'slot', capacity: 30, cook_ms: 900 * SECOND, freshness_window_ms: null },
    { station_id: 'degh', type: 'batch', capacity: 4, cook_ms: 60 * SECOND, freshness_window_ms: 60 * SECOND },
    { station_id: 'karahi', type: 'slot', capacity: 50, cook_ms: 1_200 * SECOND, freshness_window_ms: null },
    { station_id: 'tandoor', type: 'slot', capacity: 30, cook_ms: 180 * SECOND, freshness_window_ms: null },
    { station_id: 'tawa', type: 'slot', capacity: 8, cook_ms: 300 * SECOND, freshness_window_ms: null },
  ];
}

// AD-27: lines per order per station, the rates realised. The drill's formula below really gave ≈ 2.60 / 1.35 / 1.09 / 1.21 /
// 0.99 (its labels were 3.0 / 0.6 / 0.4 / 0.5 / 0.3), so a demand-side number is now stated once, here. No rate is above
// what the old day realised. Set on seed 7's busiest hours, so that demandPeakPct is 90–100 % and as near 100 % as it goes;
// the extra decimals are that fit, one line of a station's peak hour is about 1 %.
export const LINE_RATES: Readonly<Record<string, number>> = { tandoor: 2.55, karahi: 0.582, bbq: 0.503, degh: 0.96, tawa: 0.41 };

// The drill's MENU: the shape of an order's lines at a station, its weights formula as is, then each drawn line kept with
// the probability that gives the stated rate. So an order still comes in lumps, as the drill's do.
const MENU: ReadonlyArray<readonly [string, number]> = [
  ['tandoor', 3.0],
  ['karahi', 0.6],
  ['bbq', 0.4],
  ['degh', 0.5],
  ['tawa', 0.3],
];
const LINE_COUNTS = [0, 1, 2, 3, 4, 6];
const lineWeights = (avg: number): number[] => [Math.max(0.01, 1 - avg / 1.6), 1, avg / 2, avg / 3, avg / 5, avg / 8];
const MENU_DRAWS = MENU.map(([station_id, label]) => {
  const weights = lineWeights(label);
  const total = weights.reduce((a, b) => a + b, 0);
  const shapeMean = weights.reduce((sum, w, i) => sum + w * LINE_COUNTS[i]!, 0) / total;
  return { station_id, weights, keep: Math.min(1, LINE_RATES[station_id]! / shapeMean) };
});

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

// Units per one-hour window, windows every 10 minutes: window k is [k × 10 min, k × 10 min + 1 h) from the day's start.
function hourWindows(orders: readonly SimOrder[], start_ms: number, units: (o: SimOrder) => number): Map<number, number> {
  const perHour = new Map<number, number>();
  for (const o of orders) {
    const n = units(o);
    for (let w = 0; w < WINDOWS_PER_HOUR; w++) {
      const k = Math.floor((o.at_ms - start_ms + (w * HOUR) / WINDOWS_PER_HOUR) / HOUR) * WINDOWS_PER_HOUR - w;
      perHour.set(k, (perHour.get(k) ?? 0) + n);
    }
  }
  return perHour;
}

// The most units a station is asked for in any one-hour window.
export function peakHourUnits(orders: readonly SimOrder[], start_ms: number, station_id: string): number {
  return Math.max(0, ...hourWindows(orders, start_ms, (o) => o.lines.filter((l) => l.station_id === station_id).length).values());
}

// AD-27, from demand alone: a station's busiest hour as a % of what it can cook in an hour, capacity × 1 h / cook. For a
// batch station this counts full loads; on a real day its loads are not all full, so the % policyReport measures is the
// time the station is in use, and it can read higher.
export function demandPeakPct(day: SimDay): Record<string, number> {
  return Object.fromEntries(day.stations.map((s) => [s.station_id, (100 * peakHourUnits(day.orders, day.start_ms, s.station_id) * s.cook_ms) / (s.capacity * HOUR)]));
}

function pickupAt(at_ms: number, station_ids: readonly string[], cookOf: ReadonlyMap<string, number>): number {
  // Proposed (implementer, overnight): §10.6 "target = max cook + 300 s" is the drill's target for every order. The
  // engine's only input for a target later than its loop result is pickup_at_ms (§3.5.1 step 4: T = max(pickup, loop
  // result), D3), so every order carries it, whatever its type.
  return at_ms + Math.max(...station_ids.map((s) => cookOf.get(s)!)) + TARGET_EXTRA_MS;
}

// Proposed (implementer, overnight): the replay_cost drill has no order types and the policy report (D22) reports by type,
// so the mix is tandoor_sim.py's: 55 % dine in, 33 % takeaway, 12 % follow-up (a dine-in order). Dine-in tables come from a
// pool of 60, so table keys are shared as they are on a real floor (slip upkeep, §7.1).
function orderOf(kinds: () => number, order_id: string, at_ms: number, lines: SimLine[], cookOf: ReadonlyMap<string, number>): SimOrder {
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
    pickup_at_ms: pickupAt(at_ms, lines.map((l) => l.station_id), cookOf),
    lines,
  };
}

// AD-27's overload hour: the hour of the normal day with the most lines (the middle of the dinner rush), and on top of it a
// quarter of that hour's orders, carrying exactly a quarter of its lines per station, at uniform times inside it.
function withOverload(day: SimDay, seed: number, prefix: string, cookOf: ReadonlyMap<string, number>): SimDay {
  const r = prng(seed ^ 0x2545f491);
  const kinds = prng(seed ^ 0x6c62272e);
  const windows = hourWindows(day.orders, day.start_ms, (o) => o.lines.length);
  const best = [...windows].reduce((a, b) => (b[1] > a[1] || (b[1] === a[1] && b[0] < a[0]) ? b : a))[0];
  const from_ms = day.start_ms + (best * HOUR) / WINDOWS_PER_HOUR;
  const to_ms = from_ms + HOUR;
  const inHour = day.orders.filter((o) => o.at_ms >= from_ms && o.at_ms < to_ms);
  const count = Math.round(OVERLOAD_EXTRA * inHour.length);
  const baskets: string[][] = Array.from({ length: count }, () => []);
  for (const s of day.stations) {
    const units = inHour.reduce((n, o) => n + o.lines.filter((l) => l.station_id === s.station_id).length, 0);
    const extra = Math.round(OVERLOAD_EXTRA * units);
    for (let i = 0; i < extra; i++) baskets[Math.floor(r() * count)]!.push(s.station_id);
  }
  let nextLine = 1;
  const extras = baskets
    .filter((names) => names.length > 0)
    .map((names, i): SimOrder => {
      const lines = names.map((station_id) => ({ order_item_id: `${prefix}XL${String(nextLine++).padStart(7, '0')}`, station_id }));
      return orderOf(kinds, `${prefix}XO${String(i + 1).padStart(6, '0')}`, from_ms + Math.floor(r() * HOUR), lines, cookOf);
    });
  // Array.prototype.sort is stable: at one instant a normal order keeps its place and an extra follows it.
  return { ...day, orders: [...day.orders, ...extras].sort((a, b) => a.at_ms - b.at_ms), overload_hour: { from_ms, to_ms } };
}

export function generateDay(seed: number, o: GenerateOptions = {}): SimDay {
  const n = o.orders ?? 2_000;
  const start_ms = o.start_ms ?? START_MS;
  const prefix = o.id_prefix ?? '';
  const arrivals = prng(seed);
  const menu = prng(seed ^ 0x9e3779b9);
  const kinds = prng(seed ^ 0x517cc1b7);
  const list = stations();
  const cookOf = new Map(list.map((s) => [s.station_id, s.cook_ms]));
  let nextLine = 1;
  const orders = rushTimes(arrivals, n).map((offset, i): SimOrder => {
    const names: string[] = [];
    for (const { station_id, weights, keep } of MENU_DRAWS) {
      const count = LINE_COUNTS[pick(menu, weights)]!;
      for (let k = 0; k < count; k++) if (menu() < keep) names.push(station_id);
    }
    if (names.length === 0) names.push('tandoor');
    const lines = names.map((station_id) => ({ order_item_id: `${prefix}L${String(nextLine++).padStart(7, '0')}`, station_id }));
    return orderOf(kinds, `${prefix}O${String(i + 1).padStart(6, '0')}`, start_ms + offset, lines, cookOf);
  });
  const day: SimDay = { seed, start_ms, stations: list, orders };
  return o.overload === true ? withOverload(day, seed, prefix, cookOf) : day;
}
