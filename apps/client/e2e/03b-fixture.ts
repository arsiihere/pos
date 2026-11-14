import type { BranchConfig, ConfigItem, EventDraft } from '@pos/events';
import { appendOrder, fireLines, pairDevice, pairPassTablet } from '../../hub/test/kds/fixtures';
import { fakeLanPrinter, type FakeLanPrinter } from '../../hub/test/print/fixtures';
import type { TestHub } from '../../hub/test/helpers/test-hub';

// 03b / 03c client flows (Z1; 03b v1.0.8 §8, §10 #70–#76, 03c v1.0.9 §8): the fixture on top of 02's e2e hub. Every
// (flow, viewport, language) run gets its own station with its own lines, so runs never meet (as 02a's table pairs).
// Stations live in the branch config; the lines are real orders (the hub's 02b / 03b fixtures: appendOrder, then a real
// FireDispatched). The fake printer is a real TCP socket on 127.0.0.1 (the hub's 03c fixture); its printer row is
// written as the PrinterSaved event, because SavePrinter refuses a loopback address (03c §3.2) and the fake cannot
// have another one.

export const FLOWS_03 = ['kds', 'takeover', 'pass', 'admin'] as const;
export type Flow03 = (typeof FLOWS_03)[number];
const PROJECTS_03 = ['tablet-landscape', 'tablet-portrait', 'kiosk', 'phone-390', 'phone-360'] as const;
const LANGS_03 = ['en', 'ur'] as const;

/** the run's station id, name and line items; `key` = flow, viewport, language */
export const keyOf = (flow: Flow03, project: string, lang: string): string => `${flow}-${project}-${lang}`;
export const stationOf = (flow: Flow03, project: string, lang: string): string => `S3-${keyOf(flow, project, lang)}`;
export const pointOf = (flow: Flow03, project: string, lang: string): string => `P3-${keyOf(flow, project, lang)}`;
export const printerId = 'PR-E2E';

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
        const own = flow === 'pass' || flow === 'takeover';
        const point = pointOf(flow, project, lang);
        if (own) points.push({ point_id: point, name: `Pass ${key}`, sort_order: 10, is_archived: false });
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

export async function seed03(hub: TestHub): Promise<{ printer: FakeLanPrinter; devices: Devices03 }> {
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
        if (flow === 'pass' || flow === 'takeover') {
          const t = pairPassTablet(hub, { pointId: pointOf(flow, project, lang), name: `Pass tablet ${key}` });
          devices[`pass:${key}`] = { token: t.token, device_id: t.deviceId };
        }
        const lines = LINES_03.map((l) => ({ order_item_id: lineId(key, l.n), item_id: itemId(key, l.n), quantity: l.units }));
        appendOrder(hub, { order_type: 'takeaway', order_id: `O3-${key}`, placed_by: 'S_ALI', lines });
        fireLines(hub, station, lines.map((l) => l.order_item_id));
      }
  return { printer, devices };
}

/** A paired `kds` device row on `station`, as the pair page leaves it (a direct row, like the hub's own tests). */
export function pairKds(hub: TestHub, station: string, name: string): { deviceId: string; token: string } {
  return pairDevice(hub, { type: 'kds', stationId: station, name });
}
