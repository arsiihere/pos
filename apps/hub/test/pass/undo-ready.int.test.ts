import type { EngineState } from '@pos/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import type { CommandCtx } from '../../src/commands/registry';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { provideKds, undoReadyForLines as contractUndoReady } from '../../src/kds/contracts';
import { undoDoneCommand } from '../../src/kds/commands/undo-done';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, type TestHub } from '../helpers/test-hub';
import { COOK, FX, append, appendOrder, fireLines, openDay, pairKds, signInCook } from '../kds/fixtures';

// 03b §3.2 UndoDone step 5 (b9b): the Ready part, contract `undoReadyForLines` (kds/contracts.ts), provided by lane
// B4's register; test #8 through 02b-style real flow: Ready by the real MarkReadyToServe, UndoDone by a real station
// session. §6.3 Statements 2 (UndoDone's Handover read + this Ready read) + 01d's close.

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;
let alertStatements = 0;
const POINT = 'P1';
const engine = (): EngineState => hub.deps.state.get() as EngineState;

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  commandRegistry(hub.app).register(
    defineCommand({
      ...undoDoneCommand,
      commandType: 'TestUndoDoneCounted',
      handle(ctx, payload, cmd) {
        const before = counter.count;
        alertStatements = 0;
        try {
          return undoDoneCommand.handle(ctx, payload, cmd);
        } finally {
          lastStatements = counter.count - before - alertStatements;
        }
      },
    }),
  );
  counter = statementCounter(hub.deps.db);
  for (const name of ['close', 'closeMany'] as const) {
    const original = alerts[name] as (...args: unknown[]) => unknown;
    vi.spyOn(alerts, name).mockImplementation(((...args: unknown[]) => {
      const before = counter.count;
      try {
        return original(...args);
      } finally {
        alertStatements += counter.count - before;
      }
    }) as never);
  }
  openDay(hub);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await hub.close();
});

const on = (order_id: string, event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, payload });
function cook(order_id: string, ids: string[]): void {
  fireLines(hub, FX.station, ids);
  append(hub, ids.map((order_item_id) => on(order_id, 'ItemStarted', { order_item_id, started_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
  append(hub, ids.map((order_item_id) => on(order_id, 'ItemDone', { order_item_id, done_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
}
const takeaway = (ids: string[]) => appendOrder(hub, { order_type: 'takeaway', lines: ids.map((order_item_id) => ({ order_item_id, item_id: FX.naan })) }).order_id;

interface Who {
  staffId: string | null;
  deviceId: string;
  token: string;
  sessionToken: string;
}
let seq = 0;
async function send(who: Who, url: string, command_type: string, payload: Record<string, unknown>) {
  seq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${url}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: { command_id: `c-${seq}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type, payload, occurred_at: hub.clock.branchNow(), actor_id: who.staffId, device_id: who.deviceId },
  });
  const body = res.json() as { data?: { event_ids: string[]; result: Record<string, unknown> }; error?: { code: string } };
  const events =
    body.data === undefined
      ? []
      : (
          hub.deps.db
            .prepare(`SELECT event_type, actor_id, device_id, payload AS p FROM events WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY seq`)
            .all(JSON.stringify(body.data.event_ids)) as Array<{ event_type: string; actor_id: string | null; device_id: string; p: string }>
        ).map(({ p, ...rest }) => ({ ...rest, payload: JSON.parse(p) as Record<string, unknown> }));
  return { status: res.statusCode, result: body.data?.result, events, error: body.error };
}
async function cookWho(): Promise<Who> {
  const c = await signInCook(hub, { pointId: POINT });
  return { staffId: COOK.staff, deviceId: c.deviceId, token: c.token, sessionToken: c.sessionToken };
}
function station(): Who {
  const device = pairKds(hub, { stationId: FX.station });
  const session = openSession(hub, { kind: 'station', stationId: FX.station, deviceId: device.deviceId });
  return { staffId: null, deviceId: device.deviceId, token: device.token, sessionToken: session.token };
}
const alertState = (id: string) => hub.deps.db.prepare('SELECT state, close_reason FROM alerts WHERE alert_id = ?').get(id);

describe('[03b #8] UndoDone of a Ready line (b9b undoReadyForLines)', () => {
  it('[03b #8] → ReadyToServeUndone + alert closed undone, station envelope; result ready_undone; §6.3 2 statements', async () => {
    const pass = await cookWho();
    const kds = station();
    const order_id = takeaway(['L1', 'L2']);
    cook(order_id, ['L1', 'L2']);
    const ready = await send(pass, 'mark-ready-to-serve', 'MarkReadyToServe', { order_id, point_id: POINT });
    const alert_id = ready.result!.alert_id as string;

    const r = await send(kds, 'test-undo-done-counted', 'TestUndoDoneCounted', { order_item_id: 'L1' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(lastStatements).toBe(2);
    expect(r.result).toEqual({ undone: ['L1'], ready_undone: [{ order_id, point_id: POINT }] });
    expect(r.events.map((e) => e.event_type)).toEqual(['ItemDoneUndone', 'ReadyToServeUndone', 'AlertClosed']);
    expect(r.events[1]).toMatchObject({ actor_id: null, device_id: kds.deviceId, payload: { order_id, point_id: POINT, alert_id } });
    expect(r.events[2]!.payload).toMatchObject({ alert_id, reason: 'undone' });
    expect(alertState(alert_id)).toEqual({ state: 'closed', close_reason: 'undone' });
    expect(hub.deps.db.prepare('SELECT ready_alert_id FROM pass_orders WHERE order_id = ?').get(order_id)).toEqual({ ready_alert_id: null });
    expect(engine().lines.L1!.stage).toBe('cooking');
  });

  it('[03b §3.2 step 5] a line in no open Ready → no Ready drafts (closed Ready, settled line, other order)', async () => {
    const pass = await cookWho();
    const kds = station();
    const a = takeaway(['A1']);
    cook(a, ['A1']);
    const r = await send(kds, 'test-undo-done-counted', 'TestUndoDoneCounted', { order_item_id: 'A1' });
    expect(r.result).toEqual({ undone: ['A1'], ready_undone: [] });
    expect(lastStatements).toBe(2);

    const b = takeaway(['B1']);
    cook(b, ['B1']);
    const alert_id = (await send(pass, 'mark-ready-to-serve', 'MarkReadyToServe', { order_id: b, point_id: POINT })).result!.alert_id as string;
    append(hub, [{ stream_type: 'hub', stream_id: 'branch-1', event_type: 'AlertClosed', payload: { alert_id, reason: 'done', by_staff_id: null, note: null } }], { actor: null, device: 'hub' });
    const r2 = await send(kds, 'undo-done', 'UndoDone', { order_item_id: 'B1' });
    expect(r2.result).toEqual({ undone: ['B1'], ready_undone: [] });
    expect(r2.events.map((e) => e.event_type)).toEqual(['ItemDoneUndone']);
  });
});

describe('[03b §4.2] contract wiring', () => {
  it('[03b §4.2, b9b] after the server build (provideKds in lane B4 register) the contract runs the real undoReadyForLines: 1 statement, real Ready drafts', async () => {
    const pass = await cookWho();
    const order_id = takeaway(['L1']);
    cook(order_id, ['L1']);
    const alert_id = (await send(pass, 'mark-ready-to-serve', 'MarkReadyToServe', { order_id, point_id: POINT })).result!.alert_id as string;
    let out: ReturnType<typeof contractUndoReady> | undefined;
    let statements = -1;
    try {
      hub.deps.writer.run((tx) => {
        const ctx = { tx, clock: hub.clock, actor: { staffId: null, deviceId: 'D_K' }, directory: undefined } as unknown as CommandCtx;
        counter.reset();
        alertStatements = 0;
        out = contractUndoReady(ctx, ['L1']);
        statements = counter.count - alertStatements;
        throw new Error('rollback');
      });
    } catch (e) {
      if ((e as Error).message !== 'rollback') throw e;
    }
    expect(statements).toBe(1);
    expect(out!.ready_undone).toEqual([{ order_id, point_id: POINT }]);
    expect(out!.events.map((e) => e.event_type)).toEqual(['ReadyToServeUndone', 'AlertClosed']);
    expect(out!.events[0]!.payload).toEqual({ order_id, point_id: POINT, alert_id });

    // the phase-0 no-op is what the contract falls back to without a provider
    provideKds({ undoReadyForLines: undefined });
    expect(contractUndoReady({} as never, ['L1'])).toEqual({ events: [], ready_undone: [] });
  });
});
