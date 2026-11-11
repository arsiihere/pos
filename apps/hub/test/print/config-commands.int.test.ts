import type { BranchConfig } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { savePrinterCommand } from '../../src/print/commands/printer';
import { setStationOutputCommand } from '../../src/print/commands/station-output';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { fixtureMenu } from '../orders/fixtures';

// 03c §3.2, §6.2–6.3, §3.10 (task c5): SavePrinter, SetStationOutput through the real admin command route.
let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;
let device: { deviceId: string; token: string };
let admin: { sessionId: string; token: string };
let n = 0;

beforeEach(async () => {
  hub = await createTestHub();
  const directory = await aDirectory();
  // S_NODEV: an admin (access-hub-admin through R_MGR) with manage-devices denied (§3.10)
  directory.staff.push({ ...directory.staff.find((s) => s.staff_id === 'S_MGR')!, staff_id: 'S_NODEV', display_name: 'No devices', denied_permissions: ['manage-devices'] });
  await seedDirectory(hub, directory);
  const menu = fixtureMenu();
  const config: BranchConfig = { ...menu, stations: [...menu.stations, { ...menu.stations[0]!, station_id: 'S_OLD', name: 'Old', is_archived: true }] };
  swapBranchConfig({ config, snapshotHash: 'h'.repeat(64), configVersion: 1, snapshotSchemaVersion: 4, appliedAt: 0 });
  device = pairDevice(hub, { type: 'tablet' });
  admin = openSession(hub, { kind: 'admin', staffId: 'S_MGR', deviceId: device.deviceId });
  // the real handlers under test-only names, so their own statements are counted (call-waiter SG-3 pattern)
  const registry = commandRegistry(hub.app);
  for (const def of [savePrinterCommand, setStationOutputCommand] as const) {
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

const lan = (o: Record<string, unknown> = {}) => ({ name: 'Kitchen', connection: 'lan', address: '192.168.1.50', paper_width_mm: 80, ...o });
const savePrinter = (o: Record<string, unknown> = {}) => send('SavePrinter', lan(o));
const setOutput = (station_id: string, mode: string, printer_id: string | null, o: Record<string, unknown> = {}) =>
  send('SetStationOutput', { station_id, mode, printer_id, ...o });
const events = (type: string) =>
  (hub.deps.db.prepare('SELECT stream_type, stream_id, payload FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<{ stream_type: string; stream_id: string; payload: string }>).map(
    (e) => ({ ...e, payload: JSON.parse(e.payload) as Record<string, unknown> }),
  );
const printerRow = (id: string) => hub.deps.db.prepare('SELECT name, connection, address, paper_width_mm, archived_at FROM printers WHERE printer_id = ?').get(id);

describe('[03c #50] SavePrinter', () => {
  it('[03c #50, §3.2] a new LAN printer: hub id, port 9100 by default, PrinterSaved on hub / branch_id, print_config folded; edit by id', async () => {
    const saved = await savePrinter();
    expect(saved.status).toBe(200);
    const printer = saved.result!.printer as { printer_id: string };
    expect(printer).toEqual({ printer_id: expect.any(String), name: 'Kitchen', connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived: false });
    expect(events('PrinterSaved')).toEqual([{ stream_type: 'hub', stream_id: 'branch-1', payload: printer }]);
    expect(printerRow(printer.printer_id)).toEqual({ name: 'Kitchen', connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived_at: null });

    const edited = await savePrinter({ printer_id: printer.printer_id, address: '10.0.0.9:9101', paper_width_mm: 58 });
    expect(edited.status).toBe(200);
    expect(printerRow(printer.printer_id)).toMatchObject({ name: 'Kitchen', address: '10.0.0.9:9101', paper_width_mm: 58 });
    const usb = await send('SavePrinter', { name: 'Bar', connection: 'usb', address: '/dev/pos-printer-bar-1', paper_width_mm: 58 });
    expect(usb.status).toBe(200);
    expect(await send('SavePrinter', { name: 'Tandoor', connection: 'usb', address: '/dev/usb/lp0', paper_width_mm: 80 })).toMatchObject({ status: 200 });
  });

  it('[03c #50, §3.2, §7] address, name and paper validation → 400 VALIDATION_FAILED, nothing written', async () => {
    const bad: Array<Record<string, unknown>> = [
      lan({ address: '8.8.8.8' }),
      lan({ address: '172.32.0.1:9100' }),
      lan({ address: '172.15.0.1' }),
      lan({ address: '192.169.1.1' }),
      lan({ address: '192.168.1.50:0' }),
      lan({ address: '192.168.1.50:65536' }),
      lan({ address: '192.168.1.050' }),
      lan({ address: 'printer.local:9100' }),
      lan({ address: '/dev/usb/lp0' }),
      lan({ connection: 'usb', address: '/dev/sda' }),
      lan({ connection: 'usb', address: '/dev/usb/lp10' }),
      lan({ connection: 'usb', address: '/dev/pos-printer-' }),
      lan({ connection: 'usb', address: '/dev/pos-printer-Bar' }),
      lan({ connection: 'usb', address: '/dev/pos-printer-../../etc/passwd' }),
      lan({ connection: 'usb', address: '192.168.1.50' }),
      lan({ name: '' }),
      lan({ name: '   ' }),
      lan({ name: 'x'.repeat(41) }),
      lan({ paper_width_mm: 72 }),
    ];
    for (const payload of bad) {
      const r = await send('SavePrinter', payload);
      expect([r.status, r.error?.code], JSON.stringify(payload)).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect(events('PrinterSaved')).toEqual([]);
  });

  it('[03c #50, §3.2] names unique among active printers → 409 CONFIG_NAME_TAKEN; free again once archived; own name kept on edit', async () => {
    const first = ((await savePrinter()).result!.printer as { printer_id: string }).printer_id;
    expect((await savePrinter({ printer_id: first, address: '192.168.1.51' })).status).toBe(200);
    const taken = await savePrinter({ address: '192.168.1.52' });
    expect([taken.status, taken.error?.code, taken.error?.details]).toEqual([409, 'CONFIG_NAME_TAKEN', { entity: 'printer', name: 'Kitchen' }]);
    const other = ((await savePrinter({ name: 'Other', address: '192.168.1.52' })).result!.printer as { printer_id: string }).printer_id;
    expect((await savePrinter({ printer_id: other, name: 'Kitchen' })).error?.code).toBe('CONFIG_NAME_TAKEN');
    expect((await savePrinter({ printer_id: first, archived: true })).status).toBe(200);
    expect((await savePrinter({ printer_id: other, name: 'Kitchen', address: '192.168.1.52' })).status).toBe(200);
    // un-archiving the first under a name now taken
    expect((await savePrinter({ printer_id: first, archived: false })).error?.code).toBe('CONFIG_NAME_TAKEN');
  });

  it('[03c #50, §3.2] archive refused while a station output uses it (screen fallback too) → 409 CONFIG_IN_USE; allowed once the output moves', async () => {
    const p1 = ((await savePrinter()).result!.printer as { printer_id: string }).printer_id;
    const p2 = ((await savePrinter({ name: 'Spare', address: '192.168.1.60' })).result!.printer as { printer_id: string }).printer_id;
    expect((await setOutput('S1', 'both', p1)).status).toBe(200);
    expect((await setOutput('S2', 'screen', p1)).status).toBe(200);
    const refused = await savePrinter({ printer_id: p1, archived: true });
    expect([refused.status, refused.error?.code, refused.error?.details]).toEqual([
      409,
      'CONFIG_IN_USE',
      { entity: 'printer', id: p1, used_by: { entity: 'station', ids: ['S1', 'S2'] } },
    ]);
    expect(printerRow(p1)).toMatchObject({ archived_at: null });
    await setOutput('S1', 'printer', p2);
    await setOutput('S2', 'screen', null);
    const archived = await savePrinter({ printer_id: p1, archived: true });
    expect(archived.status).toBe(200);
    expect(printerRow(p1)).toMatchObject({ archived_at: hub.clock.branchNow() });
  });

  it('[03c #50, §3.2] any station output holds the printer: also an archived station\'s, and with no branch config in memory', async () => {
    const p1 = ((await savePrinter()).result!.printer as { printer_id: string }).printer_id;
    // S_OLD's output from before it was archived (SetStationOutput now refuses it: STATION_NOT_FOUND)
    hub.deps.db.prepare(`INSERT INTO station_outputs (station_id, mode, printer_id) VALUES ('S_OLD', 'both', ?)`).run(p1);
    expect((await savePrinter({ printer_id: p1, archived: true })).error?.details).toMatchObject({ used_by: { entity: 'station', ids: ['S_OLD'] } });
    swapBranchConfig(null);
    const noConfig = await savePrinter({ printer_id: p1, archived: true });
    expect([noConfig.status, noConfig.error?.code]).toEqual([409, 'CONFIG_IN_USE']);
    expect(printerRow(p1)).toMatchObject({ archived_at: null });
  });

  it('[03c #50, §3.10] admin route only: the device route → 404 ROUTE_NOT_FOUND; an admin without manage-devices → 403', async () => {
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: device.deviceId });
    const device_route = await send('SavePrinter', lan(), { route: 'device', session: staff });
    expect([device_route.status, device_route.error?.code]).toEqual([404, 'ROUTE_NOT_FOUND']);
    const noDevices = openSession(hub, { kind: 'admin', staffId: 'S_NODEV', deviceId: device.deviceId });
    const denied = await send('SavePrinter', lan(), { session: noDevices, actor: 'S_NODEV' });
    expect([denied.status, denied.error?.code]).toEqual([403, 'PERMISSION_DENIED']);
    expect((await send('SetStationOutput', { station_id: 'S1', mode: 'screen', printer_id: null }, { session: noDevices, actor: 'S_NODEV' })).error?.code).toBe('PERMISSION_DENIED');
    expect((await send('SetStationOutput', { station_id: 'S1', mode: 'screen', printer_id: null }, { route: 'device', session: staff })).error?.code).toBe('ROUTE_NOT_FOUND');
    expect(events('PrinterSaved')).toEqual([]);
  });

  it('[03c §6.2] statements: 1 per save (active-name read) and per archive (in-use read), within the spec bound of 2', async () => {
    const r = await send('TestSavePrinterCounted', lan());
    expect(r.status).toBe(200);
    expect(lastStatements).toBe(1);
    await send('TestSavePrinterCounted', lan({ printer_id: (r.result!.printer as { printer_id: string }).printer_id, archived: true }));
    expect(lastStatements).toBe(1);
    expect(lastStatements).toBeLessThanOrEqual(2);
  });
});

describe('[03c #51] SetStationOutput', () => {
  it('[03c #51, §3.2] both / printer without a printer → 400 VALIDATION_FAILED { field: printer_id }; screen without one is fine', async () => {
    for (const mode of ['both', 'printer']) {
      const r = await setOutput('S1', mode, null);
      expect([r.status, r.error?.code, r.error?.details.field]).toEqual([400, 'VALIDATION_FAILED', 'printer_id']);
    }
    expect(events('StationOutputSet')).toEqual([]);
    const screen = await setOutput('S1', 'screen', null);
    expect(screen.status).toBe(200);
    expect(screen.result).toEqual({ station_output: { station_id: 'S1', mode: 'screen', printer_id: null, show_taker: true, show_order_id: true } });
  });

  it('[03c #51, §6.3] writes StationOutputSet on hub / branch_id; toggles default true; print_config folded; unknown / archived station → 404; unknown / archived printer → 404', async () => {
    const p1 = ((await savePrinter()).result!.printer as { printer_id: string }).printer_id;
    const set = await setOutput('S2', 'printer', p1, { show_taker: false });
    expect(set.status).toBe(200);
    expect(events('StationOutputSet')).toEqual([
      { stream_type: 'hub', stream_id: 'branch-1', payload: { station_id: 'S2', mode: 'printer', printer_id: p1, show_taker: false, show_order_id: true } },
    ]);
    expect(hub.deps.db.prepare('SELECT * FROM station_outputs').all()).toEqual([{ station_id: 'S2', mode: 'printer', printer_id: p1, show_taker: 0, show_order_id: 1 }]);

    for (const station_id of ['S_NOPE', 'S_OLD']) {
      const r = await setOutput(station_id, 'both', p1);
      expect([r.status, r.error?.code, r.error?.details]).toEqual([404, 'STATION_NOT_FOUND', { station_id }]);
    }
    const unknown = await setOutput('S1', 'both', 'PR_NOPE');
    expect([unknown.status, unknown.error?.code, unknown.error?.details]).toEqual([404, 'PRINTER_NOT_FOUND', { printer_id: 'PR_NOPE' }]);
    const spare = ((await savePrinter({ name: 'Spare', address: '192.168.1.60', archived: true })).result!.printer as { printer_id: string }).printer_id;
    expect((await setOutput('S1', 'screen', spare)).error?.code).toBe('PRINTER_NOT_FOUND');
    expect(events('StationOutputSet')).toHaveLength(1);
  });

  it('[03c §6.3] statements: 1 (the printer read)', async () => {
    const p1 = ((await savePrinter()).result!.printer as { printer_id: string }).printer_id;
    expect((await send('TestSetStationOutputCounted', { station_id: 'S1', mode: 'both', printer_id: p1 })).status).toBe(200);
    expect(lastStatements).toBe(1);
  });
});
