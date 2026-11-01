import { ALERT_CONSTANTS, type Permission, type Scope } from '@pos/domain';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakePager, fakeZoneOrderTaker, registerFakes, resetFakes } from '../../test/alerts/fakes';
import { statementCounter } from '../../test/helpers/statement-counter';
import { activity } from '../auth/session-store';
import { StaffDirectory, type DirectoryCore } from '../auth/staff-directory';
import type { WriterTx } from '../engine-host/writer';
import type { ConnectedSession, WsHub } from '../ws/server';
import { kindOf, type AlertKind, type StepDef } from './kinds';
import { askRoutes, bindingIsRoute, registerRoute, routeAsk, routeRecipients, unregisterRoute } from './routes';
import { resolveStep, resolveTargets, targetKey, type AlertRow, type BatchReads, type BindingRead, type Recipient, type ResolvedTarget } from './targets';

// 01d §3.4.3, §3.8, §3.4.2: routes of a person over a hand-built BatchReads, a fake socket list and an
// in-memory directory. Tree: OWNER ← IMRAN (manager) ← KAMRAN (lead) ← ALI ← HAMZA; KAMRAN ← RUNNER (no PIN);
// CASH has no lead. Managers (branch-scope force-release-table-lock): OWNER, IMRAN.

const OWNER = 'S_OWNER';
const IMRAN = 'S_IMRAN';
const KAMRAN = 'S_KAMRAN';
const ALI = 'S_ALI';
const HAMZA = 'S_HAMZA';
const CASH = 'S_CASH';
const RUNNER = 'S_RUNNER';
const ZONE = 'S_ZONE';

const NOW = 1_761_900_000_000;
const IDLE = ALERT_CONSTANTS.binding_route_idle_ms;

type Grant = { permission: Permission; grant_type: 'allowed'; scope: Scope };
const role = (role_id: string, grants: Grant[]): DirectoryCore['roles'][number] => ({
  role_id,
  name: `name-${role_id}`,
  session_idle_ttl_ms: 300_000,
  permissions: grants.map((g) => ({ ...g, approver_role_ids: [] })),
});
const person = (staff_id: string, role_ids: string[], lead_staff_id: string | null): DirectoryCore['staff'][number] => ({
  staff_id,
  display_name: staff_id,
  pin_hash: 'h',
  role_ids,
  denied_permissions: [],
  lead_staff_id,
  floor_ids: [],
});

const dir = StaffDirectory.fromInput({
  directory_version: 1,
  roles: [role('RM', [{ permission: 'force-release-table-lock', grant_type: 'allowed', scope: 'branch' }]), role('RS', [])],
  staff: [
    person(OWNER, ['RM'], null),
    person(IMRAN, ['RM'], OWNER),
    person(KAMRAN, ['RS'], IMRAN),
    person(ALI, ['RS'], KAMRAN),
    person(HAMZA, ['RS'], ALI),
    person(CASH, ['RS'], null),
    person(ZONE, ['RS'], IMRAN),
  ],
  responsibilities: [],
  no_pin_staff: [{ staff_id: RUNNER, display_name: 'Runner', lead_staff_id: KAMRAN }],
});

function reads(over: Partial<BatchReads> = {}): BatchReads {
  return {
    sessions: [],
    bindings: [],
    devices: [],
    presence: new Map(),
    activity: new Map(),
    prevRecipients: new Map(),
    resolved: new Map(),
    routes: new Map(),
    ...over,
  };
}

function wsWith(o: { sessions?: ConnectedSession[]; alert?: Array<{ deviceId: string; deviceType: 'tablet' | 'phone' | 'cashier_kiosk' | 'kds' }> } = {}): WsHub {
  return { connectedSessions: () => o.sessions ?? [], alertSockets: () => o.alert ?? [] } as unknown as WsHub;
}
const screen = (staffId: string, deviceId: string, sessionId = `ss_${staffId}`): ConnectedSession => ({
  staffId,
  deviceId,
  sessionId,
  kind: 'staff',
});
/** A staff signed in on a device: read (3) row + its staff-session socket. */
const signedIn = (staffId: string, deviceId: string) => ({
  session: { session_id: `ss_${staffId}`, staff_id: staffId, device_id: deviceId, last_activity_at: NOW - 1_000 },
  socket: screen(staffId, deviceId),
});

const P = (staff_id: string, set: Recipient['set'] = 'recipient'): Recipient => ({ staff_id, device_id: null, set });
const D = (device_id: string, set: Recipient['set'] = 'recipient'): Recipient => ({ staff_id: null, device_id, set });

const kind = (name: string): AlertKind => {
  const k = kindOf(name);
  if (k === undefined) throw new Error(`no kind ${name}`);
  return k;
};
/** An answer notice (request_result / pin_use_failed-like): no request part, lead_fallback false. */
const notice = (): AlertKind => ({ ...kind('t_info'), kind: 't_notice', lead_fallback: false });

beforeEach(() => registerFakes());
afterEach(() => resetFakes());

describe('01d §3.4.3 routes of a person (test #3)', () => {
  it('[01d #3] screen + binding + registered route are all routes of the person', () => {
    const ali = signedIn(ALI, 'D_TAB1');
    const r = reads({
      sessions: [ali.session],
      devices: [
        { device_id: 'D_TAB1', device_type: 'tablet' },
        { device_id: 'D_TAB2', device_type: 'tablet' },
      ],
      bindings: [{ device_id: 'D_TAB2', staff_id: ALI, session_id: 'ss_old', since: NOW - 5_000 }],
      activity: new Map([[ALI, NOW - 60_000]]),
      routes: new Map([[ALI, [{ route: 'pager', ref: 'pager:5' }]]]),
    });
    const ws = wsWith({ sessions: [ali.socket], alert: [{ deviceId: 'D_TAB2', deviceType: 'tablet' }] });
    const out = routeRecipients([P(ALI)], kind('t_action'), r, dir, ws, NOW);
    expect(out.recipients).toEqual([{ staff_id: ALI, device_id: null, for_staff_id: null, set: 'recipient' }]);
    expect(out.routes).toEqual([
      { staff_id: ALI, route: 'screen', ref: 'D_TAB1' },
      { staff_id: ALI, route: 'alert_connection', ref: 'D_TAB2' },
      { staff_id: ALI, route: 'pager', ref: 'pager:5' },
    ]);
    expect(out.no_route).toEqual([]);
  });

  it('[01d #3] no route on an action or info kind → the lead with for_staff_id', () => {
    const kamran = signedIn(KAMRAN, 'D_K');
    const r = reads({ sessions: [kamran.session] });
    const ws = wsWith({ sessions: [kamran.socket] });
    for (const k of ['t_action', 't_info']) {
      const out = routeRecipients([P(ALI)], kind(k), r, dir, ws, NOW);
      expect(out.recipients).toEqual([
        { staff_id: ALI, device_id: null, for_staff_id: null, set: 'recipient' },
        { staff_id: KAMRAN, device_id: null, for_staff_id: ALI, set: 'recipient' },
      ]);
      expect(out.routes).toEqual([{ staff_id: KAMRAN, route: 'screen', ref: 'D_K' }]);
      expect(out.no_route).toEqual([ALI]);
    }
  });

  it('[01d #3] lead with no route → managers with a route; no lead at all → managers', () => {
    const imran = signedIn(IMRAN, 'D_I');
    const r = reads({ sessions: [imran.session] });
    const ws = wsWith({ sessions: [imran.socket] });
    // ALI → KAMRAN (no route) → managers: IMRAN has a route, OWNER does not.
    expect(routeRecipients([P(ALI)], kind('t_action'), r, dir, ws, NOW).recipients).toEqual([
      { staff_id: ALI, device_id: null, for_staff_id: null, set: 'recipient' },
      { staff_id: IMRAN, device_id: null, for_staff_id: ALI, set: 'recipient' },
    ]);
    // CASH has no lead → managers.
    expect(routeRecipients([P(CASH)], kind('t_info'), r, dir, ws, NOW).recipients).toEqual([
      { staff_id: CASH, device_id: null, for_staff_id: null, set: 'recipient' },
      { staff_id: IMRAN, device_id: null, for_staff_id: CASH, set: 'recipient' },
    ]);
  });

  it('[01d #3] request kind or answer notice: no "for" row, the person is recorded with no route', () => {
    const kamran = signedIn(KAMRAN, 'D_K');
    const r = reads({ sessions: [kamran.session] });
    const ws = wsWith({ sessions: [kamran.socket] });
    const approval = routeRecipients([P(ALI, 'answerer')], kind('t_approval'), r, dir, ws, NOW);
    expect(approval.recipients).toEqual([{ staff_id: ALI, device_id: null, for_staff_id: null, set: 'answerer' }]);
    expect(approval.routes).toEqual([]);
    expect(approval.no_route).toEqual([ALI]);
    const answerNotice = routeRecipients([P(ALI)], notice(), r, dir, ws, NOW);
    expect(answerNotice.recipients).toEqual([{ staff_id: ALI, device_id: null, for_staff_id: null, set: 'recipient' }]);
    expect(answerNotice.routes).toEqual([]);
    expect(answerNotice.no_route).toEqual([ALI]);
  });
});

describe('01d §3.4.3 binding route rule (a)(b)(c)', () => {
  const tablet = (staff_id = ALI, device_id = 'D_TAB'): BindingRead => ({ device_id, staff_id, session_id: 'ss_old', since: NOW - 10_000 });
  const tabletReads = (over: Partial<BatchReads> = {}) =>
    reads({ devices: [{ device_id: 'D_TAB', device_type: 'tablet' }], activity: new Map([[ALI, NOW - 60_000]]), ...over });
  const alertSocket = wsWith({ alert: [{ deviceId: 'D_TAB', deviceType: 'tablet' }] });

  it('[01d §3.4.3] (a) a tablet binding is a route only while its device is connected (alert-mode or session socket)', () => {
    expect(bindingIsRoute(tablet(), tabletReads(), wsWith(), NOW).route).toBe(false);
    expect(bindingIsRoute(tablet(), tabletReads(), alertSocket, NOW).route).toBe(true);
    // a session socket of that device, here someone else signed in on it
    expect(bindingIsRoute(tablet(), tabletReads(), wsWith({ sessions: [screen(HAMZA, 'D_TAB')] }), NOW).route).toBe(true);
    // a socket of another device does not count
    expect(bindingIsRoute(tablet(), tabletReads(), wsWith({ sessions: [screen(ALI, 'D_OTHER')] }), NOW).route).toBe(false);
  });

  it('[01d §3.4.3] (b) a person marked absent has no binding route; nobody ticked → present', () => {
    expect(bindingIsRoute(tablet(), tabletReads({ presence: new Map([[ALI, false]]) }), alertSocket, NOW).route).toBe(false);
    expect(bindingIsRoute(tablet(), tabletReads({ presence: new Map() }), alertSocket, NOW).route).toBe(true);
    expect(bindingIsRoute(tablet(), tabletReads({ presence: new Map([[ALI, true]]) }), alertSocket, NOW).route).toBe(true);
  });

  it('[01d §3.4.3] (c) a tablet routes only while the last activity is within binding_route_idle_ms; until = last + idle', () => {
    const at = (last: number) => tabletReads({ activity: new Map([[ALI, last]]) });
    expect(bindingIsRoute(tablet(), at(NOW - IDLE), alertSocket, NOW)).toEqual({ route: true, until: NOW });
    expect(bindingIsRoute(tablet(), at(NOW - IDLE - 1), alertSocket, NOW)).toEqual({ route: false, until: NOW - 1 });
    expect(bindingIsRoute(tablet(), at(NOW - 60_000), alertSocket, NOW)).toEqual({ route: true, until: NOW - 60_000 + IDLE });
    // no activity known at all → no route, no deadline
    expect(bindingIsRoute(tablet(), tabletReads({ activity: new Map() }), alertSocket, NOW)).toEqual({ route: false, until: null });
  });

  it('[01d §3.4.3] (c) last activity = max of staff_sessions.last_activity_at and the in-memory activity value', () => {
    const old = NOW - IDLE - 10_000;
    // read (9) is stale, but an active session elsewhere (read 3) is recent
    const viaSession = tabletReads({
      activity: new Map([[ALI, old]]),
      sessions: [{ session_id: 'ss_live', staff_id: ALI, device_id: 'D_ELSE', last_activity_at: NOW - 5_000 }],
    });
    expect(bindingIsRoute(tablet(), viaSession, alertSocket, NOW)).toEqual({ route: true, until: NOW - 5_000 + IDLE });
    // the active session's in-memory activity value is newer than its row
    const sessionId = 'ss_mem_test';
    activity.touch(sessionId, NOW - 1_000);
    try {
      const viaMemory = tabletReads({
        activity: new Map([[ALI, old]]),
        sessions: [{ session_id: sessionId, staff_id: ALI, device_id: 'D_ELSE', last_activity_at: old }],
      });
      expect(bindingIsRoute(tablet(), viaMemory, alertSocket, NOW)).toEqual({ route: true, until: NOW - 1_000 + IDLE });
    } finally {
      activity.drain();
    }
  });

  it('[01d §3.4.3] a phone owner binding is exempt from (c): until is null', () => {
    const phone: BindingRead = { device_id: 'D_PH', staff_id: OWNER, session_id: null, since: NOW - 3 * IDLE };
    const r = reads({ devices: [{ device_id: 'D_PH', device_type: 'phone' }] });
    expect(bindingIsRoute(phone, r, wsWith({ alert: [{ deviceId: 'D_PH', deviceType: 'phone' }] }), NOW)).toEqual({ route: true, until: null });
    expect(bindingIsRoute(phone, r, wsWith(), NOW)).toEqual({ route: false, until: null });
  });

  it('[01d §3.4.3] a kiosk row never routes (BF-3), nor a KDS or an unknown / revoked device', () => {
    const r = reads({
      devices: [
        { device_id: 'D_KIOSK', device_type: 'cashier_kiosk' },
        { device_id: 'D_KDS', device_type: 'kds' },
      ],
      activity: new Map([[ALI, NOW - 1_000]]),
    });
    const ws = wsWith({
      sessions: [screen(ALI, 'D_KIOSK')],
      alert: [
        { deviceId: 'D_KDS', deviceType: 'kds' },
        { deviceId: 'D_GONE', deviceType: 'tablet' },
      ],
    });
    expect(bindingIsRoute(tablet(ALI, 'D_KIOSK'), r, ws, NOW)).toEqual({ route: false, until: null });
    expect(bindingIsRoute(tablet(ALI, 'D_KDS'), r, ws, NOW)).toEqual({ route: false, until: null });
    expect(bindingIsRoute(tablet(ALI, 'D_GONE'), r, ws, NOW)).toEqual({ route: false, until: null });
  });

  it('[01d §3.4.3] a stale binding (tablet off) is no route → the lead gets it "for" the person', () => {
    const kamran = signedIn(KAMRAN, 'D_K');
    const r = tabletReads({ sessions: [kamran.session], bindings: [tablet()] });
    const out = routeRecipients([P(ALI)], kind('t_action'), r, dir, wsWith({ sessions: [kamran.socket] }), NOW);
    expect(out.recipients.map((x) => [x.staff_id, x.for_staff_id])).toEqual([
      [ALI, null],
      [KAMRAN, ALI],
    ]);
  });
});

describe('01d §3.4.3 / §3.8 fallbacks, registered routes, devices', () => {
  it('[01d §3.4.3] a "for" fallback reaching a person already in the step adds nothing', () => {
    const r = reads();
    // KAMRAN (ALI's lead) is in the step without a route: no "for ALI" copy anywhere, no loop.
    const out = routeRecipients([P(ALI), P(KAMRAN)], kind('t_action'), r, dir, wsWith(), NOW);
    expect(out.recipients.filter((x) => x.for_staff_id === ALI)).toEqual([]);
    // KAMRAN in the step with a route: KAMRAN has it directly, no second copy.
    const kamran = signedIn(KAMRAN, 'D_K');
    const withRoute = routeRecipients([P(ALI), P(KAMRAN)], kind('t_action'), reads({ sessions: [kamran.session] }), dir, wsWith({ sessions: [kamran.socket] }), NOW);
    expect(withRoute.recipients).toEqual([
      { staff_id: ALI, device_id: null, for_staff_id: null, set: 'recipient' },
      { staff_id: KAMRAN, device_id: null, for_staff_id: null, set: 'recipient' },
    ]);
    expect(withRoute.routes).toEqual([{ staff_id: KAMRAN, route: 'screen', ref: 'D_K' }]);
  });

  it('[01d §3.4.3] a fallback that would reach the same person again stops (a manager with no route)', () => {
    const owner = signedIn(OWNER, 'D_O');
    // IMRAN (a manager) → OWNER (lead, no route) → managers include IMRAN himself → stop.
    const out = routeRecipients([P(IMRAN)], kind('t_action'), reads(), dir, wsWith(), NOW);
    expect(out.recipients).toEqual([{ staff_id: IMRAN, device_id: null, for_staff_id: null, set: 'recipient' }]);
    // with OWNER reachable, the lead takes it
    const reached = routeRecipients([P(IMRAN)], kind('t_action'), reads({ sessions: [owner.session] }), dir, wsWith({ sessions: [owner.socket] }), NOW);
    expect(reached.recipients.map((x) => [x.staff_id, x.for_staff_id])).toEqual([
      [IMRAN, null],
      [OWNER, IMRAN],
    ]);
  });

  it('[01d §3.4.3] a no_pin_staff person with no route falls back to their lead', () => {
    const kamran = signedIn(KAMRAN, 'D_K');
    const out = routeRecipients([P(RUNNER)], kind('t_action'), reads({ sessions: [kamran.session] }), dir, wsWith({ sessions: [kamran.socket] }), NOW);
    expect(out.recipients.map((x) => [x.staff_id, x.for_staff_id])).toEqual([
      [RUNNER, null],
      [KAMRAN, RUNNER],
    ]);
  });

  it('[01d §3.4.3] two people with the same lead give two "for" rows and one copy of the lead routes', () => {
    const kamran = signedIn(KAMRAN, 'D_K');
    const out = routeRecipients([P(ALI), P(RUNNER)], kind('t_info'), reads({ sessions: [kamran.session] }), dir, wsWith({ sessions: [kamran.socket] }), NOW);
    expect(out.recipients.filter((x) => x.for_staff_id !== null).map((x) => x.for_staff_id)).toEqual([ALI, RUNNER]);
    expect(out.routes).toEqual([{ staff_id: KAMRAN, route: 'screen', ref: 'D_K' }]);
  });

  it('[01d §3.8] a person whose only route is the pager is not "no route"', () => {
    const kamran = signedIn(KAMRAN, 'D_K');
    const r = reads({ sessions: [kamran.session], routes: new Map([[ALI, [{ route: 'pager', ref: 'pager:5' }]]]) });
    const out = routeRecipients([P(ALI)], kind('t_action'), r, dir, wsWith({ sessions: [kamran.socket] }), NOW);
    expect(out.recipients).toEqual([{ staff_id: ALI, device_id: null, for_staff_id: null, set: 'recipient' }]);
    expect(out.routes).toEqual([{ staff_id: ALI, route: 'pager', ref: 'pager:5' }]);
    expect(out.no_route).toEqual([]);
  });

  it('[01d §3.8] fakePager.routesFor is called once, in one statement, with every person recipient of the tick', () => {
    const db = new Database(':memory:');
    try {
      const counter = statementCounter(db);
      const tx = { db } as unknown as WriterTx;
      fakePager.refs.set(ALI, ['pager:5']);
      fakePager.refs.set(HAMZA, ['pager:7', 'pager:8']);
      const ids = routeAsk(
        [
          { recipients: [P(ALI), P(HAMZA), D('D_KDS')], kind: kind('t_approval') },
          { recipients: [P(HAMZA), P(CASH)], kind: notice() },
        ],
        reads(),
        dir,
      );
      expect(ids).toEqual([ALI, HAMZA, CASH]);
      const got = askRoutes(tx, ids);
      expect(fakePager.calls).toEqual([[ALI, HAMZA, CASH]]);
      expect(counter.count).toBe(1);
      expect(got).toEqual(
        new Map([
          [ALI, [{ route: 'pager', ref: 'pager:5' }]],
          [HAMZA, [{ route: 'pager', ref: 'pager:7' }, { route: 'pager', ref: 'pager:8' }]],
        ]),
      );
      // no person recipients → no call
      expect(askRoutes(tx, []).size).toBe(0);
      expect(fakePager.calls.length).toBe(1);
    } finally {
      db.close();
    }
  });

  it('[01d §3.8] routeAsk adds the fallback candidates of lead_fallback kinds (leads, zone order takers, managers)', () => {
    const r = reads({ resolved: new Map([[targetKey({ kind: 'zone_order_taker', table_id: 'T12' }), { staff_ids: [ZONE], device_ids: [] }]]) });
    const owner: Recipient = { ...P(ALI), table_team: { table_id: 'T12', owner_staff_id: ALI } };
    expect(routeAsk([{ recipients: [owner], kind: kind('t_action') }], r, dir)).toEqual([ALI, KAMRAN, ZONE, IMRAN, OWNER]);
    // a request kind asks for its recipients only
    expect(routeAsk([{ recipients: [owner], kind: kind('t_approval') }], r, dir)).toEqual([ALI]);
  });

  it('[01d §3.8] a registered route with reads.routes missing is a programming error', () => {
    const r = reads();
    delete r.routes;
    expect(() => routeRecipients([P(ALI)], kind('t_action'), r, dir, wsWith(), NOW)).toThrow(/routes/);
  });

  it('[01d §3.8] registerRoute: duplicate or reserved route names throw', () => {
    const def = { route: 'x_test', format: 'text' as const, ack: false, receipts: [], routesFor: () => new Map(), send: () => {} };
    registerRoute(def);
    try {
      expect(() => registerRoute(def)).toThrow(/already registered/);
    } finally {
      unregisterRoute('x_test');
    }
    expect(() => registerRoute({ ...def, route: 'screen' })).toThrow(/reserved/);
    expect(() => registerRoute({ ...def, route: 'alert_connection' })).toThrow(/reserved/);
  });

  it('[01d §3.4.3] a device recipient: connected → its routes (staff_id null); offline → listed with no route', () => {
    const ws = wsWith({
      sessions: [{ staffId: null, deviceId: 'D_KDS', sessionId: 'st1', kind: 'station' }],
      alert: [{ deviceId: 'D_KIOSK', deviceType: 'cashier_kiosk' }],
    });
    const out = routeRecipients([D('D_KDS'), D('D_KIOSK'), D('D_OFF')], kind('t_info'), reads(), dir, ws, NOW);
    expect(out.recipients).toEqual([
      { staff_id: null, device_id: 'D_KDS', for_staff_id: null, set: 'recipient' },
      { staff_id: null, device_id: 'D_KIOSK', for_staff_id: null, set: 'recipient' },
      { staff_id: null, device_id: 'D_OFF', for_staff_id: null, set: 'recipient' },
    ]);
    expect(out.routes).toEqual([
      { staff_id: null, route: 'screen', ref: 'D_KDS' },
      { staff_id: null, route: 'alert_connection', ref: 'D_KIOSK' },
    ]);
    expect(out.no_route).toEqual([]);
  });
});

describe('01d §3.4.2 table-team fallback (zone order taker, managers)', () => {
  const T12 = targetKey({ kind: 'table_team', table_id: 'T12' });
  const Z12 = targetKey({ kind: 'zone_order_taker', table_id: 'T12' });
  const ownerStep: StepDef = { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] };
  const tableAlert = (depth: 'owner' | 'direct' = 'owner'): AlertRow => ({
    alert_id: 'A1',
    kind: 't_action',
    requester_staff_id: null,
    target: { kind: 'table_team', table_id: 'T12', depth },
    values: {},
    request: null,
    step: -1,
    raised_at: 0,
  });
  // HAMZA owns T12; his lead ALI has no route; ZONE is the zone's order taker.
  const resolvedWith = (zone: string[] | null): Map<string, ResolvedTarget> => {
    const out = new Map<string, ResolvedTarget>([[T12, { staff_ids: [HAMZA], device_ids: [] }]]);
    if (zone !== null) out.set(Z12, { staff_ids: zone, device_ids: [] });
    return out;
  };
  const run = (r: BatchReads, ws: WsHub, k = kind('t_action'), depth: 'owner' | 'direct' = 'owner') =>
    routeRecipients(resolveStep(ownerStep, tableAlert(depth), r, dir, ws), k, r, dir, ws, NOW);

  it('[01d §3.4.2] owner signed out with no route → the zone order taker gets it "for" the owner', () => {
    const zone = signedIn(ZONE, 'D_Z');
    const r = reads({ sessions: [zone.session], resolved: resolvedWith([ZONE]) });
    const out = run(r, wsWith({ sessions: [zone.socket] }));
    expect(out.recipients).toEqual([
      { staff_id: HAMZA, device_id: null, for_staff_id: null, set: 'recipient' },
      { staff_id: ZONE, device_id: null, for_staff_id: HAMZA, set: 'recipient' },
    ]);
    expect(out.routes).toEqual([{ staff_id: ZONE, route: 'screen', ref: 'D_Z' }]);
    expect(fakeZoneOrderTaker.calls).toEqual([]); // the result comes from reads.resolved, not a call here
  });

  it('[01d §3.4.2] owner marked absent (dropped by the presence filter) → still the zone order taker', () => {
    const zone = signedIn(ZONE, 'D_Z');
    const r = reads({ sessions: [zone.session], presence: new Map([[HAMZA, false]]), resolved: resolvedWith([ZONE]) });
    const out = run(r, wsWith({ sessions: [zone.socket] }));
    expect(out.recipients).toEqual([{ staff_id: ZONE, device_id: null, for_staff_id: HAMZA, set: 'recipient' }]);
    expect(out.no_route).toEqual([]);
  });

  it('[01d §3.4.2] no zone order taker → managers', () => {
    const imran = signedIn(IMRAN, 'D_I');
    for (const zone of [null, [], [ZONE]]) {
      // [ZONE] here has no route, so it counts as none
      const r = reads({ sessions: [imran.session], resolved: resolvedWith(zone) });
      const out = run(r, wsWith({ sessions: [imran.socket] }));
      expect(out.recipients.map((x) => [x.staff_id, x.for_staff_id])).toEqual([
        [HAMZA, null],
        [IMRAN, HAMZA],
      ]);
    }
  });

  it('[01d §3.4.2] the fallback person already in the step → nothing added', () => {
    const zone = signedIn(ZONE, 'D_Z');
    const r = reads({ sessions: [zone.session], resolved: resolvedWith([ZONE]) });
    const ws = wsWith({ sessions: [zone.socket] });
    const step: StepDef = {
      at: { ms: 0 },
      to: [
        { target: 'raised_target', set: 'recipient' },
        { target: { kind: 'zone_order_taker', from_value: 'table_id' }, set: 'recipient' },
      ],
    };
    const recipients = resolveStep(step, { ...tableAlert(), values: { table_id: 'T12' } }, r, dir, ws);
    const out = routeRecipients(recipients, kind('t_action'), r, dir, ws, NOW);
    expect(out.recipients).toEqual([
      { staff_id: HAMZA, device_id: null, for_staff_id: null, set: 'recipient' },
      { staff_id: ZONE, device_id: null, for_staff_id: null, set: 'recipient' },
    ]);
  });

  it('[01d §3.4.2] the lead with a route takes it first (§3.4.3 order: lead, table-team fallback, managers)', () => {
    const ali = signedIn(ALI, 'D_A');
    const zone = signedIn(ZONE, 'D_Z');
    const r = reads({ sessions: [ali.session, zone.session], resolved: resolvedWith([ZONE]) });
    const out = run(r, wsWith({ sessions: [ali.socket, zone.socket] }));
    expect(out.recipients.map((x) => [x.staff_id, x.for_staff_id])).toEqual([
      [HAMZA, null],
      [ALI, HAMZA],
    ]);
  });

  it('[01d §3.4.2] owner signed in somewhere (no socket) → the zone fallback does not apply → managers', () => {
    const zone = signedIn(ZONE, 'D_Z');
    const imran = signedIn(IMRAN, 'D_I');
    const hamzaRow = { session_id: 'ss_h', staff_id: HAMZA, device_id: 'D_H', last_activity_at: NOW - 1_000 };
    const r = reads({ sessions: [hamzaRow, zone.session, imran.session], resolved: resolvedWith([ZONE]) });
    const out = run(r, wsWith({ sessions: [zone.socket, imran.socket] }));
    expect(out.recipients.map((x) => [x.staff_id, x.for_staff_id])).toEqual([
      [HAMZA, null],
      [IMRAN, HAMZA],
    ]);
  });

  it('[01d §3.4.2] a request kind gets no table-team fallback', () => {
    const zone = signedIn(ZONE, 'D_Z');
    const r = reads({ sessions: [zone.session], resolved: resolvedWith([ZONE]) });
    const out = run(r, wsWith({ sessions: [zone.socket] }), kind('t_accept'));
    expect(out.recipients).toEqual([{ staff_id: HAMZA, device_id: null, for_staff_id: null, set: 'recipient' }]);
    expect(out.no_route).toEqual([HAMZA]);
  });

  it('[01d §3.4.2] fakeZoneOrderTaker resolves table → taker, keyed by targetKey, in one statement', () => {
    const db = new Database(':memory:');
    try {
      const counter = statementCounter(db);
      fakeZoneOrderTaker.takers.set('T12', ZONE);
      const got = resolveTargets({ db } as unknown as WriterTx, [
        { kind: 'zone_order_taker', table_id: 'T12' },
        { kind: 'zone_order_taker', table_id: 'T13' },
      ]);
      expect(got).toEqual(new Map([[Z12, { staff_ids: [ZONE], device_ids: [] }]]));
      expect(counter.count).toBe(1);
      expect(fakeZoneOrderTaker.calls.length).toBe(1);
    } finally {
      db.close();
    }
  });
});
