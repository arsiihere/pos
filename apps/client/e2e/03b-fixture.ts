import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { BranchConfig, ConfigItem, EventDraft } from '@pos/events';
import { branchConfig } from '../../hub/src/sync/branch-config-holder';
import { configPoller } from '../../hub/src/sync/config-poller';
import type { StubConfigCloud } from '../../hub/test/helpers/stub-config-cloud';
import { append, appendOrder, fireLines, pairDevice, pairPassTablet } from '../../hub/test/kds/fixtures';
import { fakeLanPrinter, type FakeLanPrinter } from '../../hub/test/print/fixtures';
import { appendDeviceProfile, type TestHub } from '../../hub/test/helpers/test-hub';

// 03b / 03c client flows (Z1; 03b v1.0.8 §8, §10 #70–#76, 03c v1.0.9 §8): the fixture on top of 02's e2e hub. Every
// (flow, viewport, language) run gets its own station with its own lines, so runs never meet (as 02a's table pairs).
// Stations live in the branch config; the lines are real orders (the hub's 02b / 03b fixtures: appendOrder, then a real
// FireDispatched). The fake printer is a real TCP socket on 127.0.0.1 (the hub's 03c fixture); its printer row is
// written as the PrinterSaved event, because SavePrinter refuses a loopback address (03c §3.2) and the fake cannot
// have another one.

// 'tkpass' (02b-TK L-CLIENT-1, 03b v1.0.16 §3.4): a Pass point of its own whose takeaway order has a pickup time
// 'd7' (02b-TK L-CLIENT-2 item 1, 03b v1.0.16 §3.10 D7): a Pass point of its own (archived by the run) and a second,
// receiving point (`receivingPointOf`) with its own Pass tablet (`passTo:<key>`)
// 'tkbags' (03b v1.0.17 §3.4 "Pass bag = token"; QA BUG-8 and the Pass design audit): a Pass point of its own with six
// bags — a token whose addition cooks after its root was done, ready / cooking / waiting bags and a pickup (phone) order
export const FLOWS_03 = ['kds', 'takeover', 'pass', 'admin', 'tkpass', 'd7', 'tkbags'] as const;
/** the 'tkpass' order's pickup: this long after the seed (the e2e hub's clock is fixed) */
export const TK_PICKUP_AFTER_MS = 30 * 60_000;
export type Flow03 = (typeof FLOWS_03)[number];
const PROJECTS_03 = ['tablet-landscape', 'tablet-portrait', 'kiosk', 'phone-390', 'phone-360'] as const;
const LANGS_03 = ['en', 'ur'] as const;

/** the run's station id, name and line items; `key` = flow, viewport, language */
export const keyOf = (flow: Flow03, project: string, lang: string): string => `${flow}-${project}-${lang}`;
export const stationOf = (flow: Flow03, project: string, lang: string): string => `S3-${keyOf(flow, project, lang)}`;
export const pointOf = (flow: Flow03, project: string, lang: string): string => `P3-${keyOf(flow, project, lang)}`;
export const printerId = 'PR-E2E';
/** the 'd7' run's receiving point (the run's station moves its default here when its own point is archived) */
export const receivingPointOf = (project: string, lang: string): string => `${pointOf('d7', project, lang)}-to`;

/** the three lines of a run, as the kitchen sees them */
export const LINES_03 = [
  { n: 1, name: 'Seekh Kebab', units: 2 },
  { n: 2, name: 'Chicken Tikka', units: 1 },
  { n: 3, name: 'Tandoori Roti', units: 4 },
] as const;
export const itemId = (key: string, n: number): string => `I3-${key}-${n}`;
export const lineId = (key: string, n: number): string => `L3-${key}-${n}`;

/** The 03b stations and items, appended to a menu (two_tap stations: Start, then Done). */
export function menuWith03(menu: BranchConfig): BranchConfig {
  const s1 = menu.stations.find((s) => s.station_id === 'S1')!;
  const base = menu.items.find((i) => i.item_id === 'I_NAAN')!;
  const stations = [];
  const points: BranchConfig['points'] = [];
  const items: ConfigItem[] = [];
  for (const flow of FLOWS_03)
    for (const project of PROJECTS_03)
      for (const lang of LANGS_03) {
        const key = keyOf(flow, project, lang);
        // the Pass flows: the station sits at its own point, so a Pass tablet bound to it sees this run's orders only
        const own = flow === 'pass' || flow === 'takeover' || flow === 'tkpass' || flow === 'd7' || flow === 'tkbags';
        const point = pointOf(flow, project, lang);
        if (own) points.push({ point_id: point, name: `Pass ${key}`, sort_order: 10, is_archived: false });
        if (flow === 'd7') points.push({ point_id: receivingPointOf(project, lang), name: `Receiving ${key}`, sort_order: 10, is_archived: false });
        stations.push({ ...s1, station_id: stationOf(flow, project, lang), name: `Grill ${key}`, completion_mode: 'two_tap' as const, ...(own ? { point_id: point, carry_times: [{ point_id: point, carry_ms: 0 }] } : {}) });
        for (const l of LINES_03) items.push({ ...base, item_id: itemId(key, l.n), name: l.name, station_id: stationOf(flow, project, lang), sort_order: 100 + l.n, cook_time_ms: 6 * 60_000 });
      }
  // a screen that stays away for 3 s is dark (03b §3.6; the default is 30 s): the takeover flow waits for it
  const engine_settings = { ...menu.engine_settings, kds_offline_ms: 3_000 };
  return { ...menu, engine_settings, points: [...menu.points, ...points], stations: [...menu.stations, ...stations], items: [...menu.items, ...items] };
}

function hubEvent(hub: TestHub, event_type: string, payload: Record<string, unknown>): void {
  const draft = { stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, event_type, schema_version: 1, payload, occurred_at: hub.clock.branchNow(), actor_id: null, device_id: 'hub-admin' } as EventDraft;
  hub.clock.advance(1_000);
  hub.deps.writer.run((tx) => tx.append([draft]));
}

/**
 * One fake LAN printer (printer `PR-E2E`, 80 mm); the `kds` flow stations print to it as well as show (mode `both`), so
 * their cards offer Reprint. Then one takeaway order of the three lines per station, fired (in Now).
 */
export interface Devices03 {
  /** `pass:<key>`: the Pass tablet bound to the run's point; `kds:<key>`: the paired kitchen screen of the run's station */
  [name: string]: { token: string; device_id: string };
}

export async function seed03(hub: TestHub, o: { orders?: boolean } = {}): Promise<{ printer: FakeLanPrinter; devices: Devices03 }> {
  const devices: Devices03 = {};
  const printer = await fakeLanPrinter();
  hubEvent(hub, 'PrinterSaved', { printer_id: printerId, name: 'Kitchen printer', connection: 'lan', address: printer.address, paper_width_mm: 80, archived: false });
  for (const flow of FLOWS_03)
    for (const project of PROJECTS_03)
      for (const lang of LANGS_03) {
        const key = keyOf(flow, project, lang);
        const station = stationOf(flow, project, lang);
        if (flow === 'kds' || flow === 'takeover') hubEvent(hub, 'StationOutputSet', { station_id: station, mode: 'both', printer_id: printerId, show_taker: false, show_order_id: true });
        // admin flows: a kitchen screen is paired to the station (offline: nothing opens its socket)
        if (flow === 'admin') pairKds(hub, station, `Screen ${key}`);
        // the takeover flow's station has a screen (its socket is what closes); the pass flow's has none (screenless)
        if (flow === 'takeover') {
          const k = pairKds(hub, station, `Screen ${key}`);
          devices[`kds:${key}`] = { token: k.token, device_id: k.deviceId };
        }
        if (flow === 'pass' || flow === 'takeover' || flow === 'tkpass' || flow === 'd7' || flow === 'tkbags') {
          const point_id = pointOf(flow, project, lang);
          const t = pairPassTablet(hub, { pointId: point_id, name: `Pass tablet ${key}` });
          // 05a v1.0.6 §3.6, M-6: a Pass tablet's profile is the `pass` screen with its point (`pass` ⇔ `point_id`), shared
          // by the kitchen (`everyone`); the profile's fold writes the same devices.point_id
          appendDeviceProfile(hub, t.deviceId, { access: 'everyone', screens: ['pass'], point_id });
          devices[`pass:${key}`] = { token: t.token, device_id: t.deviceId };
        }
        if (flow === 'd7') {
          const point_id = receivingPointOf(project, lang);
          const t = pairPassTablet(hub, { pointId: point_id, name: `Receiving tablet ${key}` });
          appendDeviceProfile(hub, t.deviceId, { access: 'everyone', screens: ['pass'], point_id });
          devices[`passTo:${key}`] = { token: t.token, device_id: t.deviceId };
        }
        // L-E2E-T1 day close (playwright.dayclose.config.ts): no seeded orders, so the day can close
        if (o.orders === false) continue;
        if (flow === 'tkbags') {
          seedBags(hub, key, station);
          continue;
        }
        const lines = LINES_03.map((l) => ({ order_item_id: lineId(key, l.n), item_id: itemId(key, l.n), quantity: l.units }));
        const pickup = flow === 'tkpass' ? { pickup_at_ms: hub.clock.branchNow() + TK_PICKUP_AFTER_MS } : {};
        appendOrder(hub, { order_type: 'takeaway', order_id: `O3-${key}`, placed_by: 'S_ALI', lines, ...pickup });
        fireLines(hub, station, lines.map((l) => l.order_item_id));
      }
  return { printer, devices };
}

/** the 'tkbags' order ids: `B3-<key>-<tag>`; the root of the token with an addition is `root`, its addition `add` */
export const bagOrderId = (key: string, tag: string): string => `B3-${key}-${tag}`;

/**
 * 03b v1.0.17 §3.4 (owner ruling 2026-11-28 "Pass bag = token"): six takeaway bags on the run's own point.
 * root + add: one token; the root's two lines done, then the addition (its own order, the root's token) fired and
 * cooking — ONE card, Cooking (BUG-8). ready: every line done (Bag ready). cooking: one started. waiting: fired, not
 * started. split: one done, one cooking. pickup: a phone order for later (its pickup 40 min ahead).
 */
function seedBags(hub: TestHub, key: string, station: string): void {
  const line = (tag: string, n: number, units = 1) => ({ order_item_id: `L3-${key}-${tag}-${n}`, item_id: itemId(key, n), quantity: units });
  const start = (ids: string[]) => append(hub, ids.map((id) => ({ stream_type: 'order', stream_id: orderOf.get(id)!, event_type: 'ItemStarted', payload: { order_item_id: id, started_at: hub.clock.branchNow(), source: 'tap' } })));
  const done = (ids: string[]) => append(hub, ids.map((id) => ({ stream_type: 'order', stream_id: orderOf.get(id)!, event_type: 'ItemDone', payload: { order_item_id: id, done_at: hub.clock.branchNow() + 1_000, source: 'tap' } })));
  const orderOf = new Map<string, string>();
  const place = (tag: string, lines: ReturnType<typeof line>[], extra: { adds_to_order_id?: string; pickup_at_ms?: number } = {}) => {
    const order_id = bagOrderId(key, tag);
    appendOrder(hub, { order_type: 'takeaway', order_id, placed_by: 'S_ALI', lines, ...extra });
    for (const l of lines) orderOf.set(l.order_item_id, order_id);
    if (extra.pickup_at_ms === undefined) fireLines(hub, station, lines.map((l) => l.order_item_id));
    return lines.map((l) => l.order_item_id);
  };
  const root = place('root', [line('root', 1, 2), line('root', 3, 4)]);
  start(root);
  done(root);
  const ready = place('ready', [line('ready', 2), line('ready', 3, 2)]);
  start(ready);
  done(ready);
  const cooking = place('cooking', [line('cooking', 1, 2), line('cooking', 3, 6)]);
  start(cooking.slice(0, 1));
  place('waiting', [line('waiting', 2), line('waiting', 3, 3)]);
  const split = place('split', [line('split', 1, 3), line('split', 2)]);
  start(split);
  done(split.slice(1));
  place('pickup', [line('pickup', 2), line('pickup', 3, 8)], { pickup_at_ms: hub.clock.branchNow() + 40 * 60_000 });
  // the addition to the root's token, after the root was done: it cooks
  const add = place('add', [line('add', 2)], { adds_to_order_id: bagOrderId(key, 'root') });
  start(add);
}

/** A paired `kds` device row on `station`, as the pair page leaves it (a direct row, like the hub's own tests). */
export function pairKds(hub: TestHub, station: string, name: string): { deviceId: string; token: string } {
  return pairDevice(hub, { type: 'kds', stationId: station, name });
}

/**
 * 02b-TK L-CLIENT-2 item 1 (03b v1.0.16 §3.10 D7, §6.16; 01a v2.11 §6.9a, §6.21): a spec asks the global setup's hub
 * for a real config apply through the hub's own poller and its stub cloud (the hub's archive-moves.int.test.ts way),
 * through a request file next to POS_E2E_HUB (the specs run in another process):
 * - `archive`: the next config archives `point` and makes `to` the default of `station` (the D7 moves go there);
 * - `refuse`: the next config archives every point (no active destination: the apply is refused, nothing commits,
 *   config status reports VALIDATION_FAILED);
 * - `clear`: the cloud answers "not modified", which clears the config status problem (the next specs see none).
 * The stub goes back to offline after each, and the hub's provisioning is confirmed only for the poll.
 */
export interface ConfigRequest03 {
  id: string;
  kind: 'archive' | 'refuse' | 'clear';
  point?: string;
  station?: string;
  to?: string;
}

export function startConfigDriver(hub: TestHub, base: string): () => void {
  const request = `${base}.config-req.json`;
  let busy = false;
  const run = async (req: ConfigRequest03): Promise<unknown> => {
    const cloud = hub.deps.configClient as StubConfigCloud;
    const provisioned = hub.deps.config.provisioned!;
    const confirmed = provisioned.confirmed_at;
    provisioned.confirmed_at = confirmed ?? hub.clock.branchNow();
    try {
      if (req.kind === 'clear') cloud.next = { kind: 'not_modified' };
      else {
        const cur = branchConfig()!;
        const next: BranchConfig = {
          ...cur,
          config_version: cur.config_version + 1,
          points: cur.points.map((p) => (req.kind === 'refuse' || p.point_id === req.point ? { ...p, is_archived: true } : p)),
          stations: cur.stations.map((st) =>
            req.kind === 'archive' && st.station_id === req.station ? { ...st, point_id: req.to!, carry_times: [...st.carry_times.filter((c) => c.point_id !== req.to), { point_id: req.to!, carry_ms: 0 }] } : st,
          ),
        };
        cloud.respondWithSnapshot(next as unknown as Record<string, unknown>);
      }
      const poller = configPoller(hub.app);
      const result = await poller.pollOnce();
      return { outcome: result.outcome, problem: poller.lastProblem() };
    } finally {
      cloud.next = { kind: 'offline' };
      if (confirmed === undefined) delete provisioned.confirmed_at;
      else provisioned.confirmed_at = confirmed;
    }
  };
  const timer = setInterval(() => {
    if (busy || !existsSync(request)) return;
    busy = true;
    const req = JSON.parse(readFileSync(request, 'utf8')) as ConfigRequest03;
    rmSync(request, { force: true });
    void run(req)
      .catch((error: unknown) => ({ error: String(error) }))
      .then((res) => writeFileSync(`${base}.config-${req.id}.json`, JSON.stringify(res)))
      .finally(() => (busy = false));
  }, 200);
  return () => {
    clearInterval(timer);
    rmSync(request, { force: true });
  };
}
