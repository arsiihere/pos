import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  aPresenceSet,
  aRequestAnswered,
  anAlertClosed,
  anAlertRaised,
  anAttemptSent,
} from '../testing/index';
import {
  AlertDetailsBase,
  AlertLockSchema,
  AlertStepTargetSchema,
  AlertTargetSchema,
  AlertInboxRow,
  AlertsCatchUpPart,
  AlertViewSchema,
  AnswerRequestPayload,
  REQUEST_OUTCOMES,
  MarkAlertsSeenPayload,
  MyRequestsResponse,
  RequestsToAnswerResponse,
  SendTestAlertPayload,
  SetPresencePayload,
} from './alerts';
import { parseEvent } from './codecs';
import './index';
import { payloadSchema } from './registry';

const ALERT_EVENTS = [
  ['AlertRaised', 'hub'],
  ['AttemptSent', 'hub'],
  ['EscalationStepped', 'hub'],
  ['StepSkipped', 'hub'],
  ['RequestAnswered', 'hub'],
  ['RequestWithdrawn', 'hub'],
  ['RequestSeen', 'hub'],
  ['AlertClosed', 'hub'],
  ['AlertDelivered', 'audit'],
  ['AlertSeen', 'audit'],
  ['RequestPinFailed', 'audit'],
  ['PresenceSet', 'staff'],
] as const;

const fixture = (type: string): Record<string, unknown> & { payload: Record<string, unknown> } => {
  const dir = fileURLToPath(new URL('../fixtures/', import.meta.url));
  return JSON.parse(readFileSync(join(dir, `${type}.v1.json`), 'utf8')) as Record<string, unknown> & {
    payload: Record<string, unknown>;
  };
};

const ULID = '01J00000000000000000000010';

describe('01d alert events', () => {
  it('[01d §4.2] a fixture per event parses, on its stream type, at schema_version 1', () => {
    for (const [type, stream] of ALERT_EVENTS) {
      const parsed = parseEvent(fixture(type));
      expect(parsed.event_type, type).toBe(type);
      expect(parsed.stream_type, type).toBe(stream);
      expect(parsed.schema_version, type).toBe(1);
    }
  });

  it('[01d §4.2] the builders parse', () => {
    for (const build of [anAlertRaised, anAttemptSent, aRequestAnswered, anAlertClosed, aPresenceSet]) {
      expect(() => parseEvent(build())).not.toThrow();
    }
    expect(aPresenceSet().stream_type).toBe('staff');
    expect(anAlertClosed({ payload: { reason: 'expired' } }).payload.reason).toBe('expired');
  });

  it('[01d §4.2] RequestPinFailed carries no pin and refuses one', () => {
    const schema = payloadSchema('RequestPinFailed', 1);
    const payload = fixture('RequestPinFailed').payload;
    expect(payload).not.toHaveProperty('pin');
    expect(schema.safeParse(payload).success).toBe(true);
    expect(schema.safeParse({ ...payload, pin: '1234' }).success).toBe(false);
    expect(schema.safeParse({ ...payload, matched: true }).success).toBe(false);
    expect(schema.safeParse({ ...payload, method: 'session' }).success).toBe(false);
    expect(schema.safeParse({ ...payload, outcome: 'answer_failed', error_code: 'REQUEST_NOT_PENDING' }).success).toBe(
      true,
    );
  });

  it('[01d §4.2] AlertRaised.request.approver_role_ids is an array', () => {
    const schema = payloadSchema('AlertRaised', 1);
    const base = fixture('AlertRaised').payload;
    const request = {
      answers: ['approve', 'reject'],
      right_mode: 'approval',
      base_permission: 'void-item',
      range_permission: 'approve-void',
      approver_role_ids: ['R1', 'R2'],
      receiver_staff_id: null,
      needs_pin: 'always',
    };
    expect(schema.safeParse({ ...base, request }).success).toBe(true);
    expect(schema.safeParse({ ...base, request: { ...request, approver_role_ids: 'R1' } }).success).toBe(false);
    const withoutRoles = Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'approver_role_ids'));
    expect(withoutRoles).not.toHaveProperty('approver_role_ids');
    expect(schema.safeParse({ ...base, request: withoutRoles }).success).toBe(false);
    expect(schema.safeParse({ ...base, request: { ...request, needs_pin: 'sometimes' } }).success).toBe(false);
    expect(schema.safeParse({ ...base, hidden_from: { session_id: 'SE', device_id: 'D' } }).success).toBe(true);
  });

  it('[01d §4.2] AlertClosed reasons are the owner reasons plus expired', () => {
    const schema = payloadSchema('AlertClosed', 1);
    const base = fixture('AlertClosed').payload;
    for (const reason of ['done', 'obsolete', 'overridden', 'undone', 'expired']) {
      expect(schema.safeParse({ ...base, reason }).success, reason).toBe(true);
    }
    for (const reason of ['answered', 'withdrawn']) {
      expect(schema.safeParse({ ...base, reason }).success, reason).toBe(false);
    }
  });

  it('[01d §4.2] StepSkipped reason is superseded or shortcut', () => {
    const schema = payloadSchema('StepSkipped', 1);
    expect(schema.safeParse({ alert_id: ULID, step: 0, reason: 'shortcut' }).success).toBe(true);
    expect(schema.safeParse({ alert_id: ULID, step: 0, reason: 'late' }).success).toBe(false);
  });
});

describe('01d wire shapes', () => {
  it('[01d §3.4] AlertTargetSchema accepts each target kind and refuses an unknown one', () => {
    const targets = [
      { kind: 'person', staff_id: 'S1' },
      { kind: 'permission', permission: 'void-item' },
      { kind: 'permission', permission: 'void-item', range_of: 'S1' },
      { kind: 'team', lead_staff_id: 'S1', depth: 'all' },
      { kind: 'answerers' },
      { kind: 'holders_informed' },
      { kind: 'managers' },
      { kind: 'requester_lead' },
      { kind: 'always_on' },
      { kind: 'point', point_id: 'P1' },
      { kind: 'table_team', table_id: 'T1' },
      { kind: 'table_team', table_id: 'T1', depth: 'owner' },
      { kind: 'zone_order_taker', table_id: 'T1' },
      { kind: 'device', device_id: 'D1' },
    ];
    for (const t of targets) expect(AlertTargetSchema.safeParse(t).success, JSON.stringify(t)).toBe(true);
    expect(AlertTargetSchema.safeParse({ kind: 'branch_scope' }).success).toBe(false);
    expect(AlertTargetSchema.safeParse({ kind: 'permission', permission: 'not-a-permission' }).success).toBe(false);
  });

  it('[01d §3.5] AlertStepTargetSchema: raised_target, step kinds and from_value targets', () => {
    for (const t of [
      'raised_target',
      { kind: 'answerers' },
      { kind: 'holders_informed' },
      { kind: 'always_on' },
      { kind: 'managers' },
      { kind: 'requester_lead' },
      { kind: 'point', from_value: 'point_id' },
      { kind: 'table_team', from_value: 'table_id' },
      { kind: 'table_team', from_value: 'table_id', depth: 'owner' },
      { kind: 'zone_order_taker', from_value: 'table_id' },
    ]) {
      expect(AlertStepTargetSchema.safeParse(t).success, JSON.stringify(t)).toBe(true);
    }
    expect(AlertStepTargetSchema.safeParse('other').success).toBe(false);
    expect(AlertStepTargetSchema.safeParse({ kind: 'person', staff_id: 'S1' }).success).toBe(false);
  });

  it('[01d §3.12] AlertDetailsBase refuses quantity 0 and a 201-char reason', () => {
    expect(AlertDetailsBase.safeParse({ item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'x' }).success).toBe(
      true,
    );
    expect(AlertDetailsBase.safeParse({}).success).toBe(true);
    expect(AlertDetailsBase.safeParse({ quantity: 0 }).success).toBe(false);
    expect(AlertDetailsBase.safeParse({ reason: 'x'.repeat(200) }).success).toBe(true);
    expect(AlertDetailsBase.safeParse({ reason: 'x'.repeat(201) }).success).toBe(false);
  });

  it('[01d §3.12] AlertLockSchema has no details key and strips one', () => {
    expect(Object.keys(AlertLockSchema.shape)).not.toContain('details');
    const parsed = AlertLockSchema.parse({
      kind_label_key: 'alert.void_approval.lock',
      table_code: '12',
      details: { amount: 480_000 },
    });
    expect(parsed).not.toHaveProperty('details');
  });

  it('[01d §6 batch 3] AlertViewSchema: card optional; lock never carries details', () => {
    const view = {
      alert_id: ULID,
      kind: 'void_approval',
      family: 'urgent',
      step: 1,
      escalation: false,
      set: 'answerer',
      for_staff_id: null,
      lock: { kind_label_key: 'alert.void_approval.lock', table_code: '12', point_code: null, requester_name: 'Hamza' },
      raised_at: 1_761_900_000_000,
    };
    expect(AlertViewSchema.safeParse(view).success).toBe(true);
    const withCard = {
      ...view,
      card: { kind_label_key: 'alert.void_approval.card', table_code: '12', details: { item: 'Mutton platter', quantity: 1 } },
    };
    expect(AlertViewSchema.parse(withCard).card?.details).toEqual({ item: 'Mutton platter', quantity: 1 });
    expect(AlertViewSchema.safeParse({ ...view, family: 'loud' }).success).toBe(false);
  });

  it('[01d AD-23] AlertViewSchema: the signed-in fields answers, needs_pin, silent are optional and typed', () => {
    const view = {
      alert_id: ULID,
      kind: 'void_approval',
      family: 'urgent',
      step: 1,
      escalation: false,
      set: 'answerer',
      for_staff_id: null,
      lock: { kind_label_key: 'alert.void_approval.lock', table_code: '12', point_code: null, requester_name: 'Hamza' },
      raised_at: 1_761_900_000_000,
    };
    const signedIn = { ...view, answers: ['approve', 'reject'], needs_pin: 'always', silent: false };
    expect(AlertViewSchema.parse(signedIn)).toMatchObject({ answers: ['approve', 'reject'], needs_pin: 'always', silent: false });
    expect(AlertViewSchema.safeParse({ ...view, answers: null, needs_pin: null, silent: true }).success).toBe(true);
    expect(AlertViewSchema.safeParse({ ...view, answers: ['maybe'] }).success).toBe(false);
    expect(AlertViewSchema.safeParse({ ...view, needs_pin: 'sometimes' }).success).toBe(false);
    expect(AlertViewSchema.safeParse({ ...view, silent: 'yes' }).success).toBe(false);
  });

  it('[01d AD-82] AlertViewSchema.outcome: approved, rejected, withdrawn, obsolete, overridden or null; nothing else', () => {
    const view = {
      alert_id: ULID,
      kind: 'request_result',
      family: 'info',
      step: 0,
      escalation: false,
      set: 'recipient',
      for_staff_id: null,
      lock: { kind_label_key: 'alert.request_result.lock', table_code: '12' },
      raised_at: 1_761_900_000_000,
    };
    expect(REQUEST_OUTCOMES).toEqual(['approved', 'rejected', 'withdrawn', 'obsolete', 'overridden']);
    for (const outcome of [...REQUEST_OUTCOMES, null]) expect(AlertViewSchema.safeParse({ ...view, outcome }).success).toBe(true);
    expect(AlertViewSchema.safeParse(view).success).toBe(true);
    expect(AlertViewSchema.safeParse({ ...view, outcome: 'answered' }).success).toBe(false);
  });

  it('[01d AD-22] AlertInboxRow: the view plus seen_by_me, moved_to_name, for_staff_name, state and close_reason', () => {
    const row = {
      alert_id: ULID,
      kind: 't_info',
      family: 'info',
      step: 0,
      escalation: false,
      set: 'recipient',
      for_staff_id: 'S_CASH',
      lock: { kind_label_key: 'alert.t_info.lock' },
      raised_at: 1,
      seen_by_me: false,
      moved_to_name: null,
      for_staff_name: 'Ali',
      state: 'closed',
      close_reason: 'expired',
    };
    expect(AlertInboxRow.safeParse(row).success).toBe(true);
    expect(AlertInboxRow.safeParse({ ...row, state: 'open', close_reason: null }).success).toBe(true);
    expect(AlertInboxRow.safeParse({ ...row, state: 'gone' }).success).toBe(false);
    expect(AlertInboxRow.safeParse({ ...row, close_reason: 'answered_twice' }).success).toBe(false);
    expect(AlertInboxRow.safeParse({ ...row, state: undefined }).success).toBe(false);
  });

  it('[01d §6 batch 3] AlertsCatchUpPart: { alerts: view + seen_by_me }', () => {
    const row = {
      alert_id: ULID,
      kind: 't_info',
      family: 'info',
      step: 0,
      escalation: false,
      set: 'recipient',
      for_staff_id: null,
      lock: { kind_label_key: 'alert.t_info.lock' },
      raised_at: 1,
      seen_by_me: true,
      from_business_day: null,
    };
    expect(AlertsCatchUpPart.safeParse({ alerts: [row] }).success).toBe(true);
    expect(AlertsCatchUpPart.safeParse({ alerts: [{ ...row, seen_by_me: undefined }] }).success).toBe(false);
  });

  it('[01d BF-4] catch-up and requests-to-answer rows carry raised_at and from_business_day (a YYYY-MM-DD business date or null; required)', () => {
    const view = {
      alert_id: ULID,
      kind: 't_approval',
      family: 'urgent',
      step: 2,
      escalation: true,
      set: 'answerer',
      for_staff_id: null,
      lock: { kind_label_key: 'alert.t_approval.lock' },
      raised_at: 1,
      seen_by_me: false,
    };
    for (const from of [null, '2025-10-19']) {
      expect(AlertsCatchUpPart.safeParse({ alerts: [{ ...view, from_business_day: from }] }).success).toBe(true);
      expect(RequestsToAnswerResponse.safeParse({ data: { requests: [{ ...view, can_answer: true, from_business_day: from }] } }).success).toBe(true);
    }
    for (const bad of [undefined, '19/10/2025', 20251019]) {
      expect(AlertsCatchUpPart.safeParse({ alerts: [{ ...view, from_business_day: bad }] }).success).toBe(false);
      expect(RequestsToAnswerResponse.safeParse({ data: { requests: [{ ...view, can_answer: true, from_business_day: bad }] } }).success).toBe(false);
    }
    expect(AlertsCatchUpPart.safeParse({ alerts: [{ ...view, raised_at: undefined, from_business_day: null }] }).success).toBe(false);
  });

  it('[01d §6.8] MyRequestsResponse rows: state, close_reason, decision, answerer_name, raised_at, waiting_ms, ask_in_person, lock (AD-13)', () => {
    const row = {
      alert_id: ULID,
      kind: 't_approval',
      state: 'approved',
      close_reason: 'answered',
      decision: 'approve',
      answerer_name: 'Manager',
      raised_at: 1,
      waiting_ms: 0,
      ask_in_person: false,
      lock: { kind_label_key: 'alert.t_approval.lock' },
    };
    expect(MyRequestsResponse.safeParse({ data: { requests: [row] } }).success).toBe(true);
    expect(MyRequestsResponse.safeParse({ data: { requests: [{ ...row, state: 'pending', close_reason: null, decision: null, answerer_name: null }] } }).success).toBe(true);
    expect(MyRequestsResponse.safeParse({ data: { requests: [{ ...row, state: 'open' }] } }).success).toBe(false);
    expect(MyRequestsResponse.safeParse({ data: { requests: [{ ...row, waiting_ms: -1 }] } }).success).toBe(false);
  });

  describe('[01d §6.2] AnswerRequestPayload', () => {
    const base = { alert_id: ULID, decision: 'approve' };
    const ok = (p: Record<string, unknown>) => AnswerRequestPayload.safeParse({ ...base, ...p }).success;

    it('[01d §6.2] accepts session without pin, pin with pin, in_person with answerer and pin', () => {
      expect(ok({ method: 'session' })).toBe(true);
      expect(ok({ method: 'pin', pin: '1234' })).toBe(true);
      expect(ok({ method: 'pin', pin: '123456' })).toBe(true);
      expect(ok({ method: 'in_person', answerer_staff_id: 'S2', pin: '1234' })).toBe(true);
    });

    it("[01d §6.2] pin '1234567' and '12a4' fail", () => {
      expect(ok({ method: 'pin', pin: '1234567' })).toBe(false);
      expect(ok({ method: 'pin', pin: '12a4' })).toBe(false);
      expect(ok({ method: 'pin', pin: '123' })).toBe(false);
    });

    it('[01d §6.2] in_person without answerer_staff_id fails', () => {
      expect(ok({ method: 'in_person', pin: '1234' })).toBe(false);
    });

    it('[01d §6.2] answerer_staff_id with pin or session fails', () => {
      expect(ok({ method: 'pin', pin: '1234', answerer_staff_id: 'S2' })).toBe(false);
      expect(ok({ method: 'session', answerer_staff_id: 'S2' })).toBe(false);
    });

    it('[01d §6.2] pin with session fails', () => {
      expect(ok({ method: 'session', pin: '1234' })).toBe(false);
    });

    it('[01d §6.2] pin or in_person without pin fails', () => {
      expect(ok({ method: 'pin' })).toBe(false);
      expect(ok({ method: 'in_person', answerer_staff_id: 'S2' })).toBe(false);
    });

    it('[01d §6.2] unknown decision or method fails; the issues never echo the PIN', () => {
      expect(ok({ method: 'session', decision: 'maybe' })).toBe(false);
      expect(ok({ method: 'voice' })).toBe(false);
      const result = AnswerRequestPayload.safeParse({ ...base, method: 'session', pin: '987654' });
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).not.toContain('987654');
    });
  });

  it('[01d §6.4] MarkAlertsSeenPayload refuses 0 and 51 ids', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `A${i}`);
    expect(MarkAlertsSeenPayload.safeParse({ alert_ids: ids(1) }).success).toBe(true);
    expect(MarkAlertsSeenPayload.safeParse({ alert_ids: ids(50) }).success).toBe(true);
    expect(MarkAlertsSeenPayload.safeParse({ alert_ids: [] }).success).toBe(false);
    expect(MarkAlertsSeenPayload.safeParse({ alert_ids: ids(51) }).success).toBe(false);
  });

  it('[01d §6.5] SendTestAlertPayload: person, team (depth default direct), device, point; nothing else', () => {
    expect(SendTestAlertPayload.parse({ target: { kind: 'team', lead_staff_id: 'S1' } }).target).toEqual({
      kind: 'team',
      lead_staff_id: 'S1',
      depth: 'direct',
    });
    for (const target of [
      { kind: 'person', staff_id: 'S1' },
      { kind: 'device', device_id: 'D1' },
      { kind: 'point', point_id: 'P1' },
    ]) {
      expect(SendTestAlertPayload.safeParse({ target }).success, target.kind).toBe(true);
    }
    expect(SendTestAlertPayload.safeParse({ target: { kind: 'managers' } }).success).toBe(false);
  });

  it('[01d §6.6] SetPresencePayload refuses 0 and 101 ids', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `S${i}`);
    expect(SetPresencePayload.safeParse({ staff_ids: ids(100), present: true }).success).toBe(true);
    expect(SetPresencePayload.safeParse({ staff_ids: ids(101), present: true }).success).toBe(false);
    expect(SetPresencePayload.safeParse({ staff_ids: [], present: true }).success).toBe(false);
    expect(SetPresencePayload.safeParse({ staff_ids: ids(1) }).success).toBe(false);
  });
});
