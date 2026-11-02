import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import type { DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { aBusinessDayClosed, aBusinessDayOpened, aDevicePaired } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineAlertKind, kindOf } from '../../src/alerts/kinds';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { alertsTick, startTickLoop, TICK_MS } from '../../src/alerts/tick';
import { applyStaffDirectory } from '../../src/auth/apply-directory';
import { swapDirectory } from '../../src/auth/guards';
import { activity, createSession } from '../../src/auth/session-store';
import { boot } from '../../src/lib/boot';
import { registerRestaurantBootSteps } from '../../src/sync/boot-steps';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, endSessionNow, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { registerFakes, resetFakes } from './fakes';

// 01d task 31: the `no_approver` warning (§3.9, §3.10), the tick's flag pass (§3.5 read (2), m1) and BF-7
// (AD-3 / P-7: the same flag pass closes `obsolete` the open personal notices of people no longer in `staff`).
// Tests #32 and the hub parts of #59. The tick runs on fake setInterval; the hub clock is moved by hand.

const OWNER = 'S_OWNER'; // manager (force-release-table-lock, branch), not an approver role
const MGR = 'S_MGR'; // approver (R_MGR), approve-void branch scope
const SUP = 'S_SUP'; // approver role R_SUP, approve-void only my_team
const DUAL = 'S_DUAL'; // requester of void-item AND the only approver role holder of it (R_APPR)
const ALI = 'S_ALI'; // approver who leaves (BF-7)
const WAIT = 'S_WAIT'; // requester of void-item
const BRANCH = 'branch-1';
const NOTICES = ['approval_receipt', 'answered_on_requester_device', 'pin_use_failed'] as const;

type Grant = DirectoryInput['roles'][number]['permissions'][number];
const allowed = (permission: Grant['permission'], scope: Grant['scope'] = 'branch'): Grant => ({
  permission,
  grant_type: 'allowed',
  approver_role_id: null,
  approver_role_ids: [],
  scope,
});
const needsApproval = (permission: Grant['permission'], approvers: string[]): Grant => ({
  permission,
  grant_type: 'requires_approval',
  approver_role_id: approvers[0] ?? null,
  approver_role_ids: approvers,
  scope: 'branch',
});

/**
 * One permission needs approval (void-item, by R_MGR / R_SUP); R_MGR holds approve-void branch-wide, R_SUP
 * only my_team. OWNER is a manager (§3.4 `managers`) but holds no approver role.
 */
async function directory(o: { without?: string[]; noPin?: string[]; version?: number; extra?: number; discount?: boolean } = {}): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = (base.staff[0] as DirectoryInput['staff'][number]).pin_hash;
  const person = (staff_id: string, role_ids: string[]): DirectoryInput['staff'][number] => ({
    staff_id,
    display_name: staff_id,
    pin_hash: pin,
    role_ids,
    denied_permissions: [],
    lead_staff_id: null,
    floor_ids: [],
  });
  const staff = [person(OWNER, ['R_OWNER']), person(MGR, ['R_MGR']), person(SUP, ['R_SUP']), person(ALI, ['R_MGR']), person(WAIT, ['R_WAIT'])].filter(
    (s) => !(o.without ?? []).includes(s.staff_id) && !(o.noPin ?? []).includes(s.staff_id),
  );
  // `extra` order takers (no approver role): the flag pass's statement count must not grow with them
  for (let i = 0; i < (o.extra ?? 0); i += 1) staff.push(person(`S_X${String(i).padStart(3, '0')}`, ['R_WAIT']));
  // `discount`: a second permission that needs approval (by R_MGR only), so the flag pass raises two warnings
  const wait = o.discount === true ? [needsApproval('void-item', ['R_MGR', 'R_SUP']), needsApproval('apply-discount', ['R_MGR'])] : [needsApproval('void-item', ['R_MGR', 'R_SUP'])];
  return {
    ...base,
    directory_version: o.version ?? (base.directory_version ?? 1) + (o.without?.length ?? 0) + (o.noPin?.length ?? 0),
    roles: [
      { role_id: 'R_OWNER', name: 'Owner', session_idle_ttl_ms: 3_600_000, permissions: [allowed('force-release-table-lock')] },
      { role_id: 'R_MGR', name: 'Manager', session_idle_ttl_ms: 3_600_000, permissions: [allowed('approve-void'), allowed('force-release-table-lock')] },
      { role_id: 'R_SUP', name: 'Supervisor', session_idle_ttl_ms: 3_600_000, permissions: [allowed('approve-void', 'my_team')] },
      { role_id: 'R_WAIT', name: 'Order taker', session_idle_ttl_ms: 300_000, permissions: wait },
    ],
    staff,
    responsibilities: [],
    no_pin_staff: (o.noPin ?? []).map((staff_id) => ({ staff_id, display_name: staff_id, lead_staff_id: null })),
  };
}

const display = { kind_label_key: 'alert.t.lock', table_code: '12', requester_name: 'Order taker' };

function receiptInput(staffId: string, n: number): RaiseInput {
  return {
    kind: 'approval_receipt',
    subject: { stream_type: 'order', stream_id: `O${n}` },
    target: { kind: 'person', staff_id: staffId },
    values: { request_alert_id: `REQ${n}`, request_kind: 't_approval', decision: 'approve', device_id: 'dev-x', on_requester_device: false },
    display,
    details: {},
    dedupe_key: `approval_receipt:REQ${n}`,
  };
}

function noticeInput(kind: (typeof NOTICES)[number], staffId: string, n: number): RaiseInput {
  if (kind === 'approval_receipt') return receiptInput(staffId, n);
  const values =
    kind === 'pin_use_failed'
      ? { request_alert_id: `REQ${n}`, request_kind: 't_approval', error_code: 'ITEM_WRONG_STAGE', device_id: 'dev-x' }
      : { request_alert_id: `REQ${n}`, request_kind: 't_approval', decision: 'approve', device_id: 'dev-x' };
  return { kind, subject: { stream_type: 'order', stream_id: `O${n}` }, target: { kind: 'person', staff_id: staffId }, values, display, dedupe_key: `${kind}:REQ${n}` };
}

const voidInput = (n: number, requester: string): RaiseInput => ({
  kind: 't_approval',
  subject: { stream_type: 'order', stream_id: `O${n}` },
  target: { kind: 'answerers' },
  values: { order_id: `O${n}` },
  display,
  details: { item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'customer changed mind' },
  dedupe_key: `void:O${n}`,
  requester_staff_id: requester,
  request: { approver_role_ids: ['R_MGR', 'R_SUP', 'R_APPR'] },
});

function draftOf(e: PosEvent, now: number, streamId = BRANCH): EventDraft {
  return {
    stream_type: e.stream_type,
    stream_id: streamId,
    event_type: e.event_type,
    schema_version: e.schema_version,
    payload: e.payload,
    occurred_at: now,
    actor_id: e.actor_id,
    device_id: e.device_id,
  };
}

interface Row {
  alert_id: string;
  kind: string;
  dedupe_key: string;
  state: string;
  close_reason: string | null;
}

describe('01d no_approver and BF-7 (task 31)', () => {
  let hub: TestHub;
  let stop: () => void = () => undefined;
  const clients: WsClient[] = [];
  const log = { error: vi.fn<(obj: Record<string, unknown>, msg?: string) => void>() };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    hub = await createTestHub();
    registerFakes();
    await seedDirectory(hub, await directory());
    log.error.mockClear();
  });

  afterEach(async () => {
    stop();
    stop = () => undefined;
    for (const c of clients.splice(0)) c.close();
    vi.restoreAllMocks();
    resetFakes();
    activity.drain();
    activity.drainDevices();
    vi.useRealTimers();
    await hub.close();
  });

  function start(): void {
    stop = startTickLoop(hub.deps, log);
  }

  async function pass(): Promise<void> {
    await vi.advanceTimersByTimeAsync(TICK_MS);
  }

  function openDay(): void {
    hub.deps.writer.run((tx) => tx.append([draftOf(aBusinessDayOpened(), hub.clock.branchNow())]));
  }

  function closeDay(): void {
    hub.deps.writer.run((tx) => tx.append([draftOf(aBusinessDayClosed(), hub.clock.branchNow())]));
  }

  function raiseHub(inputs: RaiseInput[]): string[] {
    return hub.deps.writer.run((tx) => {
      const results = alerts.raiseMany(alerts.tickCtx(tx, hub.clock.branchNow()), inputs);
      tx.append(results.flatMap((r) => r.events));
      return results.map((r) => r.alert_id);
    }).result;
  }

  function rows(kind?: string): Row[] {
    const all = hub.deps.db.prepare('SELECT alert_id, kind, dedupe_key, state, close_reason FROM alerts ORDER BY raised_seq').all() as Row[];
    return kind === undefined ? all : all.filter((r) => r.kind === kind);
  }

  const openNoApprover = (): string[] =>
    rows('no_approver')
      .filter((r) => r.state === 'open')
      .map((r) => r.dedupe_key);

  function events(alertId?: string): PosEvent[] {
    const all = (hub.deps.db.prepare('SELECT * FROM events ORDER BY seq').all() as Array<Record<string, unknown>>).map(
      (row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent,
    );
    return alertId === undefined ? all : all.filter((e) => (e.payload as { alert_id?: unknown }).alert_id === alertId);
  }

  const dirty = (): number => (hub.deps.db.prepare(`SELECT dirty FROM alert_flags WHERE name = 'no_approver'`).get() as { dirty: number }).dirty;

  // ------------------------------------------------------------------------------------------------ #32

  it('[01d #32] day open, last branch-scope approver logs out → no_approver open on the kiosk + managers within one tick; approver signs in → closed done; flag cleared', async () => {
    const kiosk = pairDevice(hub, { type: 'cashier_kiosk', name: 'Counter' });
    const tablet = pairDevice(hub, { type: 'tablet' });
    openDay();
    const mgr = openSession(hub, { kind: 'staff', staffId: MGR, deviceId: tablet.deviceId });
    start();
    await pass();
    expect(openNoApprover()).toEqual([]);
    expect(dirty()).toBe(0);

    endSessionNow(hub, mgr.sessionId);
    expect(dirty()).toBe(1);
    await pass();
    expect(openNoApprover()).toEqual(['no_approver:void-item']);
    expect(dirty()).toBe(0);
    const [alert] = rows('no_approver') as [Row];
    const raised = events(alert.alert_id).find((e) => e.event_type === 'AlertRaised') as PosEvent;
    expect(raised).toMatchObject({ stream_type: 'hub', stream_id: BRANCH, actor_id: null, device_id: 'hub' });
    expect(raised.payload).toMatchObject({ kind: 'no_approver', family: 'info', dedupe_key: 'no_approver:void-item', values: { permission: 'void-item' } });
    const sent = events(alert.alert_id).find((e) => e.event_type === 'AttemptSent') as PosEvent;
    const recipients = (sent.payload as { recipients: Array<{ staff_id: string | null; device_id: string | null; for_staff_id: string | null }> }).recipients;
    expect(recipients.filter((r) => r.device_id === kiosk.deviceId && r.staff_id === null)).toHaveLength(1);
    expect(recipients.filter((r) => r.staff_id !== null).map((r) => r.staff_id).sort()).toEqual([ALI, MGR, OWNER].sort());
    expect(recipients.every((r) => r.for_staff_id === null)).toBe(true); // lead_fallback: false (N5)

    // a second pass without a cause writes nothing more
    await pass();
    expect(rows('no_approver')).toHaveLength(1);

    openSession(hub, { kind: 'staff', staffId: MGR, deviceId: tablet.deviceId });
    await pass();
    expect(rows('no_approver')).toEqual([expect.objectContaining({ state: 'closed', close_reason: 'done' })]);
    const closed = events(alert.alert_id).filter((e) => e.event_type === 'AlertClosed');
    expect(closed.map((e) => e.payload)).toEqual([{ alert_id: alert.alert_id, reason: 'done', by_staff_id: null, note: null }]);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('[01d #32] no business day open → no warning; the flag is still cleared', async () => {
    start();
    await pass();
    expect(rows('no_approver')).toEqual([]);
    expect(dirty()).toBe(0);
  });

  // ------------------------------------------------------------------------------------------------ §3.9

  it('[01d §3.9] approve-void is a range permission: an approver role holder with only my_team scope does not count; with no registered range kind they do', async () => {
    const tablet = pairDevice(hub, { type: 'tablet' });
    openDay();
    openSession(hub, { kind: 'staff', staffId: SUP, deviceId: tablet.deviceId });
    start();
    await pass();
    expect(openNoApprover()).toEqual(['no_approver:void-item']);

    // no kind registers void-item → approve-void: any approver role holder signed in counts
    resetFakes();
    hub.deps.db.prepare(`UPDATE alert_flags SET dirty = 1`).run();
    await pass();
    expect(openNoApprover()).toEqual([]);
    expect(rows('no_approver')[0]).toMatchObject({ close_reason: 'done' });
    registerFakes();
  });

  it('[01d §3.9] the requester being the only branch-scope approver signed in is not "no approver" (per-request warning deferred, §12.4)', async () => {
    const base = await directory();
    await seedDirectory(hub, {
      ...base,
      directory_version: base.directory_version + 1,
      roles: [
        ...base.roles.map((role) => (role.role_id === 'R_WAIT' ? { ...role, permissions: [needsApproval('void-item', ['R_APPR'])] } : role)),
        { role_id: 'R_APPR', name: 'Approver', session_idle_ttl_ms: 3_600_000, permissions: [allowed('approve-void')] },
      ],
      staff: [...base.staff, { ...(base.staff[0] as DirectoryInput['staff'][number]), staff_id: DUAL, display_name: DUAL, role_ids: ['R_APPR', 'R_WAIT'] }],
    });
    const tablet = pairDevice(hub, { type: 'tablet' });
    openDay();
    const dual = openSession(hub, { kind: 'staff', staffId: DUAL, deviceId: tablet.deviceId });
    raiseHub([voidInput(1, DUAL)]);
    start();
    await pass();
    expect(openNoApprover()).toEqual([]);
    expect(rows('t_approval')).toEqual([expect.objectContaining({ state: 'open' })]);
    // the same person signed out: now no one can approve void-item
    endSessionNow(hub, dual.sessionId);
    await pass();
    expect(openNoApprover()).toEqual(['no_approver:void-item']);
  });

  // ------------------------------------------------------------------------------------------------ BF-7

  it('[01d BF-7] Ali is removed from staff with an open approval_receipt → the next tick closes it obsolete; another person’s receipt stays open', async () => {
    const [ali, mgr] = raiseHub([receiptInput(ALI, 1), receiptInput(MGR, 2)]) as [string, string];
    start();
    await pass(); // the seed's flag: nothing to close
    expect(rows('approval_receipt').map((r) => r.state)).toEqual(['open', 'open']);

    await seedDirectory(hub, await directory({ without: [ALI] }));
    expect(dirty()).toBe(1);
    await pass();
    expect(rows('approval_receipt')).toEqual([
      expect.objectContaining({ alert_id: ali, state: 'closed', close_reason: 'obsolete' }),
      expect.objectContaining({ alert_id: mgr, state: 'open' }),
    ]);
    expect(events(ali).filter((e) => e.event_type === 'AlertClosed').map((e) => e.payload)).toEqual([
      { alert_id: ali, reason: 'obsolete', by_staff_id: null, note: null },
    ]);
    expect(dirty()).toBe(0);
  });

  it('[01d BF-7] a person moved to no_pin_staff → their open personal notices (all three kinds) close obsolete', async () => {
    const ids = raiseHub(NOTICES.map((k, i) => noticeInput(k, ALI, i)));
    start();
    await pass();
    await seedDirectory(hub, await directory({ noPin: [ALI] }));
    await pass();
    for (const id of ids) expect(rows().find((r) => r.alert_id === id)).toMatchObject({ state: 'closed', close_reason: 'obsolete' });
  });

  /**
   * The flag pass's statement count (AD row, task 31): inside `intents` the step pass's due read (1) and the
   * flags read (2), the fixed reads (3)–(6), (9) = 5, the flag pass's one alert read, the flag write; and, when it
   * raises, raiseMany's dedupe read + T (one `routesFor` per registered route: here the fake pager, T = 1).
   * R = 0: `always_on` and `managers` resolve in memory.
   */
  const T = 1;
  const FLAG_PASS = 1 + 1 + 5 + 1 + 1;
  const FLAG_PASS_RAISING = FLAG_PASS + 1 + T;

  /** Marks the flag, runs `intents` once in a transaction, counts its statements, and rolls the transaction back. */
  function measureFlagPass(): { statements: number; types: string[] } {
    hub.deps.db.prepare(`UPDATE alert_flags SET dirty = 1`).run();
    const counter = statementCounter(hub.deps.db);
    const out = { statements: -1, types: [] as string[] };
    const rollback = new Error('measured');
    try {
      hub.deps.writer.run((tx) => {
        counter.reset();
        const drafts = alertsTick.intents(tx, hub.deps.state.get(), hub.clock.branchNow());
        out.statements = counter.count;
        out.types = drafts.map((d) => d.event_type);
        throw rollback;
      });
    } catch (err) {
      if (err !== rollback) throw err;
    }
    return out;
  }

  it('[01d §3.5] the flag pass reads a fixed number of statements: 1 or 20 notices of removed staff cost the same, pinned to the formula', async () => {
    let version = 10;
    const count = async (n: number): Promise<{ statements: number; closed: number }> => {
      raiseHub(Array.from({ length: n }, (_, i) => receiptInput(ALI, 1000 * n + i)));
      version += 1;
      await seedDirectory(hub, await directory({ without: [ALI], version }));
      const counter = statementCounter(hub.deps.db);
      let statements = -1;
      const result = hub.deps.writer.run((tx) => {
        counter.reset();
        const drafts = alertsTick.intents(tx, hub.deps.state.get(), hub.clock.branchNow());
        statements = counter.count;
        return tx.append(drafts);
      });
      version += 1;
      await seedDirectory(hub, await directory({ version }));
      return { statements, closed: result.appended.filter((e) => e.event_type === 'AlertClosed').length };
    };
    const one = await count(1);
    const twenty = await count(20);
    expect(one.closed).toBe(1);
    expect(twenty.closed).toBe(20);
    expect(one.statements).toBe(FLAG_PASS); // no day open: nothing raised
    expect(twenty.statements).toBe(FLAG_PASS);
  });

  it('[01d §3.5] the flag pass raising: 1 or 2 warnings cost FLAG_PASS + dedupe 1 + T, the same with 60 more staff and 40 more open alerts', async () => {
    openDay();
    await seedDirectory(hub, await directory({ version: 20 }));
    const one = measureFlagPass();
    expect(one.types.filter((t) => t === 'AlertRaised')).toHaveLength(1);
    expect(one.statements).toBe(FLAG_PASS_RAISING);

    await seedDirectory(hub, await directory({ version: 21, discount: true }));
    const two = measureFlagPass();
    expect(two.types.filter((t) => t === 'AlertRaised')).toHaveLength(2);
    expect(two.statements).toBe(FLAG_PASS_RAISING);

    // 60 more people and 40 more open alerts (personal notices of people still in staff, and info alerts)
    await seedDirectory(hub, await directory({ version: 22, discount: true, extra: 60 }));
    raiseHub([
      ...Array.from({ length: 20 }, (_, i) => receiptInput(MGR, 5000 + i)),
      ...Array.from({ length: 20 }, (_, i): RaiseInput => ({ kind: 't_info', subject: { stream_type: 'hub', stream_id: BRANCH }, target: { kind: 'person', staff_id: WAIT }, display, dedupe_key: `big:${i}` })),
    ]);
    const big = measureFlagPass();
    expect(big.types.filter((t) => t === 'AlertRaised')).toHaveLength(2);
    expect(big.types).not.toContain('AlertClosed');
    expect(big.statements).toBe(FLAG_PASS_RAISING);

    // with both warnings open, nothing is raised: back to FLAG_PASS
    start();
    await pass();
    expect(openNoApprover()).toEqual(['no_approver:apply-discount', 'no_approver:void-item']);
    expect(measureFlagPass()).toEqual({ statements: FLAG_PASS, types: [] });
  });

  // --------------------------------------------------------------------------------------------- #59 hub

  it('[01d #59 hub] (m1) day close with no_approver open and its flag dirty: one pass writes one AlertClosed expired and no done', async () => {
    openDay();
    start();
    await pass();
    const [alert] = rows('no_approver') as [Row];
    expect(alert.state).toBe('open');
    closeDay();
    expect(dirty()).toBe(1);
    await pass();
    const closes = events(alert.alert_id).filter((e) => e.event_type === 'AlertClosed');
    expect(closes.map((e) => (e.payload as { reason: string }).reason)).toEqual(['expired']);
    expect(dirty()).toBe(0);
    expect(alertsTick.due(hub.deps.db, hub.deps.state.get(), hub.clock.branchNow())).toBe(false);
    await pass();
    expect(events(alert.alert_id).filter((e) => e.event_type === 'AlertClosed')).toHaveLength(1);
  });

  it('[01d #59 hub] (m1) day close with 250 expiring alerts due before no_approver (LIMIT 200): no_approver gets exactly one AlertClosed expired and no done', async () => {
    // the 250 infos are raised first, so at day close (all due at the same time) they fill the first pass's LIMIT 200
    raiseHub(Array.from({ length: 250 }, (_, i): RaiseInput => ({ kind: 't_info', subject: { stream_type: 'hub', stream_id: BRANCH }, target: { kind: 'person', staff_id: WAIT }, display, dedupe_key: `many:${i}` })));
    openDay();
    start();
    await pass();
    const [alert] = rows('no_approver') as [Row];
    expect(alert.state).toBe('open');
    closeDay();
    for (let i = 0; i < 4; i += 1) await pass();
    const closes = events(alert.alert_id).filter((e) => e.event_type === 'AlertClosed');
    expect(closes.map((e) => (e.payload as { reason: string }).reason)).toEqual(['expired']);
    expect(rows('t_info').every((r) => r.state === 'closed' && r.close_reason === 'expired')).toBe(true);
    expect(dirty()).toBe(0);
    expect(alertsTick.due(hub.deps.db, hub.deps.state.get(), hub.clock.branchNow())).toBe(false);
  });

  it('[01d #59 hub] (m2) on the full stack a phone’s owner binding survives a SessionStarted and a logout on that phone; the owner’s alert still reaches the phone', async () => {
    const phone = pairDevice(hub, { type: 'phone', ownerStaffId: OWNER });
    const paired = aDevicePaired({ payload: { device_id: phone.deviceId, device_type: 'phone', station_id: null, owner_staff_id: OWNER } });
    hub.deps.writer.run((tx) => tx.append([draftOf(paired, hub.clock.branchNow(), phone.deviceId)]));
    const binding = () => hub.deps.db.prepare('SELECT device_id, staff_id, session_id FROM device_bindings WHERE device_id = ?').get(phone.deviceId);
    const owner = { device_id: phone.deviceId, staff_id: OWNER, session_id: null };
    expect(binding()).toEqual(owner);
    const s = openSession(hub, { kind: 'staff', staffId: MGR, deviceId: phone.deviceId });
    expect(binding()).toEqual(owner);
    endSessionNow(hub, s.sessionId);
    expect(binding()).toEqual(owner);

    const ws = await connectWs(hub.app);
    clients.push(ws);
    ws.send({ type: 'auth', device_token: phone.token });
    await ws.untilCount(1);
    expect(ws.messages[0]).toMatchObject({ type: 'alerts_open' });
    const [id] = raiseHub([{ kind: 't_info', subject: { stream_type: 'hub', stream_id: BRANCH }, target: { kind: 'person', staff_id: OWNER }, display, dedupe_key: 'm2' }]);
    await ws.untilCount(2);
    expect(ws.messages[1]).toMatchObject({ type: 'alert', alert: { alert_id: id } });
  });

  it('[01d #59 hub] (m4) on the full stack a second alert-mode auth closes the first 4409, logs both remote addresses, and the new socket gets the device’s next alert', async () => {
    const tablet = pairDevice(hub, { type: 'tablet' });
    const auth = async (remoteAddress: string): Promise<WsClient> => {
      const ws = await connectWs(hub.app, { remoteAddress });
      clients.push(ws);
      ws.send({ type: 'auth', device_token: tablet.token });
      await ws.untilCount(1);
      return ws;
    };
    const first = await auth('192.168.10.41');
    const second = await auth('192.168.10.42');
    expect((await first.untilClose()).code).toBe(4409);
    expect(second.messages[0]).toMatchObject({ type: 'alerts_open' });
    // the replacement socket is the device's alert socket: the next step frame of a device alert reaches it
    raiseHub([{ kind: 't_info', subject: { stream_type: 'hub', stream_id: BRANCH }, target: { kind: 'device', device_id: tablet.deviceId }, display, dedupe_key: 'm4b' }]);
    await second.untilCount(2);
    expect(second.messages[1]).toMatchObject({ type: 'alert' });
    expect(first.messages).toHaveLength(1); // the replaced socket got nothing after its alerts_open
    const line = hub
      .logs()
      .split('\n')
      .filter((l) => l.trim().startsWith('{'))
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.old_remote_address !== undefined);
    expect(line).toMatchObject({ device_id: tablet.deviceId, old_remote_address: '192.168.10.41', new_remote_address: '192.168.10.42' });
  });

  it('[01d #59 hub] (v0.5 #5) a request kind with lead_fallback: true → startup error; (m15) family urgent with request: null → startup error; neither registers', () => {
    const base = {
      subject: 'table' as const,
      steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target' as const, set: 'answerer' as const }] }],
      closes_on: 'owner' as const,
      values_schema: z.object({}),
      details_schema: null,
      expires_at_day_close: true,
      silent: false,
      labels: { card: 'c', lock: 'l' },
    };
    expect(() =>
      defineAlertKind({
        ...base,
        kind: 't_req_lead_fallback',
        family: 'action',
        lead_fallback: true,
        request: { answers: ['accept', 'decline'], right: { mode: 'named' }, needs_pin: 'never', apply: () => [] },
      }),
    ).toThrow(/lead_fallback: true on a request kind/);
    expect(kindOf('t_req_lead_fallback')).toBeUndefined();
    expect(() =>
      defineAlertKind({
        ...base,
        steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
        kind: 't_urgent_no_request',
        family: 'urgent',
        lead_fallback: false,
        request: null,
      }),
    ).toThrow(/family 'urgent' needs a request part/);
    expect(kindOf('t_urgent_no_request')).toBeUndefined();
  });

  it('[01d #59 hub] (m8) two kinds with the same dedupe_key give two alerts; a deduped raise returns the open one’s requester', () => {
    const same = (kind: string): RaiseInput => ({ kind, subject: { stream_type: 'hub', stream_id: BRANCH }, target: { kind: 'person', staff_id: MGR }, display, dedupe_key: 'shared:1' });
    const [a, b] = raiseHub([same('t_info'), same('t_action')]) as [string, string];
    expect(a).not.toBe(b);
    expect(rows().filter((r) => r.dedupe_key === 'shared:1' && r.state === 'open')).toHaveLength(2);
    const [first] = raiseHub([voidInput(7, WAIT)]) as [string];
    const again = hub.deps.writer.run((tx) => alerts.raise(alerts.tickCtx(tx, hub.clock.branchNow()), { ...voidInput(7, MGR) })).result;
    expect(again).toMatchObject({ alert_id: first, deduped: true, events: [], requester_staff_id: WAIT });
  });

  it('[01d §3.10] no_approver is defined at top level per §3.10: info, hub subject, step 0 to always_on + managers, closes on owner, no lead fallback, expires at day close', () => {
    expect(kindOf('no_approver')).toMatchObject({
      kind: 'no_approver',
      family: 'info',
      subject: 'hub',
      steps: [{ at: { ms: 0 }, to: [{ target: { kind: 'always_on' }, set: 'recipient' }, { target: { kind: 'managers' }, set: 'recipient' }] }],
      closes_on: 'owner',
      lead_fallback: false,
      expires_at_day_close: true,
      silent: false,
      request: null,
    });
  });
});

// ------------------------------------------------------------------------------------------------- booted hub

function writeConfig(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-no-approver-'));
  const dataDir = join(dir, 'data');
  const backupDir = join(dir, 'backup');
  mkdirSync(dataDir);
  mkdirSync(backupDir);
  const path = join(dir, 'config.json');
  writeFileSync(
    path,
    JSON.stringify({
      cloud_base_url: 'https://cloud.example',
      http_port: 3000,
      data_dir: dataDir,
      backup_dir: backupDir,
      min_client_version: '1.0.0',
      backup_encryption_key: Buffer.alloc(32, 7).toString('base64'),
      advertised_host: '192.168.10.2',
      provisioned: { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'test-branch-api-key' },
    }),
  );
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('01d no_approver on a booted hub (task 31)', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const WALL = 1_761_000_000_000;
  // as main.ts: the step-3 engine fold, so the restarted hub knows the business day is open
  registerRestaurantBootSteps();
  const bootIt = (path: string) => boot({ configPath: path, wallNow: () => WALL, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud(), logStream: quiet() });
  // the offline cloud makes boot log `hub confirm failed`; these tests do not read the log
  function quiet(): Writable {
    return new Writable({ write: (_chunk, _enc, done) => done() });
  }

  it('[01d #32] the flag survives a restart: dirty at stop → the restarted hub’s first pass raises no_approver; [01d §3.5] the flag pass clears it, so the next pass opens no transaction (#22)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const first = await bootIt(cfg.path);
    const input = await directory();
    first.deps.writer.run((tx) => {
      applyStaffDirectory(tx, input, (next) => swapDirectory(first.app, next));
    });
    first.deps.writer.run((tx) => tx.append([draftOf(aBusinessDayOpened(), first.deps.clock.branchNow())]));
    // MGR signs in (SessionStarted marks the flag): it is dirty when the hub stops, before any tick pass
    first.deps.db
      .prepare(
        `INSERT INTO devices (device_id, branch_id, token_hash, device_name, device_type, paired_at, paired_by)
         VALUES ('dev-tab', ?, 'h', 'Tab', 'tablet', ?, 'S_OWNER')`,
      )
      .run(BRANCH, WALL);
    const session = first.deps.writer.run((tx) =>
      createSession(tx, { kind: 'staff', staffId: MGR, stationId: null, deviceId: 'dev-tab', idleTtlMs: 3_600_000, eventDeviceId: 'hub' }),
    ).result;
    expect(session.sessionId).toBeTruthy();
    expect((first.deps.db.prepare(`SELECT dirty FROM alert_flags`).get() as { dirty: number }).dirty).toBe(1);
    await first.stop();

    const second = await bootIt(cfg.path);
    cleanups.push(() => second.stop());
    const run = vi.spyOn(second.deps.writer, 'run');
    await vi.advanceTimersByTimeAsync(TICK_MS);
    // the persisted flag makes the first pass open its transaction (whatever boot did with MGR's session)
    expect(run).toHaveBeenCalledTimes(1);
    expect((second.deps.db.prepare(`SELECT dirty FROM alert_flags`).get() as { dirty: number }).dirty).toBe(0);
    run.mockClear();
    await vi.advanceTimersByTimeAsync(TICK_MS * 3);
    expect(run).not.toHaveBeenCalled();
  });

  it('[01d #32] restart with nobody signed in and the flag dirty → the first pass of the restarted hub raises no_approver', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const first = await bootIt(cfg.path);
    const input = await directory();
    first.deps.writer.run((tx) => {
      applyStaffDirectory(tx, input, (next) => swapDirectory(first.app, next));
    });
    first.deps.writer.run((tx) => tx.append([draftOf(aBusinessDayOpened(), first.deps.clock.branchNow())]));
    await first.stop();

    const second = await bootIt(cfg.path);
    cleanups.push(() => second.stop());
    await vi.advanceTimersByTimeAsync(TICK_MS);
    const open = second.deps.db.prepare(`SELECT dedupe_key FROM alerts WHERE kind = 'no_approver' AND state = 'open'`).pluck().all();
    expect(open).toEqual(['no_approver:void-item']);
    expect((second.deps.db.prepare(`SELECT dirty FROM alert_flags`).get() as { dirty: number }).dirty).toBe(0);
  });
});
