import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { renderText, type Doc } from '@pos/domain';
import { SnapshotBillingSchema, type BranchConfig, type ConfigItem } from '@pos/events';
import { hubBilling } from '../../hub/src/billing/defaults';
import { branchConfig } from '../../hub/src/sync/branch-config-holder';
import { configPoller } from '../../hub/src/sync/config-poller';
import type { StubConfigCloud } from '../../hub/test/helpers/stub-config-cloud';
import type { EngineState } from '@pos/engine';
import { fireLines, pairPassTablet } from '../../hub/test/kds/fixtures';
import { appendDeviceProfile, pairDevice, type TestHub } from '../../hub/test/helpers/test-hub';
import { openSeating } from '../../hub/test/orders/fixtures';

// L-E2E-T1 (Tier 1 dry-run checklist, owner sheet "Takeaway Tier 1 — Restaurant Dry Run Checklist"): the fixture of the
// t1-*.spec.ts journeys on top of the e2e hub. Every (viewport, language) run of a journey gets its own Pass point with a
// screenless station and two items of its own — a main (10 min) and a drink (1 min) — so its cards never meet another
// run's, and a second point of its own for the order-type routing row (#20). One manager phone (listed: the Manager)
// answers the unpaid hand-over requests. A request driver (the 03b config driver's way: a request file next to
// POS_E2E_HUB, since the specs run in another process) lets a journey read the hub's document print jobs, read and move
// the hub's clock, and apply a config that sets Pass points' order types.

export const T1_PROJECTS = ['kiosk', 'tablet-landscape'] as const;
const T1_LANGS = ['en', 'ur'] as const;
/** the journeys that need a point of their own */
export const T1_FLOWS = ['bag', 'route', 'amber', 'unpaid', 'close'] as const;
export type T1Flow = (typeof T1_FLOWS)[number];

export const t1Key = (flow: T1Flow, project: string, lang: string): string => `${flow}-${project}-${lang}`;
export const t1Point = (key: string): string => `PT1-${key}`;
/** the row-#20 second point (dine-in once the run sets it) */
export const t1OtherPoint = (key: string): string => `PT1-${key}-b`;
export const t1Station = (key: string): string => `ST1-${key}`;
export const T1_COOK_MS = { main: 10 * 60_000, drink: 60_000 } as const;
/** the run's two items: a main and a drink, at the run's station */
export const t1Items = (key: string) => ({
  main: { item_id: `IT1M-${key}`, name: `Paye ${key}` },
  drink: { item_id: `IT1D-${key}`, name: `Lassi ${key}` },
});

export function menuWithT1(menu: BranchConfig): BranchConfig {
  const s1 = menu.stations.find((s) => s.station_id === 'S1')!;
  const base = menu.items.find((i) => i.item_id === 'I_NAAN')!;
  const points: BranchConfig['points'] = [];
  const stations: BranchConfig['stations'] = [];
  const items: ConfigItem[] = [];
  for (const flow of T1_FLOWS)
    for (const project of T1_PROJECTS)
      for (const lang of T1_LANGS) {
        const key = t1Key(flow, project, lang);
        const point = t1Point(key);
        points.push({ point_id: point, name: `Pass ${key}`, sort_order: 20, is_archived: false });
        if (flow === 'route') points.push({ point_id: t1OtherPoint(key), name: `Pass ${key} B`, sort_order: 21, is_archived: false });
        // pullable as global-setup's Kheer (capacity, max_early_ms): the fixed clock has no fires tick, so a journey pulls its
        // lines onto Now (02b-support `kitchenPull`, the cook's GiveMeMore) before the Pass cooks them
        stations.push({ ...s1, station_id: t1Station(key), name: `Grill ${key}`, completion_mode: 'two_tap' as const, capacity: 20, point_id: point, carry_times: [{ point_id: point, carry_ms: 0 }] });
        const it = t1Items(key);
        items.push({ ...base, item_id: it.main.item_id, name: it.main.name, station_id: t1Station(key), sort_order: 300, cook_time_ms: T1_COOK_MS.main, max_early_ms: 3_600_000 });
        items.push({ ...base, item_id: it.drink.item_id, name: it.drink.name, station_id: t1Station(key), sort_order: 301, cook_time_ms: T1_COOK_MS.drink, max_early_ms: 3_600_000 });
      }
  // row #26 (03a PK-1, DC-1): a stock-tracked item whose line is a HELD line of a pickup order (serve mode immediate)
  const karahi = menu.items.find((i) => i.item_id === 'I_KARAHI')!;
  items.push({ ...karahi, item_id: T1_HELD.item_id, name: T1_HELD.name, serve_mode: 'immediate', sort_order: 310 });
  // row #6: a card mode on the counter that asks for the machine's reference (05 §6.9 reference_required)
  const pk = hubBilling({ currency_code: menu.currency_code, tax_classes: menu.tax_classes, billing: menu.billing });
  const billing = SnapshotBillingSchema.parse({
    ...pk.settings,
    jurisdiction: pk.jurisdiction,
    tax_profiles: pk.tax_profiles.map((p) => ({ tax_class_id: p.tax_profile_id, taxes: p.taxes })),
    payment_modes: [...pk.settings.payment_modes.filter((m) => m.mode_id !== T1_CARD.mode_id), { mode_id: T1_CARD.mode_id, name: T1_CARD.name, kind: 'card', payment_class: 'digital', reference_required: true, is_active: true, sort_order: 1, authority_codes: [] }],
  });
  // row #20: a small floor of its own (the 02a / dl table pool is fully taken), one table per (viewport, language)
  const floor = {
    floor_id: 'FL-T1',
    name: 'T1',
    sort_order: 90,
    zones: [],
    tables: T1_PROJECTS.flatMap((project) => T1_LANGS.map((lang) => t1Table(project, lang))).map((table_id, i) => ({ table_id, name: table_id, seats: 4, sort_order: i, zone_id: null })),
  };
  return { ...menu, billing, floors: [...menu.floors, floor] as BranchConfig['floors'], points: [...menu.points, ...points], stations: [...menu.stations, ...stations], items: [...menu.items, ...items] };
}

export const T1_CARD = { mode_id: 'card', name: 'Card' } as const;
/** row #26: the stock-tracked immediate item (K1 draws) whose pickup line the engine holds (03a PK-1) */
export const T1_HELD = { item_id: 'IT1-HELD', name: 'Karahi to go' } as const;
/** row #20's dine-in table of a (viewport, language) run, on the T1 floor */
export const t1Table = (project: string, lang: string): string => `T1-${project === 'kiosk' ? 'K' : 'L'}-${lang.toUpperCase()}`;

export interface DevicesT1 {
  /** `pass:<key>` the run point's Pass tablet; `passB:<key>` the route run's second point; `managerPhone` */
  [name: string]: { token: string; device_id: string };
}

export function seedT1(hub: TestHub): DevicesT1 {
  const devices: DevicesT1 = {};
  for (const flow of T1_FLOWS)
    for (const project of T1_PROJECTS)
      for (const lang of T1_LANGS) {
        const key = t1Key(flow, project, lang);
        const pair = (point_id: string, name: string) => {
          const t = pairPassTablet(hub, { pointId: point_id, name });
          appendDeviceProfile(hub, t.deviceId, { access: 'everyone', screens: ['pass'], point_id });
          return { token: t.token, device_id: t.deviceId };
        };
        devices[`pass:${key}`] = pair(t1Point(key), `Pass tablet ${key}`);
        if (flow === 'route') devices[`passB:${key}`] = pair(t1OtherPoint(key), `Pass tablet ${key} B`);
      }
  // the Manager's own phone: `listed` [the Manager], the manager screen (Requests) — 05a §5.3, OR-7 answers
  const phone = pairDevice(hub, { type: 'phone', ownerStaffId: 'S_MGR', name: 'Manager phone', profile: { access: 'listed', staff_ids: ['S_MGR'], screens: ['takeaway', 'manager'] } });
  devices['managerPhone'] = { token: phone.token, device_id: phone.deviceId };
  return devices;
}

export type T1Request =
  | { kind: 'jobs'; since: number }
  | { kind: 'now' }
  | { kind: 'advance'; ms: number }
  /** the events of an order's stream and the stock events naming one of its lines (row #26 DC-1 read-back) */
  | { kind: 'orderEvents'; order_id: string }
  /** an open seating on `table_id` held by `holder` (the 02b fixture's TableOpened), for a dine-in set-up */
  | { kind: 'seat'; table_id: string; seating_id: string; holder: string }
  /** the station's unfired live lines get a real FireDispatched (the fixed clock has no fires tick); `except` stay held */
  | { kind: 'fire'; station: string; except?: string[] }
  | { kind: 'orderTypes'; points: Record<string, Array<'dine_in' | 'takeaway' | 'parking'> | null> }
  /** ⚠️ 02b-TK L-CLIENT-5 (03a PK-1, PK-5): the engine's current plan of an order (t1-support `hubPlan`) */
  | { kind: 'plan'; order_id: string };

interface JobRow {
  job_id: string;
  printer_id: string;
  order_id: string | null;
  payload: string;
  created_at: number;
}

export function startT1Driver(hub: TestHub, base: string): () => void {
  const request = `${base}.t1-req.json`;
  let busy = false;
  const applyOrderTypes = async (points: Record<string, Array<'dine_in' | 'takeaway' | 'parking'> | null>): Promise<unknown> => {
    const cloud = hub.deps.configClient as StubConfigCloud;
    const provisioned = hub.deps.config.provisioned!;
    const confirmed = provisioned.confirmed_at;
    provisioned.confirmed_at = confirmed ?? hub.clock.branchNow();
    try {
      const cur = branchConfig()!;
      const next: BranchConfig = {
        ...cur,
        config_version: cur.config_version + 1,
        points: cur.points.map((p) => {
          if (!(p.point_id in points)) return p;
          const types = points[p.point_id];
          const copy = { ...p };
          if (types === null || types === undefined) delete copy.order_types;
          else copy.order_types = types;
          return copy;
        }),
      };
      cloud.respondWithSnapshot(next as unknown as Record<string, unknown>);
      const poller = configPoller(hub.app);
      const result = await poller.pollOnce();
      return { outcome: result.outcome, problem: poller.lastProblem() };
    } finally {
      cloud.next = { kind: 'offline' };
      if (confirmed === undefined) delete provisioned.confirmed_at;
      else provisioned.confirmed_at = confirmed;
    }
  };
  const run = async (req: T1Request & { id: string }): Promise<unknown> => {
    switch (req.kind) {
      case 'now':
        return { now: hub.clock.branchNow() };
      case 'advance':
        hub.clock.advance(req.ms);
        return { now: hub.clock.branchNow() };
      case 'orderEvents': {
        const rows = hub.deps.db
          .prepare(
            `SELECT seq, stream_type, event_type, payload FROM events
              WHERE stream_id = @o OR (stream_type = 'stock' AND payload LIKE '%' || @o || '%') ORDER BY seq`,
          )
          .all({ o: req.order_id }) as Array<{ seq: number; stream_type: string; event_type: string; payload: string }>;
        return { events: rows.map((r) => ({ seq: r.seq, stream_type: r.stream_type, event_type: r.event_type, payload: JSON.parse(r.payload) as unknown })) };
      }
      case 'seat':
        openSeating(hub, { table_id: req.table_id, seating_id: req.seating_id, holder_staff_id: req.holder });
        return { ok: true };
      case 'fire': {
        const state = hub.deps.state.get() as EngineState;
        const ids = Object.values(state.lines)
          .filter((l) => l.station_id === req.station && l.stage === 'added' && l.fired_at === null && !(req.except ?? []).includes(l.order_item_id))
          .map((l) => l.order_item_id);
        if (ids.length > 0) fireLines(hub, req.station, ids);
        return { fired: ids };
      }
      case 'jobs': {
        const rows = hub.deps.db
          .prepare(`SELECT job_id, printer_id, order_id, payload, created_at FROM print_jobs WHERE kind = 'document' AND created_at >= ? ORDER BY created_at, job_id`)
          .all(req.since) as JobRow[];
        return {
          jobs: rows.map((r) => {
            const p = JSON.parse(r.payload) as { doc: Doc; kind_label?: string };
            return { job_id: r.job_id, printer_id: r.printer_id, order_id: r.order_id, created_at: r.created_at, kind_label: p.kind_label ?? null, text: renderText(p.doc, p.doc.width_cols ?? 48) };
          }),
        };
      }
      case 'orderTypes':
        return applyOrderTypes(req.points);
      case 'plan': {
        const state = hub.deps.state.get() as EngineState;
        const order = state.orders[req.order_id];
        if (order === undefined) return { error: `order ${req.order_id} is not in the engine` };
        return {
          pickup_at_ms: order.pickup_at_ms,
          boosted: order.boosted,
          promise_ms: order.promise_ms,
          lines: order.line_ids.flatMap((id) => {
            const l = state.lines[id];
            if (l === undefined) return [];
            // a line's planned land: its booking's end (the station profile) + carry; before a booking fire + prep + cook + carry
            const end = l.booked?.end ?? (l.fire_ms === null ? null : l.fire_ms + l.prep_ms + l.cook_ms);
            return [{ order_item_id: id, stage: l.stage, land_ms: end === null ? null : end + l.carry_ms }];
          }),
        };
      }
    }
  };
  const timer = setInterval(() => {
    if (busy || !existsSync(request)) return;
    busy = true;
    const req = JSON.parse(readFileSync(request, 'utf8')) as T1Request & { id: string };
    rmSync(request, { force: true });
    void run(req)
      .catch((error: unknown) => ({ error: String(error) }))
      .then((res) => writeFileSync(`${base}.t1-${req.id}.json`, JSON.stringify(res)))
      .finally(() => (busy = false));
  }, 100);
  return () => {
    clearInterval(timer);
    rmSync(request, { force: true });
  };
}
