import type { EngineState } from '@pos/engine';
import type { PosEvent } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { passProjection } from '../../src/kds/pass-projection';
import { createProjectionRegistry } from '../../src/projections/registry';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FX, append, appendOrder, cookDirectory, fireLines, openDay, removeLine, serveLines, voidLine } from '../kds/fixtures';

// 03b §5 projection `pass` (with reset), §3.5 Settling (idempotent; open_lines by rows changed; live units =
// units − removed_units − voided_units), R8 total fold. 03b's own events (ReadyToServe, Handover, …) are written raw
// through the real writer: their commands are b14 / b15. 02b's events and its ReturnToKitchen command are real.

let hub: TestHub;
afterEach(async () => {
  await hub?.close();
});

const POINT = 'P1';
const engine = (): EngineState => hub.deps.state.get() as EngineState;
const branch = (): string => hub.deps.config.provisioned!.branch_id;

const on = (order_id: string, event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, payload });
const onHub = (event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'hub' as const, stream_id: 'branch-1', event_type, payload });

function start(order_id: string, ids: string[]): void {
  append(hub, ids.map((order_item_id) => on(order_id, 'ItemStarted', { order_item_id, started_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
}
function done(order_id: string, ids: string[]): void {
  append(hub, ids.map((order_item_id) => on(order_id, 'ItemDone', { order_item_id, done_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
}
/** fire → start → done (real engine events). */
function cook(order_id: string, ids: string[]): void {
  fireLines(hub, FX.station, ids);
  start(order_id, ids);
  done(order_id, ids);
}
function ready(order_id: string, ids: string[], alert_id: string | null, table_id: string | null = null): void {
  append(hub, [on(order_id, 'ReadyToServe', { order_id, point_id: POINT, order_item_ids: ids, table_id, alert_id })], { actor: 'S_COOK' });
}
function handover(order_id: string, handover_id: string, ids: string[], alert_id = `A_CARD_${handover_id}`, ready_alert_closed: string | null = null): void {
  append(hub, [on(order_id, 'Handover', { handover_id, order_id, point_id: POINT, receiver_staff_id: 'S_WAIT', order_item_ids: ids, alert_id, ready_alert_closed })], {
    actor: 'S_COOK',
  });
}
function closeAlert(alert_id: string, reason: 'done' | 'undone' | 'obsolete' | 'expired' = 'done'): void {
  append(hub, [onHub('AlertClosed', { alert_id, reason, by_staff_id: null, note: null })], { actor: null, device: 'hub' });
}

function takeaway(ids: string[], quantity = 1): string {
  return appendOrder(hub, { order_type: 'takeaway', lines: ids.map((order_item_id) => ({ order_item_id, item_id: FX.naan, quantity })) }).order_id;
}

const handoverRow = (id: string) => hub.deps.db.prepare('SELECT open_lines, served_card_alert_id, card_closed_at FROM handovers WHERE handover_id = ?').get(id) as {
  open_lines: number;
  served_card_alert_id: string | null;
  card_closed_at: number | null;
};
const handoverLine = (id: string) => hub.deps.db.prepare('SELECT handover_id, settled_at FROM handover_lines WHERE order_item_id = ?').get(id) as { handover_id: string; settled_at: number | null };
const readyLine = (id: string) => hub.deps.db.prepare('SELECT settled_at FROM pass_ready_lines WHERE order_item_id = ?').get(id) as { settled_at: number | null } | undefined;
const passOrder = (order_id: string) => hub.deps.db.prepare('SELECT ready_at, ready_by, ready_alert_id, ready_table_id FROM pass_orders WHERE order_id = ? AND point_id = ?').get(order_id, POINT);
const skipped = (): number => hub.logs().split('\n').filter((l) => l.includes('kds.fold_skipped')).length;

function dump(): Record<string, unknown[]> {
  const all = (sql: string) => hub.deps.db.prepare(sql).all();
  return {
    pass_orders: all('SELECT * FROM pass_orders ORDER BY order_id, point_id'),
    pass_ready_lines: all('SELECT * FROM pass_ready_lines ORDER BY order_id, point_id, order_item_id'),
    handovers: all('SELECT * FROM handovers ORDER BY handover_id'),
    handover_lines: all('SELECT * FROM handover_lines ORDER BY order_item_id'),
  };
}

/** Rebuilds `pass` alone from seq 0 (no checkpoint → reset), with every other projection at the tip (§5 catch-up). */
function rebuild(): Record<string, unknown[]> {
  hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'pass'`).run();
  const registry = createProjectionRegistry();
  registry.register(passProjection());
  const { replayed } = registry.catchUp(hub.deps.db, branch());
  expect(replayed.pass).toBeGreaterThan(0);
  return dump();
}

async function ownerSession(): Promise<{ deviceId: string; token: string; sessionToken: string }> {
  await seedDirectory(hub, await cookDirectory());
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId: 'S_OWNER', deviceId: device.deviceId });
  return { ...device, sessionToken: session.token };
}

let commandSeq = 0;
/** 02b's real ReturnToKitchen (§6.7) through the command route; Owner holds mark-item-returned at branch. */
async function returnToKitchen(who: { deviceId: string; token: string; sessionToken: string }, order_item_id: string, return_order_item_id: string) {
  commandSeq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: '/commands/return-to-kitchen',
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id: `ret-${commandSeq}`,
      tenant_id: 'tenant-a',
      branch_id: branch(),
      command_type: 'ReturnToKitchen',
      payload: { order_item_id, return_order_item_id, mode: 'remake' },
      occurred_at: hub.clock.branchNow(),
      actor_id: 'S_OWNER',
      device_id: who.deviceId,
    },
  });
  return { status: res.statusCode, body: res.json() as { data?: { event_ids: string[] }; error?: { code: string } } };
}

describe('[03b #30] pass projection: settling is idempotent', () => {
  it('[03b #30] hand over → serve → 02b remake return: the return command succeeds, open_lines stays 0', async () => {
    hub = await createTestHub({ provisioned: true });
    openDay(hub);
    const who = await ownerSession();
    const order_id = takeaway(['L1', 'L2']);
    cook(order_id, ['L1', 'L2']);
    handover(order_id, 'H1', ['L1', 'L2']);
    expect(handoverRow('H1').open_lines).toBe(2);

    serveLines(hub, order_id, ['L1', 'L2']);
    expect(handoverRow('H1').open_lines).toBe(0);
    const settledAt = handoverLine('L1').settled_at;
    expect(settledAt).not.toBeNull();
    expect(engine().lines.L1!.stage).toBe('served');

    const reply = await returnToKitchen(who, 'L1', 'R1');
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    expect(engine().lines.L1!.stage).toBe('returned');
    expect(handoverRow('H1').open_lines).toBe(0);
    expect(handoverLine('L1').settled_at).toBe(settledAt);
    expect(skipped()).toBe(0);
  });

  it('[03b #30] hand over → serve → void: no change the second time, open_lines stays 0', async () => {
    hub = await createTestHub({ provisioned: true });
    openDay(hub);
    const order_id = takeaway(['L1'], 2);
    cook(order_id, ['L1']);
    ready(order_id, ['L1'], 'A_READY');
    handover(order_id, 'H1', ['L1']);
    serveLines(hub, order_id, ['L1']);
    const before = dump();
    expect(handoverRow('H1').open_lines).toBe(0);
    expect(readyLine('L1')!.settled_at).not.toBeNull();

    voidLine(hub, order_id, 'L1', 2);
    expect(dump()).toEqual(before);
    expect(skipped()).toBe(0);
  });

  it('[03b #30] ItemRemoved { units } to 0 then a whole-line event: no change; a partial removal above 0 settles nothing', async () => {
    hub = await createTestHub({ provisioned: true });
    openDay(hub);
    const order_id = takeaway(['L1', 'L2'], 3);
    cook(order_id, ['L1', 'L2']);
    ready(order_id, ['L1', 'L2'], 'A_READY');
    handover(order_id, 'H1', ['L1', 'L2']);

    removeLine(hub, order_id, 'L1', 1);
    voidLine(hub, order_id, 'L2', 2);
    expect(handoverRow('H1').open_lines).toBe(2);
    expect(handoverLine('L1').settled_at).toBeNull();
    expect(readyLine('L2')!.settled_at).toBeNull();

    removeLine(hub, order_id, 'L1', 2); // live units 3 − 3 = 0
    expect(handoverRow('H1').open_lines).toBe(1);
    expect(handoverLine('L1').settled_at).not.toBeNull();
    expect(readyLine('L1')!.settled_at).not.toBeNull();
    const before = dump();

    removeLine(hub, order_id, 'L1'); // a whole-line event on a line already at 0
    serveLines(hub, order_id, ['L1']);
    expect(dump()).toEqual(before);
    expect(skipped()).toBe(0);
  });

  it('[03b #30] OrderCancelled settles every line of the order in both tables; the card stays open until closed', async () => {
    hub = await createTestHub({ provisioned: true });
    openDay(hub);
    const order_id = takeaway(['L1', 'L2', 'L3']);
    cook(order_id, ['L1', 'L2', 'L3']);
    ready(order_id, ['L1', 'L2', 'L3'], 'A_READY');
    handover(order_id, 'H1', ['L1']);
    handover(order_id, 'H2', ['L2', 'L3']);
    serveLines(hub, order_id, ['L2']);
    expect(handoverRow('H2').open_lines).toBe(1);

    append(hub, [on(order_id, 'OrderCancelled', { order_id })], { actor: 'S_MGR' });
    expect(handoverRow('H1').open_lines).toBe(0);
    expect(handoverRow('H2').open_lines).toBe(0);
    for (const id of ['L1', 'L2', 'L3']) expect(readyLine(id)!.settled_at, id).not.toBeNull();
    expect(handoverRow('H1').card_closed_at).toBeNull();
    expect(skipped()).toBe(0);
  });

  it('[03b #30] a settle that would break CHECK (open_lines >= 0) logs kds.fold_skipped and the fold does not throw', async () => {
    hub = await createTestHub({ provisioned: true });
    openDay(hub);
    const order_id = takeaway(['L1']);
    cook(order_id, ['L1']);
    handover(order_id, 'H1', ['L1']);
    // An inconsistent row (not reachable by events) stands in for a fold that would break the CHECK.
    hub.deps.db.prepare('UPDATE handovers SET open_lines = 0 WHERE handover_id = ?').run('H1');

    expect(() => serveLines(hub, order_id, ['L1'])).not.toThrow();
    expect(engine().lines.L1!.stage).toBe('served');
    expect(handoverRow('H1').open_lines).toBe(0);
    expect(skipped()).toBe(1);
    const line = hub.logs().split('\n').find((l) => l.includes('kds.fold_skipped'))!;
    expect(JSON.parse(line)).toMatchObject({ handover_id: 'H1', settled: 1 });
  });
});

describe('[03b §5] pass projection: Ready, Undo, re-target, alert close, hand-over rows', () => {
  it('[03b §5] ReadyToServe / AlertClosed / ReadyRetargeted / ReadyToServeUndone fold pass_orders and pass_ready_lines', async () => {
    hub = await createTestHub({ provisioned: true });
    openDay(hub);
    const order_id = takeaway(['L1', 'L2', 'L3']);
    cook(order_id, ['L1', 'L2']);

    ready(order_id, ['L1', 'L2'], 'A1', 'T2');
    const readyAt = hub.clock.branchNow();
    expect(passOrder(order_id)).toEqual({ ready_at: readyAt, ready_by: 'S_COOK', ready_alert_id: 'A1', ready_table_id: 'T2' });
    expect(readyLine('L1')).toEqual({ settled_at: null });
    expect(readyLine('L3')).toBeUndefined();

    append(hub, [on(order_id, 'ReadyRetargeted', { order_id, point_id: POINT, table_id: 'T1', alert_id: 'A2', previous_alert_id: 'A1' })], { actor: null, device: 'hub' });
    closeAlert('A1', 'obsolete'); // the previous alert's close does not touch the new one
    expect(passOrder(order_id)).toMatchObject({ ready_alert_id: 'A2', ready_table_id: 'T1', ready_at: readyAt });

    append(hub, [on(order_id, 'ReadyToServeUndone', { order_id, point_id: POINT, alert_id: 'A2' })], { actor: 'S_COOK' });
    expect(passOrder(order_id)).toEqual({ ready_at: null, ready_by: null, ready_alert_id: null, ready_table_id: null });
    expect(readyLine('L1')).toBeUndefined();

    // a new Ready replaces the lines of the earlier one; closing its alert keeps ready_at / ready_by
    cook(order_id, ['L3']);
    ready(order_id, ['L3'], 'A3');
    expect(readyLine('L1')).toBeUndefined();
    expect(readyLine('L3')).toEqual({ settled_at: null });
    closeAlert('A3');
    expect(passOrder(order_id)).toMatchObject({ ready_alert_id: null, ready_by: 'S_COOK' });
    expect(passOrder(order_id)).not.toMatchObject({ ready_at: null });
  });

  it('[03b §5] Handover inserts the card and its lines (open_lines = lines); AlertClosed of the card sets card_closed_at; a replayed handover_id changes nothing', async () => {
    hub = await createTestHub({ provisioned: true });
    openDay(hub);
    const order_id = takeaway(['L1', 'L2']);
    cook(order_id, ['L1', 'L2']);
    handover(order_id, 'H1', ['L1', 'L2'], 'A_CARD');
    const handedAt = hub.clock.branchNow();
    expect(hub.deps.db.prepare('SELECT * FROM handovers').all()).toEqual([
      { handover_id: 'H1', order_id, point_id: POINT, receiver_staff_id: 'S_WAIT', handed_at: handedAt, open_lines: 2, served_card_alert_id: 'A_CARD', card_closed_at: null },
    ]);
    expect(handoverLine('L2')).toEqual({ handover_id: 'H1', settled_at: null });

    const before = dump();
    handover(order_id, 'H1', ['L1', 'L2'], 'A_CARD');
    expect(dump()).toEqual(before);

    closeAlert('A_CARD');
    expect(handoverRow('H1').card_closed_at).toBe(hub.clock.branchNow());
    expect(handoverRow('H1').open_lines).toBe(2);
  });
});

describe('[03b #30] pass rebuild from seq 0 equals the live tables', () => {
  it('[03b #30, §5] a fixture day (Ready, re-target, undo, hand-overs, serve, return, remove, void, cancel, alert closes) rebuilds to the live tables', async () => {
    hub = await createTestHub({ provisioned: true });
    openDay(hub);
    const who = await ownerSession();

    const a = takeaway(['A1', 'A2', 'A3', 'A4'], 2);
    cook(a, ['A1', 'A2', 'A3', 'A4']);
    ready(a, ['A1', 'A2', 'A3'], 'RA1', 'T2');
    append(hub, [on(a, 'ReadyRetargeted', { order_id: a, point_id: POINT, table_id: 'T1', alert_id: 'RA2', previous_alert_id: 'RA1' })], { actor: null, device: 'hub' });
    closeAlert('RA1', 'obsolete');
    handover(a, 'HA1', ['A1', 'A2'], 'CA1');
    serveLines(hub, a, ['A1']);
    expect((await returnToKitchen(who, 'A1', 'A1r')).status).toBe(200);
    voidLine(hub, a, 'A2', 2);
    removeLine(hub, a, 'A3', 2); // whole units in one partial event
    closeAlert('CA1');
    handover(a, 'HA2', ['A4'], 'CA2', 'RA2');
    closeAlert('RA2');

    const b = takeaway(['B1', 'B2']);
    cook(b, ['B1', 'B2']);
    ready(b, ['B1', 'B2'], 'RB1');
    append(hub, [on(b, 'ReadyToServeUndone', { order_id: b, point_id: POINT, alert_id: 'RB1' })], { actor: 'S_COOK' });
    closeAlert('RB1', 'undone');
    ready(b, ['B1'], null);
    handover(b, 'HB1', ['B1'], 'CB1');
    append(hub, [on(b, 'OrderCancelled', { order_id: b })], { actor: 'S_MGR' });

    const live = dump();
    expect(live.handovers).toHaveLength(3);
    expect(live.pass_orders).toHaveLength(2);
    expect(skipped()).toBe(0);
    expect(rebuild()).toEqual(live);
    expect(skipped()).toBe(0);
  });

  it('[03b §5 catch-up] a line removed to 0 in two partial events: the rebuild reads order_lines at the tip, so it settles at the first one — same open_lines and settled rows, settled_at may be earlier', async () => {
    hub = await createTestHub({ provisioned: true });
    openDay(hub);
    const order_id = takeaway(['L1'], 2);
    cook(order_id, ['L1']);
    ready(order_id, ['L1'], 'A_READY');
    handover(order_id, 'H1', ['L1']);
    removeLine(hub, order_id, 'L1', 1);
    const firstRemoval = hub.clock.branchNow();
    removeLine(hub, order_id, 'L1', 1);
    const live = dump();
    expect(handoverLine('L1').settled_at).toBe(hub.clock.branchNow());

    const rebuilt = rebuild();
    expect(handoverLine('L1').settled_at).toBe(firstRemoval);
    const noTimes = (d: Record<string, unknown[]>) => ({
      ...d,
      pass_ready_lines: d.pass_ready_lines!.map((r) => ({ ...(r as object), settled_at: (r as { settled_at: number | null }).settled_at !== null })),
      handover_lines: d.handover_lines!.map((r) => ({ ...(r as object), settled_at: (r as { settled_at: number | null }).settled_at !== null })),
    });
    expect(noTimes(rebuilt)).toEqual(noTimes(live));
  });
});

describe('[03b §7] pass folds: fixed statement counts', () => {
  /** Statements of one `pass` fold of `event` on the current tables, rolled back afterwards (other projections excluded). */
  function foldStatements(stream_id: string, event_type: string, payload: Record<string, unknown>, stream_type: PosEvent['stream_type'] = 'order'): number {
    const event = {
      event_id: `E_COUNT_${event_type}`,
      tenant_id: 'tenant-a',
      branch_id: branch(),
      stream_type,
      stream_id,
      event_type,
      schema_version: 1,
      payload,
      occurred_at: hub.clock.branchNow(),
      recorded_at: hub.clock.branchNow(),
      actor_id: 'S_COOK',
      device_id: 'D_COUNT',
      seq: 1_000_000,
    } as PosEvent;
    const projection = passProjection();
    const before = dump();
    const counter = statementCounter(hub.deps.db);
    let n = -1;
    try {
      hub.deps.db.transaction(() => {
        counter.reset();
        projection.apply(hub.deps.db, event, 'live');
        n = counter.count;
        throw new Error('rollback');
      })();
    } catch (e) {
      if ((e as Error).message !== 'rollback') throw e;
    }
    expect(dump()).toEqual(before);
    return n;
  }

  it('[03b §7] ReadyToServe 3, Handover 3, AlertClosed 2, ItemServed over 3 hand-overs 3, OrderCancelled 3, partial ItemRemoved to 0 3 (and above 0 3)', async () => {
    hub = await createTestHub({ provisioned: true });
    openDay(hub);
    const order_id = takeaway(['L1', 'L2', 'L3', 'L4'], 2);
    cook(order_id, ['L1', 'L2', 'L3', 'L4']);
    ready(order_id, ['L1', 'L2', 'L3', 'L4'], 'A_READY');
    handover(order_id, 'H1', ['L1']);
    handover(order_id, 'H2', ['L2']);
    handover(order_id, 'H3', ['L3', 'L4']);
    removeLine(hub, order_id, 'L4', 1);

    expect(foldStatements(order_id, 'ReadyToServe', { order_id, point_id: POINT, order_item_ids: ['L1', 'L2', 'L3', 'L4'], table_id: null, alert_id: 'A_R2' })).toBe(3);
    expect(foldStatements(order_id, 'Handover', { handover_id: 'H9', order_id, point_id: POINT, receiver_staff_id: 'S_WAIT', order_item_ids: ['L5', 'L6'], alert_id: 'A_C9', ready_alert_closed: null })).toBe(3);
    expect(foldStatements('branch-1', 'AlertClosed', { alert_id: 'A_CARD_H1', reason: 'done', by_staff_id: null, note: null }, 'hub')).toBe(2);
    expect(foldStatements(order_id, 'ItemServed', { order_item_ids: ['L1', 'L2', 'L3'], source: 'tap' })).toBe(3);
    expect(foldStatements(order_id, 'OrderCancelled', { order_id })).toBe(3);
    expect(foldStatements(order_id, 'ItemRemoved', { order_item_id: 'L3', units: 1 })).toBe(3); // live 2 → not settled

    removeLine(hub, order_id, 'L4', 1); // order_lines live units of L4 now 0; the real fold settled it
    expect(handoverRow('H3').open_lines).toBe(1);
    hub.deps.db.prepare('UPDATE handover_lines SET settled_at = NULL WHERE order_item_id = ?').run('L4'); // measure the settling path
    hub.deps.db.prepare('UPDATE handovers SET open_lines = 2 WHERE handover_id = ?').run('H3');
    expect(foldStatements(order_id, 'ItemRemoved', { order_item_id: 'L4', units: 1 })).toBe(3);
    expect(foldStatements(order_id, 'ReadyToServeUndone', { order_id, point_id: POINT, alert_id: 'A_READY' })).toBe(2);
    expect(foldStatements(order_id, 'ReadyRetargeted', { order_id, point_id: POINT, table_id: 'T1', alert_id: 'A_R3', previous_alert_id: 'A_READY' })).toBe(1);
  });
});
