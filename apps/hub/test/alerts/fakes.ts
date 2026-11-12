import { ALERT_CONSTANTS, DomainError, type ErrorCode } from '@pos/domain';
import { AlertDetailsBase, defineEvent, latestVersion, type AlertTarget, type EventDraft } from '@pos/events';
import { z } from 'zod';
import type { WriterTx } from '../../src/engine-host/writer';
import {
  APPROVAL_TIER_STEPS,
  defineAlertKind,
  unregisterAlertKind,
  type AlertApplyCtx,
  type AlertRequestDef,
  type AnswerFacts,
} from '../../src/alerts/kinds';
import { registerRoute, unregisterRoute } from '../../src/alerts/routes';
import { registerTick, unregisterTick } from '../../src/alerts/tick';
import { registerTargetResolver, targetKey, unregisterTargetResolver, type ResolvedTarget } from '../../src/alerts/targets';

// 01d §4.4 test fakes (plan "Test fakes"): kinds of later modules exist here only. Never imported by src/.
// Each test file calls registerFakes() (beforeAll / beforeEach) and resetFakes() (afterAll / afterEach).
// Resolvers fakeTableOwner / fakePoint (task 16), fakeZoneOrderTaker and route fakePager (task 17);
// tick fakeFires (task 27): registered only by registerFakeFires(), unregistered by resetFakes().

export type FakeApplyMode = 'ok' | 'throw' | 'append' | 'onCommit' | 'write' | 'no_alert_id' | 'other_alert_id';

/** Controls every fake request kind's `apply` and `onWithdraw`; `resetFakes()` restores the defaults. */
export const fakeApply: {
  mode: FakeApplyMode;
  throwCode: ErrorCode;
  calls: Array<{ fn: 'apply' | 'onWithdraw'; kind: string; alert_id: string; answer: AnswerFacts | null }>;
} = { mode: 'ok', throwCode: 'ITEM_WRONG_STAGE', calls: [] };

/** The effect event a fake `apply` returns (payload `alert_id` optional so 01d's own check is what fails). */
export const FAKE_EFFECT_EVENT = 'TestAlertEffect';

function ensureEffectEvent(): void {
  try {
    latestVersion(FAKE_EFFECT_EVENT);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('unknown event type')) throw error;
    defineEvent({ eventType: FAKE_EFFECT_EVENT, version: 1, payload: z.object({ alert_id: z.string().optional() }) });
  }
}

function effect(ctx: AlertApplyCtx<unknown, unknown>, payload: Record<string, unknown>): EventDraft {
  return {
    stream_type: ctx.alert.subject.stream_type as EventDraft['stream_type'],
    stream_id: ctx.alert.subject.stream_id,
    event_type: FAKE_EFFECT_EVENT,
    schema_version: 1,
    payload,
    occurred_at: ctx.clock.branchNow(),
    actor_id: ctx.actor.staffId,
    device_id: ctx.actor.deviceId,
  };
}

function runFake(fn: 'apply' | 'onWithdraw', ctx: AlertApplyCtx<unknown, unknown>, answer: AnswerFacts | null): EventDraft[] {
  fakeApply.calls.push({ fn, kind: ctx.alert.kind, alert_id: ctx.alert.alert_id, answer });
  const own = effect(ctx, { alert_id: ctx.alert.alert_id });
  switch (fakeApply.mode) {
    case 'ok':
      return [own];
    case 'throw':
      throw new DomainError(fakeApply.throwCode, { reason: 'fake_apply' });
    case 'append':
      ctx.tx.append([own]);
      return [own];
    case 'onCommit':
      ctx.tx.onCommit(() => {});
      return [own];
    case 'write':
      // A visible write: if the read-only view let it through, the alert's step would change.
      ctx.tx.db.prepare('UPDATE alerts SET step = step + 100 WHERE alert_id = ?').run(ctx.alert.alert_id);
      return [own];
    case 'no_alert_id':
      return [effect(ctx, {})];
    case 'other_alert_id':
      return [effect(ctx, { alert_id: `${ctx.alert.alert_id}_other` })];
  }
}

function fakeRequest<V, D>(
  part: Pick<AlertRequestDef<V, D>, 'answers' | 'right' | 'needs_pin'>,
  o: { alsoTo?: boolean } = {},
): AlertRequestDef<V, D> {
  const request: AlertRequestDef<V, D> = {
    ...part,
    apply: (ctx, answer) => runFake('apply', ctx as AlertApplyCtx<unknown, unknown>, answer),
    onWithdraw: (ctx) => runFake('onWithdraw', ctx as AlertApplyCtx<unknown, unknown>, null),
  };
  if (o.alsoTo === true) request.result_also_to = (ctx) => runAlsoTo(ctx as AlertApplyCtx<unknown, unknown>);
  return request;
}

/**
 * 01d v1.2.5 D-2 (test 67): the fake `result_also_to` of `t_approval_also` — one read statement (as 04's
 * `currentTableOf`), then `{ table_team, table_id, depth: 'owner' }`, or null when `table_id` is null. Each
 * call records whether its tx was the read-only view (`append` throws there).
 */
export const fakeAlsoTo: {
  table_id: string | null;
  /** 'throw' → a DomainError (fakeApply.throwCode); 'write' → a write on the read-only view (refused, a plain Error) */
  mode: 'ok' | 'throw' | 'write';
  calls: Array<{ alert_id: string; read_only: boolean }>;
} = {
  table_id: 'T12',
  mode: 'ok',
  calls: [],
};

function runAlsoTo(ctx: AlertApplyCtx<unknown, unknown>): AlertTarget | null {
  const row = ctx.tx.db.prepare('SELECT ? AS table_id').get(fakeAlsoTo.table_id) as { table_id: string | null };
  let read_only = false;
  try {
    ctx.tx.append([]);
  } catch {
    read_only = true;
  }
  fakeAlsoTo.calls.push({ alert_id: ctx.alert.alert_id, read_only });
  if (fakeAlsoTo.mode === 'throw') throw new DomainError(fakeApply.throwCode, { reason: 'fake_also_to' });
  if (fakeAlsoTo.mode === 'write') ctx.tx.db.prepare('UPDATE alerts SET step = step + 100 WHERE alert_id = ?').run(ctx.alert.alert_id);
  return row.table_id === null ? null : { kind: 'table_team', table_id: row.table_id, depth: 'owner' };
}

type TableTeamTarget = Extract<AlertTarget, { kind: 'table_team' }>;
type PointTarget = Extract<AlertTarget, { kind: 'point' }>;
type ZoneTarget = Extract<AlertTarget, { kind: 'zone_order_taker' }>;

/** 02-like `tableOwner` (§3.4, §4.4): table_id → owner, set by the test; one statement per call. */
export const fakeTableOwner: {
  owners: Map<string, string>;
  reports: Map<string, string[]>;
  /** table_id → device ids the resolver also returns (device recipient rows, staff_id null) */
  devices: Map<string, string[]>;
  calls: TableTeamTarget[][];
} = {
  owners: new Map(),
  reports: new Map(),
  devices: new Map(),
  calls: [],
};

/** 01a-like point tablets (§3.4, §4.4): point_id → bound tablet ids, set by the test; one statement per call. */
export const fakePoint: { devices: Map<string, string[]>; calls: PointTarget[][] } = { devices: new Map(), calls: [] };

/** 01a/01b/02-like zone order taker (§3.4.2, §4.4): table_id → taker, set by the test; one statement per call. */
export const fakeZoneOrderTaker: { takers: Map<string, string>; calls: ZoneTarget[][] } = { takers: new Map(), calls: [] };

/** 01e-like pager route (§3.8): staff_id → pager refs, set by the test; one statement per `routesFor` call. */
export const fakePager: {
  refs: Map<string, string[]>;
  calls: string[][];
  sent: Array<{ alert_id: string; step: number; route_ref: string }>;
} = { refs: new Map(), calls: [], sent: [] };

function fakeZoneOrderTakerResolver(tx: WriterTx, targets: ZoneTarget[]): Map<string, ResolvedTarget> {
  fakeZoneOrderTaker.calls.push(targets);
  const rows = tx.db
    .prepare('SELECT t.value AS table_id, z.value AS staff_id FROM json_each(?) t JOIN json_each(?) z ON z.key = t.value')
    .all(JSON.stringify(targets.map((t) => t.table_id)), JSON.stringify(Object.fromEntries(fakeZoneOrderTaker.takers))) as Array<{
    table_id: string;
    staff_id: string;
  }>;
  return new Map(
    rows.map((row) => [targetKey({ kind: 'zone_order_taker', table_id: row.table_id }), { staff_ids: [row.staff_id], device_ids: [] }]),
  );
}

function fakePagerRoutesFor(tx: WriterTx, staffIds: string[]): Map<string, Array<{ route_ref: string }>> {
  fakePager.calls.push([...staffIds]);
  const rows = tx.db
    .prepare('SELECT s.value AS staff_id, r.value AS refs FROM json_each(?) s JOIN json_each(?) r ON r.key = s.value')
    .all(JSON.stringify(staffIds), JSON.stringify(Object.fromEntries(fakePager.refs))) as Array<{ staff_id: string; refs: string }>;
  return new Map(rows.map((row) => [row.staff_id, (JSON.parse(row.refs) as string[]).map((route_ref) => ({ route_ref }))]));
}

function fakeTableOwnerResolver(tx: WriterTx, targets: TableTeamTarget[]): Map<string, ResolvedTarget> {
  fakeTableOwner.calls.push(targets);
  const rows = tx.db
    .prepare('SELECT t.value AS table_id, o.value AS staff_id FROM json_each(?) t JOIN json_each(?) o ON o.key = t.value')
    .all(JSON.stringify(targets.map((t) => t.table_id)), JSON.stringify(Object.fromEntries(fakeTableOwner.owners))) as Array<{
    table_id: string;
    staff_id: string;
  }>;
  // 01d D-1: the full set per (table, depth); `owner` → [holder], `direct` → [holder, ...reports set by the test]
  const holders = new Map(rows.map((row) => [row.table_id, row.staff_id]));
  const out = new Map<string, ResolvedTarget>();
  for (const t of targets) {
    const holder = holders.get(t.table_id);
    if (holder === undefined) continue;
    const staff_ids = t.depth === 'owner' ? [holder] : [holder, ...(fakeTableOwner.reports.get(holder) ?? [])];
    out.set(targetKey(t), { staff_ids, device_ids: fakeTableOwner.devices.get(t.table_id) ?? [], owner_staff_id: holder });
  }
  return out;
}

function fakePointResolver(tx: WriterTx, targets: PointTarget[]): Map<string, ResolvedTarget> {
  fakePoint.calls.push(targets);
  const rows = tx.db
    .prepare('SELECT t.value AS point_id, d.value AS devices FROM json_each(?) t JOIN json_each(?) d ON d.key = t.value')
    .all(JSON.stringify(targets.map((t) => t.point_id)), JSON.stringify(Object.fromEntries(fakePoint.devices))) as Array<{
    point_id: string;
    devices: string;
  }>;
  return new Map(
    rows.map((row) => [targetKey({ kind: 'point', point_id: row.point_id }), { staff_ids: [], device_ids: JSON.parse(row.devices) as string[] }]),
  );
}

const labels = (kind: string) => ({ card: `alert.${kind}.card`, lock: `alert.${kind}.lock` });

const FAKE_KINDS = [
  't_approval',
  't_approval_also',
  't_accept',
  't_action',
  't_info',
  't_two_step',
  't_point_like',
  't_handover_like',
] as const;
export type FakeKind = (typeof FAKE_KINDS)[number];

/** Step 1 of the fake two-step / point-like kinds and the handover-like remind (ms after raise). */
export const FAKE_STEP_1_MS = 60_000;

export function registerFakes(): void {
  ensureEffectEvent();
  // 02a SG-6: registerTables (buildHubServer) registered the real resolvers; the fakes replace them
  unregisterTargetResolver('table_team');
  unregisterTargetResolver('zone_order_taker');
  unregisterTargetResolver('point'); // 03b G-1: registerKds (buildHubServer) registers the real point resolver
  registerTargetResolver('table_team', fakeTableOwnerResolver);
  registerTargetResolver('point', fakePointResolver);
  registerTargetResolver('zone_order_taker', fakeZoneOrderTakerResolver);
  registerRoute({
    route: 'pager',
    format: 'short_code',
    ack: false,
    receipts: [],
    routesFor: fakePagerRoutesFor,
    send: (alert, step, route_ref) => {
      fakePager.sent.push({ alert_id: alert.alert_id, step, route_ref });
    },
  });

  // 04-like void approval: approval tier, money PIN, details for the approver.
  defineAlertKind({
    kind: 't_approval',
    family: 'urgent',
    subject: 'order',
    steps: APPROVAL_TIER_STEPS,
    closes_on: 'owner',
    values_schema: z.object({ order_id: z.string() }),
    details_schema: AlertDetailsBase.required({ item: true, quantity: true, amount: true, reason: true }),
    lead_fallback: false,
    expires_at_day_close: true,
    silent: false,
    labels: labels('t_approval'),
    request: fakeRequest({
      answers: ['approve', 'reject'],
      right: { mode: 'approval', base_permission: 'void-item', range_permission: 'approve-void' },
      needs_pin: ALERT_CONSTANTS.needs_pin.money,
    }),
  });

  // 04-like void approval with 01d v1.2.5 D-2's `result_also_to` (test 67): t_approval plus the hook.
  defineAlertKind({
    kind: 't_approval_also',
    family: 'urgent',
    subject: 'order',
    steps: APPROVAL_TIER_STEPS,
    closes_on: 'owner',
    values_schema: z.object({ order_id: z.string() }),
    details_schema: AlertDetailsBase.required({ item: true, quantity: true, amount: true, reason: true }),
    lead_fallback: false,
    expires_at_day_close: true,
    silent: false,
    labels: labels('t_approval_also'),
    request: fakeRequest(
      {
        answers: ['approve', 'reject'],
        right: { mode: 'approval', base_permission: 'void-item', range_permission: 'approve-void' },
        needs_pin: ALERT_CONSTANTS.needs_pin.money,
      },
      { alsoTo: true },
    ),
  });

  // Named accept kind, no PIN (pilot accept kinds).
  defineAlertKind({
    kind: 't_accept',
    family: 'action',
    subject: 'table',
    steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'answerer' }] }],
    closes_on: 'owner',
    values_schema: z.object({}),
    details_schema: null,
    lead_fallback: false,
    expires_at_day_close: true,
    silent: false,
    labels: labels('t_accept'),
    request: fakeRequest({ answers: ['accept', 'decline'], right: { mode: 'named' }, needs_pin: ALERT_CONSTANTS.needs_pin.accept }),
  });

  defineAlertKind({
    kind: 't_action',
    family: 'action',
    subject: 'table',
    steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
    closes_on: 'owner',
    values_schema: z.object({}),
    details_schema: null,
    lead_fallback: true,
    expires_at_day_close: true,
    silent: false,
    labels: labels('t_action'),
    request: null,
  });

  defineAlertKind({
    kind: 't_info',
    family: 'info',
    subject: 'hub',
    steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
    closes_on: 'owner',
    values_schema: z.object({}),
    details_schema: null,
    lead_fallback: true,
    expires_at_day_close: true,
    silent: false,
    labels: labels('t_info'),
    request: null,
  });

  // test_alert-like over two steps (test 46).
  defineAlertKind({
    kind: 't_two_step',
    family: 'info',
    subject: 'hub',
    steps: [
      { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] },
      { at: { ms: FAKE_STEP_1_MS }, to: [{ target: 'raised_target', set: 'recipient' }] },
    ],
    closes_on: 'owner',
    values_schema: z.object({}),
    details_schema: null,
    lead_fallback: true,
    expires_at_day_close: true,
    silent: false,
    labels: labels('t_two_step'),
    request: null,
  });

  // 03a-like (test 50): step 1 targets built from the alert's values.
  defineAlertKind({
    kind: 't_point_like',
    family: 'action',
    subject: 'order',
    steps: [
      { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] },
      {
        at: { ms: FAKE_STEP_1_MS },
        to: [
          { target: { kind: 'point', from_value: 'point_id' }, set: 'recipient' },
          { target: { kind: 'managers' }, set: 'recipient' },
        ],
      },
    ],
    closes_on: 'owner',
    values_schema: z.object({ point_id: z.string().min(1), table_id: z.string() }),
    details_schema: null,
    lead_fallback: true,
    expires_at_day_close: true,
    silent: false,
    labels: labels('t_point_like'),
    request: null,
  });

  // 02 handover-like accept (test 50): remind, and the requester's lead at step 1.
  defineAlertKind({
    kind: 't_handover_like',
    family: 'action',
    subject: 'table',
    steps: [
      { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'answerer' }] },
      {
        at: { ms: FAKE_STEP_1_MS },
        to: [
          { target: 'raised_target', set: 'answerer' },
          { target: { kind: 'requester_lead' }, set: 'informed' },
        ],
      },
    ],
    closes_on: 'owner',
    values_schema: z.object({ table_id: z.string() }),
    details_schema: null,
    lead_fallback: false,
    expires_at_day_close: true,
    silent: false,
    labels: labels('t_handover_like'),
    request: fakeRequest({ answers: ['accept', 'decline'], right: { mode: 'named' }, needs_pin: ALERT_CONSTANTS.needs_pin.accept }),
  });
}

/**
 * 03a-like fire scheduler tick (§3.5, §4.2 "To 03a", test 37): `due` is pure over the fields below (no
 * statement); `intents` appends one effect draft itself (so a rollback is visible) and returns another,
 * or throws. Every call records the `now` it was given.
 */
export const fakeFires: {
  due: boolean;
  mode: 'ok' | 'throw' | 'throw_due';
  calls: Array<{ fn: 'due' | 'intents'; now: number }>;
} = { due: false, mode: 'ok', calls: [] };

/** The effect draft fakeFires writes; `marker` tells its two drafts apart. */
export function fakeFiresDraft(now: number, marker: string): EventDraft {
  return {
    stream_type: 'hub',
    stream_id: 'fires',
    event_type: FAKE_EFFECT_EVENT,
    schema_version: 1,
    payload: { alert_id: marker },
    occurred_at: now,
    actor_id: null,
    device_id: 'hub',
  };
}

/** Registers fakeFires after the ticks already registered (01d's `alerts` is first). */
export function registerFakeFires(): void {
  ensureEffectEvent();
  registerTick({
    name: 'fires',
    due: (_db, _state, now) => {
      fakeFires.calls.push({ fn: 'due', now });
      if (fakeFires.mode === 'throw_due') throw new Error('fake fires due failed');
      return fakeFires.due;
    },
    intents: (tx, _state, now) => {
      fakeFires.calls.push({ fn: 'intents', now });
      tx.append([fakeFiresDraft(now, 'fires_appended')]);
      if (fakeFires.mode === 'throw') throw new Error('fake fires intents failed');
      return [fakeFiresDraft(now, 'fires_returned')];
    },
  });
}

export function resetFakes(): void {
  unregisterTick('fires');
  fakeFires.due = false;
  fakeFires.mode = 'ok';
  fakeFires.calls.length = 0;
  for (const kind of FAKE_KINDS) unregisterAlertKind(kind);
  unregisterTargetResolver('table_team');
  unregisterTargetResolver('point');
  unregisterTargetResolver('zone_order_taker');
  unregisterRoute('pager');
  fakeZoneOrderTaker.takers.clear();
  fakeZoneOrderTaker.calls.length = 0;
  fakePager.refs.clear();
  fakePager.calls.length = 0;
  fakePager.sent.length = 0;
  fakeTableOwner.owners.clear();
  fakeTableOwner.reports.clear();
  fakeTableOwner.devices.clear();
  fakeTableOwner.calls.length = 0;
  fakePoint.devices.clear();
  fakePoint.calls.length = 0;
  fakeApply.mode = 'ok';
  fakeApply.throwCode = 'ITEM_WRONG_STAGE';
  fakeApply.calls.length = 0;
  fakeAlsoTo.table_id = 'T12';
  fakeAlsoTo.mode = 'ok';
  fakeAlsoTo.calls.length = 0;
}
