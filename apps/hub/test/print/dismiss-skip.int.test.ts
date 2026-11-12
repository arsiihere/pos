import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { dismissPrintSkipCommand } from '../../src/print/commands/dismiss-skip';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FX, append as kdsAppend, openDay } from '../kds/fixtures';

// ⚠️ 03c v1.0.6 §6.12, §3.7, §3.10, §9 (Q-14, owner 2026-11-12; task P0.22): DismissPrintSkip { alert_id } through the
// real device command route. A staff session with `force-release-table-lock` (branch) closes one `printer_problem
// { problem: 'ticket_not_built' }` alert `done` (AlertClosed with the staff actor) and marks its skip resolved; any
// other alert → 404 ALERT_NOT_FOUND, a closed one → 409 ALERT_ALREADY_CLOSED. Real 01d alerts raised as 03c's worker
// raises them (status.ts raiseSkips: kind printer_problem, dedupe printer_problem:ticket_not_built:<event_id>).
let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;
let n = 0;

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  const directory = await aDirectory();
  // S_FLOOR: force-release-table-lock at my_floors only (not in 01d's managers set)
  directory.roles.push({
    role_id: 'R_FLOOR',
    name: 'Floor lead',
    session_idle_ttl_ms: 3_600_000,
    permissions: [{ permission: 'force-release-table-lock', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'my_floors' }],
  });
  directory.staff.push({ ...directory.staff.find((s) => s.staff_id === 'S_WAIT')!, staff_id: 'S_FLOOR', display_name: 'Floor lead', role_ids: ['R_FLOOR'] });
  await seedDirectory(hub, directory);
  openDay(hub);
  hubEvent('PrinterSaved', { printer_id: 'PR1', name: 'Kitchen', connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived: false });
  hubEvent('StationOutputSet', { station_id: FX.station, mode: 'both', printer_id: 'PR1', show_taker: true, show_order_id: true });
  commandRegistry(hub.app).register(
    defineCommand({
      ...dismissPrintSkipCommand,
      commandType: 'TestDismissPrintSkipCounted',
      handle(ctx, payload, cmd) {
        const before = counter.count;
        try {
          return dismissPrintSkipCommand.handle(ctx, payload, cmd);
        } finally {
          lastStatements = counter.count - before;
        }
      },
    }),
  );
  counter = statementCounter(hub.deps.db);
});
afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

const branch = (): string => hub.deps.config.provisioned!.branch_id;
const now = (): number => hub.clock.branchNow();
function hubEvent(event_type: string, payload: Record<string, unknown>): void {
  kdsAppend(hub, [{ stream_type: 'hub', stream_id: branch(), event_type, payload }], { actor: null });
}
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

function staff(staffId: string): { token: string; sessionToken: string; deviceId: string; actor: string } {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { token: device.token, sessionToken: session.token, deviceId: device.deviceId, actor: staffId };
}
async function dismiss(who: ReturnType<typeof staff>, alert_id: string, commandType = 'DismissPrintSkip') {
  hub.clock.advance(1_000);
  const response = await hub.app.inject({
    method: 'POST',
    url: `/commands/${kebab(commandType)}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: { command_id: `cmd-${++n}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type: commandType, payload: { alert_id }, occurred_at: now(), actor_id: who.actor, device_id: who.deviceId },
  });
  const body = response.json() as { data?: { result: Record<string, unknown> }; error?: { code: string; details: Record<string, unknown> } };
  return { status: response.statusCode, result: body.data?.result, error: body.error };
}

/** A fold skip row, alerted as 03c's worker raises it (one alert per skip, C3-3). */
function skipAlert(event_id: string): string {
  hub.deps.db
    .prepare('INSERT INTO print_fold_skips (event_id, station_id, order_ids, reason, at, alerted_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(event_id, FX.station, '[]', 'bad_output', now(), now());
  return raise('ticket_not_built', `printer_problem:ticket_not_built:${event_id}`);
}
function raise(problem: string, dedupe_key: string): string {
  const { appended } = hub.deps.writer.run((tx) => {
    const [r] = alerts.raiseMany(alerts.tickCtx(tx, now()), [
      {
        kind: 'printer_problem',
        subject: { stream_type: 'hub', stream_id: branch() },
        target: { kind: 'managers' },
        values: { printer_id: 'PR1', waiting: 0 },
        display: { kind_label_key: 'alert.printer_problem.card' },
        details: { printer_name: 'Kitchen', problem },
        dedupe_key,
      },
    ]);
    tx.append(r!.events);
  });
  return (appended.find((e) => e.event_type === 'AlertRaised')!.payload as { alert_id: string }).alert_id;
}
const alertRow = (alert_id: string) =>
  hub.deps.db.prepare('SELECT state, close_reason, closed_by_staff_id FROM alerts WHERE alert_id = ?').get(alert_id) as { state: string; close_reason: string | null; closed_by_staff_id: string | null };
const closedEvents = () =>
  (hub.deps.db.prepare(`SELECT actor_id, payload FROM events WHERE event_type = 'AlertClosed' ORDER BY seq`).all() as Array<{ actor_id: string | null; payload: string }>).map((e) => ({
    actor_id: e.actor_id,
    payload: JSON.parse(e.payload) as Record<string, unknown>,
  }));

describe('[03c v1.0.6 §6.12, Q-14] DismissPrintSkip', () => {
  it('[03c §6.12] a manager closes a ticket_not_built alert done (AlertClosed with the staff actor); the skip stays, resolved; no other alert touched; 2 statements + 01d close', async () => {
    const skip = skipAlert('E1');
    const other = skipAlert('E2');
    const paper = raise('paper_out', 'printer_problem:PR1');
    const r = await dismiss(staff('S_MGR'), skip, 'TestDismissPrintSkipCounted');
    expect(r).toMatchObject({ status: 200, result: { dismissed: true } });
    expect(alertRow(skip)).toEqual({ state: 'closed', close_reason: 'done', closed_by_staff_id: 'S_MGR' });
    expect(closedEvents()).toEqual([{ actor_id: 'S_MGR', payload: { alert_id: skip, reason: 'done', by_staff_id: 'S_MGR', note: null } }]);
    expect(alertRow(other).state).toBe('open');
    expect(alertRow(paper).state).toBe('open');
    // resolved = alerted (retention's rule, the worker never raises it again); still listed until retention
    expect(hub.deps.db.prepare('SELECT event_id, alerted_at IS NOT NULL AS resolved FROM print_fold_skips ORDER BY event_id').all()).toEqual([
      { event_id: 'E1', resolved: 1 },
      { event_id: 'E2', resolved: 1 },
    ]);
    // the alert read + the skip update, plus 01d's close (its one alert read): 3 here
    expect(lastStatements).toBe(3);
  });

  it('[03c §6.12] another problem of printer_problem (paper_out) → 404 ALERT_NOT_FOUND; not_printing and an unknown id → 404; nothing closed', async () => {
    const mgr = staff('S_MGR');
    const paper = raise('paper_out', 'printer_problem:PR1');
    expect(await dismiss(mgr, paper)).toMatchObject({ status: 404, error: { code: 'ALERT_NOT_FOUND', details: { alert_id: paper } } });
    expect(await dismiss(mgr, 'NO_SUCH_ALERT')).toMatchObject({ status: 404, error: { code: 'ALERT_NOT_FOUND', details: { alert_id: 'NO_SUCH_ALERT' } } });
    const notPrinting = raise('not_printing', 'printer_problem:PR2');
    expect(await dismiss(mgr, notPrinting)).toMatchObject({ status: 404, error: { code: 'ALERT_NOT_FOUND', details: { alert_id: notPrinting } } });
    expect(alertRow(notPrinting).state).toBe('open');
    expect(alertRow(paper).state).toBe('open');
    expect(closedEvents()).toEqual([]);
  });

  it('[03c §6.12, §9] an already closed skip alert → 409 ALERT_ALREADY_CLOSED { alert_id, reason }', async () => {
    const mgr = staff('S_MGR');
    const skip = skipAlert('E1');
    expect((await dismiss(mgr, skip)).status).toBe(200);
    expect(await dismiss(mgr, skip)).toMatchObject({ status: 409, error: { code: 'ALERT_ALREADY_CLOSED', details: { alert_id: skip, reason: 'done' } } });
    expect(closedEvents()).toHaveLength(1);
  });

  it('[03c §3.10] without force-release-table-lock → 403; at my_floors scope (not a manager) → 403; a station session → 403; nothing closed', async () => {
    const skip = skipAlert('E1');
    expect(await dismiss(staff('S_WAIT'), skip)).toMatchObject({ status: 403, error: { code: 'PERMISSION_DENIED', details: { permission: 'force-release-table-lock' } } });
    expect(await dismiss(staff('S_FLOOR'), skip)).toMatchObject({ status: 403, error: { code: 'PERMISSION_DENIED', details: { permission: 'force-release-table-lock', reason: 'outside_scope' } } });
    const kds = pairDevice(hub, { type: 'kds', stationId: FX.station });
    const station = openSession(hub, { kind: 'station', stationId: FX.station, deviceId: kds.deviceId });
    expect(await dismiss({ token: kds.token, sessionToken: station.token, deviceId: kds.deviceId, actor: null as unknown as string }, skip)).toMatchObject({ status: 403 });
    expect(alertRow(skip).state).toBe('open');
    expect(closedEvents()).toEqual([]);
  });
});
