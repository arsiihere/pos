import type { EngineState } from '@pos/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handoversDue } from '../../src/kds/contracts';
import { HANDOVERS_DUE_LIMIT } from '../../src/kds/exports';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, seedDirectory, type TestHub } from '../helpers/test-hub';
import { COOK, FX, append, appendOrder, cookDirectory, fireLines, openDay, pairDevice, pairPassTablet, removeLine, serveLines } from '../kds/fixtures';

// 03b §4.2 `handoversDue(db, now, older_than_ms)` (2 statements, LIMIT 200), test #27 (export half). Hand-overs go
// through the real Handover route; settling through real ItemServed / ItemRemoved; the day-close expiry of the Served
// card is the AlertClosed { reason: 'expired' } 01d's tick writes. Called through the contract (contracts.ts), as 0e does.

let hub: TestHub;
const POINT = 'P1';
const engine = (): EngineState => hub.deps.state.get() as EngineState;

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
});
afterEach(async () => {
  await hub.close();
});

const on = (order_id: string, event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, payload });

function cook(order_id: string, ids: string[]): void {
  fireLines(hub, engine().lines[ids[0]!]!.station_id, ids);
  append(hub, ids.map((order_item_id) => on(order_id, 'ItemStarted', { order_item_id, started_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
  append(hub, ids.map((order_item_id) => on(order_id, 'ItemDone', { order_item_id, done_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
}
const takeaway = (ids: string[]) => appendOrder(hub, { order_type: 'takeaway', lines: ids.map((order_item_id) => ({ order_item_id, item_id: FX.naan })) }).order_id;

interface Who {
  deviceId: string;
  token: string;
  sessionToken: string;
}
async function seed(): Promise<Who> {
  await seedDirectory(hub, await cookDirectory());
  const device = pairPassTablet(hub, { pointId: POINT });
  const session = openSession(hub, { kind: 'staff', staffId: COOK.staff, deviceId: device.deviceId });
  openSession(hub, { kind: 'staff', staffId: 'S_OWNER', deviceId: pairDevice(hub, { type: 'tablet' }).deviceId }); // a signed-in receiver (B4-3)
  return { deviceId: device.deviceId, token: device.token, sessionToken: session.token };
}
let seq = 0;
async function handover(who: Who, order_id: string, order_item_ids?: string[]): Promise<{ handover_id: string; served_card_alert_id: string }> {
  seq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: '/commands/handover',
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id: `cmd-${seq}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'Handover',
      payload: { order_id, point_id: POINT, receiver_staff_id: 'S_OWNER', ...(order_item_ids === undefined ? {} : { order_item_ids }) },
      occurred_at: hub.clock.branchNow(),
      actor_id: COOK.staff,
      device_id: who.deviceId,
    },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: { result: { handover_id: string; served_card_alert_id: string } } }).data.result;
}

describe('handoversDue (03b §4.2)', () => {
  it('[03b #27] only hand-overs with unsettled lines handed at or before the cut-off, with only their unsettled ids; 2 statements', async () => {
    openDay(hub);
    const who = await seed();
    const a = takeaway(['A1', 'A2', 'A3']);
    const b = takeaway(['B1']);
    const c = takeaway(['C1']);
    cook(a, ['A1', 'A2', 'A3']);
    cook(b, ['B1']);
    cook(c, ['C1']);

    const ha = await handover(who, a); // oldest
    const handedA = hub.clock.branchNow();
    hub.clock.advance(60_000);
    const hc = await handover(who, c); // settled below: never due
    hub.clock.advance(60_000);
    const hb = await handover(who, b); // newest
    serveLines(hub, a, ['A1']);
    removeLine(hub, a, 'A3');
    serveLines(hub, c, ['C1']);

    const now = hub.clock.branchNow();
    const counter = statementCounter(hub.deps.db);
    const all = handoversDue(hub.deps.db, now, 0);
    expect(counter.count).toBe(2);
    expect(all).toEqual([
      { handover_id: ha.handover_id, order_id: a, order_item_ids: ['A2'] },
      { handover_id: hb.handover_id, order_id: b, order_item_ids: ['B1'] },
    ]);
    expect(all.map((h) => h.handover_id)).not.toContain(hc.handover_id);

    // the cut-off: handed at or before now − older_than_ms
    expect(handoversDue(hub.deps.db, now, now - handedA).map((h) => h.handover_id)).toEqual([ha.handover_id]);
    expect(handoversDue(hub.deps.db, now, now - handedA + 1)).toEqual([]);

    // nothing due → 1 statement
    counter.reset();
    expect(handoversDue(hub.deps.db, now, now)).toEqual([]);
    expect(counter.count).toBe(1);
  });

  it('[03b #27, §3.5 Day close] a Served card expired at day close does not stop the estimate: its unsettled lines stay due', async () => {
    openDay(hub);
    const who = await seed();
    const a = takeaway(['A1', 'A2']);
    cook(a, ['A1', 'A2']);
    const { handover_id, served_card_alert_id } = await handover(who, a);
    append(hub, [on(a, 'AlertClosed', { alert_id: served_card_alert_id, reason: 'expired', by_staff_id: null, note: null })], { actor: null, device: 'hub' });
    expect((hub.deps.db.prepare('SELECT card_closed_at FROM handovers WHERE handover_id = ?').get(handover_id) as { card_closed_at: number | null }).card_closed_at).not.toBeNull();
    serveLines(hub, a, ['A1']);
    expect(handoversDue(hub.deps.db, hub.clock.branchNow(), 0)).toEqual([{ handover_id, order_id: a, order_item_ids: ['A2'] }]);
  });

  it(`[03b §4.2] LIMIT ${HANDOVERS_DUE_LIMIT}, oldest first`, () => {
    // Handover events through the writer, folded by the real pass projection (it does not read the order)
    const drafts = Array.from({ length: HANDOVERS_DUE_LIMIT + 1 }, (_, i) => {
      const n = String(i).padStart(3, '0');
      return on(`O${n}`, 'Handover', {
        handover_id: `H${n}`,
        order_id: `O${n}`,
        point_id: POINT,
        receiver_staff_id: 'S_OWNER',
        order_item_ids: [`L${n}`],
        alert_id: `A${n}`,
        ready_alert_closed: null,
      });
    });
    for (const d of drafts) append(hub, [d], { advanceMs: 10 });
    const due = handoversDue(hub.deps.db, hub.clock.branchNow(), 0);
    expect(due).toHaveLength(HANDOVERS_DUE_LIMIT);
    expect(due[0]).toEqual({ handover_id: 'H000', order_id: 'O000', order_item_ids: ['L000'] });
    expect(due[due.length - 1]!.handover_id).toBe('H199');
  });
});
