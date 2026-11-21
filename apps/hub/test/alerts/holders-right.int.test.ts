import { AlertDetailsBase, type DirectoryInput, type PosEvent } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { APPROVAL_TIER_STEPS, defineAlertKind, unregisterAlertKind } from '../../src/alerts/kinds';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { activity } from '../../src/auth/session-store';
import { currentDirectory } from '../../src/auth/guards';
import type { CommandCtx } from '../../src/commands/registry';
import { aDirectory, PIN, pinHash } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FAKE_EFFECT_EVENT, registerFakes, resetFakes } from './fakes';

// ⚠️ Changed by 05 (row D-1; H1-1, owner R1), 01d v1.3.4 §3.3 rule 6, §4.3 To 05; 05 test #53b (written here,
// tasks 21 / 22 extend with the real petty_cash / shift_variance kinds): a request kind with the right
// `{ mode: 'holders', permission: 'close-shift-for-others' }` — raised as AlertRaised v5 with
// `right_mode: 'holders'`; step 0 reaches the holders in range, never the requester; AnswerRequest accepts only
// holders whose scope covers the requester, whatever the requester's own grant.

const OWNER = 'S_OWNER'; // holds close-shift-for-others (branch), PIN.a
const MGR = 'S_MGR'; // holds close-shift-for-others (branch), PIN.b
const CASH = 'S_CASH'; // requester, PIN.c
const CASH2 = 'S_CASH2'; // a second cashier: no close-shift-for-others, PIN.c
const LEAD2 = 'S_LEAD2'; // close-shift-for-others my_team, nobody below them, PIN.c
const TENANT = 'tenant-a';
const BRANCH = 'branch-1';
const KIND = 't_holders';

async function directory(pettyGrant: 'allowed' | 'requires_approval'): Promise<DirectoryInput> {
  const base = await aDirectory();
  const c = await pinHash(PIN.c);
  const roles = base.roles.map((role) =>
    role.role_id === 'R_CASH'
      ? {
          ...role,
          permissions: [
            ...role.permissions,
            { permission: 'manage-own-shift' as const, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope: 'branch' as const },
            pettyGrant === 'allowed'
              ? { permission: 'record-petty-cash' as const, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope: 'branch' as const }
              : // the grant's own approvers are the cashiers: the holders right must not read them
                { permission: 'record-petty-cash' as const, grant_type: 'requires_approval' as const, approver_role_id: 'R_CASH', approver_role_ids: ['R_CASH'], scope: 'branch' as const },
          ],
        }
      : role,
  );
  roles.push({
    role_id: 'R_LEAD',
    name: 'Lead',
    session_idle_ttl_ms: 3_600_000,
    permissions: [
      { permission: 'manage-own-shift', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'branch' },
      { permission: 'close-shift-for-others', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'my_team' },
    ],
  });
  const staff = [
    ...base.staff.filter((s) => s.staff_id !== 'S_WAIT'),
    { staff_id: CASH2, display_name: 'Cashier 2', pin_hash: c, role_ids: ['R_CASH'], denied_permissions: [], lead_staff_id: null, floor_ids: [] },
    { staff_id: LEAD2, display_name: 'Lead 2', pin_hash: c, role_ids: ['R_LEAD'], denied_permissions: [], lead_staff_id: null, floor_ids: [] },
  ];
  return { ...base, roles, staff };
}

interface Seat {
  staffId: string;
  deviceId: string;
  deviceToken: string;
  sessionId: string;
  sessionToken: string;
}

function seat(hub: TestHub, staffId: string): Seat {
  const device = pairDevice(hub, { type: 'tablet', name: staffId });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, deviceToken: device.token, sessionId: session.sessionId, sessionToken: session.token };
}

function raiseAs(hub: TestHub, s: Seat, input: RaiseInput): string {
  return hub.deps.writer.run((tx) => {
    const ctx = {
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
    const result = alerts.raise(ctx, input);
    tx.append(result.events);
    return result.alert_id;
  }).result;
}

const pettyInput = (n: number): RaiseInput => ({
  kind: KIND,
  subject: { stream_type: 'hub', stream_id: BRANCH },
  target: { kind: 'answerers' },
  values: {},
  display: { kind_label_key: 'alert.t.lock', requester_name: 'Cashier' },
  details: { amount: 150_000, reason: 'supplies' },
  dedupe_key: `petty:cmd-${n}`,
  requester_staff_id: CASH,
  request: {},
});

let commandNo = 0;
function answer(hub: TestHub, s: Seat, payload: Record<string, unknown>) {
  return hub.app.inject({
    method: 'POST',
    url: '/commands/answer-request',
    headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
    payload: {
      command_id: `cmd-holders-${(commandNo += 1)}`,
      tenant_id: TENANT,
      branch_id: BRANCH,
      command_type: 'AnswerRequest',
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: s.staffId,
      device_id: s.deviceId,
    },
  });
}

function eventsOf(hub: TestHub, type: string): PosEvent[] {
  return (hub.deps.db.prepare('SELECT * FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<Record<string, unknown>>).map(
    (row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent,
  );
}

const PINS: Record<string, string> = { [OWNER]: PIN.a, [MGR]: PIN.b, [CASH]: PIN.c, [CASH2]: PIN.c, [LEAD2]: PIN.c };

describe('[05 #53b, 01d v1.3.4 §3.3 rule 6] holders right through raise and AnswerRequest', () => {
  const cleanups: Array<() => Promise<void>> = [];
  beforeEach(() => {
    registerFakes();
    defineAlertKind({
      kind: KIND,
      family: 'urgent',
      subject: 'hub',
      steps: APPROVAL_TIER_STEPS,
      closes_on: 'owner',
      values_schema: z.object({}),
      details_schema: AlertDetailsBase.pick({ amount: true, reason: true }),
      lead_fallback: false,
      expires_at_day_close: true,
      silent: false,
      labels: { card: 'alert.t.card', lock: 'alert.t.lock' },
      request: {
        answers: ['approve', 'reject'],
        right: { mode: 'holders', permission: 'close-shift-for-others' },
        needs_pin: 'always',
        apply: (ctx) => [
          {
            stream_type: 'hub',
            stream_id: BRANCH,
            event_type: FAKE_EFFECT_EVENT,
            schema_version: 1,
            payload: { alert_id: ctx.alert.alert_id },
            occurred_at: ctx.clock.branchNow(),
            actor_id: ctx.actor.staffId,
            device_id: ctx.actor.deviceId,
          },
        ],
        onWithdraw: () => [],
      },
    });
  });
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    unregisterAlertKind(KIND);
    resetFakes();
    activity.drain();
    activity.drainDevices();
  });

  for (const grant of ['allowed', 'requires_approval'] as const) {
    it(`[05 #53b] requester grant ${grant}: AlertRaised v5 holders part; step 0 = holders in range; only Owner and Manager answers are accepted`, async () => {
      const hub = await createTestHub();
      cleanups.push(() => hub.close());
      await seedDirectory(hub, await directory(grant));
      const seats = Object.fromEntries([OWNER, MGR, CASH, CASH2, LEAD2].map((id) => [id, seat(hub, id)])) as Record<string, Seat>;

      const first = raiseAs(hub, seats[CASH]!, pettyInput(1));
      const raised = eventsOf(hub, 'AlertRaised').find((e) => (e.payload as { alert_id: string }).alert_id === first)!;
      expect(raised.schema_version).toBe(5);
      expect((raised.payload as { request: unknown }).request).toEqual({
        answers: ['approve', 'reject'],
        right_mode: 'holders',
        base_permission: 'close-shift-for-others',
        range_permission: null,
        approver_role_ids: [],
        receiver_staff_id: null,
        needs_pin: 'always',
      });
      const step0 = eventsOf(hub, 'AttemptSent').find((e) => (e.payload as { alert_id: string }).alert_id === first)!;
      const answerers = (step0.payload as { recipients: Array<{ staff_id: string | null; set: string }> }).recipients
        .filter((r) => r.set === 'answerer' && r.staff_id !== null)
        .map((r) => r.staff_id)
        .sort();
      expect(answerers).toEqual([MGR, OWNER].sort());

      const refused: Array<[string, string]> = [
        [CASH, 'self'],
        [CASH2, 'not_approver'],
        [LEAD2, 'out_of_range'],
      ];
      for (const [who, reason] of refused) {
        const response = await answer(hub, seats[who]!, { alert_id: first, decision: 'approve', method: 'pin', pin: PINS[who] });
        expect(response.statusCode, `${who} ${response.body}`).toBe(403);
        expect(response.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason } });
      }
      expect(eventsOf(hub, 'RequestAnswered')).toHaveLength(0);

      // Owner and Manager both may answer (each on their own request)
      const second = raiseAs(hub, seats[CASH]!, pettyInput(2));
      for (const [who, id] of [
        [MGR, first],
        [OWNER, second],
      ] as const) {
        const response = await answer(hub, seats[who]!, { alert_id: id, decision: 'approve', method: 'pin', pin: PINS[who] });
        expect(response.statusCode, `${who} ${response.body}`).toBe(200);
      }
      const answered = eventsOf(hub, 'RequestAnswered').map((e) => e.payload as { alert_id: string; answerer_staff_id: string });
      expect(answered.map((p) => [p.alert_id, p.answerer_staff_id])).toEqual([
        [first, MGR],
        [second, OWNER],
      ]);
    });
  }
});
