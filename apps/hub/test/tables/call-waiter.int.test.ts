import type { BranchConfig, DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kindOf } from '../../src/alerts/kinds';
import { startTickLoop, TICK_MS } from '../../src/alerts/tick';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { cleanTableCommand } from '../../src/tables/commands/bill-clean';
import { callWaiterCommand } from '../../src/tables/commands/call-waiter';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';

// 02a §3.13, §6.14 CallWaiter and kind `call_waiter`, §3.5 waiter team, 01d D-3 skip_requester, §8 P-1f.
// State is seeded with real events through the writer (lane rule 2); no other lane's command is called.

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;
let lastQueuedAt: number | null | undefined;
const clients: WsClient[] = [];

function grant(permission: string, scope: 'branch' | 'my_floors' | 'own_tables' = 'branch') {
  return { permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope };
}

// S_ALI holds the seatings; S_W1 / S_W2 report to him (W when working); S_BOB is a branch-scope order taker
// outside the team; S_ZAIN is my_floors (F1), S_OMAR own_tables.
async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const person = (staff_id: string, role_id: string, lead_staff_id: string | null = null, floor_ids: string[] = []) => ({
    staff_id,
    display_name: staff_id,
    pin_hash: pin,
    role_ids: [role_id],
    denied_permissions: [],
    lead_staff_id,
    floor_ids,
  });
  const role = (role_id: string, permissions: ReturnType<typeof grant>[]) => ({ role_id, name: role_id, session_idle_ttl_ms: 3_600_000, permissions });
  return {
    ...base,
    roles: [
      ...base.roles,
      role('R_TAKER', [grant('take-order'), grant('clean-table')]),
      role('R_FLOOR', [grant('take-order', 'my_floors')]),
      role('R_OWN', [grant('take-order', 'own_tables')]),
    ],
    staff: [
      ...base.staff,
      person('S_ALI', 'R_TAKER'),
      person('S_W1', 'R_TAKER', 'S_ALI'),
      person('S_W2', 'R_TAKER', 'S_ALI'),
      person('S_BOB', 'R_TAKER'),
      person('S_ZAIN', 'R_FLOOR', null, ['F1']),
      person('S_OMAR', 'R_OWN'),
      person('S_HOLD', 'R_TAKER', 'S_BOB'), // a holder with a lead (S_BOB) and no reports
    ],
  };
}

// engine_settings: the table_locks tick reads the lock TTL from the config when the #35 test runs the tick loop
const CONFIG = {
  engine_settings: { table_lock_ttl_ms: 600_000 },
  floors: [
    { floor_id: 'F1', tables: [{ table_id: 'T1', name: 'Table 1', zone_id: null }, { table_id: 'T2', name: 'Table 2', zone_id: null }] },
    { floor_id: 'F2', tables: [{ table_id: 'T9', name: 'Table 9', zone_id: null }] },
  ],
} as unknown as BranchConfig;

beforeEach(async () => {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  swapBranchConfig({ config: CONFIG, snapshotHash: 'h'.repeat(64), configVersion: 1, snapshotSchemaVersion: 4, appliedAt: 0 });
  const registry = commandRegistry(hub.app);
  // R-2D-6: the real CleanTable handler under a test-only name, so its own statements are counted (SG-3 pattern).
  registry.register(
    defineCommand({
      ...cleanTableCommand,
      commandType: 'TestCleanTableCounted',
      handle(ctx, payload, cmd) {
        const before = counter.count;
        try {
          return cleanTableCommand.handle(ctx, payload, cmd);
        } finally {
          lastStatements = counter.count - before;
        }
      },
    }),
  );
  // #61: the real CallWaiter def (its queueable flag included) under a test-only name, recording ctx.queuedAt.
  registry.register(
    defineCommand({
      ...callWaiterCommand,
      commandType: 'TestCallWaiterQueuedAt',
      handle(ctx, payload, cmd) {
        lastQueuedAt = ctx.queuedAt;
        return callWaiterCommand.handle(ctx, payload, cmd);
      },
    }),
  );
  counter = statementCounter(hub.deps.db);
  lastStatements = -1;
  lastQueuedAt = undefined;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  vi.useRealTimers();
  swapBranchConfig(null);
  await hub.close();
});

// ------------------------------------------------------------------------------------------- seeding

function ev(stream_type: 'table' | 'order', stream_id: string, event_type: string, payload: Record<string, unknown>): EventDraft {
  return {
    stream_type,
    stream_id,
    event_type,
    schema_version: 1,
    payload,
    occurred_at: hub.clock.branchNow(),
    actor_id: 'S_ALI',
    device_id: 'D_SEED',
  } as EventDraft;
}

function append(...drafts: EventDraft[]): void {
  for (const d of drafts) {
    hub.clock.advance(1_000);
    hub.deps.writer.run((tx) => tx.append([d]));
  }
}

const opened = (table_id: string, seating_id: string, holder = 'S_ALI') =>
  ev('table', table_id, 'TableOpened', { table_id, seating_id, holder_staff_id: holder, party_size: 2 });
function placed(order_id: string, seating_id: string): EventDraft {
  const T = hub.clock.branchNow();
  return ev('order', order_id, 'OrderPlaced', {
    order_id,
    order_type: 'dine_in',
    table_id: null,
    table_key: `dine_in:${seating_id}`,
    follow_up: false,
    pickup_at_ms: null,
    order_item_ids: [`${order_id}-L1`],
    groups: [{ group_id: `${order_id}:0`, target_land_ms: T + 600_000, promise_ms: T + 900_000, order_item_ids: [`${order_id}-L1`] }],
    lines: [],
  });
}
const billClosed = (seating_id: string, table_id: string) => ev('table', table_id, 'BillClosed', { seating_id });
const cleaned = (seating_id: string, table_ids: string[]) =>
  ev('table', table_ids[0]!, 'TableCleaned', { seating_id, table_ids, reason: 'cleaned', by_staff_id: 'S_ALI' });

/** A second table joined to an open seating (SQL into 0012, lane rule 2; merge is lane C's command). */
function join(table_id: string, seating_id: string): void {
  hub.deps.db.prepare('INSERT INTO seating_tables (table_id, seating_id, joined_at) VALUES (?, ?, ?)').run(table_id, seating_id, hub.clock.branchNow() + 1);
}

function eventCount(): number {
  return (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
}

interface AlertRow {
  state: string;
  close_reason: string | null;
  kind: string;
  subject_stream_type: string;
  subject_stream_id: string;
  dedupe_key: string;
  requester_staff_id: string | null;
  values_json: string;
  display_json: string;
}
function alertRow(alert_id: string): AlertRow {
  return hub.deps.db
    .prepare(
      `SELECT state, close_reason, kind, subject_stream_type, subject_stream_id, dedupe_key, requester_staff_id, values_json, display_json
         FROM alerts WHERE alert_id = ?`,
    )
    .get(alert_id) as AlertRow;
}

// ------------------------------------------------------------------------------------------- calls

interface Who {
  staffId: string;
  deviceId: string;
  token: string;
  sessionToken: string;
}

function signIn(staffId: string): Who {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, token: device.token, sessionToken: session.token };
}

/** A staff socket on the person's tablet (a `screen` route for 01d's routing, §3.4.3). */
async function online(who: Who): Promise<WsClient> {
  const ws = await connectWs(hub.app);
  clients.push(ws);
  ws.send({ type: 'auth', device_token: who.token, session_token: who.sessionToken });
  await ws.untilCount(1);
  return ws;
}

interface Stored {
  event_type: string;
  stream_type: string;
  stream_id: string;
  actor_id: string | null;
  device_id: string;
  payload: Record<string, unknown>;
}

interface Reply {
  status: number;
  body: unknown;
  result: Record<string, unknown> | undefined;
  events: Stored[];
  error?: { code: string; details: Record<string, unknown> };
}

type Payload = { table_id: string; seating_id: string; chip?: string };
let commandSeq = 0;

async function call(
  who: Who,
  type: 'CallWaiter' | 'TestCleanTableCounted' | 'TestCallWaiterQueuedAt',
  payload: Payload,
  o: { queuedAt?: number; commandId?: string } = {},
): Promise<Reply> {
  commandSeq += 1;
  const path = { CallWaiter: 'call-waiter', TestCleanTableCounted: 'test-clean-table-counted', TestCallWaiterQueuedAt: 'test-call-waiter-queued-at' }[type];
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${path}`,
    headers: {
      authorization: `Bearer ${who.token}`,
      'x-session-token': who.sessionToken,
      ...(o.queuedAt === undefined ? {} : { 'x-queued-at': String(o.queuedAt) }),
    },
    payload: {
      command_id: o.commandId ?? `cmd-${commandSeq}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: type,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: who.staffId,
      device_id: who.deviceId,
    },
  });
  const body = res.json() as {
    data?: { event_ids: string[]; result: Record<string, unknown> };
    error?: { code: string; details: Record<string, unknown> };
  };
  const events =
    body.data === undefined
      ? []
      : (
          hub.deps.db
            .prepare(
              `SELECT event_type, stream_type, stream_id, actor_id, device_id, payload AS payload_json FROM events
                WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY seq`,
            )
            .all(JSON.stringify(body.data.event_ids)) as Array<Omit<Stored, 'payload'> & { payload_json: string }>
        ).map(({ payload_json, ...rest }) => ({ ...rest, payload: JSON.parse(payload_json) as Record<string, unknown> }));
  const error = body.error === undefined ? undefined : { code: body.error.code, details: body.error.details };
  return { status: res.statusCode, body, result: body.data?.result, events, error };
}

type RecipientRow = { staff_id: string | null; device_id: string | null; for_staff_id: string | null; set: string };
const attempt = (r: Reply) => r.events.find((e) => e.event_type === 'AttemptSent')?.payload as
  | { step: number; recipients: RecipientRow[]; routes: Array<{ staff_id: string | null; route: string; ref: string }> }
  | undefined;
const staffOf = (r: Reply) => (attempt(r)?.recipients ?? []).map((x) => x.staff_id).sort();

// ------------------------------------------------------------------------------------------- kind

describe('kind call_waiter (02a §6.14)', () => {
  it('[02a §6.14] registered at module load with the spec fields verbatim', () => {
    const kind = kindOf('call_waiter');
    expect(kind).toBeDefined();
    expect(kind).toMatchObject({
      kind: 'call_waiter',
      family: 'action',
      subject: 'table',
      steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
      closes_on: { after_ms: 300_000 },
      details_schema: null,
      lead_fallback: true,
      expires_at_day_close: true,
      silent: false,
      skip_requester: true,
      labels: { card: 'alert.call_waiter.card', lock: 'alert.call_waiter.lock' },
      request: null,
    });
    const values = kind!.values_schema;
    expect(values.safeParse({ table_id: 'T1', seating_id: 'S1' }).success).toBe(true);
    expect(values.safeParse({ table_id: 'T1', seating_id: 'S1', chip: 'water' }).success).toBe(true);
    expect(values.safeParse({ table_id: 'T1', seating_id: 'S1', chip: 'beer' }).success).toBe(false);
    expect(values.safeParse({ table_id: '', seating_id: 'S1' }).success).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------- CallWaiter

describe('CallWaiter (02a §6.14, §3.13)', () => {
  it('[02a #35] CallWaiter → W ∪ {holder}; repeat → repeated: true; closes after 5 min; a new call after that raises again', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const bob = signIn('S_BOB');
    signIn('S_W1'); // working; S_W2 is not
    append(opened('T1', 'S1'), placed('O1', 'S1'));

    const first = await call(bob, 'CallWaiter', { table_id: 'T1', seating_id: 'S1', chip: 'water' });
    expect(first.status).toBe(200);
    const alertId = first.result?.alert_id as string;
    expect(first.result).toEqual({ alert_id: alertId, repeated: false, recipients: 2 });
    expect(first.events.map((e) => [e.event_type, e.stream_type, e.stream_id, e.actor_id, e.device_id])).toEqual([
      ['AlertRaised', 'table', 'T1', 'S_BOB', bob.deviceId],
      ['AttemptSent', 'table', 'T1', 'S_BOB', bob.deviceId],
    ]);
    expect(staffOf(first)).toEqual(['S_ALI', 'S_W1']);
    expect(first.events[0]!.payload).toMatchObject({
      kind: 'call_waiter',
      family: 'action',
      subject_stream_type: 'table',
      subject_stream_id: 'T1',
      dedupe_key: 'call_waiter:S1',
      requester_staff_id: 'S_BOB',
      target: { kind: 'table_team', table_id: 'T1', depth: 'direct' },
      values: { table_id: 'T1', seating_id: 'S1', chip: 'water' },
      display: { kind_label_key: 'alert.call_waiter.lock', table_code: 'Table 1' },
      details: null,
    });

    const before = eventCount();
    const repeat = await call(bob, 'CallWaiter', { table_id: 'T1', seating_id: 'S1' });
    expect(repeat.status).toBe(200);
    expect(repeat.result).toEqual({ alert_id: alertId, repeated: true });
    expect(repeat.events).toEqual([]);
    expect(eventCount()).toBe(before);

    // §3.13: closes after 5 minutes (closes_on.after_ms), by the 01d tick
    const log = { error: vi.fn() };
    const stop = startTickLoop(hub.deps, log);
    try {
      hub.clock.advance(300_000 - 1);
      await vi.advanceTimersByTimeAsync(TICK_MS);
      expect(alertRow(alertId).state).toBe('open');
      hub.clock.advance(1);
      await vi.advanceTimersByTimeAsync(TICK_MS);
    } finally {
      stop();
    }
    expect(log.error).not.toHaveBeenCalled();
    expect(alertRow(alertId)).toMatchObject({ state: 'closed', close_reason: 'expired' });

    const again = await call(bob, 'CallWaiter', { table_id: 'T1', seating_id: 'S1' });
    expect(again.result).toMatchObject({ repeated: false, recipients: 2 });
    expect(again.result?.alert_id).not.toBe(alertId);
  });

  it('[02a #35] CleanTable closes the open call_waiter `obsolete`; statements 1 + 2 byDedupeKey + closeMany bound', async () => {
    const bob = signIn('S_BOB');
    append(opened('T1', 'S1'));
    const raised = await call(bob, 'CallWaiter', { table_id: 'T1', seating_id: 'S1' });
    const alertId = raised.result?.alert_id as string;
    expect(alertRow(alertId).state).toBe('open');

    const clean = await call(bob, 'TestCleanTableCounted', { table_id: 'T1', seating_id: 'S1' });
    expect(clean.status).toBe(200);
    expect(clean.events.map((e) => e.event_type)).toEqual(['TableCleaned', 'AlertClosed']);
    expect(clean.events[1]).toMatchObject({ stream_type: 'table', stream_id: 'T1', payload: { alert_id: alertId, reason: 'obsolete', by_staff_id: 'S_BOB' } });
    expect(alertRow(alertId)).toMatchObject({ state: 'closed', close_reason: 'obsolete' });
    // 1 seating read + 2 byDedupeKey + closeMany's bound for non-requests: its one alert read, no raiseMany
    // (alerts/raise.ts closeMany; 01d close.int.test "closeMany of non-requests issues the alert read only")
    expect(lastStatements).toBe(4);
  });

  it('[02a #50] CallWaiter by the holder → his own devices get nothing (D-3); the rest of W do', async () => {
    const ali = signIn('S_ALI');
    const w1 = signIn('S_W1');
    signIn('S_W2');
    const aliWs = await online(ali);
    const w1Ws = await online(w1);
    append(opened('T1', 'S1'));

    const r = await call(ali, 'CallWaiter', { table_id: 'T1', seating_id: 'S1' });
    expect(r.status).toBe(200);
    expect(r.result).toMatchObject({ repeated: false, recipients: 2 });
    expect(staffOf(r)).toEqual(['S_W1', 'S_W2']);
    const sent = attempt(r)!;
    // every route is W1's (his screen socket and its alert connection); none reaches the holder's tablet
    expect(sent.routes.length).toBeGreaterThan(0);
    expect(sent.routes.every((x) => x.staff_id === 'S_W1' && x.ref === w1.deviceId)).toBe(true);
    expect(sent.routes.some((x) => x.ref === ali.deviceId)).toBe(false);
    expect(sent.recipients.some((x) => x.staff_id === 'S_ALI' || x.for_staff_id === 'S_ALI')).toBe(false);

    await w1Ws.untilCount(2); // W1's tablet gets the alert frame
    const kinds = (ws: WsClient) => ws.messages.map((m) => (m as { type?: string }).type);
    expect(kinds(w1Ws)).toContain('alert');
    expect(kinds(aliWs)).not.toContain('alert');
  });

  it('[02a #50b] W = ∅, caller = holder → recipients: 0', async () => {
    const ali = signIn('S_ALI');
    append(opened('T1', 'S1'));
    const r = await call(ali, 'CallWaiter', { table_id: 'T1', seating_id: 'S1' });
    expect(r.status).toBe(200);
    expect(r.result).toEqual({ alert_id: r.result?.alert_id, repeated: false, recipients: 0 });
    expect(attempt(r)).toMatchObject({ step: 0, recipients: [] });
  });

  it('[02a #50b] W = ∅, caller = holder whose lead is working and online → recipients: 0, no "for" rows (D-3 skip_requester with lead_fallback)', async () => {
    const hold = signIn('S_HOLD');
    const bob = signIn('S_BOB'); // S_HOLD's lead, live staff session
    await online(hold);
    const bobWs = await online(bob);
    append(opened('T1', 'S1', 'S_HOLD'));
    const r = await call(hold, 'CallWaiter', { table_id: 'T1', seating_id: 'S1' });
    expect(r.status).toBe(200);
    expect(r.result).toEqual({ alert_id: r.result?.alert_id, repeated: false, recipients: 0 });
    // no recipient row at all: the holder is skipped (01d targets.ts skip_requester), so nobody lacks a route and
    // lead_fallback has no one to stand in for; the owner marker is skipped for the requester too
    expect(attempt(r)).toEqual({ alert_id: r.result?.alert_id, step: 0, recipients: [], routes: [] });
    expect(bobWs.messages.map((m) => (m as { type?: string }).type)).not.toContain('alert');
  });

  it('[02a §6.14] a joined table: subject on the primary, target and values name the table called; table_code the primary name', async () => {
    const bob = signIn('S_BOB');
    append(opened('T1', 'S1'));
    join('T2', 'S1');
    const r = await call(bob, 'CallWaiter', { table_id: 'T2', seating_id: 'S1', chip: 'clear' });
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.stream_id)).toEqual(['T1', 'T1']);
    expect(r.events[0]!.payload).toMatchObject({
      target: { kind: 'table_team', table_id: 'T2', depth: 'direct' },
      values: { table_id: 'T2', seating_id: 'S1', chip: 'clear' },
      display: { kind_label_key: 'alert.call_waiter.lock', table_code: 'Table 1' },
    });
    expect(staffOf(r)).toEqual(['S_ALI']);
    // one open per seating, whichever table is called
    const viaT1 = await call(bob, 'CallWaiter', { table_id: 'T1', seating_id: 'S1' });
    expect(viaT1.result).toEqual({ alert_id: r.result?.alert_id, repeated: true });
  });

  it('[02a §6.14] no chip → values without chip', async () => {
    const bob = signIn('S_BOB');
    append(opened('T1', 'S1'));
    const r = await call(bob, 'CallWaiter', { table_id: 'T1', seating_id: 'S1' });
    expect(JSON.parse(alertRow(r.result?.alert_id as string).values_json)).toEqual({ table_id: 'T1', seating_id: 'S1' });
  });

  it('[02a §6.14] NEEDS_CLEANING → 409 TABLE_NEEDS_CLEANING, no event', async () => {
    const bob = signIn('S_BOB');
    append(opened('T1', 'S1'), placed('O1', 'S1'), billClosed('S1', 'T1'));
    const before = eventCount();
    const r = await call(bob, 'CallWaiter', { table_id: 'T1', seating_id: 'S1' });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'TABLE_NEEDS_CLEANING', details: { table_id: 'T1' } });
    expect(eventCount()).toBe(before);
  });

  it('[02a §6.14] stale seating_id (another seating on the table) → 409 TABLE_SEATING_CHANGED', async () => {
    const bob = signIn('S_BOB');
    append(opened('T1', 'S1'), placed('O1', 'S1'), billClosed('S1', 'T1'), cleaned('S1', ['T1']), opened('T1', 'S2'));
    const before = eventCount();
    const r = await call(bob, 'CallWaiter', { table_id: 'T1', seating_id: 'S1' });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'S1' } });
    expect(eventCount()).toBe(before);
  });

  it('[02a §6.14] no seating on the table → 409 TABLE_SEATING_CHANGED', async () => {
    const bob = signIn('S_BOB');
    const r = await call(bob, 'CallWaiter', { table_id: 'T1', seating_id: 'S1' });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'S1' } });
  });

  it('[02a §6.14] D32 retransmit: same command_id → same response, no new event', async () => {
    const bob = signIn('S_BOB');
    append(opened('T1', 'S1'));
    const first = await call(bob, 'CallWaiter', { table_id: 'T1', seating_id: 'S1' }, { commandId: 'call-once' });
    expect(first.status).toBe(200);
    const before = eventCount();
    const again = await call(bob, 'CallWaiter', { table_id: 'T1', seating_id: 'S1' }, { commandId: 'call-once' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(eventCount()).toBe(before);
  });

  it('[02a §6.14] scope (C8): my_floors outside the floor → 403 outside_scope; on the floor → passes', async () => {
    const zain = signIn('S_ZAIN');
    append(opened('T9', 'S9'), opened('T1', 'S1'));
    const before = eventCount();
    const out = await call(zain, 'CallWaiter', { table_id: 'T9', seating_id: 'S9' });
    expect(out.status).toBe(403);
    expect(out.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T9'] } });
    expect(eventCount()).toBe(before);
    const ok = await call(zain, 'CallWaiter', { table_id: 'T1', seating_id: 'S1' });
    expect(ok.status).toBe(200);
  });

  it('[02a §6.14] scope (C8): own_tables → only the seating whose holder is the caller', async () => {
    const omar = signIn('S_OMAR');
    append(opened('T1', 'S1', 'S_ALI'), opened('T2', 'S2', 'S_OMAR'));
    const out = await call(omar, 'CallWaiter', { table_id: 'T1', seating_id: 'S1' });
    expect(out.status).toBe(403);
    expect(out.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T1'] } });
    const ok = await call(omar, 'CallWaiter', { table_id: 'T2', seating_id: 'S2' });
    expect(ok.status).toBe(200);
    expect(ok.result).toMatchObject({ repeated: false, recipients: 0 });
  });

  it('[02a §6.14] scope is checked last: a state error wins over outside_scope', async () => {
    const zain = signIn('S_ZAIN');
    append(opened('T9', 'S9'), placed('O9', 'S9'), billClosed('S9', 'T9'));
    const r = await call(zain, 'CallWaiter', { table_id: 'T9', seating_id: 'S9' });
    expect(r.error?.code).toBe('TABLE_NEEDS_CLEANING');
  });

  it('[02a §3.14] CallWaiter on an archived seated table (absent from the config) works, table_code falls back to the table id', async () => {
    const bob = signIn('S_BOB');
    append(opened('T7', 'S7'));
    const r = await call(bob, 'CallWaiter', { table_id: 'T7', seating_id: 'S7' });
    expect(r.status).toBe(200);
    expect(JSON.parse(alertRow(r.result?.alert_id as string).display_json)).toEqual({ kind_label_key: 'alert.call_waiter.lock', table_code: 'T7' });
  });

  it('[02a §6.14] payload: seating_id required, chip from the enum (VALIDATION_FAILED)', async () => {
    const bob = signIn('S_BOB');
    append(opened('T1', 'S1'));
    const noSeating = await call(bob, 'CallWaiter', { table_id: 'T1' } as unknown as Payload);
    expect(noSeating.status).toBe(400);
    expect(noSeating.error?.code).toBe('VALIDATION_FAILED');
    const badChip = await call(bob, 'CallWaiter', { table_id: 'T1', seating_id: 'S1', chip: 'beer' });
    expect(badChip.status).toBe(400);
    expect(badChip.error?.code).toBe('VALIDATION_FAILED');
  });

  it('[02a #61 CallWaiter] not queueable: X-Queued-At is ignored (ctx.queuedAt null), the call succeeds', async () => {
    expect(callWaiterCommand.queueable).not.toBe(true);
    const registry = commandRegistry(hub.app);
    expect(registry.byPath('call-waiter')?.queueable).not.toBe(true);
    expect(registry.byPath('call-waiter')?.permission).toBe('take-order');

    const bob = signIn('S_BOB');
    append(opened('T1', 'S1'), opened('T2', 'S2'));
    const queuedAt = hub.clock.branchNow() - 5_000;
    const echoed = await call(bob, 'TestCallWaiterQueuedAt', { table_id: 'T1', seating_id: 'S1' }, { queuedAt });
    expect(echoed.status).toBe(200);
    expect(lastQueuedAt).toBeNull();
    const real = await call(bob, 'CallWaiter', { table_id: 'T2', seating_id: 'S2' }, { queuedAt });
    expect(real.status).toBe(200);
    expect(real.result).toMatchObject({ repeated: false });
  });
});
