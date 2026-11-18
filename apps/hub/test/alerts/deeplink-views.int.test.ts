import { ALERT_CONSTANTS } from '@pos/domain';
import { AlertDetailsBase, WsServerMessage, type AlertLinkTarget, type AlertView, type DirectoryInput } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ANSWERED_ON_REQUESTER_DEVICE,
  APPROVAL_RECEIPT,
  APPROVAL_TIER_STEPS,
  defineAlertKind,
  kindOf,
  PIN_USE_FAILED,
  REQUEST_RESULT,
  safeLink,
  unregisterAlertKind,
  type AlertKind,
} from '../../src/alerts/kinds';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { lockOnlyView, lockView, signedInView, StrictCardView, StrictLockView } from '../../src/alerts/ws-frames';
import { currentDirectory } from '../../src/auth/guards';
import { activity } from '../../src/auth/session-store';
import type { CommandCtx } from '../../src/commands/registry';
import { wsHubFor } from '../../src/ws/server';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { registerFakes, resetFakes } from './fakes';

// dl h1 — 01d v1.3 §3.13.1 (the target contract), §3.5 note (`link` on defineAlertKind), §3.10 note (the copy kinds'
// `values.link`), §5.4 (`target` on every view); test 70 and `[01d §3.13.1]` safeLink cases. One builder (`lockView`)
// computes `target: safeLink(kind, values)` for every view: step frames (lock and card), `alerts_open`, the `alerts`
// catch-up part, `alerts-inbox`, `requests-to-answer`. `my-requests` keeps `lock` only. Real sockets and HTTP injects.

const MGR = 'S_MGR'; // approver (R_MGR)
const WAIT = 'S_WAIT'; // requester: void-item requires approval by R_MGR
const TENANT = 'tenant-a';
const BRANCH = 'branch-1';
const DETAILS = { item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'customer changed mind' };

const LINKED = 't_link_approval'; // a 04-like approval kind with a `link` (order_line from its values)
const LINKED_INFO = 't_link_info'; // an info kind with a `link` (table), for device targets
const THROWS = 't_link_throws';
const NOPE = 't_link_nope';
const FAKE_LINK_KINDS = [LINKED, LINKED_INFO, THROWS, NOPE];

const LINE: AlertLinkTarget = { type: 'order_line', order_id: 'O1', order_item_id: 'L1' };

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const roles = base.roles.map((role) =>
    role.role_id === 'R_WAIT'
      ? {
          ...role,
          permissions: [
            { permission: 'void-item' as const, grant_type: 'requires_approval' as const, approver_role_id: 'R_MGR', approver_role_ids: ['R_MGR'], scope: 'branch' as const },
          ],
        }
      : role,
  );
  return { ...base, roles };
}

function defineFakeLinkKinds(): void {
  const OrderLineValues = z.object({ order_id: z.string().min(1), order_item_id: z.string().min(1) });
  defineAlertKind({
    kind: LINKED,
    family: 'urgent',
    subject: 'order',
    steps: APPROVAL_TIER_STEPS,
    closes_on: 'owner',
    values_schema: OrderLineValues,
    details_schema: AlertDetailsBase.required({ item: true, quantity: true, amount: true, reason: true }),
    lead_fallback: false,
    expires_at_day_close: true,
    silent: false,
    labels: { card: `alert.${LINKED}.card`, lock: `alert.${LINKED}.lock` },
    link: (v) => ({ type: 'order_line', order_id: v.order_id, order_item_id: v.order_item_id }),
    request: {
      answers: ['approve', 'reject'],
      right: { mode: 'approval', base_permission: 'void-item', range_permission: 'approve-void' },
      needs_pin: ALERT_CONSTANTS.needs_pin.money,
      apply: () => [],
    },
  });
  const info = (kind: string, link: (v: { table_id: string; seating_id: string }) => AlertLinkTarget | null) =>
    defineAlertKind({
      kind,
      family: 'info',
      subject: 'table',
      steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
      closes_on: 'owner',
      values_schema: z.object({ table_id: z.string().min(1), seating_id: z.string().min(1) }),
      details_schema: null,
      lead_fallback: false,
      expires_at_day_close: true,
      silent: false,
      labels: { card: `alert.${kind}.card`, lock: `alert.${kind}.lock` },
      link,
      request: null,
    });
  info(LINKED_INFO, (v) => ({ type: 'table', table_id: v.table_id, seating_id: v.seating_id }));
  info(THROWS, () => {
    throw new Error('a link that throws');
  });
  info(NOPE, () => ({ type: 'nope' }) as unknown as AlertLinkTarget);
}

interface Seat {
  staffId: string;
  deviceId: string;
  deviceToken: string;
  sessionId: string;
  sessionToken: string;
}
type Frame = { type: string; alert_id?: string; alert?: AlertView & Record<string, unknown> } & Record<string, unknown>;
type Row = AlertView & Record<string, unknown>;

describe('[01d #70] target on every view (dl h1; §3.13.1, §5.4)', () => {
  let hub: TestHub;
  const clients: WsClient[] = [];
  const tokens = new Map<string, string>();

  beforeEach(async () => {
    hub = await createTestHub();
    registerFakes();
    defineFakeLinkKinds();
    await seedDirectory(hub, await directory());
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    tokens.clear();
    for (const kind of FAKE_LINK_KINDS) unregisterAlertKind(kind);
    resetFakes();
    activity.drain();
    activity.drainDevices();
    await hub.close();
  });

  function device(type: 'tablet' | 'cashier_kiosk' | 'kds', name: string): string {
    const d = pairDevice(hub, { type, name, stationId: type === 'kds' ? 'station-1' : undefined });
    tokens.set(d.deviceId, d.token);
    return d.deviceId;
  }
  function signIn(staffId: string, deviceId: string): Seat {
    const s = openSession(hub, { kind: 'staff', staffId, deviceId });
    return { staffId, deviceId, deviceToken: tokens.get(deviceId)!, sessionId: s.sessionId, sessionToken: s.token };
  }
  async function socketOf(s: Seat): Promise<WsClient> {
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: s.deviceToken, session_token: s.sessionToken });
    await ws.untilCount(1);
    expect(ws.messages[0]).toMatchObject({ type: 'catch_up' });
    clients.push(ws);
    return ws;
  }
  async function stationSocket(deviceId: string): Promise<WsClient> {
    const response = await hub.app.inject({ method: 'POST', url: '/auth/station', headers: { authorization: `Bearer ${tokens.get(deviceId)!}` } });
    const body = response.json() as { data: { session_token: string } };
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: tokens.get(deviceId)!, session_token: body.data.session_token });
    await ws.untilCount(1);
    clients.push(ws);
    return ws;
  }
  async function alertSocket(deviceId: string): Promise<WsClient> {
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: tokens.get(deviceId)! });
    await ws.untilCount(1);
    expect(ws.messages[0]).toMatchObject({ type: 'alerts_open' });
    clients.push(ws);
    return ws;
  }
  const catchUpOf = (ws: WsClient): Row[] => (ws.messages[0] as { state: { alerts: { alerts: Row[] } } }).state.alerts.alerts;
  const openRows = (ws: WsClient): Row[] => (ws.messages[0] as { alerts: Row[] }).alerts;
  let fenceNo = 0;
  async function fence(): Promise<void> {
    fenceNo += 1;
    const id = `FENCE_${fenceNo}`;
    wsHubFor(hub.app).sendToDevices([...tokens.keys()], { type: 'alert_seen', alert_id: id });
    for (const client of clients) {
      for (let i = 0; i < 50 && !client.messages.some((m) => (m as Frame).alert_id === id); i += 1) await client.untilCount(client.messages.length + 1);
    }
  }
  const alertFrames = (client: WsClient): Row[] =>
    (client.messages as Frame[]).flatMap((m) => (m.type === 'alert' && m.alert !== undefined ? [m.alert] : []));

  function ctxOf(tx: Parameters<Parameters<TestHub['deps']['writer']['run']>[0]>[0], s: Seat): CommandCtx {
    return {
      tx,
      state: tx.state,
      clock: tx.clock,
      ids: tx.ids,
      secrets: hub.deps.secrets,
      actor: { kind: 'staff', staffId: s.staffId, stationId: null, sessionId: s.sessionId, deviceId: s.deviceId },
      permission: null,
      branch: { tenantId: TENANT, branchId: BRANCH },
      directory: currentDirectory(hub.app),
      config: hub.deps.config,
    } as unknown as CommandCtx;
  }
  function raiseAs(s: Seat | null, input: RaiseInput): string {
    return hub.deps.writer.run((tx) => {
      const result = alerts.raise(s === null ? alerts.tickCtx(tx, hub.clock.branchNow()) : ctxOf(tx, s), input);
      tx.append(result.events);
      return result.alert_id;
    }).result;
  }
  const display = { kind_label_key: 'alert.t.lock', table_code: '12', requester_name: 'Order taker' };
  const linkedRequest = (): RaiseInput => ({
    kind: LINKED,
    subject: { stream_type: 'order', stream_id: 'O1' },
    target: { kind: 'answerers' },
    values: { order_id: 'O1', order_item_id: 'L1' },
    display,
    details: DETAILS,
    dedupe_key: 'void:O1:L1',
    requester_staff_id: WAIT,
    request: { approver_role_ids: ['R_MGR'] },
  });
  const infoTo = (kind: string, target: RaiseInput['target'], key: string): RaiseInput => ({
    kind,
    subject: { stream_type: 'table', stream_id: 'T5' },
    target,
    values: { table_id: 'T5', seating_id: 'S5' },
    display,
    dedupe_key: key,
  });
  async function rows(s: Seat, resource: 'alerts-inbox' | 'requests-to-answer' | 'my-requests'): Promise<Row[]> {
    const response = await hub.app.inject({
      method: 'GET',
      url: `/queries/${resource}`,
      headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
    });
    expect(response.statusCode, resource).toBe(200);
    const data = (response.json() as { data: { alerts?: Row[]; requests?: Row[] } }).data;
    return data.alerts ?? data.requests ?? [];
  }

  it('[01d #70] (a) a linked kind: lock frame, card frame, alerts_open, catch-up, alerts-inbox and requests-to-answer rows carry the same target; my-requests has none', async () => {
    const tab = device('tablet', 'mgr tablet');
    const mgr = signIn(MGR, tab); // binds the tablet to MGR: its alert-mode socket gets the lock frames
    const hamza = signIn(WAIT, device('tablet', 'hamza tablet'));
    const mode = await alertSocket(tab);
    const staff = await socketOf(mgr);
    const id = raiseAs(hamza, linkedRequest());
    const plain = raiseAs(null, { kind: 't_info', subject: { stream_type: 'hub', stream_id: BRANCH }, target: { kind: 'person', staff_id: MGR }, display, dedupe_key: 'plain' });
    await fence();

    const card = alertFrames(staff).find((f) => f.alert_id === id);
    expect(card).toMatchObject({ card: { details: DETAILS }, target: LINE });
    const lock = alertFrames(mode).find((f) => f.alert_id === id);
    expect(lock).not.toHaveProperty('card');
    expect(lock?.target).toEqual(LINE);
    expect(openRows(await alertSocket(tab)).find((r) => r.alert_id === id)?.target).toEqual(LINE);
    expect(catchUpOf(await socketOf(mgr)).find((r) => r.alert_id === id)?.target).toEqual(LINE);
    expect((await rows(mgr, 'alerts-inbox')).find((r) => r.alert_id === id)?.target).toEqual(LINE);
    expect((await rows(mgr, 'requests-to-answer')).find((r) => r.alert_id === id)?.target).toEqual(LINE);
    // a kind without `link`: target null on every view (present, not absent)
    expect(alertFrames(staff).find((f) => f.alert_id === plain)).toHaveProperty('target', null);
    expect((await rows(mgr, 'alerts-inbox')).find((r) => r.alert_id === plain)).toHaveProperty('target', null);
    // the requester's waiting card is not a notification: lock only, no target (§3.13.1)
    const mine = (await rows(hamza, 'my-requests')).find((r) => r.alert_id === id);
    expect(mine).toBeDefined();
    expect(mine).not.toHaveProperty('target');
  });

  it('[01d #70] (a) a device target (a KDS station socket\'s lock-only catch-up row, its lock frame) carries the target too', async () => {
    const kds = device('kds', 'kds');
    const before = raiseAs(null, infoTo(LINKED_INFO, { kind: 'device', device_id: kds }, 'dev1'));
    const ws = await stationSocket(kds);
    expect(catchUpOf(ws).find((r) => r.alert_id === before)).toMatchObject({ target: { type: 'table', table_id: 'T5', seating_id: 'S5' } });
    const after = raiseAs(null, infoTo(LINKED_INFO, { kind: 'device', device_id: kds }, 'dev2'));
    await fence();
    const frame = alertFrames(ws).find((f) => f.alert_id === after);
    expect(frame).not.toHaveProperty('card');
    expect(frame?.target).toEqual({ type: 'table', table_id: 'T5', seating_id: 'S5' });
  });

  it('[01d #70] (c) a link that throws or returns a type outside the schema → target null; the view is still built and sent', async () => {
    const tab = device('tablet', 'mgr tablet');
    const mgr = signIn(MGR, tab);
    const staff = await socketOf(mgr);
    const thrown = raiseAs(null, infoTo(THROWS, { kind: 'person', staff_id: MGR }, 'throws'));
    const nope = raiseAs(null, infoTo(NOPE, { kind: 'person', staff_id: MGR }, 'nope'));
    await fence();
    for (const id of [thrown, nope]) {
      expect(alertFrames(staff).find((f) => f.alert_id === id), id).toHaveProperty('target', null);
      expect((await rows(mgr, 'alerts-inbox')).find((r) => r.alert_id === id), id).toHaveProperty('target', null);
      expect(catchUpOf(await socketOf(mgr)).find((r) => r.alert_id === id), id).toHaveProperty('target', null);
    }
  });

  it('[01d #70] (b) the strict lock pick accepts target and still refuses card, details, answers, needs_pin, silent, raised_device_id', () => {
    const kind = kindOf(LINKED)!;
    const row = { alert_id: 'A1', kind: LINKED, family: 'urgent' as const, display_json: JSON.stringify(display), values_json: JSON.stringify({ order_id: 'O1', order_item_id: 'L1' }), raised_at: 1 };
    const place = { escalation: false, set: 'answerer' as const, for_staff_id: null };
    const lock = lockOnlyView(row, kind, 0, place);
    expect(lock.target).toEqual(LINE);
    expect(StrictLockView.safeParse(lock).success).toBe(true);
    for (const extra of [{ card: { kind_label_key: 'x', table_code: null, point_code: null, requester_name: null, details: null } }, { details: DETAILS }, { answers: ['approve'] }, { needs_pin: 'never' }, { silent: false }, { raised_device_id: 'D1' }]) {
      expect(StrictLockView.safeParse({ ...lock, ...extra }).success, Object.keys(extra)[0]).toBe(false);
    }
    const card = signedInView({ ...row, details_json: JSON.stringify(DETAILS), request_json: JSON.stringify({ answers: ['approve', 'reject'], needs_pin: 'always' }), raised_device_id: 'D1' }, kind, 0, place);
    expect(card.target).toEqual(LINE);
  });

  it('[01d #70] (c) the hub\'s strict view schemas refuse a target outside AlertLinkTargetSchema (no silent catch on the emit side)', () => {
    const kind = kindOf(LINKED)!;
    const row = { alert_id: 'A1', kind: LINKED, family: 'urgent' as const, display_json: JSON.stringify(display), values_json: JSON.stringify({ order_id: 'O1', order_item_id: 'L1' }), raised_at: 1 };
    const lock = lockOnlyView(row, kind, 0, { escalation: false, set: 'answerer', for_staff_id: null });
    for (const bad of [{ type: 'station', station_id: 'S1' }, { ...LINE, item_name: 'Mutton platter' }, { type: 'order', order_id: '' }]) {
      expect(StrictLockView.safeParse({ ...lock, target: bad }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(StrictCardView.shape.target.safeParse({ type: 'station' }).success).toBe(false);
    expect(StrictLockView.safeParse({ ...lock, target: null }).success).toBe(true);
  });

  it('[01d #70] (d) (e) a frame with an unknown or malformed target parses through WsServerMessage to target null and is kept; no target key parses', () => {
    const view = { alert_id: 'A1', kind: LINKED, family: 'urgent', step: 0, escalation: false, set: 'answerer', for_staff_id: null, raised_at: 1, lock: { kind_label_key: 'k', table_code: null, point_code: null, requester_name: null } };
    for (const target of [{ type: 'station', station_id: 'S1' }, { type: 'order_line', order_id: 'O1' }, 'O1']) {
      const parsed = WsServerMessage.parse({ type: 'alert', alert: { ...view, target } }) as { type: 'alert'; alert: AlertView };
      expect(parsed.alert.alert_id).toBe('A1');
      expect(parsed.alert.target, JSON.stringify(target)).toBeNull();
    }
    const old = WsServerMessage.parse({ type: 'alert', alert: view }) as { type: 'alert'; alert: AlertView };
    expect(old.alert.alert_id).toBe('A1');
    expect(old.alert.target).toBeUndefined();
  });
});

describe('[01d §3.13.1] safeLink and lockView', () => {
  const kinds: string[] = [];
  const make = (kind: string, link?: (v: Record<string, unknown>) => unknown): AlertKind =>
    (kinds.push(kind),
    defineAlertKind({
      kind,
      family: 'info',
      subject: 'hub',
      steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
      closes_on: 'owner',
      values_schema: z.object({}).passthrough(),
      details_schema: null,
      lead_fallback: false,
      expires_at_day_close: true,
      silent: false,
      labels: { card: `alert.${kind}.card`, lock: `alert.${kind}.lock` },
      ...(link === undefined ? {} : { link: link as (v: Record<string, unknown>) => AlertLinkTarget | null }),
      request: null,
    }) as unknown as AlertKind);
  afterEach(() => {
    for (const kind of kinds.splice(0)) unregisterAlertKind(kind);
  });

  it('[01d §3.13.1] no link → null; a valid target → it; a throw, null, undefined, an unknown type, an extra key, an empty id → null', () => {
    expect(safeLink(make('t_sl_none'), {})).toBeNull();
    expect(safeLink(make('t_sl_ok', () => LINE), {})).toEqual(LINE);
    expect(safeLink(make('t_sl_values', (v) => ({ type: 'order', order_id: v.order_id })), { order_id: 'O9' })).toEqual({ type: 'order', order_id: 'O9' });
    const bad: Array<[string, () => unknown]> = [
      ['t_sl_throw', () => { throw new Error('boom'); }],
      ['t_sl_throw_value', () => { throw 'not an error'; }],
      ['t_sl_null', () => null],
      ['t_sl_undef', () => undefined],
      ['t_sl_nope', () => ({ type: 'nope' })],
      ['t_sl_station', () => ({ type: 'station', station_id: 'S1' })],
      ['t_sl_extra', () => ({ ...LINE, amount: 480_000 })],
      ['t_sl_empty', () => ({ type: 'order', order_id: '' })],
      ['t_sl_string', () => 'O1'],
    ];
    for (const [kind, link] of bad) expect(safeLink(make(kind, link), {}), kind).toBeNull();
  });

  it('[01d §3.13.1] lockView: target from values_json; unreadable values_json → null, the view is still built', () => {
    const kind = make('t_sl_view', (v) => ({ type: 'order', order_id: v.order_id }));
    const row = { alert_id: 'A1', kind: 't_sl_view', family: 'info' as const, display_json: JSON.stringify({ kind_label_key: 'k' }), raised_at: 1 };
    expect(lockView({ ...row, values_json: JSON.stringify({ order_id: 'O1' }) }, kind, 0).target).toEqual({ type: 'order', order_id: 'O1' });
    for (const values_json of ['not json', 'null', '[]', '"O1"']) {
      const view = lockView({ ...row, values_json }, kind, 0);
      expect(view.alert_id, values_json).toBe('A1');
      expect(view.target, values_json).toBeNull();
    }
  });

  it('[01d §3.10 note] the four copy kinds read values.link (absent → null; a bad stored link → null)', () => {
    for (const kind of [REQUEST_RESULT, APPROVAL_RECEIPT, ANSWERED_ON_REQUESTER_DEVICE, PIN_USE_FAILED] as unknown as AlertKind[]) {
      expect(safeLink(kind, { request_alert_id: 'A1', link: LINE }), kind.kind).toEqual(LINE);
      expect(safeLink(kind, { request_alert_id: 'A1', link: null }), kind.kind).toBeNull();
      expect(safeLink(kind, { request_alert_id: 'A1' }), kind.kind).toBeNull();
      expect(safeLink(kind, { request_alert_id: 'A1', link: { type: 'nope' } }), kind.kind).toBeNull();
      // the values schema keeps `link` (strict target, nullable, optional)
      const shape = kind.values_schema.shape as Record<string, z.ZodType>;
      expect(shape.link?.safeParse(LINE).success, kind.kind).toBe(true);
      expect(shape.link?.safeParse(null).success, kind.kind).toBe(true);
      expect(shape.link?.safeParse(undefined).success, kind.kind).toBe(true);
      expect(shape.link?.safeParse({ type: 'nope' }).success, kind.kind).toBe(false);
    }
  });
});
