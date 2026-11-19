import type { BranchConfig } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { billPrinterFor } from '../../src/print/bill-routes';
import { savePrinterCommand } from '../../src/print/commands/printer';
import { setBillRouteCommand } from '../../src/print/commands/bill-route';
import { registerPrintProjections } from '../../src/print/index';
import { createProjectionRegistry } from '../../src/projections/registry';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FX, fixtureMenu } from '../orders/fixtures';
import { pairDevice } from '../kds/fixtures';

// 03c v1.0.13 §3.2, §5, §6.2, §6.6, §6.13 (05 row P-1, R-22; plan P0.16; 05 test #85): bill routes. Hub migration
// 0022_bill_routes, SetBillRoute / BillRouteSet, the print_config fold, billPrinterFor, CONFIG_IN_USE on archive.
let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;
let device: { deviceId: string; token: string };
let admin: { sessionId: string; token: string };
let n = 0;

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  const directory = await aDirectory();
  directory.staff.push({ ...directory.staff.find((s) => s.staff_id === 'S_MGR')!, staff_id: 'S_NODEV', display_name: 'No devices', denied_permissions: ['manage-devices'] });
  await seedDirectory(hub, directory);
  const menu = fixtureMenu();
  const config: BranchConfig = { ...menu };
  swapBranchConfig({ config, snapshotHash: 'h'.repeat(64), configVersion: 1, snapshotSchemaVersion: 4, appliedAt: 0 });
  device = pairDevice(hub, { type: 'tablet' });
  admin = openSession(hub, { kind: 'admin', staffId: 'S_MGR', deviceId: device.deviceId });
  const registry = commandRegistry(hub.app);
  for (const def of [savePrinterCommand, setBillRouteCommand] as const) {
    registry.register(
      defineCommand({
        ...(def as typeof savePrinterCommand),
        commandType: `Test${def.commandType}Counted`,
        handle(ctx, payload, cmd) {
          const before = counter.count;
          try {
            return (def as typeof savePrinterCommand).handle(ctx, payload, cmd);
          } finally {
            lastStatements = counter.count - before;
          }
        },
      }),
    );
  }
  counter = statementCounter(hub.deps.db);
  lastStatements = -1;
});
afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

async function send(commandType: string, payload: Record<string, unknown>, o: { route?: 'admin' | 'device'; session?: { token: string }; actor?: string } = {}) {
  hub.clock.advance(1_000);
  const device_route = o.route === 'device';
  const response = await hub.app.inject({
    method: 'POST',
    url: `${device_route ? '/commands/' : '/admin/commands/'}${kebab(commandType)}`,
    headers: { authorization: `Bearer ${device.token}`, [device_route ? 'x-session-token' : 'x-admin-session']: (o.session ?? admin).token },
    payload: {
      command_id: `cmd-${++n}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: commandType,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: o.actor ?? 'S_MGR',
      device_id: device.deviceId,
    },
  });
  const body = response.json() as { data?: { result: Record<string, unknown> }; error?: { code: string; details: Record<string, unknown> } };
  return { status: response.statusCode, result: body.data?.result, error: body.error };
}

const savePrinter = async (name: string, o: Record<string, unknown> = {}): Promise<string> => {
  const r = await send('SavePrinter', { name, connection: 'lan', address: '192.168.1.50', paper_width_mm: 80, ...o });
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  return (r.result!.printer as { printer_id: string }).printer_id;
};
const setRoute = (scope: string, ref_id: string, printer_id: string | null, type = 'SetBillRoute') => send(type, { scope, ref_id, printer_id });
const routes = () => hub.deps.db.prepare('SELECT scope, ref_id, printer_id FROM bill_routes ORDER BY scope, ref_id').all();
const events = (type: string) =>
  (hub.deps.db.prepare('SELECT stream_type, stream_id, payload FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<{ stream_type: string; stream_id: string; payload: string }>).map(
    (e) => ({ ...e, payload: JSON.parse(e.payload) as Record<string, unknown> }),
  );
const printerRow = (id: string) => hub.deps.db.prepare('SELECT archived_at FROM printers WHERE printer_id = ?').get(id);

describe('[05 #85] hub migration 0022_bill_routes (03c v1.0.13 §5)', () => {
  it('[05 #85, 03c §5] bill_routes(scope, ref_id, printer_id), PRIMARY KEY (scope, ref_id); scope in the five; ref_id \'\' exactly for report / default', () => {
    const db = hub.deps.db;
    expect((db.pragma('table_info(bill_routes)') as Array<{ name: string; notnull: number; pk: number }>).map((c) => [c.name, c.notnull, c.pk])).toEqual([
      ['scope', 1, 1],
      ['ref_id', 1, 2],
      ['printer_id', 1, 0],
    ]);
    const insert = db.prepare('INSERT INTO bill_routes (scope, ref_id, printer_id) VALUES (?, ?, ?)');
    for (const [scope, ref] of [['zone', 'Z1'], ['floor', 'F1'], ['device', 'D1'], ['report', ''], ['default', '']] as const) expect(() => insert.run(scope, ref, 'PR1')).not.toThrow();
    expect(() => insert.run('zone', 'Z1', 'PR2'), 'one route per (scope, ref_id)').toThrow(/UNIQUE|PRIMARY/);
    expect(() => insert.run('table', 'T1', 'PR1')).toThrow(/CHECK/);
    expect(() => insert.run('default', 'X', 'PR1')).toThrow(/CHECK/);
    expect(() => insert.run('zone', '', 'PR1')).toThrow(/CHECK/);
  });
});

describe('[05 #85] SetBillRoute (03c v1.0.13 §6.13)', () => {
  it('[05 #85, 03c §6.13] writes BillRouteSet on hub / branch_id; print_config folds it; a save replaces the route of that (scope, ref_id); null removes it', async () => {
    const p1 = await savePrinter('Counter');
    const p2 = await savePrinter('Bar', { address: '192.168.1.51' });
    const set = await setRoute('zone', FX.zone, p1);
    expect([set.status, set.result]).toEqual([200, { bill_route: { scope: 'zone', ref_id: FX.zone, printer_id: p1 } }]);
    expect(events('BillRouteSet')).toEqual([{ stream_type: 'hub', stream_id: 'branch-1', payload: { scope: 'zone', ref_id: FX.zone, printer_id: p1 } }]);
    expect(routes()).toEqual([{ scope: 'zone', ref_id: FX.zone, printer_id: p1 }]);

    expect((await setRoute('zone', FX.zone, p2)).status).toBe(200);
    expect(routes(), 'replaced, not added').toEqual([{ scope: 'zone', ref_id: FX.zone, printer_id: p2 }]);
    expect((await setRoute('default', '', p1)).status).toBe(200);
    expect((await setRoute('report', '', p2)).status).toBe(200);
    expect(routes()).toHaveLength(3);

    const removed = await setRoute('zone', FX.zone, null);
    expect(removed.status).toBe(200);
    expect(events('BillRouteSet').at(-1)!.payload).toEqual({ scope: 'zone', ref_id: FX.zone, printer_id: null });
    expect(routes().map((r) => (r as { scope: string }).scope)).toEqual(['default', 'report']);
    expect((await setRoute('zone', FX.zone, null)).status, 'removing a route that is not there is fine').toBe(200);
  });

  it('[05 #85, 03c §6.13] ref_id: \'\' for report / default (anything else → 400 VALIDATION_FAILED), the entity id (not empty) for zone / floor / device; unknown scope → 400', async () => {
    const p1 = await savePrinter('Counter');
    const bad: Array<[string, string]> = [['report', 'x'], ['default', FX.floor], ['zone', ''], ['floor', ''], ['device', ''], ['table', 'T1'], ['', '']];
    for (const [scope, ref_id] of bad) {
      const r = await setRoute(scope, ref_id, p1);
      expect([r.status, r.error?.code], `${scope}:${ref_id}`).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect((await send('SetBillRoute', { scope: 'default', printer_id: p1 })).error?.code, 'ref_id is required').toBe('VALIDATION_FAILED');
    expect(events('BillRouteSet')).toEqual([]);
  });

  it('[05 #85, 03c §6.13] a zone / floor / device ref_id that does not exist → 422 CONFIG_REFERENCE_INVALID { field: ref_id, reason: not_found }; nothing written', async () => {
    const p1 = await savePrinter('Counter');
    for (const [scope, ref_id] of [['zone', 'Z_NOPE'], ['floor', 'F_NOPE'], ['device', 'D_NOPE']] as const) {
      const r = await setRoute(scope, ref_id, p1);
      expect([r.status, r.error?.code, r.error?.details], scope).toEqual([422, 'CONFIG_REFERENCE_INVALID', { field: 'ref_id', reason: 'not_found' }]);
    }
    // a zone is not a floor and the other way round
    expect((await setRoute('floor', FX.zone, p1)).error?.code).toBe('CONFIG_REFERENCE_INVALID');
    expect((await setRoute('zone', FX.floor, p1)).error?.code).toBe('CONFIG_REFERENCE_INVALID');
    // no branch config in memory: no zone / floor exists
    swapBranchConfig(null);
    expect((await setRoute('zone', FX.zone, p1)).error?.code).toBe('CONFIG_REFERENCE_INVALID');
    expect(events('BillRouteSet')).toEqual([]);
    for (const [scope, ref_id] of [['floor', FX.floor], ['device', device.deviceId]] as const) {
      if (scope === 'floor') swapBranchConfig({ config: fixtureMenu(), snapshotHash: 'h'.repeat(64), configVersion: 1, snapshotSchemaVersion: 4, appliedAt: 0 });
      expect((await setRoute(scope, ref_id, p1)).status, scope).toBe(200);
    }
  });

  it('[05 #85, 03c §6.13] an unknown or archived printer → 404 PRINTER_NOT_FOUND { printer_id }; the reference check comes first', async () => {
    const old = await savePrinter('Old', { archived: true });
    for (const printer_id of ['PR_NOPE', old]) {
      const r = await setRoute('default', '', printer_id);
      expect([r.status, r.error?.code, r.error?.details], printer_id).toEqual([404, 'PRINTER_NOT_FOUND', { printer_id }]);
    }
    const both = await setRoute('zone', 'Z_NOPE', 'PR_NOPE');
    expect(both.error?.code).toBe('CONFIG_REFERENCE_INVALID');
    expect(events('BillRouteSet')).toEqual([]);
  });

  it('[05 #85, 03c §3.10, §6.13] admin route only; manage-devices required (as SavePrinter)', async () => {
    const p1 = await savePrinter('Counter');
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: device.deviceId });
    const onDeviceRoute = await send('SetBillRoute', { scope: 'default', ref_id: '', printer_id: p1 }, { route: 'device', session: staff });
    expect([onDeviceRoute.status, onDeviceRoute.error?.code]).toEqual([404, 'ROUTE_NOT_FOUND']);
    const noDevices = openSession(hub, { kind: 'admin', staffId: 'S_NODEV', deviceId: device.deviceId });
    const denied = await send('SetBillRoute', { scope: 'default', ref_id: '', printer_id: p1 }, { session: noDevices, actor: 'S_NODEV' });
    expect([denied.status, denied.error?.code]).toEqual([403, 'PERMISSION_DENIED']);
    expect(events('BillRouteSet')).toEqual([]);
  });

  it('[05 #85, 03c §6.13] statements: 2 at most (the reference check + the printer check); a zone / floor / default route reads only the printer; a removal reads nothing for default', async () => {
    const p1 = await savePrinter('Counter');
    expect((await setRoute('device', device.deviceId, p1, 'TestSetBillRouteCounted')).status).toBe(200);
    expect(lastStatements).toBe(2);
    expect((await setRoute('zone', FX.zone, p1, 'TestSetBillRouteCounted')).status).toBe(200);
    expect(lastStatements).toBe(1);
    expect((await setRoute('default', '', p1, 'TestSetBillRouteCounted')).status).toBe(200);
    expect(lastStatements).toBe(1);
    expect((await setRoute('default', '', null, 'TestSetBillRouteCounted')).status).toBe(200);
    expect(lastStatements).toBe(0);
  });
});

describe('[05 #85] projection print_config folds BillRouteSet (03c §5)', () => {
  it('[05 #85, 03c §5] a rebuild from seq 0 (no checkpoint → reset) equals the live table; a stale row is cleared', async () => {
    const p1 = await savePrinter('Counter');
    const p2 = await savePrinter('Bar', { address: '192.168.1.51' });
    await setRoute('zone', FX.zone, p1);
    await setRoute('default', '', p1);
    await setRoute('zone', FX.zone, p2);
    await setRoute('default', '', null);
    await setRoute('report', '', p1);
    const live = routes();
    expect(live).toEqual([
      { scope: 'report', ref_id: '', printer_id: p1 },
      { scope: 'zone', ref_id: FX.zone, printer_id: p2 },
    ]);
    hub.deps.db.prepare(`INSERT INTO bill_routes (scope, ref_id, printer_id) VALUES ('floor', 'F_STALE', 'PR_X')`).run();
    hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'print_config'`).run();
    const registry = createProjectionRegistry();
    registerPrintProjections(registry);
    registry.catchUp(hub.deps.db, hub.deps.config.provisioned!.branch_id);
    expect(routes()).toEqual(live);
  });
});

describe('[05 #85] billPrinterFor (03c v1.0.13 §4.2)', () => {
  const insert = (scope: string, ref_id: string, printer_id: string) => hub.deps.db.prepare('INSERT INTO bill_routes (scope, ref_id, printer_id) VALUES (?, ?, ?)').run(scope, ref_id, printer_id);
  const addPrinter = (id: string, archived = false) =>
    hub.deps.db.prepare(`INSERT INTO printers (printer_id, name, connection, address, paper_width_mm, archived_at, updated_at) VALUES (?, ?, 'lan', '192.168.1.50:9100', 80, ?, 1)`).run(id, id, archived ? 5 : null);
  const ids = { device_id: 'D1', zone_id: 'Z1', floor_id: 'F1' };

  beforeEach(() => {
    for (const id of ['P_DEV', 'P_ZONE', 'P_FLOOR', 'P_DEF', 'P_REP']) addPrinter(id);
  });

  it('[05 #85, 03c §4.2] order device → zone → floor → default; ids not asked for or without a route are skipped; no route → null', () => {
    const db = hub.deps.db;
    expect(billPrinterFor(db, ids)).toBeNull();
    insert('default', '', 'P_DEF');
    expect(billPrinterFor(db, ids)).toBe('P_DEF');
    expect(billPrinterFor(db, {})).toBe('P_DEF');
    insert('floor', 'F1', 'P_FLOOR');
    expect(billPrinterFor(db, ids)).toBe('P_FLOOR');
    expect(billPrinterFor(db, { zone_id: 'Z1' }), 'a floor route needs the floor id').toBe('P_DEF');
    insert('zone', 'Z1', 'P_ZONE');
    expect(billPrinterFor(db, ids)).toBe('P_ZONE');
    expect(billPrinterFor(db, { device_id: 'D1', floor_id: 'F1' })).toBe('P_FLOOR');
    insert('device', 'D1', 'P_DEV');
    expect(billPrinterFor(db, ids)).toBe('P_DEV');
    expect(billPrinterFor(db, { zone_id: 'Z1', floor_id: 'F1' })).toBe('P_ZONE');
    expect(billPrinterFor(db, { device_id: 'D_OTHER', zone_id: 'Z_OTHER', floor_id: 'F_OTHER' }), 'routes of other entities never match').toBe('P_DEF');
  });

  it('[05 #85, 03c §4.2] the first ACTIVE printer: an archived printer\'s route is skipped for the next one', () => {
    const db = hub.deps.db;
    addPrinter('P_OLD', true);
    insert('device', 'D1', 'P_OLD');
    insert('zone', 'Z1', 'P_ZONE');
    insert('default', '', 'P_DEF');
    expect(billPrinterFor(db, ids)).toBe('P_ZONE');
    db.prepare(`UPDATE printers SET archived_at = 9 WHERE printer_id IN ('P_ZONE', 'P_DEF')`).run();
    expect(billPrinterFor(db, ids)).toBeNull();
  });

  it('[05 #85, 03c §4.2, R-22] a report (X / Z): the report route if set and active, else default; a bill never uses the report route', () => {
    const db = hub.deps.db;
    insert('report', '', 'P_REP');
    expect(billPrinterFor(db, { report: true }), 'no default yet: the report route').toBe('P_REP');
    expect(billPrinterFor(db, ids), 'a bill never uses report').toBeNull();
    insert('default', '', 'P_DEF');
    insert('zone', 'Z1', 'P_ZONE');
    expect(billPrinterFor(db, { report: true })).toBe('P_REP');
    expect(billPrinterFor(db, { report: true, zone_id: 'Z1' }), 'zone / floor / device are not consulted for a report').toBe('P_REP');
    expect(billPrinterFor(db, ids)).toBe('P_ZONE');
    db.prepare(`UPDATE printers SET archived_at = 9 WHERE printer_id = 'P_REP'`).run();
    expect(billPrinterFor(db, { report: true }), 'the report printer is archived: default').toBe('P_DEF');
    db.prepare('DELETE FROM bill_routes').run();
    expect(billPrinterFor(db, { report: true })).toBeNull();
  });

  it('[05 #85, 03c §4.2] 1 statement per call (and the empty-string ids of a report / default are never a zone / floor / device id)', () => {
    insert('default', '', 'P_DEF');
    const c = statementCounter(hub.deps.db);
    billPrinterFor(hub.deps.db, ids);
    expect(c.count).toBe(1);
    billPrinterFor(hub.deps.db, { report: true });
    expect(c.count).toBe(2);
    expect(billPrinterFor(hub.deps.db, { device_id: '', zone_id: '', floor_id: '' })).toBe('P_DEF');
  });
});

describe('[05 #85] SavePrinter archive vs bill routes (03c v1.0.13 §3.2, §6.2; 03c #50)', () => {
  it('[05 #85, 03c #50] archive refused while a bill route uses it → 409 CONFIG_IN_USE { used_by: { entity: bill_route, ids: [scope:ref_id] } }; allowed once the routes move', async () => {
    const p1 = await savePrinter('Counter');
    const p2 = await savePrinter('Bar', { address: '192.168.1.51' });
    await setRoute('zone', FX.zone, p1);
    await setRoute('default', '', p1);
    await setRoute('report', '', p2);
    const refused = await send('SavePrinter', { printer_id: p1, name: 'Counter', connection: 'lan', address: '192.168.1.50', paper_width_mm: 80, archived: true });
    expect([refused.status, refused.error?.code, refused.error?.details]).toEqual([
      409,
      'CONFIG_IN_USE',
      { entity: 'printer', id: p1, used_by: { entity: 'bill_route', ids: ['default:', `zone:${FX.zone}`] } },
    ]);
    expect(printerRow(p1)).toMatchObject({ archived_at: null });
    await setRoute('zone', FX.zone, p2);
    await setRoute('default', '', null);
    const archived = await send('SavePrinter', { printer_id: p1, name: 'Counter', connection: 'lan', address: '192.168.1.50', paper_width_mm: 80, archived: true });
    expect(archived.status).toBe(200);
    expect(printerRow(p1)).toMatchObject({ archived_at: hub.clock.branchNow() });
    // the report route alone also holds a printer
    expect((await send('SavePrinter', { printer_id: p2, name: 'Bar', connection: 'lan', address: '192.168.1.51', paper_width_mm: 80, archived: true })).error?.details).toMatchObject({
      used_by: { entity: 'bill_route', ids: ['report:', `zone:${FX.zone}`] },
    });
  });

  it('[05 #85, 03c §6.2, R-22] stations first when both use it: used_by is the stations; the route is named once they let go; still ONE check query (2 statements bound)', async () => {
    const p1 = await savePrinter('Counter');
    expect((await send('SetStationOutput', { station_id: 'S1', mode: 'both', printer_id: p1 })).status).toBe(200);
    await setRoute('default', '', p1);
    const archive = { printer_id: p1, name: 'Counter', connection: 'lan', address: '192.168.1.50', paper_width_mm: 80, archived: true };
    const both = await send('TestSavePrinterCounted', archive);
    expect([both.status, both.error?.details]).toEqual([409, { entity: 'printer', id: p1, used_by: { entity: 'station', ids: ['S1'] } }]);
    expect(lastStatements).toBe(1);
    await send('SetStationOutput', { station_id: 'S1', mode: 'screen', printer_id: null });
    const routeOnly = await send('TestSavePrinterCounted', archive);
    expect([routeOnly.status, routeOnly.error?.details]).toEqual([409, { entity: 'printer', id: p1, used_by: { entity: 'bill_route', ids: ['default:'] } }]);
    expect(lastStatements).toBe(1);
    await setRoute('default', '', null);
    expect((await send('TestSavePrinterCounted', archive)).status).toBe(200);
    expect(lastStatements).toBe(1);
    expect(lastStatements).toBeLessThanOrEqual(2);
  });

  it('[05 #85, 03c §3.2] a route holds the printer also when no branch config is in memory (zone / floor ids are only strings in the table)', async () => {
    const p1 = await savePrinter('Counter');
    await setRoute('floor', FX.floor, p1);
    swapBranchConfig(null);
    const r = await send('SavePrinter', { printer_id: p1, name: 'Counter', connection: 'lan', address: '192.168.1.50', paper_width_mm: 80, archived: true });
    expect([r.status, r.error?.code]).toEqual([409, 'CONFIG_IN_USE']);
  });
});

describe('[05 #85] print-config lists bill_routes (03c v1.0.13 §6.6)', () => {
  it('[05 #85, 03c §6.6, R-22] bill_routes: [{ scope, ref_id, printer_id }] in (scope, ref_id) order; 5 statements', async () => {
    const p1 = await savePrinter('Counter');
    const p2 = await savePrinter('Bar', { address: '192.168.1.51' });
    await setRoute('zone', FX.zone, p1);
    await setRoute('default', '', p2);
    const read = async () => {
      const r = await hub.app.inject({ method: 'GET', url: '/admin/queries/print-config', headers: { authorization: `Bearer ${device.token}`, 'x-admin-session': admin.token } });
      return r.json() as { data: { bill_routes: unknown[] } };
    };
    const reads = statementCounter(hub.deps.readDb);
    const body = await read();
    expect(reads.count).toBe(5);
    expect(body.data.bill_routes).toEqual([
      { scope: 'default', ref_id: '', printer_id: p2 },
      { scope: 'zone', ref_id: FX.zone, printer_id: p1 },
    ]);
    await setRoute('zone', FX.zone, null);
    await setRoute('default', '', null);
    expect((await read()).data.bill_routes).toEqual([]);
  });

  it('[05 #85, R-38] zones and floors from the config in memory (names, archived flag; 0 extra statements): [{ zone_id, floor_id, name, archived }] / [{ floor_id, name, archived }]; none without a config', async () => {
    const read = async () => {
      const r = await hub.app.inject({ method: 'GET', url: '/admin/queries/print-config', headers: { authorization: `Bearer ${device.token}`, 'x-admin-session': admin.token } });
      return r.json() as { data: { zones: unknown[]; floors: unknown[] } };
    };
    const menu = fixtureMenu();
    const floor = menu.floors[0]!;
    const config: BranchConfig = { ...menu, floors: [{ ...floor, zones: [...floor.zones, { ...floor.zones[0]!, zone_id: 'Z_OLD', name: 'Old patio', is_archived: true, routes: [], stock_items: [] }] }] };
    swapBranchConfig({ config, snapshotHash: 'h'.repeat(64), configVersion: 1, snapshotSchemaVersion: 4, appliedAt: 0 });
    const reads = statementCounter(hub.deps.readDb);
    const body = await read();
    expect(reads.count, 'still 5').toBe(5);
    expect(body.data.zones).toEqual([
      { zone_id: FX.zone, floor_id: FX.floor, name: floor.zones[0]!.name, archived: false },
      { zone_id: 'Z_OLD', floor_id: FX.floor, name: 'Old patio', archived: true },
    ]);
    expect(body.data.floors).toEqual([{ floor_id: FX.floor, name: floor.name, archived: false }]);
    swapBranchConfig(null);
    const none = await read();
    expect([none.data.zones, none.data.floors]).toEqual([[], []]);
  });
});
