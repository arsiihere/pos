import type { BranchConfig, PosEvent, WsStationNotice } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { printConfigHook } from '../../src/print/config-hook';
import { branchConfig, runBranchConfigHooks, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { FX, appendOrder, append as kdsAppend, fireLines, openDay, pairDevice, pairKds } from '../kds/fixtures';

// ⚠️ 03c v1.0.6 §3.2 (Q-18) and §3.8 (Q-20), 03b v1.0.6 §3.10 (owner 2026-11-12; task P0.22):
// - a config apply that archives a station, or removes it from the snapshot, appends StationOutputSet { mode: 'screen',
//   printer_id: null, source: 'config' } in the apply transaction; SavePrinter { archived: true } then succeeds; the
//   station's pending jobs stay unsent and listed in print-queue;
// - a StationOutputSet / PrinterSaved that flips a station's has_printer sends station_notice { kind: 'output' } to that
//   station's sockets after commit. Real admin command and query routes, real sockets through the hub's /ws.
let hub: TestHub;
let device: { deviceId: string; token: string };
let admin: string;
let n = 0;
const sockets: WsClient[] = [];

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  await seedDirectory(hub, await aDirectory());
  openDay(hub);
  device = pairDevice(hub, { type: 'tablet' });
  admin = openSession(hub, { kind: 'admin', staffId: 'S_MGR', deviceId: device.deviceId }).token;
});
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  swapBranchConfig(null);
  await hub.close();
});

const branch = (): string => hub.deps.config.provisioned!.branch_id;
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

async function send(commandType: string, payload: Record<string, unknown>) {
  hub.clock.advance(1_000);
  const response = await hub.app.inject({
    method: 'POST',
    url: `/admin/commands/${kebab(commandType)}`,
    headers: { authorization: `Bearer ${device.token}`, 'x-admin-session': admin },
    payload: { command_id: `cmd-${++n}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type: commandType, payload, occurred_at: hub.clock.branchNow(), actor_id: 'S_MGR', device_id: device.deviceId },
  });
  const body = response.json() as { data?: { result: Record<string, unknown> }; error?: { code: string; details: Record<string, unknown> } };
  return { status: response.statusCode, result: body.data?.result, error: body.error };
}
const printer = (printer_id: string, archived = false) =>
  send('SavePrinter', { printer_id, name: `Printer ${printer_id}`, connection: 'lan', address: '192.168.1.50', paper_width_mm: 80, archived });
const output = (station_id: string, mode: 'screen' | 'both' | 'printer', printer_id: string | null, o: Record<string, unknown> = {}) =>
  send('SetStationOutput', { station_id, mode, printer_id, ...o });

/** Applies `next` the way the config poller does (hooks inside one writer.run), then swaps it in. */
function apply(next: BranchConfig): PosEvent[] {
  const prev = branchConfig();
  const { appended } = hub.deps.writer.run((tx) => runBranchConfigHooks(prev, next, tx));
  swapBranchConfig({ config: next, snapshotHash: 'd'.repeat(64), configVersion: next.config_version, snapshotSchemaVersion: 4, appliedAt: hub.clock.branchNow() });
  return appended;
}
function archive(station_id: string): PosEvent[] {
  const config = branchConfig()!;
  return apply({ ...config, config_version: config.config_version + 1, stations: config.stations.map((s) => (s.station_id === station_id ? { ...s, is_archived: true } : s)) });
}
const outputs = () => hub.deps.db.prepare('SELECT station_id, mode, printer_id, show_taker, show_order_id FROM station_outputs ORDER BY station_id').all();

async function stationSocket(station_id: string): Promise<WsClient> {
  const kds = pairKds(hub, { stationId: station_id });
  const session = openSession(hub, { kind: 'station', stationId: station_id, deviceId: kds.deviceId });
  const ws = await connectWs(hub.app);
  sockets.push(ws);
  ws.send({ type: 'auth', device_token: kds.token, session_token: session.token });
  await ws.untilCount(1);
  return ws;
}
const notices = (ws: WsClient): WsStationNotice[] => ws.messages.filter((m) => (m as { type?: string }).type === 'station_notice') as WsStationNotice[];

describe('[03c v1.0.6 §3.2, Q-18] a config apply that archives / removes a station releases its printer', () => {
  it('[03c §3.2] archive of a station holding a printer → StationOutputSet { screen, null, source: config } in the apply tx (toggles kept); then SavePrinter archived succeeds', async () => {
    await printer('PR1');
    await output(FX.station, 'both', 'PR1', { show_taker: false });
    await output(FX.zoneStation, 'screen', null);
    expect(await printer('PR1', true)).toMatchObject({ status: 409, error: { code: 'CONFIG_IN_USE' } });

    const appended = archive(FX.station);
    const released = appended.filter((e) => e.event_type === 'StationOutputSet');
    expect(released.map((e) => [e.stream_type, e.stream_id, e.actor_id, e.device_id, e.payload])).toEqual([
      ['hub', branch(), null, 'hub', { station_id: FX.station, mode: 'screen', printer_id: null, show_taker: false, show_order_id: true, source: 'config' }],
    ]);
    expect(outputs()).toEqual([
      { station_id: FX.station, mode: 'screen', printer_id: null, show_taker: 0, show_order_id: 1 },
      { station_id: FX.zoneStation, mode: 'screen', printer_id: null, show_taker: 1, show_order_id: 1 },
    ]);
    expect(await printer('PR1', true)).toMatchObject({ status: 200 });
    // nothing left holding a printer: the hook alone runs its 1 read and appends nothing
    const config = branchConfig()!;
    const counter = statementCounter(hub.deps.db);
    const hook = printConfigHook(hub.app, hub.deps);
    const { appended: none } = hub.deps.writer.run((tx) => {
      counter.reset();
      hook(config, { ...config, config_version: config.config_version + 1 }, tx);
      expect(counter.count).toBe(1);
    });
    expect(none).toEqual([]);
  });

  it('[03c §3.2] a station removed from the snapshot is released too; a live station and a screen station with a fallback printer it still lists are not', async () => {
    await printer('PR1');
    await printer('PR2');
    await output(FX.station, 'printer', 'PR1');
    await output(FX.zoneStation, 'screen', 'PR2'); // fallback printer of a live station
    const config = branchConfig()!;
    const appended = apply({ ...config, config_version: config.config_version + 1, stations: config.stations.filter((s) => s.station_id !== FX.station) });
    expect(appended.filter((e) => e.event_type === 'StationOutputSet').map((e) => e.payload)).toEqual([
      { station_id: FX.station, mode: 'screen', printer_id: null, show_taker: true, show_order_id: true, source: 'config' },
    ]);
    expect(outputs()).toMatchObject([
      { station_id: FX.station, printer_id: null },
      { station_id: FX.zoneStation, mode: 'screen', printer_id: 'PR2' },
    ]);
  });

  it('[03c §3.2, §6.7] the archived station\'s pending job stays unsent and listed in print-queue (no printer), never cancelled', async () => {
    await printer('PR1');
    await output(FX.station, 'both', 'PR1');
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan, quantity: 1 }] });
    fireLines(hub, FX.station, ['A1']);
    const pending = () => hub.deps.db.prepare(`SELECT job_id, sent_at, cancelled_at FROM print_jobs WHERE station_id = ? AND kind = 'kitchen'`).all(FX.station);
    expect(pending()).toEqual([{ job_id: expect.any(String), sent_at: null, cancelled_at: null }]);
    archive(FX.station);
    expect(pending()).toEqual([{ job_id: expect.any(String), sent_at: null, cancelled_at: null }]);
    const r = await hub.app.inject({ method: 'GET', url: '/admin/queries/print-queue', headers: { authorization: `Bearer ${device.token}`, 'x-admin-session': admin } });
    const data = (r.json() as { data: { jobs: Array<{ station_id: string; printer_id: string | null }>; no_printer?: number } }).data;
    expect(data.jobs).toMatchObject([{ station_id: FX.station, printer_id: null }]);
  });

  it('[03c §3.2] total: an odd config shape (stations not a list) releases nothing and never throws', async () => {
    await printer('PR1');
    await output(FX.station, 'both', 'PR1');
    const config = branchConfig()!;
    const odd = { ...config, config_version: config.config_version + 1, stations: null } as unknown as BranchConfig;
    // this hook alone (03a's engine hook rejects such a config itself)
    const hook = printConfigHook(hub.app, hub.deps);
    const { appended } = hub.deps.writer.run((tx) => hook(config, odd, tx));
    expect(appended).toEqual([]);
    expect(outputs()).toMatchObject([{ station_id: FX.station, printer_id: 'PR1' }]);
  });
});

describe('[03c v1.0.6 §3.8, 03b v1.0.6 §3.10, Q-20] station_notice { kind: output }', () => {
  it('[03c §3.8] SetStationOutput both → has_printer true to that station\'s sockets only; a toggle change sends nothing; screen → false', async () => {
    await printer('PR1');
    const s1 = await stationSocket(FX.station);
    const s2 = await stationSocket(FX.zoneStation);
    await output(FX.station, 'both', 'PR1');
    await settle();
    expect(notices(s1)).toEqual([{ type: 'station_notice', station_id: FX.station, kind: 'output', has_printer: true }]);
    expect(notices(s2)).toEqual([]);
    await output(FX.station, 'both', 'PR1', { show_taker: false });
    await output(FX.station, 'screen', 'PR1'); // a fallback printer does not print at fire
    await settle();
    expect(notices(s1).map((m) => (m as { has_printer: boolean }).has_printer)).toEqual([true, false]);
  });

  it('[03c §3.8, §3.2] a config archive releasing the printer → has_printer false', async () => {
    await printer('PR1');
    await output(FX.station, 'printer', 'PR1');
    const s1 = await stationSocket(FX.station);
    archive(FX.station);
    await settle();
    expect(notices(s1).filter((m) => m.kind === 'output')).toEqual([{ type: 'station_notice', station_id: FX.station, kind: 'output', has_printer: false }]);
  });

  it('[03c §3.8] a PrinterSaved that archives / restores the printer of a printing station flips has_printer (events as replayed; SavePrinter itself refuses the archive)', async () => {
    await printer('PR1');
    await output(FX.station, 'both', 'PR1');
    const s1 = await stationSocket(FX.station);
    const saved = (archived: boolean) =>
      kdsAppend(hub, [{ stream_type: 'hub', stream_id: branch(), event_type: 'PrinterSaved', payload: { printer_id: 'PR1', name: 'Printer PR1', connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived } }], { actor: null });
    saved(true);
    saved(false);
    await settle();
    expect(notices(s1).map((m) => (m as { has_printer: boolean }).has_printer)).toEqual([false, true]);
  });
});
