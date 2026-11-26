import type { Permission } from '@pos/domain';
import type { AlertRaisedPayloadV6 } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { APPROVAL_TIER_STEPS, defineAlertKind, unregisterAlertKind } from '../../src/alerts/kinds';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { deviceProfile } from '../../src/auth/device-profile';
import { currentDirectory } from '../../src/auth/guards';
import type { CommandCtx } from '../../src/commands/registry';
import { DISCOUNT, REOPEN_BILL } from '../../src/billing/kinds/index';
import { COMP } from '../../src/orders/comp-kind';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { signInOn } from '../helpers/device-access';
import { PIN } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { pairDevice, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { answer, post, stagedOrder, startVoids, STAFF, voidsDirectory, type Reply, type Who } from '../voids/fixtures';

// 05a v1.0.2 plan task 24 (B6, row D-2): the raise from a downgraded grant. 05a §3.9 rule 1, §3.3a, A-2; 01d v1.3.5
// §3.3 "Raise from a downgraded grant", §3.5 G1-9d shortcut (owner Q-3 (a): keyed on the STORED right), §4.2 raise
// (G-d: `ctx.permission` is read only for `masked === 'downgraded'`). A manager's own `allowed` money grant on an
// `everyone` device resolves `requires_approval` / `masked: 'downgraded'` through the session view; the kind's own
// request is raised with the stored right chosen once, at raise:
//   (a) a listed device of the requester (unrevoked) is connected now → `named`, receiver = the requester;
//   (b) else `holders` of the kind's `range_permission`, else its `base_permission`.
// Real hub, real VoidItems (void), real AnswerRequest, real WS sockets for "connected now".
//
// The answer half of #17 (the requester approves the `named` request on the phone with rule 5 skipped; the kiosk answer
// refused `listed_device_only`; "rings only their listed phone") is AnswerRequest / mayAnswer (task 23) and the
// listed-device route drop (task 25): those halves are tested in their tasks; this file pins the stored right.

const MGR = STAFF.manager; // S_MGR: Manager, every permission allowed (void-item, approve-void, apply-*, reopen-bill)
const OWNER = 'S_OWNER'; // Owner: every permission allowed
const CASH = STAFF.cashier; // S_CASH: void-item requires_approval by R_MGR (voidsDirectory)

let hub: TestHub;
const sockets: WsClient[] = [];

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

/** An `everyone` cashier kiosk with `staffId` signed in on it. */
function kiosk(staffId: string): Who {
  const d = pairDevice(hub, { type: 'cashier_kiosk', name: `Kiosk ${staffId}`, profile: { access: 'everyone', screens: ['cashier'] } });
  const s = signInOn(hub, d.deviceId, staffId);
  return { staffId, deviceId: d.deviceId, token: d.token, sessionId: s.sessionId, sessionToken: s.token };
}

/** A `listed` phone listing `listed` (default: the person), with `staffId` signed in on it (no socket yet). */
function phone(staffId: string, listed: string[] = [staffId]): Who {
  const d = pairDevice(hub, { type: 'phone', name: `Phone ${staffId}`, profile: { access: 'listed', staff_ids: listed, screens: ['manager'] } });
  const s = signInOn(hub, d.deviceId, staffId);
  return { staffId, deviceId: d.deviceId, token: d.token, sessionId: s.sessionId, sessionToken: s.token };
}

/** The device connected now: a staff-session socket (`session`) or an alert-mode socket (`alert`). */
async function connect(who: Who, mode: 'session' | 'alert'): Promise<void> {
  const ws = await connectWs(hub.app);
  sockets.push(ws);
  ws.send(mode === 'session' ? { type: 'auth', device_token: who.token, session_token: who.sessionToken } : { type: 'auth', device_token: who.token });
  await ws.untilCount(1);
  expect(ws.messages[0]).toMatchObject({ type: mode === 'session' ? 'catch_up' : 'alerts_open' });
}

function voidServed(who: Who, prefix: string): Promise<Reply> {
  const s = stagedOrder(hub, { prefix });
  return post(hub, who, 'void-items', 'VoidItems', { order_id: s.order_id, reason_code: 'quality', note: null, disposition_note: null, lines: [{ order_item_id: s.served, disposition: 'wastage' }] });
}

/** The request was raised (no ItemVoided); its AlertRaised payload and the raise's alert event types. */
function raisedOf(r: Reply): { alert_id: string; payload: AlertRaisedPayloadV6; types: string[] } {
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  expect(r.events.filter((e) => e.event_type === 'ItemVoided')).toEqual([]);
  const raised = r.events.filter((e) => e.event_type === 'AlertRaised');
  expect(raised).toHaveLength(1);
  const payload = raised[0]!.payload as unknown as AlertRaisedPayloadV6;
  const alertTypes = new Set(['AlertRaised', 'AttemptSent', 'EscalationStepped', 'StepSkipped']);
  return { alert_id: payload.alert_id, payload, types: r.events.filter((e) => alertTypes.has(e.event_type)).map((e) => e.event_type) };
}

const named = (receiver: string) => ({ right_mode: 'named', base_permission: null, range_permission: null, approver_role_ids: [], receiver_staff_id: receiver });
const holdersOf = (permission: Permission) => ({ right_mode: 'holders', base_permission: permission, range_permission: null, approver_role_ids: [], receiver_staff_id: null });
const refused = (r: Reply, reason: string) => expect([r.status, r.error?.code, r.error?.details.reason], JSON.stringify(r.error)).toEqual([403, 'PERMISSION_DENIED', reason]);

describe('[05a #17] downgrade with a listed device connected now → named to the requester', () => {
  it('[05a #17, §3.9 rule 1 (a)] a manager’s direct void on an `everyone` kiosk, their listed phone connected (session socket) → `named`, receiver = themself', async () => {
    hub = await startVoids();
    const at = kiosk(MGR);
    const mgrPhone = phone(MGR);
    await connect(mgrPhone, 'session');
    expect(currentDirectory(hub.app).forSession({ staff_id: MGR, device_id: at.deviceId }, deviceProfile).resolve(MGR, 'void-item')).toMatchObject({ grant: 'requires_approval', masked: 'downgraded' });
    const reply = await voidServed(at, 'A');
    const r = raisedOf(reply);
    expect(r.payload.kind).toBe('void_approval');
    expect(r.payload.requester_staff_id).toBe(MGR);
    expect(r.payload.request).toMatchObject({ ...named(MGR), answers: ['approve', 'reject'], needs_pin: 'always' });
    // the kind's own request: same kind and steps (step 0 sent, no shortcut: Q-3 (a), the stored right is named)
    expect(r.types).toEqual(['AlertRaised', 'AttemptSent']);
    // "it rings their listed phone": step 0's one answerer is the requester (rule 5 skipped for named-to-self), routed
    // to the phone's screen (the drop of the kiosk route for a money kind is task 25, §3.9 rule 3)
    const step0 = reply.events.find((e) => e.event_type === 'AttemptSent')!.payload as { recipients: unknown[]; routes: unknown[] };
    expect(step0.recipients).toEqual([{ staff_id: MGR, device_id: null, for_staff_id: null, set: 'answerer' }]);
    expect(step0.routes).toContainEqual({ staff_id: MGR, route: 'screen', ref: mgrPhone.deviceId });
    // stored, never changes (§3.9 rule 1, N-3): the projection row holds the named right
    const row = hub.deps.db.prepare('SELECT request_json FROM alerts WHERE alert_id = ?').get(r.alert_id) as { request_json: string };
    expect(JSON.parse(row.request_json)).toMatchObject(named(MGR));
    // answering it from the `everyone` kiosk → 403 listed_device_only (§3.9 rule 2); on the listed phone with their own
    // PIN it applies (01d rule 5 skipped for a named request whose receiver is its requester)
    refused(await answer(hub, at, r.alert_id, 'approve', PIN.b), 'listed_device_only');
    const ok = await answer(hub, mgrPhone, r.alert_id, 'approve', PIN.b);
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    expect(ok.events.filter((e) => e.event_type === 'ItemVoided').map((e) => e.payload)).toEqual([expect.objectContaining({ requester_staff_id: MGR, approver_staff_id: MGR })]);
  });

  it('[05a #17, §3.9 rule 1 (a)] an alert-mode socket of the listed phone also counts as connected now', async () => {
    hub = await startVoids();
    const at = kiosk(MGR);
    await connect(phone(MGR), 'alert');
    expect(raisedOf(await voidServed(at, 'B')).payload.request).toMatchObject(named(MGR));
  });

  it('[05a #17, §3.9 rule 1] chosen once at raise: the phone disconnecting afterwards leaves the stored `named` right', async () => {
    hub = await startVoids();
    const at = kiosk(MGR);
    await connect(phone(MGR), 'session');
    const r = raisedOf(await voidServed(at, 'C'));
    for (const s of sockets.splice(0)) s.close();
    // a later raise (another line) takes path (b); the first request's stored right is unchanged
    expect(raisedOf(await voidServed(at, 'D')).payload.request).toMatchObject(holdersOf('approve-void'));
    const row = hub.deps.db.prepare('SELECT request_json FROM alerts WHERE alert_id = ?').get(r.alert_id) as { request_json: string };
    expect(JSON.parse(row.request_json)).toMatchObject(named(MGR));
  });
});

describe('[05a #17a, #18] downgrade with no listed device connected now → holders of approve-void', () => {
  it('[05a #17a] the manager’s only listed device (a phone) is not connected → `holders` of approve-void; another manager answers on a listed device; the requester cannot (`self`)', async () => {
    hub = await startVoids();
    const at = kiosk(MGR);
    const mgrPhone = phone(MGR); // signed in, but no socket: not connected now
    const ownerPhone = phone(OWNER);
    await connect(ownerPhone, 'session');
    const r = raisedOf(await voidServed(at, 'E'));
    expect(r.payload.request).toMatchObject(holdersOf('approve-void'));
    refused(await answer(hub, mgrPhone, r.alert_id, 'approve', PIN.b), 'self');
    const ok = await answer(hub, ownerPhone, r.alert_id, 'approve', PIN.a);
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    expect(ok.events.filter((e) => e.event_type === 'ItemVoided').map((e) => e.payload)).toEqual([expect.objectContaining({ requester_staff_id: MGR, approver_staff_id: OWNER })]);
  });

  it('[05a #18] no listed device at all → `holders` of approve-void; another manager answers on a listed device; the requester cannot (`self`)', async () => {
    hub = await startVoids();
    const at = kiosk(MGR);
    const ownerPhone = phone(OWNER);
    await connect(ownerPhone, 'session');
    const r = raisedOf(await voidServed(at, 'F'));
    expect(r.payload.request).toMatchObject(holdersOf('approve-void'));
    // the requester, on a listed device signed in after the raise (the kiosk would refuse listed_device_only first)
    refused(await answer(hub, phone(MGR), r.alert_id, 'approve', PIN.b), 'self');
    const ok = await answer(hub, ownerPhone, r.alert_id, 'approve', PIN.a);
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    expect(ok.events.filter((e) => e.event_type === 'ItemVoided').map((e) => e.payload)).toEqual([expect.objectContaining({ requester_staff_id: MGR, approver_staff_id: OWNER })]);
  });

  it('[05a §3.9 rule 1 (a)] a connected listed device that does not list the requester does not count; nor does their own connected session on another `everyone` device → holders', async () => {
    hub = await startVoids();
    const at = kiosk(MGR);
    await connect(phone(OWNER), 'session'); // listed, lists only the Owner
    await connect(kiosk(MGR), 'session'); // a second `everyone` device, MGR signed in and connected
    expect(raisedOf(await voidServed(at, 'G')).payload.request).toMatchObject(holdersOf('approve-void'));
  });

  it('[05a v1.0.4 G-h (a)] route-level: a listed device listing the requester with only someone else signed in does NOT count → holders', async () => {
    hub = await startVoids();
    const at = kiosk(MGR);
    await connect(phone(OWNER, [OWNER, MGR]), 'session'); // lists both; only the Owner is signed in on it
    expect(raisedOf(await voidServed(at, 'H')).payload.request).toMatchObject(holdersOf('approve-void'));
  });

  it('[05a v1.0.4 G-h (a)] route-level: the alert-mode socket of a listed device with two people is not bound to the requester → holders', async () => {
    hub = await startVoids();
    const at = kiosk(MGR);
    await connect(phone(OWNER, [OWNER, MGR]), 'alert');
    expect(raisedOf(await voidServed(at, 'I')).payload.request).toMatchObject(holdersOf('approve-void'));
  });

  it('[05a v1.0.4 G-h (a)] route-level: the requester’s own session on a shared listed device counts → named', async () => {
    hub = await startVoids();
    const at = kiosk(MGR);
    await connect(phone(MGR, [OWNER, MGR]), 'session'); // lists both; MGR signed in
    expect(raisedOf(await voidServed(at, 'H2')).payload.request).toMatchObject(named(MGR));
  });
});

describe('[05a #19] downgraded discount, comp and reopen follow tests 17–18', () => {
  /** alerts.raise as the owning command does it: ctx.permission = the session view's resolution of `permission`. */
  function raiseAs(who: Who, permission: Permission, input: Omit<RaiseInput, 'requester_staff_id' | 'request' | 'display' | 'target'>): { alert_id: string; payload: AlertRaisedPayloadV6; types: string[] } {
    const directory = currentDirectory(hub.app).forSession({ staff_id: who.staffId, device_id: who.deviceId }, deviceProfile);
    const grant = directory.resolve(who.staffId, permission);
    expect(grant).toMatchObject({ grant: 'requires_approval', approver_role_ids: [], masked: 'downgraded' });
    return hub.deps.writer.run((tx) => {
      const ctx = {
        tx,
        state: tx.state,
        clock: tx.clock,
        ids: tx.ids,
        actor: { kind: 'staff', staffId: who.staffId, stationId: null, sessionId: who.sessionId, deviceId: who.deviceId },
        branch: { tenantId: 'tenant-a', branchId: 'branch-1' },
        directory,
        permission: grant,
        queuedAt: null,
      } as unknown as CommandCtx;
      const res = alerts.raise(ctx, {
        ...input,
        target: { kind: 'answerers' },
        display: { kind_label_key: `alert.${input.kind}.lock`, requester_name: 'Manager' },
        requester_staff_id: who.staffId,
        request: { approver_role_ids: 'approver_role_ids' in grant ? grant.approver_role_ids : [] },
      });
      tx.append(res.events);
      const payload = res.events[0]!.payload as unknown as AlertRaisedPayloadV6;
      return { alert_id: res.alert_id, payload, types: res.events.map((e) => e.event_type) };
    }).result;
  }

  const CASES: Array<{ kind: string; permission: Permission; input: () => Omit<RaiseInput, 'requester_staff_id' | 'request' | 'display' | 'target'> }> = [
    {
      kind: DISCOUNT.kind,
      permission: 'apply-discount',
      input: () => ({ kind: DISCOUNT.kind, subject: { stream_type: 'bill', stream_id: 'B1' }, values: { bill_id: 'B1', kind: 'percent', value: 10, reason_code: 'regular', note_id: null, has_note: false }, details: { amount: 500 }, dedupe_key: 'discount:B1' }),
    },
    {
      kind: COMP.kind,
      permission: 'apply-comp',
      input: () => ({ kind: COMP.kind, subject: { stream_type: 'order', stream_id: 'O1' }, values: { order_id: 'O1', order_item_id: 'L1', units: 1, reason_code: 'quality', note: null }, details: { item: 'Naan', quantity: 1, amount: 300 }, dedupe_key: 'comp:L1' }),
    },
    {
      kind: REOPEN_BILL.kind,
      permission: 'reopen-bill',
      input: () => ({ kind: REOPEN_BILL.kind, subject: { stream_type: 'bill', stream_id: 'B2' }, values: { bill_id: 'B2', invoice_ids: ['I1'], credit_invoice_ids: ['C1'], reason_code: 'price_error', note_id: null, has_note: false }, details: { amount: 900 }, dedupe_key: 'reopen:B2' }),
    },
  ];

  for (const c of CASES) {
    it(`[05a #19, #17] downgraded ${c.kind} with a listed device connected now → \`named\` to the requester`, async () => {
      hub = await startVoids();
      const at = kiosk(MGR);
      await connect(phone(MGR), 'session');
      const r = raiseAs(at, c.permission, c.input());
      expect(r.payload.kind).toBe(c.kind);
      expect(r.payload.request).toMatchObject(named(MGR));
      expect(r.types).toEqual(['AlertRaised', 'AttemptSent']);
    });

    it(`[05a #19, #18, A-2] downgraded ${c.kind} with no listed device → \`holders\` of ${c.permission}; another manager answers, the requester cannot (\`self\`)`, async () => {
      hub = await startVoids();
      const at = kiosk(MGR);
      const ownerPhone = phone(OWNER);
      await connect(ownerPhone, 'session');
      const r = raiseAs(at, c.permission, c.input());
      expect(r.payload.request).toMatchObject(holdersOf(c.permission));
      refused(await answer(hub, phone(MGR), r.alert_id, 'reject', PIN.b), 'self'); // a listed device, signed in after the raise
      const ok = await answer(hub, ownerPhone, r.alert_id, 'reject', PIN.a);
      expect(ok.status, JSON.stringify(ok.error)).toBe(200);
      expect(ok.events.find((e) => e.event_type === 'RequestAnswered')?.payload).toMatchObject({ alert_id: r.alert_id, decision: 'reject' });
    });
  }
});

describe('[01d §3.5 G1-9d, owner Q-3 (a)] the shortcut keys on the stored right', () => {
  it('[01d #20, Q-3 (a)] a downgraded request (stored `holders`) with no routed answerer → NO StepSkipped `shortcut`; step 0 is sent', async () => {
    hub = await startVoids();
    const at = kiosk(MGR); // the Owner (the only other approve-void holder) is signed in nowhere
    const r = raisedOf(await voidServed(at, 'J'));
    expect(r.payload.request).toMatchObject(holdersOf('approve-void'));
    expect(r.types).toEqual(['AlertRaised', 'AttemptSent']);
    expect(hub.deps.db.prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'StepSkipped'`).pluck().get()).toBe(0);
  });

  it('[01d #20] a non-downgraded raise is unchanged: a cashier’s requires_approval void with no routed answerer → the shortcut (StepSkipped 0, 1; EscalationStepped 2), stored `approval`', async () => {
    hub = await startVoids();
    const at = kiosk(CASH); // R_CASH void-item requires_approval by R_MGR; no manager signed in
    const r = raisedOf(await voidServed(at, 'K'));
    expect(r.payload.request).toMatchObject({ right_mode: 'approval', base_permission: 'void-item', range_permission: 'approve-void', approver_role_ids: ['R_MGR'], receiver_staff_id: null });
    expect(r.types).toEqual(['AlertRaised', 'StepSkipped', 'StepSkipped', 'EscalationStepped']);
  });

  it('[05a §3.9 rule 1, 01d §4.2] a manager on a listed device is not downgraded: their void applies directly (no request)', async () => {
    hub = await startVoids();
    const r = await voidServed(phone(MGR), 'L');
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.events.filter((e) => e.event_type === 'AlertRaised')).toEqual([]);
    expect(r.events.filter((e) => e.event_type === 'ItemVoided')).toHaveLength(1);
  });
});

describe('[05a §3.9 rule 1, 01d §4.2] no statement added', () => {
  it('[05a §3.9 rule 1] the downgraded raise (either path) costs no added statement: approval, holders and named requests cost 51 each', async () => {
    // a second manager, MGR2 (R_MGR: a cashier's approver and an approve-void holder), signed in on a listed phone, so
    // every one of the three requests has a routed step-0 answerer: none takes the G1-9d shortcut
    const base = await voidsDirectory();
    const mgr = base.staff.find((p) => p.staff_id === MGR)!;
    hub = await startVoids({ directory: { ...base, staff: [...base.staff, { ...mgr, staff_id: 'S_MGR2', display_name: 'Manager 2' }] } });
    const counter = statementCounter(hub.deps.db); // before any cached statement of the raise is prepared
    const mgrKiosk = kiosk(MGR);
    const cashKiosk = kiosk(CASH);
    await connect(phone('S_MGR2'), 'session');
    // warm every cached statement once
    raisedOf(await voidServed(cashKiosk, 'W1'));
    raisedOf(await voidServed(mgrKiosk, 'W2'));
    const orders = ['M1', 'M2', 'M3'].map((p) => stagedOrder(hub, { prefix: p }));
    const cost = async (who: Who, o: (typeof orders)[number]): Promise<number> => {
      counter.reset();
      const r = await post(hub, who, 'void-items', 'VoidItems', { order_id: o.order_id, reason_code: 'quality', note: null, disposition_note: null, lines: [{ order_item_id: o.served, disposition: 'wastage' }] });
      types.push(raisedOf(r).types);
      return counter.count;
    };
    const types: string[][] = [];
    const approval = await cost(cashKiosk, orders[0]!);
    const holders = await cost(mgrKiosk, orders[1]!);
    await connect(phone(MGR), 'session');
    const named = await cost(mgrKiosk, orders[2]!);
    // like for like (step 0 sent, no shortcut on any of them), the stored right changes no statement: the socket lists
    // and the profile map are memory. Each VoidItems request command costs the same, statement for statement.
    expect(types).toEqual([['AlertRaised', 'AttemptSent'], ['AlertRaised', 'AttemptSent'], ['AlertRaised', 'AttemptSent']]);
    expect([approval, holders, named]).toEqual([51, 51, 51]);
  });
});

describe('[05a §3.3a, 01d §4.2 G-d] a downgraded grant raises only a money kind', () => {
  it('[05a §3.9 rule 1] raising a NON-money approval kind from a ctx with `masked: downgraded` throws /not a money permission/', async () => {
    hub = await startVoids();
    const who = kiosk(MGR);
    defineAlertKind({
      kind: 't_nonmoney_approval',
      family: 'urgent',
      subject: 'order',
      steps: APPROVAL_TIER_STEPS,
      closes_on: 'owner',
      values_schema: z.object({}),
      details_schema: null,
      lead_fallback: false,
      expires_at_day_close: true,
      silent: false,
      labels: { card: 'alert.t.card', lock: 'alert.t.lock' },
      request: { answers: ['approve', 'reject'], right: { mode: 'approval', base_permission: 'move-item-to-stock' }, needs_pin: 'never', apply: () => [] },
    });
    try {
      const directory = currentDirectory(hub.app);
      const raise = () =>
        hub.deps.writer.run((tx) => {
          const ctx = {
            tx,
            state: tx.state,
            clock: tx.clock,
            ids: tx.ids,
            actor: { kind: 'device', staffId: MGR, stationId: null, sessionId: who.sessionId, deviceId: who.deviceId },
            branch: { tenantId: 'tenant-a', branchId: 'branch-1' },
            directory,
            permission: { grant: 'requires_approval', scope: 'branch', approver_role_ids: ['R_MGR'], masked: 'downgraded' },
            queuedAt: null,
          } as unknown as CommandCtx;
          alerts.raise(ctx, {
            kind: 't_nonmoney_approval',
            subject: { stream_type: 'order', stream_id: 'O1' },
            target: { kind: 'answerers' },
            display: { kind_label_key: 'alert.t.lock' },
            dedupe_key: 'nonmoney:O1',
            requester_staff_id: MGR,
            request: { approver_role_ids: ['R_MGR'] },
          });
        });
      expect(raise).toThrow(/not a money permission/);
    } finally {
      unregisterAlertKind('t_nonmoney_approval');
    }
  });
});
