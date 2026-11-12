import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { reprintTicketCommand } from '../../src/print/commands/reprint';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, type TestHub } from '../helpers/test-hub';
import { COOK, FX, appendOrder, append as kdsAppend, fireLines, openDay, pairKds, removeLine, serveLines, signInCook } from '../kds/fixtures';

// 03c §3.5, §6.1, §6.8, §3.10 (task c9): ReprintTicket from a KDS station session and from a Cook on a Pass tablet
// (default grant, 03b B-1) through the real device command route; the order-tickets query. `reprint` jobs come from
// c8's TicketReprinted fold.
let hub: TestHub;
let cook: Awaited<ReturnType<typeof signInCook>>;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;
let n = 0;

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  openDay(hub);
  cook = await signInCook(hub, { pointId: 'P1' });
  hubEvent('PrinterSaved', { printer_id: 'PR1', name: 'PR1', connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived: false });
  hubEvent('StationOutputSet', { station_id: FX.station, mode: 'both', printer_id: 'PR1', show_taker: true, show_order_id: true });
  commandRegistry(hub.app).register(
    defineCommand({
      ...reprintTicketCommand,
      commandType: 'TestReprintTicketCounted',
      handle(ctx, payload, cmd) {
        const before = counter.count;
        try {
          return reprintTicketCommand.handle(ctx, payload, cmd);
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

function hubEvent(event_type: string, payload: Record<string, unknown>): void {
  kdsAppend(hub, [{ stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, event_type, payload }], { actor: null });
}
type Who = { token: string; sessionToken: string; deviceId: string; actor: string | null };
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

async function reprint(who: Who, payload: Record<string, unknown>, commandType = 'ReprintTicket') {
  hub.clock.advance(1_000);
  const response = await hub.app.inject({
    method: 'POST',
    url: `/commands/${kebab(commandType)}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: { command_id: `cmd-${++n}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type: commandType, payload, occurred_at: hub.clock.branchNow(), actor_id: who.actor, device_id: who.deviceId },
  });
  const body = response.json() as { data?: { result: { ticket_ids: string[]; skipped: Array<{ ticket_id: string; reason: string }> } }; error?: { code: string; details: Record<string, unknown> } };
  return { status: response.statusCode, result: body.data?.result, error: body.error };
}
async function orderTickets(who: Who, order_id: string) {
  const response = await hub.app.inject({
    method: 'GET',
    url: `/queries/order-tickets?order_id=${order_id}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
  });
  const body = response.json() as { data?: { tickets: Array<Record<string, unknown>> }; error?: { code: string } };
  return { status: response.statusCode, tickets: body.data?.tickets, error: body.error };
}
function kds(station_id: string): Who {
  const device = pairKds(hub, { stationId: station_id });
  const session = openSession(hub, { kind: 'station', stationId: station_id, deviceId: device.deviceId });
  return { token: device.token, sessionToken: session.token, deviceId: device.deviceId, actor: null };
}
const cookWho = (): Who => ({ token: cook.token, sessionToken: cook.sessionToken, deviceId: cook.deviceId, actor: COOK.staff });
function staff(staffId: string): Who {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { token: device.token, sessionToken: session.token, deviceId: device.deviceId, actor: staffId };
}

/** An order with A1 at S1 and A2 at S2 (fired there by the test); returns the order and both ticket ids. */
function twoStationOrder(): { order_id: string; s1: string; s2: string } {
  const order_id = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan, quantity: 2 }, { order_item_id: 'A2', item_id: FX.naan }] }).order_id;
  const [f1] = fireLines(hub, FX.station, ['A1']);
  const [f2] = fireLines(hub, FX.zoneStation, ['A2']);
  return { order_id, s1: `${f1!.event_id}:${order_id}`, s2: `${f2!.event_id}:${order_id}` };
}
const reprintJobs = () =>
  hub.deps.db.prepare(`SELECT job_id, station_id, ticket_id FROM print_jobs WHERE kind = 'reprint' ORDER BY job_id`).all() as Array<{ job_id: string; station_id: string; ticket_id: string }>;
const events = () =>
  (hub.deps.db.prepare(`SELECT stream_type, stream_id, actor_id, payload FROM events WHERE event_type = 'TicketReprinted' ORDER BY seq`).all() as Array<{ payload: string }>).map((e) => ({
    ...e,
    payload: JSON.parse(e.payload) as unknown,
  }));

describe('[03c #9] ReprintTicket', () => {
  it('[03c #9, §3.5] a KDS reprints its own station: by order → only its station\'s tickets; another station\'s ticket → 403', async () => {
    const { order_id, s1, s2 } = twoStationOrder();
    const s1Kds = kds(FX.station);
    const byOrder = await reprint(s1Kds, { order_id });
    expect(byOrder).toMatchObject({ status: 200, result: { ticket_ids: [s1], skipped: [] } });
    expect(events()).toEqual([{ stream_type: 'order', stream_id: order_id, actor_id: null, payload: { order_id, station_id: FX.station, ticket_ids: [s1] } }]);
    expect(reprintJobs().map((j) => [j.station_id, j.ticket_id])).toEqual([[FX.station, s1]]);
    const byTicket = await reprint(s1Kds, { ticket_id: s1 });
    expect(byTicket.result).toEqual({ ticket_ids: [s1], skipped: [] });
    const other = await reprint(s1Kds, { ticket_id: s2 });
    expect([other.status, other.error?.code, other.error?.details]).toEqual([403, 'PERMISSION_DENIED', { permission: 'reprint-ticket', reason: 'outside_scope', station_id: FX.zoneStation }]);
    expect(reprintJobs()).toHaveLength(2);
  });

  it('[03c #9, §3.10, 03b B-1] a Cook on a Pass tablet (default grant) reprints by order → every ticket; staff without reprint-ticket → 403', async () => {
    const { order_id, s1, s2 } = twoStationOrder();
    const r = await reprint(cookWho(), { order_id });
    // S2 has no station output (screen, no printer): skipped as no_printer
    expect(r).toMatchObject({ status: 200, result: { ticket_ids: [s1], skipped: [{ ticket_id: s2, reason: 'no_printer' }] } });
    expect(events()).toEqual([{ stream_type: 'order', stream_id: order_id, actor_id: COOK.staff, payload: { order_id, station_id: null, ticket_ids: [s1] } }]);
    expect(reprintJobs().map((j) => j.ticket_id)).toEqual([s1]);
    // once S2 has a (fallback) printer its ticket reprints too
    hubEvent('StationOutputSet', { station_id: FX.zoneStation, mode: 'screen', printer_id: 'PR1', show_taker: true, show_order_id: true });
    expect((await reprint(cookWho(), { order_id })).result).toEqual({ ticket_ids: [s1, s2], skipped: [] });
    const waiter = await reprint(staff('S_WAIT'), { order_id });
    expect([waiter.status, waiter.error?.code]).toEqual([403, 'PERMISSION_DENIED']);
  });

  it('[03c §3.5, §6.1] nothing live (every unit removed or voided) → result.skipped, no event; a served line with units left is still reprinted', async () => {
    hubEvent('StationOutputSet', { station_id: FX.zoneStation, mode: 'both', printer_id: 'PR1', show_taker: true, show_order_id: true });
    const { order_id, s1, s2 } = twoStationOrder();
    serveLines(hub, order_id, ['A2']);
    removeLine(hub, order_id, 'A1', 1);
    expect((await reprint(cookWho(), { order_id })).result).toEqual({ ticket_ids: [s1, s2], skipped: [] });
    removeLine(hub, order_id, 'A1', 1);
    expect((await reprint(cookWho(), { order_id })).result).toEqual({ ticket_ids: [s2], skipped: [{ ticket_id: s1, reason: 'nothing_live' }] });
    expect(events()).toHaveLength(2);
    const b = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'B1', item_id: FX.naan }] }).order_id;
    const [fb] = fireLines(hub, FX.station, ['B1']);
    removeLine(hub, b, 'B1');
    expect((await reprint(cookWho(), { order_id: b })).result).toEqual({ ticket_ids: [], skipped: [{ ticket_id: `${fb!.event_id}:${b}`, reason: 'nothing_live' }] });
    expect(events()).toHaveLength(2);
  });

  it('[03c §6.1] errors: neither / both ids → 400 VALIDATION_FAILED; unknown order or ticket → 404 ORDER_NOT_FOUND; an order with no ticket at the KDS station → empty result', async () => {
    for (const payload of [{}, { order_id: 'X', ticket_id: 'Y' }]) {
      const r = await reprint(cookWho(), payload);
      expect([r.status, r.error?.code], JSON.stringify(payload)).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect((await reprint(cookWho(), { order_id: 'NOPE' })).error).toMatchObject({ code: 'ORDER_NOT_FOUND', details: { order_id: 'NOPE' } });
    expect((await reprint(cookWho(), { ticket_id: 'NOPE' })).error).toMatchObject({ code: 'ORDER_NOT_FOUND', details: { ticket_id: 'NOPE' } });
    const order_id = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'B1', item_id: FX.naan }] }).order_id;
    fireLines(hub, FX.station, ['B1']);
    expect((await reprint(kds(FX.zoneStation), { order_id })).result).toEqual({ ticket_ids: [], skipped: [] });
    expect(events()).toEqual([]);
  });

  it('[03c §3.5, §6.1] a screen-only station (no printer): by order and by ticket → skipped no_printer, no event, no job', async () => {
    hubEvent('StationOutputSet', { station_id: FX.station, mode: 'screen', printer_id: null, show_taker: true, show_order_id: true });
    const { order_id, s1, s2 } = twoStationOrder();
    expect((await reprint(cookWho(), { order_id })).result).toEqual({
      ticket_ids: [],
      skipped: [
        { ticket_id: s1, reason: 'no_printer' },
        { ticket_id: s2, reason: 'no_printer' },
      ],
    });
    expect((await reprint(kds(FX.station), { ticket_id: s1 })).result).toEqual({ ticket_ids: [], skipped: [{ ticket_id: s1, reason: 'no_printer' }] });
    expect(events()).toEqual([]);
    expect(reprintJobs()).toEqual([]);
  });

  it('[03c §6.1] statements: 2 by order (order, tickets), 1 by ticket', async () => {
    const { order_id, s1 } = twoStationOrder();
    expect((await reprint(cookWho(), { order_id }, 'TestReprintTicketCounted')).status).toBe(200);
    expect(lastStatements).toBe(2);
    expect((await reprint(cookWho(), { ticket_id: s1 }, 'TestReprintTicketCounted')).status).toBe(200);
    expect(lastStatements).toBe(1);
  });
});

describe('[03c #9, §6.8] order-tickets', () => {
  it('[03c #9, §6.8] tickets of the order with station_name, fired_at, printed, has_printer; 2 statements', async () => {
    const { order_id, s1, s2 } = twoStationOrder();
    const fired = (id: string) => hub.deps.db.prepare('SELECT fired_at FROM tickets WHERE ticket_id = ?').pluck().get(id) as number;
    hub.deps.db.prepare(`UPDATE print_jobs SET sent_at = 1, sent_printer_id = 'PR1', acked_at = 1 WHERE ticket_id = ?`).run(s1);
    const reads = statementCounter(hub.deps.readDb);
    const r = await orderTickets(cookWho(), order_id);
    expect(reads.count).toBe(2);
    expect(r.status).toBe(200);
    expect(r.tickets).toEqual([
      { ticket_id: s1, station_id: FX.station, station_name: 'Karahi', fired_at: fired(s1), printed: true, has_printer: true },
      { ticket_id: s2, station_id: FX.zoneStation, station_name: 'Counter', fired_at: fired(s2), printed: false, has_printer: false },
    ]);
    // a screen station with a fallback printer has a printer
    hubEvent('StationOutputSet', { station_id: FX.zoneStation, mode: 'screen', printer_id: 'PR1', show_taker: true, show_order_id: true });
    expect((await orderTickets(cookWho(), order_id)).tickets!.map((t) => t.has_printer)).toEqual([true, true]);
  });

  it('[03c §3.10] order-tickets: staff without reprint-ticket → 403; a station session → refused', async () => {
    const { order_id } = twoStationOrder();
    expect((await orderTickets(staff('S_WAIT'), order_id)).error?.code).toBe('PERMISSION_DENIED');
    const station = await orderTickets(kds(FX.station), order_id);
    expect([station.status, station.error?.code]).toEqual([401, 'SESSION_INVALID']);
    expect((await orderTickets(cookWho(), 'NOPE')).tickets).toEqual([]);
  });
});
