// ⚠️ 03b v1.0.16 §3.10 "Pass archive (D7)", §6.22, §11 task 51, test 132 (hub part); 01a v2.11 §6.9a Archive (R3-B-1);
// 03a v1.2.11 §3.3 D7 fold, test 195 (hub part). A real config apply (the poller, a stub cloud) whose snapshot archives a
// Pass point: the same commit holds BranchConfigApplied and one PassPointLinesMoved per affected order; the engine
// lines move to the point routePoint picks among the incoming active points (a routing-only point; a station default
// with the effective active fallback); an old point Ready whose lines all moved is closed `obsolete` and its memberships
// dropped; stage and hand-overs stay; a later config does not move them back (live = full rebuild). With no active
// destination the apply is refused and nothing commits.
import { initialEngineState, type EngineState } from '@pos/engine';
import { ConfigStatusResponse, type BranchConfig, type PosEvent } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { replayEngine } from '../../src/engine-host/replay';
import { buildLineDetails } from '../../src/kds/contracts';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { configPoller } from '../../src/sync/config-poller';
import { stubConfigCloud, type StubConfigCloud } from '../helpers/stub-config-cloud';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { fakeReturnDrafts } from '../engine/fakes';
import { COOK, FX, append, appendOrder, fireLines, fixtureMenu, openDay, serveLines, signInCook } from '../kds/fixtures';

const BRANCH = 'branch-1';
const CONFIRMED = { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'key-1', confirmed_at: 1 };

let hub: TestHub;
let cloud: StubConfigCloud;
beforeEach(async () => {
  cloud = stubConfigCloud();
  hub = await createTestHub({ configClient: cloud, config: { provisioned: { ...CONFIRMED } } });
});
const sockets: WsClient[] = [];
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  swapBranchConfig(null);
  await hub.close();
});

const engine = (): EngineState => hub.deps.state.get();
const point = (point_id: string, name: string, sort_order: number, o: Partial<BranchConfig['points'][number]> = {}) => ({ point_id, name, sort_order, is_archived: false, ...o });

/** fixtureMenu with Main (all) and a Takeaway Pass; S1's default `s1Point`; S1 carries 30 s to TA, 0 to Main. */
function menu(version: number, o: { s1Point: string; ta?: Partial<BranchConfig['points'][number]>; main?: Partial<BranchConfig['points'][number]> }): BranchConfig {
  const base = fixtureMenu();
  return {
    ...base,
    branch_id: BRANCH,
    config_version: version,
    points: [point('MAIN', 'Main Pass', 0, o.main), point('TA', 'Takeaway Pass', 1, { order_types: ['takeaway'], ...o.ta })],
    stations: base.stations.map((s) => ({
      ...s,
      point_id: s.station_id === FX.station ? o.s1Point : 'MAIN',
      carry_times: [{ point_id: 'TA', carry_ms: 30_000 }, { point_id: 'MAIN', carry_ms: 0 }],
    })),
  };
}
async function apply(config: BranchConfig) {
  cloud.respondWithSnapshot(config as unknown as Record<string, unknown>);
  return configPoller(hub.app).pollOnce();
}
const lastCommit = (): PosEvent[] => hub.published.at(-1) ?? [];
const withoutDiagnostics = (s: EngineState) => ({ ...s, diagnostics: [] });

describe('[03b #132, 03a #195] D7: a config apply that archives a Pass moves its outstanding work in the same commit', () => {
  it('a routing-only point: cooking and returned lines move to Main with the carry facts and source name; its Ready alert closes obsolete; a later config keeps them; live = rebuild', async () => {
    const pass = await signInCook(hub, { pointId: 'TA' });
    // Orders placed while S1's default was TA (their lines record TA); then an ordinary edit makes Main S1's default.
    openDay(hub, { menu: menu(1, { s1Point: 'TA' }) });
    const o1 = appendOrder(hub, { order_type: 'takeaway', order_id: 'O1', lines: [{ order_item_id: 'A1', item_id: FX.naan }, { order_item_id: 'A2', item_id: FX.naan }] });
    expect(engine().lines.A1).toMatchObject({ point_id: 'TA' });
    fireLines(hub, FX.station, ['A1']);
    append(hub, [{ stream_type: 'order', stream_id: 'O1', event_type: 'ItemStarted', payload: { order_item_id: 'A1', started_at: hub.clock.branchNow(), source: 'tap' } }]);
    // A2 cooked, served and returned (remake): the return line A2R is outstanding at TA.
    fireLines(hub, FX.station, ['A2']);
    append(hub, [
      { stream_type: 'order', stream_id: 'O1', event_type: 'ItemStarted', payload: { order_item_id: 'A2', started_at: hub.clock.branchNow(), source: 'tap' } },
      { stream_type: 'order', stream_id: 'O1', event_type: 'ItemDone', payload: { order_item_id: 'A2', done_at: hub.clock.branchNow(), source: 'tap' } },
    ]);
    serveLines(hub, 'O1', ['A2']);
    const a2Added = o1.events.find((e) => e.event_type === 'ItemAdded' && (e.payload as { order_item_id: string }).order_item_id === 'A2')!;
    // The return line records the served line's point (02b PT-R1's return routing is not built: set here).
    hub.deps.writer.run((tx) =>
      tx.append(
        fakeReturnDrafts(tx.state as EngineState, a2Added, 'remake', tx.clock.branchNow()).map((d) =>
          d.event_type !== 'OrderLinesAdded' ? d : { ...d, payload: { ...d.payload, lines: (d.payload.lines as Array<Record<string, unknown>>).map((l) => ({ ...l, point_id: 'TA' })) } },
        ),
      ),
    );
    expect(engine().lines.A2R).toMatchObject({ point_id: 'TA', stage: 'added' });
    // A1 done and marked Ready at TA (its alert open).
    append(hub, [{ stream_type: 'order', stream_id: 'O1', event_type: 'ItemDone', payload: { order_item_id: 'A1', done_at: hub.clock.branchNow(), source: 'tap' } }]);
    const ready = await hub.app.inject({
      method: 'POST',
      url: '/commands/mark-ready-to-serve',
      headers: { authorization: `Bearer ${pass.token}`, 'x-session-token': pass.sessionToken },
      payload: { command_id: 'ready-1', tenant_id: 'tenant-a', branch_id: BRANCH, command_type: 'MarkReadyToServe', payload: { order_id: 'O1', point_id: 'TA' }, occurred_at: hub.clock.branchNow(), actor_id: COOK.staff, device_id: pass.deviceId },
    });
    expect(ready.statusCode, ready.body).toBe(200);
    const alertId = (hub.deps.db.prepare("SELECT ready_alert_id FROM pass_orders WHERE order_id = 'O1' AND point_id = 'TA'").get() as { ready_alert_id: string }).ready_alert_id;
    expect(alertId).toEqual(expect.any(String));
    expect((await apply(menu(2, { s1Point: 'MAIN' }))).outcome).toBe('applied');
    expect(engine().lines.A1!.point_id).toBe('TA'); // an ordinary edit leaves recorded points in place
    const before = { A1: engine().lines.A1!, A2R: engine().lines.A2R! };

    expect((await apply(menu(3, { s1Point: 'MAIN', ta: { is_archived: true } }))).outcome).toBe('applied');
    const commit = lastCommit();
    expect(commit.map((e) => e.event_type)).toEqual(expect.arrayContaining(['BranchConfigApplied', 'PassPointLinesMoved']));
    const moved = commit.filter((e) => e.event_type === 'PassPointLinesMoved');
    expect(moved).toHaveLength(1);
    expect(moved[0]!.payload).toEqual({
      order_id: 'O1',
      moves: [
        { order_item_id: 'A1', from_point_id: 'TA', from_point_name: 'Takeaway Pass', to_point_id: 'MAIN', carry_ms: 0, alternates: [] },
        { order_item_id: 'A2R', from_point_id: 'TA', from_point_name: 'Takeaway Pass', to_point_id: 'MAIN', carry_ms: 0, alternates: [] },
      ],
    });
    for (const id of ['A1', 'A2R'] as const) {
      expect(engine().lines[id], id).toMatchObject({ point_id: 'MAIN', carry_ms: 0, from_point_id: 'TA', from_point_name: 'Takeaway Pass', stage: before[id].stage, booked: before[id].booked });
    }
    // The old Ready had only A1: its alert closed obsolete in the same commit and its membership dropped.
    const closed = commit.filter((e) => e.event_type === 'AlertClosed').map((e) => e.payload as { alert_id: string; reason: string });
    expect(closed).toEqual(expect.arrayContaining([expect.objectContaining({ alert_id: alertId, reason: 'obsolete' })]));
    expect(hub.deps.db.prepare("SELECT count(*) AS n FROM pass_ready_lines WHERE settled_at IS NULL AND point_id = 'TA'").get()).toEqual({ n: 0 });

    // The receiving Pass shows "Moved from Takeaway Pass" (LineDetail.moved_from; absent on a line never moved).
    const details = buildLineDetails(hub.deps.db, engine(), ['A1', 'A2R', 'A2']);
    expect(details.get('A1')).toMatchObject({ point_id: 'MAIN', moved_from: 'Takeaway Pass' });
    expect(details.get('A2R')).toMatchObject({ point_id: 'MAIN', moved_from: 'Takeaway Pass' });
    expect(details.get('A2')).not.toHaveProperty('moved_from');

    // Routing changes again (TA restored and now taking every type): nothing moves back; live = full rebuild.
    expect((await apply(menu(4, { s1Point: 'MAIN', ta: { order_types: 'all' } }))).outcome).toBe('applied');
    expect(lastCommit().some((e) => e.event_type === 'PassPointLinesMoved')).toBe(false);
    expect(engine().lines.A1).toMatchObject({ point_id: 'MAIN', from_point_name: 'Takeaway Pass' });
    const rebuilt = replayEngine(hub.deps.db, BRANCH, 0, initialEngineState(), () => undefined).state;
    expect(withoutDiagnostics(rebuilt)).toEqual(withoutDiagnostics(engine()));
  });

  it("a station's default Pass: its lines move to the effective active fallback by order type", async () => {
    openDay(hub, { menu: menu(1, { s1Point: 'MAIN', ta: { order_types: 'all' } }) });
    appendOrder(hub, { order_type: 'takeaway', order_id: 'O2', lines: [{ order_item_id: 'B1', item_id: FX.naan }] });
    expect(engine().lines.B1!.point_id).toBe('MAIN');
    expect((await apply(menu(2, { s1Point: 'MAIN', ta: { order_types: 'all' }, main: { is_archived: true } }))).outcome).toBe('applied');
    expect(engine().lines.B1).toMatchObject({ point_id: 'TA', carry_ms: 30_000, from_point_id: 'MAIN', from_point_name: 'Main Pass' });
  });

  it('no active destination: the apply is refused, nothing commits (no move, no BranchConfigApplied, the last config kept)', async () => {
    openDay(hub, { menu: menu(1, { s1Point: 'MAIN' }) });
    appendOrder(hub, { order_type: 'takeaway', order_id: 'O3', lines: [{ order_item_id: 'C1', item_id: FX.naan }] });
    const line = engine().lines.C1!;
    const seq = hub.deps.writer.lastSeq();
    const result = await apply(menu(2, { s1Point: 'MAIN', main: { is_archived: true }, ta: { is_archived: true } }));
    expect(result).toMatchObject({ outcome: 'rejected', reason: 'apply_failed' });
    // 01a §6.21 (R3-B-1): config status reports apply_failed with the §6.9a code and details.issues.
    const problem = configPoller(hub.app).lastProblem();
    expect(problem).toMatchObject({ outcome: 'rejected', reason: 'apply_failed', code: 'VALIDATION_FAILED', details: { issues: [{ path: 'archived', message: 'Activate another Pass point first' }] } });
    expect(ConfigStatusResponse.shape.data.shape.last_problem.parse(problem)).toEqual(problem);
    expect(branchConfig()?.config_version).toBe(1);
    expect(hub.deps.db.prepare("SELECT count(*) AS n FROM events WHERE seq > ? AND event_type IN ('BranchConfigApplied', 'PassPointLinesMoved')").get(seq)).toEqual({ n: 0 });
    expect(engine().lines.C1).toEqual(line);
  });

  it('[03b §6.16 R3-M-1] after the commit, Pass sockets at the moved-from and moved-to points get point_view_refresh { as_of_seq, view }: null on the archived point, the new view (with the moved lines and moved_from) on the receiving one', async () => {
    const atTa = await signInCook(hub, { pointId: 'TA' });
    const atMain = await signInCook(hub, { pointId: 'MAIN' });
    openDay(hub, { menu: menu(1, { s1Point: 'TA' }) });
    appendOrder(hub, { order_type: 'takeaway', order_id: 'O4', lines: [{ order_item_id: 'D1', item_id: FX.naan }] });
    expect((await apply(menu(2, { s1Point: 'MAIN' }))).outcome).toBe('applied');
    const connect = async (who: { token: string; sessionToken: string }) => {
      const ws = await connectWs(hub.app);
      sockets.push(ws);
      ws.send({ type: 'auth', device_token: who.token, session_token: who.sessionToken });
      await ws.untilCount(1);
      return ws;
    };
    const ta = await connect(atTa);
    const main = await connect(atMain);
    expect((await apply(menu(3, { s1Point: 'MAIN', ta: { is_archived: true } }))).outcome).toBe('applied');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const lastSeq = hub.deps.writer.lastSeq();
    const refresh = (ws: WsClient) => ws.messages.filter((m) => (m as { type?: string }).type === 'point_view_refresh') as Array<{ as_of_seq: number; view: { point_id: string; orders: Array<{ lines: Array<{ order_item_id: string; moved_from?: string }> }> } | null }>;
    expect(refresh(ta)).toEqual([{ type: 'point_view_refresh', as_of_seq: lastSeq, view: null }]);
    const got = refresh(main);
    expect(got).toHaveLength(1);
    expect(got[0]!.as_of_seq).toBe(lastSeq);
    expect(got[0]!.view!.point_id).toBe('MAIN');
    expect(got[0]!.view!.orders.flatMap((o) => o.lines)).toEqual([expect.objectContaining({ order_item_id: 'D1', moved_from: 'Takeaway Pass' })]);
  });

  it('[03b #130] an ordinary routing edit (TA takeaway → parking) leaves an existing takeaway line at TA; a carry edit for TA recalculates its hidden line from TA; cold replay agrees', async () => {
    openDay(hub, { menu: menu(1, { s1Point: 'TA' }) });
    // A pickup two hours ahead: its line stays hidden and unfired on the (Waada Guard) station.
    appendOrder(hub, { order_type: 'takeaway', order_id: 'O5', pickup_at_ms: hub.clock.branchNow() + 7_200_000, lines: [{ order_item_id: 'E1', item_id: FX.naan }] });
    expect(engine().lines.E1).toMatchObject({ point_id: 'TA', fired_at: null });
    const edited = menu(2, { s1Point: 'MAIN', ta: { order_types: ['parking'] } });
    edited.stations = edited.stations.map((st) => (st.station_id === FX.station ? { ...st, carry_times: [{ point_id: 'TA', carry_ms: 45_000 }, { point_id: 'MAIN', carry_ms: 0 }] } : st));
    expect((await apply(edited)).outcome).toBe('applied');
    expect(lastCommit().some((e) => e.event_type === 'PassPointLinesMoved')).toBe(false);
    expect(engine().lines.E1).toMatchObject({ point_id: 'TA', carry_ms: 45_000, from_point_id: null });
    const rebuilt = replayEngine(hub.deps.db, BRANCH, 0, initialEngineState(), () => undefined).state;
    expect(withoutDiagnostics(rebuilt)).toEqual(withoutDiagnostics(engine()));
  });
});

// ⚠️ 03b v1.0.16 test 132 (R3-M-1): "Cold and checkpoint replay restore recorded moves and labels under later config",
// the checkpoint half with a real day close (the after-commit checkpoint of 03a §3.12). L-CLOSE-1.
describe('[03b #132 checkpoint] D7 moves restore from a day-close checkpoint plus replay', () => {
  it('day 1 closes (checkpoint written); day 2 a TA line moves to Main on archive; a later config; checkpoint + replay = live, moved_from kept', async () => {
    const { ORDER_EXIT_AFTER_SERVED_MS } = await import('@pos/engine');
    const { loadEngineBase } = await import('../../src/engine-host/replay');
    openDay(hub, { menu: menu(1, { s1Point: 'TA' }) });
    // day 1: an order served and out of the engine, then the day closes → the D26 checkpoint
    appendOrder(hub, { order_type: 'takeaway', order_id: 'D1', lines: [{ order_item_id: 'D1a', item_id: FX.naan }] });
    fireLines(hub, FX.station, ['D1a']);
    append(hub, [{ stream_type: 'order', stream_id: 'D1', event_type: 'ItemDone', payload: { order_item_id: 'D1a', done_at: hub.clock.branchNow(), source: 'tap' } }]);
    serveLines(hub, 'D1', ['D1a']);
    hub.clock.advance(ORDER_EXIT_AFTER_SERVED_MS + 60_000);
    append(hub, [{ stream_type: 'hub', stream_id: BRANCH, event_type: 'BusinessDayClosed', payload: {} }], { actor: null });
    const checkpoint = hub.deps.db.prepare('SELECT last_seq FROM engine_checkpoints WHERE branch_id = ? ORDER BY last_seq DESC LIMIT 1').get(BRANCH) as { last_seq: number } | undefined;
    expect(checkpoint).toBeDefined();

    // day 2: a line recorded at TA, then TA archived (moves to Main), then a later routing change
    hub.clock.advance(24 * 3_600_000);
    openDay(hub, { menu: menu(10, { s1Point: 'TA' }) });
    appendOrder(hub, { order_type: 'takeaway', order_id: 'O2', lines: [{ order_item_id: 'B1', item_id: FX.naan }] });
    fireLines(hub, FX.station, ['B1']);
    expect(engine().lines.B1).toMatchObject({ point_id: 'TA' });
    expect((await apply(menu(11, { s1Point: 'MAIN', ta: { is_archived: true } }))).outcome).toBe('applied');
    expect(engine().lines.B1).toMatchObject({ point_id: 'MAIN', from_point_name: 'Takeaway Pass' });
    expect((await apply(menu(12, { s1Point: 'MAIN', ta: { order_types: 'all' } }))).outcome).toBe('applied');

    // cold replay and checkpoint + replay reproduce the points and carry facts
    const cold = replayEngine(hub.deps.db, BRANCH, 0, initialEngineState(), () => undefined).state;
    expect(withoutDiagnostics(cold)).toEqual(withoutDiagnostics(engine()));
    const base = loadEngineBase(hub.deps.db, BRANCH, () => undefined);
    expect(base.checkpoint_seq).toBe(checkpoint!.last_seq);
    expect(base.snapshot_seq).toBeNull();
    const restored = replayEngine(hub.deps.db, BRANCH, base.checkpoint_seq!, base.state!, () => undefined).state;
    expect(restored.lines.B1).toMatchObject({ point_id: 'MAIN', from_point_id: 'TA', from_point_name: 'Takeaway Pass' });
    expect(withoutDiagnostics(restored)).toEqual(withoutDiagnostics(engine()));
    expect(buildLineDetails(hub.deps.db, restored, ['B1']).get('B1')).toMatchObject({ point_id: 'MAIN', moved_from: 'Takeaway Pass' });
  });
});

// ---- 02b-tk L-CLOSE-3: 03b v1.0.16 test 130 open parts (R3-M-7): alternate carry, non-FIFO, the inherited return, checkpoint replay ----

describe('[03b #130] routing and carry edits on a hidden TA line with an alternate', () => {
  it('a carry edit for TA (primary and alternate rows) recalculates the hidden, unfired line on its non-FIFO station from TA; a move to its alternate keeps TA; its return inherits TA while TA is active; checkpoint + replay = live', async () => {
    const { seedDirectory, openSession, pairDevice } = await import('../helpers/test-hub');
    const { aDirectory } = await import('../helpers/fixtures');
    const { ORDER_EXIT_AFTER_SERVED_MS } = await import('@pos/engine');
    const { loadEngineBase } = await import('../../src/engine-host/replay');
    await seedDirectory(hub, await aDirectory());
    /** S1 (Waada Guard) with S2 as its takeaway alternate; both carry to TA. */
    const withAlt = (version: number, carry: { s1: number; s2: number }, o: Parameters<typeof menu>[1] = { s1Point: 'TA' }, s1: { capacity?: number; reserve_units?: number; s2Home?: boolean } = {}): BranchConfig => {
      const m = menu(version, o);
      return {
        ...m,
        stations: m.stations.map((st) => ({
          ...st,
          policy: 'waada_guard' as const,
          ...(st.station_id === FX.station
            ? {
                ...(s1.capacity === undefined ? {} : { capacity: s1.capacity, reserve_units: s1.reserve_units ?? 0 }),
                alternates: [{ station_id: FX.zoneStation, order_types: ['takeaway' as const], home_for_order_types: s1.s2Home === true ? ['takeaway' as const] : [] }],
              }
            : {}),
          carry_times: [{ point_id: 'TA', carry_ms: st.station_id === FX.station ? carry.s1 : carry.s2 }, { point_id: 'MAIN', carry_ms: 0 }],
        })),
      };
    };
    openDay(hub, { menu: withAlt(1, { s1: 30_000, s2: 20_000 }) });
    // day 1 closes with nothing in the kitchen: the day-close checkpoint
    append(hub, [{ stream_type: 'hub', stream_id: BRANCH, event_type: 'BusinessDayClosed', payload: {} }], { actor: null });
    hub.clock.advance(ORDER_EXIT_AFTER_SERVED_MS);
    const checkpoint = hub.deps.db.prepare('SELECT last_seq FROM engine_checkpoints ORDER BY last_seq DESC LIMIT 1').get() as { last_seq: number } | undefined;
    expect(checkpoint).toBeDefined();
    hub.clock.advance(24 * 3_600_000);
    openDay(hub, { menu: withAlt(1, { s1: 30_000, s2: 20_000 }) });
    const device = pairDevice(hub, { type: 'tablet' });
    const session = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: device.deviceId });
    const submit = await hub.app.inject({
      method: 'POST',
      url: '/commands/submit-order',
      headers: { authorization: `Bearer ${device.token}`, 'x-session-token': session.token },
      payload: { command_id: 'c130', tenant_id: 'tenant-a', branch_id: BRANCH, command_type: 'SubmitOrder', payload: { order_id: 'O130', order_type: 'takeaway', pickup_at_ms: hub.clock.branchNow() + 7_200_000, lines: [{ order_item_id: 'E1', item_id: FX.naan, quantity: 1 }] }, occurred_at: hub.clock.branchNow(), actor_id: 'S_MGR', device_id: device.deviceId },
    });
    expect(submit.statusCode, submit.body).toBe(200);
    expect(engine().lines.E1).toMatchObject({ point_id: 'TA', carry_ms: 30_000, fired_at: null, alternates: [{ station_id: FX.zoneStation, carry_ms: 20_000 }] });
    // edit both carry rows to TA (and make TA parking-only): the hidden line stays at TA and recalculates both carries
    expect((await apply(withAlt(2, { s1: 45_000, s2: 50_000 }, { s1Point: 'MAIN', ta: { order_types: ['parking'] } }))).outcome).toBe('applied');
    expect(lastCommit().some((e) => e.event_type === 'PassPointLinesMoved')).toBe(false);
    expect(engine().lines.E1).toMatchObject({ point_id: 'TA', carry_ms: 45_000, alternates: [{ station_id: FX.zoneStation, carry_ms: 50_000 }] });
    expect(engine().config!.stations.find((s) => s.station_id === engine().lines.E1!.station_id)!.policy).not.toBe('fifo');
    // S2 becomes the takeaway home and all of S1 is reserved (a capacity change re-plans S1): E1 moves to its alternate
    // and keeps TA, with S2's TA carry
    expect((await apply(withAlt(3, { s1: 45_000, s2: 50_000 }, { s1Point: 'MAIN', ta: { order_types: ['parking'] } }, { capacity: 1, reserve_units: 1, s2Home: true }))).outcome).toBe('applied');
    expect(lastCommit().some((e) => e.event_type === 'PassPointLinesMoved')).toBe(false);
    expect(engine().lines.E1).toMatchObject({ station_id: FX.zoneStation, point_id: 'TA', carry_ms: 50_000, alternates: [{ station_id: FX.station, carry_ms: 45_000 }] });
    // cook, serve and return E1: the return inherits TA (still active, now parking-only) with its station's TA carry
    const { serveLines } = await import('../kds/fixtures');
    const st = engine().lines.E1!.station_id;
    hub.clock.set(Math.max(engine().lines.E1!.fire_ms!, hub.clock.branchNow()));
    const at = hub.clock.branchNow();
    hub.deps.writer.run((tx) =>
      tx.append([
        { stream_type: 'station', stream_id: st, event_type: 'FireDispatched', schema_version: 1, payload: { station_id: st, order_item_ids: ['E1'], load_id: null, due_at: at, reason: 'pulled' }, occurred_at: at, actor_id: null, device_id: 'hub' },
        { stream_type: 'order', stream_id: 'O130', event_type: 'ItemStarted', schema_version: 1, payload: { order_item_id: 'E1', started_at: at, source: 'tap' }, occurred_at: at, actor_id: null, device_id: 'hub' },
        { stream_type: 'order', stream_id: 'O130', event_type: 'ItemDone', schema_version: 1, payload: { order_item_id: 'E1', done_at: at, source: 'tap' }, occurred_at: at, actor_id: null, device_id: 'hub' },
      ]),
    );
    serveLines(hub, 'O130', ['E1']);
    const device2 = pairDevice(hub, { type: 'tablet' }); // the clock moved past the first session
    const later = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: device2.deviceId });
    const ret = await hub.app.inject({
      method: 'POST',
      url: '/commands/return-to-kitchen',
      headers: { authorization: `Bearer ${device2.token}`, 'x-session-token': later.token },
      payload: { command_id: 'c130r', tenant_id: 'tenant-a', branch_id: BRANCH, command_type: 'ReturnToKitchen', payload: { order_item_id: 'E1', return_order_item_id: 'E1R', mode: 'remake' }, occurred_at: hub.clock.branchNow(), actor_id: 'S_MGR', device_id: device2.deviceId },
    });
    expect(ret.statusCode, ret.body).toBe(200);
    const r = engine().lines.E1R!;
    expect(r.point_id).toBe('TA');
    expect(r.carry_ms).toBe(r.station_id === FX.station ? 45_000 : 50_000);
    // cold replay and checkpoint + replay reproduce the points and carry facts
    const cold = replayEngine(hub.deps.db, BRANCH, 0, initialEngineState(), () => undefined).state;
    expect(withoutDiagnostics(cold)).toEqual(withoutDiagnostics(engine()));
    const base = loadEngineBase(hub.deps.db, BRANCH, () => undefined);
    expect(base.checkpoint_seq).toBe(checkpoint!.last_seq);
    const restored = replayEngine(hub.deps.db, BRANCH, base.checkpoint_seq!, base.state!, () => undefined).state;
    expect(withoutDiagnostics(restored)).toEqual(withoutDiagnostics(engine()));
  });
});
