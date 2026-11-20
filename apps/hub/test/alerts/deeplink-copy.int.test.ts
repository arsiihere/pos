import type { AlertLinkTarget, AlertView, BranchConfig, DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineAlertKind, kindOf, unregisterAlertKind, type AlertKind, type AlertKindDef } from '../../src/alerts/kinds';
import { alerts } from '../../src/alerts/raise';
import { lockView } from '../../src/alerts/ws-frames';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { TABLE_HANDOVER } from '../../src/tables/kinds';
import { resetMergeGuard } from '../../src/tables/merge-guard';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { answer, openSeating, PIN, post, raiseVoid, signIn, STAFF, stagedOrder, startVoids, VX, type Who } from '../voids/fixtures';

// dl h3 — 01d v1.3 §3.10 note (L-2), §3.13.1 "Copy kinds" and "Statement counts"; tests 71, 72. The copy kinds
// (`request_result` and its `:also`, `approval_receipt`, `answered_on_requester_device`, `pin_use_failed`) store the
// request's target as `values.link`, computed once with the guarded `safeLink` on the request's values: in
// AnswerRequest, in pinFailed (RequestRow) and in close / closeMany (`values_json` in its same SELECT). A throwing or
// bad `link` gives `values.link: null` and never aborts the answer or the merge / clean whose transaction closes it (M4).

let hub: TestHub;

const raisedOf = (kind: string): PosEvent[] =>
  (hub.deps.db.prepare(`SELECT payload, event_id FROM events WHERE event_type = 'AlertRaised' ORDER BY seq`).all() as Array<{ payload: string; event_id: string }>)
    .map((r) => ({ event_id: r.event_id, payload: JSON.parse(r.payload) as Record<string, unknown> }) as unknown as PosEvent)
    .filter((e) => e.payload.kind === kind);
const valuesOf = (e: PosEvent | undefined) => (e?.payload as { values: Record<string, unknown> } | undefined)?.values;
const aboutRequest = (kind: string, request: string) => raisedOf(kind).filter((e) => valuesOf(e)?.request_alert_id === request);

/** The view of a stored alert through the one builder (§3.13.1: every view goes through lockView). */
function viewTarget(alert_id: string): AlertView['target'] {
  const row = hub.deps.db.prepare('SELECT alert_id, kind, family, display_json, values_json, raised_at FROM alerts WHERE alert_id = ?').get(alert_id) as
    | { alert_id: string; kind: string; family: 'info'; display_json: string; values_json: string; raised_at: number }
    | undefined;
  if (row === undefined) throw new Error(`no alert ${alert_id}`);
  return lockView(row, kindOf(row.kind)!, 0).target;
}

async function inboxTarget(who: { token: string; sessionToken: string }, alert_id: string): Promise<AlertView['target'] | 'absent'> {
  const res = await hub.app.inject({ method: 'GET', url: '/queries/alerts-inbox', headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
  expect(res.statusCode).toBe(200);
  const row = (res.json() as { data: { alerts: AlertView[] } }).data.alerts.find((r) => r.alert_id === alert_id);
  return row === undefined ? 'absent' : (row.target ?? null);
}

// -------------------------------------------------------------------------------------------------------- #72 (a)

describe('[01d #72] (a) the copy kinds of a void_approval request carry its order_line target', () => {
  let waiter: Who;
  let mgr: Who;
  beforeEach(async () => {
    hub = await startVoids();
    waiter = signIn(hub, STAFF.orderTaker);
    mgr = signIn(hub, STAFF.manager);
    signIn(hub, STAFF.cashier); // the table's holder: the reject's `:also` goes to the table team (not only the requester)
    openSeating(hub, { table_id: VX.tables.T4, seating_id: 'SEAT_T4', holder_staff_id: STAFF.cashier });
  });
  afterEach(async () => {
    await hub.close();
  });

  const line = (order_id: string, order_item_id: string): AlertLinkTarget => ({ type: 'order_line', order_id, order_item_id });
  const raise = (order_id: string, order_item_id: string) => raiseVoid(hub, { requester: waiter, order_id, order_item_id }).alert_id;

  it('[01d #72] (a) approve → request_result and approval_receipt carry values.link; their views show it', async () => {
    const o = stagedOrder(hub, { seating_id: 'SEAT_T4' });
    const id = raise(o.order_id, o.done);
    const r = await answer(hub, mgr, id, 'approve');
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const want = line(o.order_id, o.done);
    for (const kind of ['request_result', 'approval_receipt']) {
      const [e, ...more] = aboutRequest(kind, id);
      expect(more, kind).toHaveLength(0);
      expect(valuesOf(e)?.link, kind).toEqual(want);
      expect(viewTarget(e!.payload.alert_id as string), kind).toEqual(want);
    }
    // the requester's inbox row of the result
    expect(await inboxTarget(waiter, aboutRequest('request_result', id)[0]!.payload.alert_id as string)).toEqual(want);
  });

  it('[01d #72] (a) reject → request_result and its `:also` request_result carry values.link', async () => {
    const o = stagedOrder(hub, { seating_id: 'SEAT_T4' });
    const id = raise(o.order_id, o.served);
    const r = await answer(hub, mgr, id, 'reject');
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const results = aboutRequest('request_result', id);
    expect(results.map((e) => e.payload.dedupe_key)).toEqual([`request_result:${id}`, `request_result:${id}:also`]);
    for (const e of results) {
      expect(valuesOf(e)?.link).toEqual(line(o.order_id, o.served));
      expect(viewTarget(e.payload.alert_id as string)).toEqual(line(o.order_id, o.served));
    }
  });

  it('[01d #72] (a) obsolete through closeMany → request_result carries values.link', () => {
    const o = stagedOrder(hub, { seating_id: 'SEAT_T4' });
    const id = raise(o.order_id, o.cooking);
    hub.deps.writer.run((tx) => tx.append(alerts.closeMany(alerts.tickCtx(tx, hub.clock.branchNow()), [{ alert_id: id, reason: 'obsolete' }])));
    const [e] = aboutRequest('request_result', id);
    expect(valuesOf(e)).toMatchObject({ close_reason: 'obsolete', link: line(o.order_id, o.cooking) });
    expect(viewTarget(e!.payload.alert_id as string)).toEqual(line(o.order_id, o.cooking));
  });

  it('[01d #72] (a) answered in person on the requester\'s device → answered_on_requester_device (and the receipt) carry values.link', async () => {
    const o = stagedOrder(hub, { seating_id: 'SEAT_T4' });
    const id = raise(o.order_id, o.done);
    const r = await post(hub, waiter, 'answer-request', 'AnswerRequest', { alert_id: id, decision: 'approve', method: 'in_person', answerer_staff_id: STAFF.manager, pin: PIN.b });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    for (const kind of ['answered_on_requester_device', 'approval_receipt', 'request_result']) {
      const [e] = aboutRequest(kind, id);
      expect(valuesOf(e)?.link, kind).toEqual(line(o.order_id, o.done));
      expect(viewTarget(e!.payload.alert_id as string), kind).toEqual(line(o.order_id, o.done));
    }
  });

  it('[01d #72] (a) a matched PIN whose answer then fails → pin_use_failed carries values.link', async () => {
    const o = stagedOrder(hub, { seating_id: 'SEAT_T4' });
    const id = raise(o.order_id, o.done);
    // §3.3 rule 4 (d), as answer-pin.int.test.ts #54: the request closes while argon2 runs, so the in-person answer on the
    // raising device fails after the manager's PIN matched → RequestPinFailed answer_failed and pin_use_failed to him
    hub.deps.testHooks = {
      betweenVerifyAndWriter: async () => {
        await Promise.resolve();
        hub.deps.writer.run((tx) => tx.append(alerts.close(alerts.tickCtx(tx, hub.clock.branchNow()), id, 'obsolete')));
      },
    };
    const r = await post(hub, waiter, 'answer-request', 'AnswerRequest', { alert_id: id, decision: 'approve', method: 'in_person', answerer_staff_id: STAFF.manager, pin: PIN.b });
    hub.deps.testHooks = {};
    expect(r.status, JSON.stringify(r.error)).toBe(409);
    const [e, ...more] = aboutRequest('pin_use_failed', id);
    expect(more).toHaveLength(0);
    expect(valuesOf(e)?.link).toEqual(line(o.order_id, o.done));
    expect(viewTarget(e!.payload.alert_id as string)).toEqual(line(o.order_id, o.done));
  });
});

// ------------------------------------------------------------------------------------------------ #72 (b), (c), #71

// T1, T2 on F1; S_ALI holds, S_SARA receives. table_handover is a request kind 01d closes through MergeTables and
// CleanTable (closeMany) and answers through AnswerRequest (accept). Its registration is swapped for a test variant
// (no link / a throwing link / a link returning { type: 'nope' }) and restored in afterEach.
const ORIGINAL = TABLE_HANDOVER as unknown as AlertKind;
type Variant = 'real' | 'none' | 'throws' | 'nope';
function useHandover(variant: Variant): void {
  unregisterAlertKind('table_handover');
  const { link: _drop, ...rest } = ORIGINAL as AlertKindDef;
  void _drop;
  const link =
    variant === 'real'
      ? ORIGINAL.link
      : variant === 'throws'
        ? () => {
            throw new Error('a link that throws');
          }
        : variant === 'nope'
          ? () => ({ type: 'nope' }) as unknown as AlertLinkTarget
          : undefined;
  defineAlertKind({ ...rest, ...(link === undefined ? {} : { link }) } as AlertKindDef);
}

async function tablesDirectory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const allowed = (permission: string) => ({ permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [] as string[], scope: 'branch' as const });
  const person = (staff_id: string, display_name: string) => ({ staff_id, display_name, pin_hash: pin, role_ids: ['R_TAKER'], denied_permissions: [], lead_staff_id: null, floor_ids: [] });
  return {
    ...base,
    roles: [...base.roles, { role_id: 'R_TAKER', name: 'R_TAKER', session_idle_ttl_ms: 3_600_000, permissions: [allowed('take-order'), allowed('clean-table')] }],
    staff: [...base.staff, person('S_ALI', 'Ali'), person('S_SARA', 'Sara')],
  };
}

describe('[01d #72] (b) (c), [01d #71] copy kinds when the request kind has no link or a bad one', () => {
  let ali: Who;
  let sara: Who;
  let commandSeq = 0;

  beforeEach(async () => {
    hub = await createTestHub();
    resetMergeGuard(); // 04's boot guard; these tests count without it (AD-12)
    await seedDirectory(hub, await tablesDirectory());
    const config = { floors: [{ floor_id: 'F1', tables: [{ table_id: 'T1', zone_id: null }, { table_id: 'T2', zone_id: null }] }] } as unknown as BranchConfig;
    swapBranchConfig({ config, snapshotHash: 'h'.repeat(64), configVersion: 1, snapshotSchemaVersion: 4, appliedAt: 0 });
    ali = seat('S_ALI');
    sara = seat('S_SARA');
  });
  afterEach(async () => {
    useHandover('real');
    resetMergeGuard();
    swapBranchConfig(null);
    await hub.close();
  });

  function seat(staffId: string): Who {
    const device = pairDevice(hub, { type: 'tablet' });
    const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
    return { staffId, deviceId: device.deviceId, token: device.token, sessionId: session.sessionId, sessionToken: session.token };
  }
  function opened(table_id: string, seating_id: string): void {
    const d: EventDraft = {
      stream_type: 'table',
      stream_id: table_id,
      event_type: 'TableOpened',
      schema_version: 1,
      payload: { table_id, seating_id, holder_staff_id: 'S_ALI', party_size: 2 },
      occurred_at: hub.clock.branchNow(),
      actor_id: 'S_ALI',
      device_id: 'DEV_SEED',
    };
    hub.deps.writer.run((tx) => tx.append([d]));
  }
  async function command(who: Who, path: string, command_type: string, payload: Record<string, unknown>) {
    commandSeq += 1;
    const res = await hub.app.inject({
      method: 'POST',
      url: `/commands/${path}`,
      headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
      payload: { command_id: `dl-${commandSeq}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type, payload, occurred_at: hub.clock.branchNow(), actor_id: who.staffId, device_id: who.deviceId },
    });
    return { status: res.statusCode, body: res.json() as { data?: { result: Record<string, unknown> }; error?: { code: string } } };
  }
  async function requestHandover(table_id: string, seating_id: string): Promise<string> {
    const r = await command(ali, 'request-table-handover', 'RequestTableHandover', { table_id, seating_id, to_staff_id: 'S_SARA' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.data!.result.alert_id as string;
  }
  const accept = (alert_id: string) => command(sara, 'answer-request', 'AnswerRequest', { alert_id, decision: 'accept', method: 'session' });
  const merge = () => command(ali, 'merge-tables', 'MergeTables', { into_table_id: 'T1', into_seating_id: 'S1', table_id: 'T2', table_seating_id: 'S2' });
  const clean = () => command(ali, 'clean-table', 'CleanTable', { table_id: 'T1', seating_id: 'S1' });
  const resultLink = (request: string) => {
    const [e, ...more] = aboutRequest('request_result', request);
    expect(more).toHaveLength(0);
    expect(valuesOf(e), request).toHaveProperty('link');
    return valuesOf(e)!.link;
  };
  const answeredCount = (alert_id: string) =>
    hub.deps.db.prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'RequestAnswered' AND json_extract(payload, '$.alert_id') = ?`).pluck().get(alert_id);

  it('[01d #72] a real table_handover: accept, MergeTables and CleanTable results carry its table target (control)', async () => {
    opened('T1', 'S1');
    opened('T2', 'S2');
    const a = await requestHandover('T1', 'S1');
    expect((await accept(a)).status).toBe(200);
    expect(resultLink(a)).toEqual({ type: 'table', table_id: 'T1', seating_id: 'S1' });
  });

  for (const variant of ['none', 'throws', 'nope'] as const) {
    const label = variant === 'none' ? 'no link' : variant === 'throws' ? 'a link that throws' : "a link returning { type: 'nope' }";
    it(`[01d #72] ${variant === 'none' ? '(b)' : '(c)'} ${label}: AnswerRequest commits (200, RequestAnswered, the result written) with values.link null; no VALIDATION_FAILED`, async () => {
      useHandover(variant);
      opened('T1', 'S1');
      const a = await requestHandover('T1', 'S1');
      const r = await accept(a);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(answeredCount(a)).toBe(1);
      expect(resultLink(a)).toBeNull();
      expect(viewTarget(aboutRequest('request_result', a)[0]!.payload.alert_id as string)).toBeNull();
    });

    it(`[01d #72] ${variant === 'none' ? '(b)' : '(c)'} ${label}: a MergeTables and a CleanTable that closeMany the request commit, values.link null`, async () => {
      useHandover(variant);
      opened('T1', 'S1');
      opened('T2', 'S2');
      const a1 = await requestHandover('T2', 'S2');
      const m = await merge();
      expect(m.status, JSON.stringify(m.body)).toBe(200);
      expect(hub.deps.db.prepare(`SELECT state, close_reason FROM alerts WHERE alert_id = ?`).get(a1)).toEqual({ state: 'closed', close_reason: 'obsolete' });
      expect(resultLink(a1)).toBeNull();
      const a2 = await requestHandover('T1', 'S1');
      const c = await clean();
      expect(c.status, JSON.stringify(c.body)).toBe(200);
      expect(hub.deps.db.prepare(`SELECT state, close_reason FROM alerts WHERE alert_id = ?`).get(a2)).toEqual({ state: 'closed', close_reason: 'obsolete' });
      expect(resultLink(a2)).toBeNull();
    });
  }

  // ---------------------------------------------------------------------------------------------------- #71

  /** statements of one HTTP inject / one function, on the writer's db and the read db */
  async function counted<T>(fn: () => Promise<T> | T): Promise<{ value: T; statements: number; reads: number }> {
    const w = statementCounter(hub.deps.db);
    const r = statementCounter(hub.deps.readDb);
    w.reset();
    r.reset();
    const value = await fn();
    return { value, statements: w.count + r.count, reads: r.count };
  }

  it('[01d #71] statement counts are the same with and without a link (and with a throwing one): raise, AnswerRequest, closeMany, alerts-inbox, requests-to-answer', async () => {
    const measure = async (variant: Variant) => {
      useHandover(variant);
      resetMergeGuard();
      opened('T1', 'S1');
      opened('T2', 'S2');
      const out: Record<string, number> = {};
      // raise of an owning kind (RequestTableHandover): link is not run at raise
      let a = '';
      out.raise = (
        await counted(async () => {
          a = await requestHandover('T1', 'S1');
        })
      ).statements;
      // the receiver's reads of the open request
      const inbox = await counted(() => hub.app.inject({ method: 'GET', url: '/queries/alerts-inbox', headers: { authorization: `Bearer ${sara.token}`, 'x-session-token': sara.sessionToken } }));
      out.inbox = inbox.statements;
      out.inboxQuery = inbox.reads; // the query's own statements (queries run on the read db)
      const toAnswer = await counted(() => hub.app.inject({ method: 'GET', url: '/queries/requests-to-answer', headers: { authorization: `Bearer ${sara.token}`, 'x-session-token': sara.sessionToken } }));
      out.requestsToAnswer = toAnswer.statements;
      out.requestsToAnswerQuery = toAnswer.reads;
      // AnswerRequest (accept, the request_result raise with values.link)
      out.answer = (await counted(() => accept(a))).statements;
      // closeMany with a request_result raise (one alert read, values_json in the same SELECT)
      const b = await requestHandover('T2', 'S2');
      out.closeMany = (await counted(() => hub.deps.writer.run((tx) => tx.append(alerts.closeMany(alerts.tickCtx(tx, hub.clock.branchNow()), [{ alert_id: b, reason: 'obsolete' }]))))).statements;
      return out;
    };
    const real = await measure('real');
    // a fresh hub for each variant, so every count starts from the same rows
    for (const variant of ['none', 'throws'] as const) {
      useHandover('real');
      await hub.close();
      hub = await createTestHub();
      resetMergeGuard();
      await seedDirectory(hub, await tablesDirectory());
      ali = seat('S_ALI');
      sara = seat('S_SARA');
      expect(await measure(variant), variant).toEqual(real);
    }
    // Absolute totals, so a statement added for every variant fails here too (review h3 #252, reviewer B's mutation).
    // Measured with this same flow on module-deeplinks @ 4d596bed (before h1, = v1.2.5 alerts code): identical numbers.
    // Each total is the whole HTTP command / query (auth, pipeline, after-commit frames), writer db + read db:
    // - raise 44: RequestTableHandover (the owning raise; `link` is not run there; +1 since 05 task 7, the `billing` checkpoint;
    //   +1 since 05 task 8, the `shifts` checkpoint)
    // - inbox 4 = 2 query statements (§3.13.1 "Statement counts": 2 → 2; 01d #42 pin) + 2 auth
    // - requests-to-answer 4 = 2 query statements (2 → 2; 01d §6.9 pin) + 2 auth
    // - answer 54 (+1, 05 task 7; +1, 05 task 8): AnswerRequest accept with the request_result raise (values.link from the RequestRow, no read added)
    // - closeMany 41 (+1, 05 task 7; +1, 05 task 8): one close obsolete with its request_result raise (values_json in the same alert SELECT, 1 → 1)
    expect(real).toEqual({ raise: 44, inbox: 4, inboxQuery: 2, requestsToAnswer: 4, requestsToAnswerQuery: 2, answer: 54, closeMany: 41 });
  });
});
