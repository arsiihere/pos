import { verify } from '@node-rs/argon2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import { currentDirectory } from '../../src/auth/guards';
import { activity } from '../../src/auth/session-store';
import type { CommandCtx } from '../../src/commands/registry';
import { appendDeviceProfile, openSession, pairDevice, type DeviceProfileInput, type TestHub } from '../helpers/test-hub';
import { answer, PIN, post, signIn, STAFF, stagedOrder, startVoids, type Reply, type Who } from '../voids/fixtures';
import { registerFakes, resetFakes } from './fakes';

// 05a §3.9 rule 2, §4.5 D-2 (01d v1.3.5 §3.3 rules 2, 2a, 4 (b), 5): `in_person` is refused `in_person_removed`, a
// money answer from a session on an `everyone` device (or a device with no profile, R-1) is refused
// `listed_device_only`; both in preRead before argon2 (nothing counted) and again in prepare. Rule 5 (self) is
// skipped only for a `named` request whose receiver is its requester. Tests #8, #4f, #5, #6 (and the named-self
// answer of #17, whose raise is task 24). Real VoidItems → void_approval requests, real AnswerRequest.

// The argon2 verify the pipeline calls, counted (the real verify still runs).
vi.mock('@node-rs/argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@node-rs/argon2')>();
  return { ...actual, verify: vi.fn((hash: string, pin: string) => actual.verify(hash, pin)) };
});
const verifySpy = vi.mocked(verify);

let hub: TestHub;

afterEach(async () => {
  resetFakes();
  vi.restoreAllMocks();
  verifySpy.mockClear();
  activity.drain();
  activity.drainDevices();
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

const EVERYONE: DeviceProfileInput = { access: 'everyone', screens: ['takeaway', 'manager'] };
const listed = (staff_ids: string[]): DeviceProfileInput => ({ access: 'listed', staff_ids, screens: ['manager'] });

/** A tablet with the given profile (null: a profile-less staff device, R-1). */
function device(profile: DeviceProfileInput | null, name: string): { deviceId: string; token: string } {
  const d = pairDevice(hub, { type: 'tablet', name });
  if (profile !== null) appendDeviceProfile(hub, d.deviceId, profile);
  return d;
}

/** A staff session on the device, its profile left as it is. */
function on(d: { deviceId: string; token: string }, staffId: string): Who {
  const s = openSession(hub, { kind: 'staff', staffId, deviceId: d.deviceId, legacyProfile: false });
  return { staffId, deviceId: d.deviceId, token: d.token, sessionId: s.sessionId, sessionToken: s.token };
}

/** VoidItems by `who` on a new staged order; the one request's alert_id. */
async function askVoid(who: Who, prefix: string): Promise<string> {
  const s = stagedOrder(hub, { prefix });
  const reply = await post(hub, who, 'void-items', 'VoidItems', {
    order_id: s.order_id,
    reason_code: 'customer_changed_mind',
    note: null,
    disposition_note: null,
    lines: [{ order_item_id: s.cooking, disposition: 'wastage' }],
  });
  expect(reply.status, JSON.stringify(reply.error)).toBe(200);
  return (reply.result as { pending: Array<{ alert_id: string }> }).pending[0]!.alert_id;
}

const db = () => hub.deps.db;
const eventCount = (): number => db().prepare('SELECT COUNT(*) FROM events').pluck().get() as number;
const alertState = (id: string): string => db().prepare('SELECT state FROM alerts WHERE alert_id = ?').pluck().get(id) as string;
/** Every PIN failure counter (00 §3.5): the staff and device rows of auth_lockouts. */
const lockouts = (): unknown[] => db().prepare('SELECT subject_type, subject_id, failed_count FROM auth_lockouts ORDER BY subject_type, subject_id').all();
const answered = (r: Reply) => r.events.find((e) => e.event_type === 'RequestAnswered')?.payload;

/** Refused before argon2: the given 403 reason, no PIN verified, nothing written, no counter moved, still pending. */
async function refusedBeforePin(send: () => Promise<Reply>, reason: string, alertId: string): Promise<void> {
  const events = eventCount();
  const counters = lockouts();
  verifySpy.mockClear();
  const reply = await send();
  expect(reply.status, JSON.stringify(reply.error)).toBe(403);
  expect(reply.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason } });
  expect(verifySpy).not.toHaveBeenCalled();
  expect(eventCount()).toBe(events);
  expect(lockouts()).toEqual(counters);
  expect(alertState(alertId)).toBe('open');
}

const inPerson = (who: Who, alert_id: string, answerer: string, pin: string) =>
  post(hub, who, 'answer-request', 'AnswerRequest', { alert_id, decision: 'approve', method: 'in_person', answerer_staff_id: answerer, pin });

describe('[05a §3.9 rule 2, D-2] AnswerRequest by device access', () => {
  it('[05a #8] in_person → 403 in_person_removed from preRead, before argon2: right and wrong PIN alike, on the raising device and elsewhere; nothing counted', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const id = await askVoid(cashier, 'IP');
    for (const pin of [PIN.b, '5555']) {
      await refusedBeforePin(() => inPerson(cashier, id, STAFF.manager, pin), 'in_person_removed', id);
      await refusedBeforePin(() => inPerson(manager, id, STAFF.manager, pin), 'in_person_removed', id);
    }
    // the request is still answered the normal way
    const ok = await answer(hub, manager, id, 'approve');
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    expect(answered(ok)).toMatchObject({ method: 'pin', answerer_staff_id: STAFF.manager });
  });

  it('[05a #4f] a void answer on an `everyone` device → 403 listed_device_only from preRead (not not_approver); argon2 not called; counters unchanged; a device with no profile is refused the same (R-1)', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const id = await askVoid(cashier, 'EV');
    const shared = on(device(EVERYONE, 'Shared tablet'), STAFF.manager);
    const bare = on(device(null, 'No profile'), STAFF.manager);
    for (const who of [shared, bare]) {
      for (const pin of [PIN.b, '5555']) await refusedBeforePin(() => answer(hub, who, id, 'approve', pin), 'listed_device_only', id);
      await refusedBeforePin(() => answer(hub, who, id, 'reject'), 'listed_device_only', id);
    }
    // rule order (01d §3.3 rule 4 (b)): rule 3, the PIN rule (422), comes before rule 2a
    const noPin = await post(hub, shared, 'answer-request', 'AnswerRequest', { alert_id: id, decision: 'approve', method: 'session' });
    expect(noPin.error?.code).toBe('REQUEST_PIN_REQUIRED');
    // and rule 2a before rule 2 (in person)
    await refusedBeforePin(() => inPerson(shared, id, STAFF.manager, PIN.b), 'listed_device_only', id);
  });

  it('[05a #5] the same manager on their listed phone answers the void', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const id = await askVoid(cashier, 'PH');
    const kiosk = on(device(EVERYONE, 'Shared tablet'), STAFF.manager);
    await refusedBeforePin(() => answer(hub, kiosk, id, 'approve'), 'listed_device_only', id);
    const phone = on(pairDevice(hub, { type: 'phone', name: 'Manager phone', profile: listed([STAFF.manager]) }), STAFF.manager);
    const r = await answer(hub, phone, id, 'approve');
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(answered(r)).toMatchObject({ answerer_staff_id: STAFF.manager, device_id: phone.deviceId });
    expect(r.events.find((e) => e.event_type === 'ItemVoided')?.payload).toMatchObject({ approver_staff_id: STAFF.manager });
    expect(alertState(id)).toBe('closed');
  });

  it('[05a #6, §3.4] floor tablet listed [floor manager, waiter]: the floor manager answers a void there (accepted risk)', async () => {
    hub = await startVoids();
    const waiter = signIn(hub, STAFF.orderTaker);
    const id = await askVoid(waiter, 'FT');
    const floor = device({ access: 'listed', staff_ids: [STAFF.manager, STAFF.orderTaker], screens: ['dine_in', 'manager'] }, 'Floor tablet');
    const r = await answer(hub, on(floor, STAFF.manager), id, 'approve');
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(answered(r)).toMatchObject({ answerer_staff_id: STAFF.manager, device_id: floor.deviceId });
  });

  it('[05a §3.9 rule 2] re-checked in prepare: the device becomes `everyone` while argon2 runs → listed_device_only, counted once as answer_failed', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const id = await askVoid(cashier, 'RC');
    const tablet = device(listed([STAFF.manager]), 'Manager tablet');
    const manager = on(tablet, STAFF.manager);
    hub.deps.testHooks = {
      async betweenVerifyAndWriter() {
        appendDeviceProfile(hub, tablet.deviceId, EVERYONE);
      },
    };
    const r = await answer(hub, manager, id, 'approve');
    expect(r.status).toBe(403);
    expect(r.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'listed_device_only' } });
    expect(verifySpy).toHaveBeenCalledTimes(1);
    const failed = db().prepare("SELECT payload FROM events WHERE event_type = 'RequestPinFailed'").pluck().all() as string[];
    expect(failed.map((p) => JSON.parse(p) as unknown)).toEqual([
      expect.objectContaining({ alert_id: id, outcome: 'answer_failed', error_code: 'PERMISSION_DENIED', method: 'pin' }),
    ]);
    expect(alertState(id)).toBe('open');
  });

  it('[05a §3.9 rule 1 (a), 01d §3.3 rule 5] a `named` money request whose receiver is its requester: the requester answers it on a listed device (self skipped); from the `everyone` device → listed_device_only; anyone else → not_receiver', async () => {
    hub = await startVoids();
    const kiosk = device(EVERYONE, 'Counter kiosk');
    const mgrOnKiosk = on(kiosk, STAFF.manager);
    // The manager's own void on the everyone kiosk is downgraded (05a §3.3a) and takes the request path. Task 24
    // stores its right as `named` to the requester; until then this one raise's request part is given that right.
    const raiseMany = alerts.raiseMany.bind(alerts);
    vi.spyOn(alerts, 'raiseMany').mockImplementationOnce((ctx, inputs) =>
      raiseMany(ctx, inputs).map((raised) => ({
        ...raised,
        events: raised.events.map((e) => {
          if (e.event_type !== 'AlertRaised') return e;
          const payload = e.payload as { request: Record<string, unknown> };
          const request = { ...payload.request, right_mode: 'named', base_permission: null, range_permission: null, approver_role_ids: [], receiver_staff_id: STAFF.manager };
          return { ...e, payload: { ...payload, request } };
        }),
      })),
    );
    const id = await askVoid(mgrOnKiosk, 'NS');
    const row = db().prepare('SELECT requester_staff_id, request_json FROM alerts WHERE alert_id = ?').get(id) as { requester_staff_id: string; request_json: string };
    expect(row.requester_staff_id).toBe(STAFF.manager);
    expect(JSON.parse(row.request_json)).toMatchObject({ right_mode: 'named', receiver_staff_id: STAFF.manager, needs_pin: 'always' });
    const owner = signIn(hub, 'S_OWNER');
    await refusedBeforePin(() => answer(hub, mgrOnKiosk, id, 'approve'), 'listed_device_only', id);
    await refusedBeforePin(() => answer(hub, owner, id, 'approve'), 'not_receiver', id);
    const phone = on(device(listed([STAFF.manager]), 'Manager phone'), STAFF.manager);
    const r = await answer(hub, phone, id, 'approve');
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(answered(r)).toMatchObject({ answerer_staff_id: STAFF.manager, method: 'pin' });
  });

  it('[05a §3.9 rule 2, 01d §3.3 rule 5] the requester of an `approval` request is still refused `self` on a listed device', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const id = await askVoid(cashier, 'SF');
    await refusedBeforePin(() => answer(hub, cashier, id, 'approve'), 'self', id);
  });

  it('[05a §3.9 rule 2] accept kinds are unchanged: a non-money answer (`needs_pin: never`, method session) on an `everyone` device works', async () => {
    hub = await startVoids();
    registerFakes();
    const waiter = signIn(hub, STAFF.orderTaker);
    const cashier = on(device(EVERYONE, 'Counter kiosk'), STAFF.cashier);
    const id = hub.deps.writer.run((tx) => {
      const ctx = {
        tx,
        state: tx.state,
        clock: tx.clock,
        ids: tx.ids,
        secrets: hub.deps.secrets,
        actor: { kind: 'staff', staffId: waiter.staffId, stationId: null, sessionId: waiter.sessionId, deviceId: waiter.deviceId },
        permission: null,
        branch: { tenantId: 'tenant-a', branchId: 'branch-1' },
        directory: currentDirectory(hub.app),
        config: hub.deps.config,
      } as unknown as CommandCtx;
      const raised = alerts.raise(ctx, {
        kind: 't_accept',
        subject: { stream_type: 'table', stream_id: 'T1' },
        target: { kind: 'person', staff_id: STAFF.cashier },
        display: { kind_label_key: 'alert.t.lock', table_code: '1', requester_name: 'Order taker' },
        dedupe_key: 'accept:T1',
        requester_staff_id: STAFF.orderTaker,
        request: { receiver_staff_id: STAFF.cashier },
      });
      tx.append(raised.events);
      return raised.alert_id;
    }).result;
    const r = await post(hub, cashier, 'answer-request', 'AnswerRequest', { alert_id: id, decision: 'accept', method: 'session' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(verifySpy).not.toHaveBeenCalled();
    expect(answered(r)).toMatchObject({ answerer_staff_id: STAFF.cashier, method: 'session' });
  });
});
