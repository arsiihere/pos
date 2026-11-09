import { DomainError, type Permission, type Scope } from '@pos/domain';
import type { AlertTarget } from '@pos/events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { StaffDirectory, type DirectoryCore } from '../auth/staff-directory';
import type { WriterTx } from '../engine-host/writer';
import type { WsHub } from '../ws/server';
import { defineAlertKind, unregisterAlertKind, type StepDef } from './kinds';
import {
  isPresent,
  mayAnswer,
  registerTargetResolver,
  resolveStep,
  resolveTargets,
  targetKey,
  unregisterTargetResolver,
  walkTeam,
  type AlertRequestPart,
  type AlertRow,
  type BatchReads,
  type ResolvedTarget,
  type ResolverKind,
  type TargetResolver,
} from './targets';

// 01d §3.4, §3.4.1, §3.3 rules 5–6, BF-8: pure target resolution over an in-memory (fake) directory.
// Tree: OWNER ← IMRAN (manager) ← KAMRAN, ZAIN (team leads); KAMRAN ← ALI ← HAMZA; KAMRAN ← RUNNER (no PIN).
// MGR2 is a manager with approve-void denied. CASH has no void right. Role names are never read (R5).

const OWNER = 'S_OWNER';
const IMRAN = 'S_IMRAN';
const MGR2 = 'S_MGR2';
const KAMRAN = 'S_KAMRAN';
const ZAIN = 'S_ZAIN';
const ALI = 'S_ALI';
const BILAL = 'S_BILAL';
const HAMZA = 'S_HAMZA';
const CASH = 'S_CASH';
const RUNNER = 'S_RUNNER';

type Grant = { permission: Permission; grant_type: 'allowed' | 'requires_approval'; approver_role_ids?: string[]; scope: Scope };

function role(role_id: string, grants: Grant[]): DirectoryCore['roles'][number] {
  return {
    role_id,
    name: `name-${role_id}`,
    session_idle_ttl_ms: 300_000,
    permissions: grants.map((g) => ({ ...g, approver_role_ids: g.approver_role_ids ?? [] })),
  };
}

function person(staff_id: string, role_ids: string[], lead_staff_id: string | null, denied: string[] = []): DirectoryCore['staff'][number] {
  return { staff_id, display_name: staff_id, pin_hash: 'h', role_ids, denied_permissions: denied, lead_staff_id, floor_ids: [] };
}

function directory(over: Partial<DirectoryCore> = {}): StaffDirectory {
  return StaffDirectory.fromInput({
    directory_version: 1,
    roles: [
      role('R1', [
        { permission: 'approve-void', grant_type: 'allowed', scope: 'branch' },
        { permission: 'force-release-table-lock', grant_type: 'allowed', scope: 'branch' },
      ]),
      role('R2', [
        { permission: 'approve-void', grant_type: 'allowed', scope: 'branch' },
        { permission: 'force-release-table-lock', grant_type: 'allowed', scope: 'branch' },
        { permission: 'manage-staff', grant_type: 'allowed', scope: 'branch' },
      ]),
      role('R3', [
        { permission: 'approve-void', grant_type: 'allowed', scope: 'my_team' },
        { permission: 'force-release-table-lock', grant_type: 'allowed', scope: 'my_floors' },
      ]),
      role('R4', [
        { permission: 'void-item', grant_type: 'requires_approval', approver_role_ids: ['R2', 'R3'], scope: 'own_tables' },
        { permission: 'apply-discount', grant_type: 'requires_approval', approver_role_ids: ['R2', 'R3'], scope: 'branch' },
      ]),
      role('R5', []),
    ],
    staff: [
      person(OWNER, ['R1'], null),
      person(IMRAN, ['R2'], OWNER),
      person(MGR2, ['R2'], OWNER, ['approve-void']),
      person(KAMRAN, ['R3'], IMRAN),
      person(ZAIN, ['R3'], IMRAN),
      person(ALI, ['R4'], KAMRAN),
      person(BILAL, ['R4'], ZAIN),
      person(HAMZA, ['R4'], ALI),
      person(CASH, ['R5'], null),
    ],
    responsibilities: [],
    no_pin_staff: [{ staff_id: RUNNER, display_name: 'Runner', lead_staff_id: KAMRAN }],
    ...over,
  });
}

const VOID: AlertRequestPart = {
  answers: ['approve', 'reject'],
  right_mode: 'approval',
  base_permission: 'void-item',
  range_permission: 'approve-void',
  approver_role_ids: ['R2', 'R3'],
  receiver_staff_id: null,
  needs_pin: 'always',
};
const DISCOUNT: AlertRequestPart = { ...VOID, base_permission: 'apply-discount', range_permission: null };
const named = (receiver: string): AlertRequestPart => ({
  answers: ['accept', 'decline'],
  right_mode: 'named',
  base_permission: null,
  range_permission: null,
  approver_role_ids: [],
  receiver_staff_id: receiver,
  needs_pin: 'never',
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
    ...over,
  };
}

function alert(over: Partial<AlertRow> = {}): AlertRow {
  return {
    alert_id: 'A1',
    kind: 'k',
    requester_staff_id: null,
    target: { kind: 'person', staff_id: ALI },
    values: {},
    request: null,
    step: -1,
    raised_at: 0,
    ...over,
  };
}

const ws = {} as WsHub;
const one = (target: StepDef['to'][number]['target'], set: StepDef['to'][number]['set'] = 'recipient'): StepDef => ({
  at: { ms: 0 },
  to: [{ target, set }],
});
const staffOf = (rs: ReturnType<typeof resolveStep>) => rs.filter((r) => r.staff_id !== null).map((r) => r.staff_id);
const devicesOf = (rs: ReturnType<typeof resolveStep>) => rs.filter((r) => r.device_id !== null).map((r) => r.device_id);

function resolveRaised(target: AlertTarget, o: { reads?: BatchReads; dir?: StaffDirectory; alert?: Partial<AlertRow> } = {}) {
  return resolveStep(one('raised_target'), alert({ target, ...o.alert }), o.reads ?? reads(), o.dir ?? directory(), ws);
}

const voidAlert = (requester: string, request: AlertRequestPart = VOID): Partial<AlertRow> => ({ requester_staff_id: requester, request });

const resolverKinds: ResolverKind[] = [];
function resolver<K extends ResolverKind>(kind: K, fn: TargetResolver<K>): void {
  registerTargetResolver(kind, fn);
  resolverKinds.push(kind);
}
afterEach(() => {
  for (const kind of resolverKinds.splice(0)) unregisterTargetResolver(kind);
});

describe('01d §3.4 resolveStep (test #1)', () => {
  it('[01d #1] person resolves to that person', () => {
    expect(resolveRaised({ kind: 'person', staff_id: HAMZA })).toEqual([{ staff_id: HAMZA, device_id: null, set: 'recipient' }]);
  });

  it('[01d #1] permission with my_team range_of: branch holders plus team holders above range_of', () => {
    expect(staffOf(resolveRaised({ kind: 'permission', permission: 'approve-void', range_of: ALI }))).toEqual([IMRAN, KAMRAN, OWNER]);
    expect(staffOf(resolveRaised({ kind: 'permission', permission: 'approve-void', range_of: HAMZA }))).toEqual([IMRAN, KAMRAN, OWNER]);
    expect(staffOf(resolveRaised({ kind: 'permission', permission: 'approve-void', range_of: BILAL }))).toEqual([IMRAN, OWNER, ZAIN]);
    // without range_of: every holder; MGR2 (denied) never
    expect(staffOf(resolveRaised({ kind: 'permission', permission: 'approve-void' }))).toEqual([IMRAN, KAMRAN, OWNER, ZAIN]);
  });

  it('[01d #1] team direct and all, with no_pin_staff', () => {
    expect(staffOf(resolveRaised({ kind: 'team', lead_staff_id: KAMRAN, depth: 'direct' }))).toEqual([ALI, RUNNER]);
    expect(staffOf(resolveRaised({ kind: 'team', lead_staff_id: KAMRAN, depth: 'all' }))).toEqual([ALI, RUNNER, HAMZA]);
    expect(staffOf(resolveRaised({ kind: 'team', lead_staff_id: IMRAN, depth: 'all' }))).toEqual([KAMRAN, ZAIN, ALI, RUNNER, BILAL, HAMZA]);
  });

  it('[01d #1] answerers include branch-scope holders and in-range team leads; holders_informed are out of range', () => {
    const dir = directory();
    const step: StepDef = {
      at: { ms: 0 },
      to: [
        { target: { kind: 'answerers' }, set: 'answerer' },
        { target: { kind: 'holders_informed' }, set: 'informed' },
      ],
    };
    const out = resolveStep(step, alert(voidAlert(ALI)), reads(), dir, ws);
    expect(out).toEqual([
      { staff_id: IMRAN, device_id: null, set: 'answerer' },
      { staff_id: KAMRAN, device_id: null, set: 'answerer' },
      { staff_id: ZAIN, device_id: null, set: 'informed' },
    ]);
    // grand-report requester: KAMRAN still in range
    expect(staffOf(resolveStep(one({ kind: 'answerers' }, 'answerer'), alert(voidAlert(HAMZA)), reads(), dir, ws))).toEqual([IMRAN, KAMRAN]);
  });

  it('[01d #1] answerers / holders_informed on a non-request alert resolve to nobody', () => {
    expect(resolveStep(one({ kind: 'answerers' }), alert(), reads(), directory(), ws)).toEqual([]);
    expect(resolveStep(one({ kind: 'holders_informed' }), alert(), reads(), directory(), ws)).toEqual([]);
  });

  it('[01d #1] table_team depth direct = owner + direct reports; depth owner = owner only', () => {
    resolver('table_team', () => new Map());
    const r = reads({
      resolved: new Map([
        [targetKey({ kind: 'table_team', table_id: 'T12', depth: 'direct' }), { staff_ids: [KAMRAN, ALI, RUNNER], device_ids: [], owner_staff_id: KAMRAN }],
        [targetKey({ kind: 'table_team', table_id: 'T12', depth: 'owner' }), { staff_ids: [KAMRAN], device_ids: [], owner_staff_id: KAMRAN }],
      ]),
    });
    expect(targetKey({ kind: 'table_team', table_id: 'T12' })).toBe('table_team:T12:direct');
    expect(staffOf(resolveRaised({ kind: 'table_team', table_id: 'T12' }, { reads: r }))).toEqual([KAMRAN, ALI, RUNNER]);
    expect(staffOf(resolveRaised({ kind: 'table_team', table_id: 'T12', depth: 'direct' }, { reads: r }))).toEqual([KAMRAN, ALI, RUNNER]);
    expect(staffOf(resolveRaised({ kind: 'table_team', table_id: 'T12', depth: 'owner' }, { reads: r }))).toEqual([KAMRAN]);
  });

  it('[01d #1] table_team owner with no reports → owner only', () => {
    resolver('table_team', () => new Map());
    const r = reads({ resolved: new Map([[targetKey({ kind: 'table_team', table_id: 'T1' }), { staff_ids: [HAMZA], device_ids: [], owner_staff_id: HAMZA }]]) });
    expect(staffOf(resolveRaised({ kind: 'table_team', table_id: 'T1' }, { reads: r }))).toEqual([HAMZA]);
  });

  it('[01d §3.4] a step table_team target built from values resolves through the resolver result', () => {
    resolver('table_team', () => new Map());
    const r = reads({ resolved: new Map([[targetKey({ kind: 'table_team', table_id: 'T7' }), { staff_ids: [ALI, HAMZA], device_ids: [], owner_staff_id: ALI }]]) });
    const out = resolveStep(one({ kind: 'table_team', from_value: 'table_id' }), alert({ values: { table_id: 'T7' } }), r, directory(), ws);
    expect(staffOf(out)).toEqual([ALI, HAMZA]);
  });

  it('[01d §3.4] a point step target resolves to the resolver devices', () => {
    resolver('point', () => new Map());
    const r = reads({ resolved: new Map([[targetKey({ kind: 'point', point_id: 'P1' }), { staff_ids: [], device_ids: ['D_TAB1'] }]]) });
    const out = resolveStep(one({ kind: 'point', from_value: 'point_id' }), alert({ values: { point_id: 'P1' } }), r, directory(), ws);
    expect(out).toEqual([{ staff_id: null, device_id: 'D_TAB1', set: 'recipient' }]);
  });

  it('[01d §3.4] an unregistered table_team → VALIDATION_FAILED target_unavailable', () => {
    let caught: unknown;
    try {
      resolveRaised({ kind: 'table_team', table_id: 'T12' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe('VALIDATION_FAILED');
    expect((caught as DomainError).details).toEqual({ issue: 'target_unavailable', target_kind: 'table_team' });
  });

  it('[01d §3.4] requester_lead: the lead; no lead or no requester → empty, other entries still go', () => {
    const step: StepDef = {
      at: { ms: 0 },
      to: [
        { target: { kind: 'requester_lead' }, set: 'recipient' },
        { target: { kind: 'managers' }, set: 'recipient' },
      ],
    };
    expect(staffOf(resolveStep(step, alert({ requester_staff_id: ALI }), reads(), directory(), ws))).toEqual([KAMRAN, IMRAN, MGR2, OWNER]);
    expect(staffOf(resolveStep(step, alert({ requester_staff_id: CASH }), reads(), directory(), ws))).toEqual([IMRAN, MGR2, OWNER]);
    expect(staffOf(resolveStep(step, alert({ requester_staff_id: null }), reads(), directory(), ws))).toEqual([IMRAN, MGR2, OWNER]);
  });

  it('[01d §3.4] managers = branch-scope force-release-table-lock holders (my_floors leads are not)', () => {
    expect(staffOf(resolveRaised({ kind: 'managers' }))).toEqual([IMRAN, MGR2, OWNER]);
  });

  it('[01d §3.4] always_on = kiosk + KDS devices (tablets and phones are not)', () => {
    const r = reads({
      devices: [
        { device_id: 'D_KIOSK', device_type: 'cashier_kiosk' },
        { device_id: 'D_TAB', device_type: 'tablet' },
        { device_id: 'D_KDS', device_type: 'kds' },
        { device_id: 'D_PHONE', device_type: 'phone' },
      ],
    });
    expect(devicesOf(resolveRaised({ kind: 'always_on' }, { reads: r }))).toEqual(['D_KIOSK', 'D_KDS']);
  });

  it('[01d §3.4] device resolves to that device', () => {
    expect(resolveRaised({ kind: 'device', device_id: 'D9' })).toEqual([{ staff_id: null, device_id: 'D9', set: 'recipient' }]);
  });

  it('[01d §3.5] a person reached by two entries is listed once with the stronger set', () => {
    const step: StepDef = {
      at: { ms: 0 },
      to: [
        { target: { kind: 'managers' }, set: 'recipient' },
        { target: { kind: 'holders_informed' }, set: 'informed' },
        { target: { kind: 'answerers' }, set: 'answerer' },
      ],
    };
    const out = resolveStep(step, alert(voidAlert(ALI)), reads(), directory(), ws);
    expect(out).toEqual([
      { staff_id: IMRAN, device_id: null, set: 'answerer' },
      { staff_id: MGR2, device_id: null, set: 'recipient' },
      { staff_id: OWNER, device_id: null, set: 'recipient' },
      { staff_id: ZAIN, device_id: null, set: 'informed' },
      { staff_id: KAMRAN, device_id: null, set: 'answerer' },
    ]);
  });

  it('[01d §3.3 rule 5] the requester is left out of every answerer set', () => {
    const raisedOut = resolveStep(one('raised_target', 'answerer'), alert({ ...voidAlert(ALI), target: { kind: 'person', staff_id: ALI } }), reads(), directory(), ws);
    expect(raisedOut).toEqual([]);
  });
});

describe('01d §3.4 resolveTargets (batch resolvers)', () => {
  it('[01d §3.4] a registered resolver is called once with every target of its kind', () => {
    const tableTeam = vi.fn((_tx: WriterTx, targets: Array<Extract<AlertTarget, { kind: 'table_team' }>>) => {
      const out = new Map<string, { staff_ids: string[]; device_ids: string[] }>();
      for (const t of targets) out.set(targetKey(t), { staff_ids: [`owner-of-${t.table_id}`], device_ids: [] });
      return out;
    });
    const point = vi.fn(() => new Map([[targetKey({ kind: 'point', point_id: 'P1' }), { staff_ids: [], device_ids: ['D1'] }]]));
    resolver('table_team', tableTeam);
    resolver('point', point);
    const tx = {} as WriterTx;
    const out = resolveTargets(tx, [
      { kind: 'table_team', table_id: 'T1' },
      { kind: 'person', staff_id: ALI },
      { kind: 'table_team', table_id: 'T2', depth: 'owner' },
      { kind: 'point', point_id: 'P1' },
      { kind: 'table_team', table_id: 'T1', depth: 'direct' },
    ]);
    expect(tableTeam).toHaveBeenCalledTimes(1);
    expect(tableTeam.mock.calls[0]![1]).toEqual([
      { kind: 'table_team', table_id: 'T1' },
      { kind: 'table_team', table_id: 'T2', depth: 'owner' },
    ]);
    expect(point).toHaveBeenCalledTimes(1);
    expect(out.get(targetKey({ kind: 'table_team', table_id: 'T2', depth: 'owner' }))).toEqual({ staff_ids: ['owner-of-T2'], device_ids: [] });
    expect(out.get(targetKey({ kind: 'point', point_id: 'P1' }))).toEqual({ staff_ids: [], device_ids: ['D1'] });
  });

  it('[01d §3.4] no resolver targets → no resolver call', () => {
    const fn = vi.fn(() => new Map());
    resolver('table_team', fn);
    expect(resolveTargets({} as WriterTx, [{ kind: 'managers' }]).size).toBe(0);
    expect(fn).not.toHaveBeenCalled();
  });

  it('[01d §3.4] an unregistered resolver kind → VALIDATION_FAILED target_unavailable', () => {
    expect(() => resolveTargets({} as WriterTx, [{ kind: 'zone_order_taker', table_id: 'T1' }])).toThrow(DomainError);
    try {
      resolveTargets({} as WriterTx, [{ kind: 'zone_order_taker', table_id: 'T1' }]);
    } catch (error) {
      expect((error as DomainError).details).toEqual({ issue: 'target_unavailable', target_kind: 'zone_order_taker' });
    }
  });

  it('[01d §3.4] registering a resolver kind twice throws', () => {
    resolver('point', () => new Map());
    expect(() => registerTargetResolver('point', () => new Map())).toThrow(/already registered/);
  });
});

describe('01d §3.3 rule 6 mayAnswer', () => {
  const dir = directory();

  it('[01d §3.3 rule 6] the requester → self', () => {
    expect(mayAnswer(dir, VOID, ALI, ALI)).toEqual({ ok: false, reason: 'self' });
    expect(mayAnswer(dir, named(ALI), ALI, ALI)).toEqual({ ok: false, reason: 'self' });
  });

  it('[01d §3.3 rule 6] approver_role_ids read now are empty → not_approver', () => {
    // CASH's void-item is not requires_approval; the stored approver_role_ids are ignored (read now)
    expect(mayAnswer(dir, VOID, CASH, IMRAN)).toEqual({ ok: false, reason: 'not_approver' });
    // requester left the directory
    expect(mayAnswer(dir, VOID, 'S_GONE', IMRAN)).toEqual({ ok: false, reason: 'not_approver' });
    expect(mayAnswer(dir, VOID, null, IMRAN)).toEqual({ ok: false, reason: 'not_approver' });
    // the grant changed to allowed after raise
    const changed = directory({
      roles: [
        role('R2', [{ permission: 'approve-void', grant_type: 'allowed', scope: 'branch' }]),
        role('R4', [{ permission: 'void-item', grant_type: 'allowed', scope: 'own_tables' }]),
      ],
    });
    expect(mayAnswer(changed, VOID, ALI, IMRAN)).toEqual({ ok: false, reason: 'not_approver' });
  });

  it('[01d §3.3 rule 6] answerer without an approver role → not_approver', () => {
    expect(mayAnswer(dir, VOID, ALI, OWNER)).toEqual({ ok: false, reason: 'not_approver' });
    expect(mayAnswer(dir, VOID, ALI, BILAL)).toEqual({ ok: false, reason: 'not_approver' });
  });

  it('[01d §3.3 rule 6] range_permission not allowed (denied) → not_approver', () => {
    expect(mayAnswer(dir, VOID, ALI, MGR2)).toEqual({ ok: false, reason: 'not_approver' });
  });

  it('[01d §3.3 rule 6] my_team scope: requester outside the subtree → out_of_range; a grand-report → ok', () => {
    expect(mayAnswer(dir, VOID, ALI, ZAIN)).toEqual({ ok: false, reason: 'out_of_range' });
    expect(mayAnswer(dir, VOID, ALI, KAMRAN)).toEqual({ ok: true });
    expect(mayAnswer(dir, VOID, HAMZA, KAMRAN)).toEqual({ ok: true });
  });

  it('[01d §3.3 rule 6] branch scope covers every requester', () => {
    expect(mayAnswer(dir, VOID, ALI, IMRAN)).toEqual({ ok: true });
    expect(mayAnswer(dir, VOID, BILAL, IMRAN)).toEqual({ ok: true });
  });

  it('[01d §3.3 rule 6] no range_permission → branch-wide', () => {
    expect(mayAnswer(dir, DISCOUNT, ALI, ZAIN)).toEqual({ ok: true });
    expect(mayAnswer(dir, DISCOUNT, ALI, MGR2)).toEqual({ ok: true });
  });

  it('[01d §3.3 rule 6] named: not the receiver → not_receiver', () => {
    expect(mayAnswer(dir, named(BILAL), ALI, BILAL)).toEqual({ ok: true });
    expect(mayAnswer(dir, named(BILAL), ALI, HAMZA)).toEqual({ ok: false, reason: 'not_receiver' });
  });

  it('[01d §3.3 rule 6] a no_pin_staff person never may answer', () => {
    expect(mayAnswer(dir, named(RUNNER), ALI, RUNNER).ok).toBe(false);
    expect(mayAnswer(dir, DISCOUNT, ALI, RUNNER).ok).toBe(false);
    // someone not in the directory at all
    expect(mayAnswer(dir, named('S_GONE'), ALI, 'S_GONE').ok).toBe(false);
  });
});

describe('01d §3.3 rule 6 walkTeam (test #2)', () => {
  it('[01d #2] my_team covers a grand-report', () => {
    expect(walkTeam(directory(), KAMRAN, 'all', { includeNoPin: false })).toEqual([ALI, HAMZA]);
    expect(mayAnswer(directory(), VOID, HAMZA, KAMRAN)).toEqual({ ok: true });
  });

  it('[01d #2] direct = teamOf only; includeNoPin adds no_pin_staff', () => {
    expect(walkTeam(directory(), KAMRAN, 'direct', { includeNoPin: false })).toEqual([ALI]);
    expect(walkTeam(directory(), KAMRAN, 'direct', { includeNoPin: true })).toEqual([ALI, RUNNER]);
  });

  it('[01d #2] loop-safe: a lead cycle terminates, the lead is never in its own team', () => {
    const cyclic = directory({
      roles: [role('R5', [])],
      staff: [person('S_X', ['R5'], 'S_Z'), person('S_Y', ['R5'], 'S_X'), person('S_Z', ['R5'], 'S_Y')],
      no_pin_staff: [],
    });
    expect(walkTeam(cyclic, 'S_X', 'all', { includeNoPin: true })).toEqual(['S_Y', 'S_Z']);
    // self-lead
    const selfLead = directory({ roles: [role('R5', [])], staff: [person('S_X', ['R5'], 'S_X')], no_pin_staff: [] });
    expect(walkTeam(selfLead, 'S_X', 'all', { includeNoPin: false })).toEqual([]);
  });

  it('[01d #2] depth bound: at most active-staff-count levels are walked', () => {
    // a chain of 6 (C0 ← C1 ← … ← C5) is walked whole; teamOf is called at most once per person
    const staff = Array.from({ length: 6 }, (_, i) => person(`C${i}`, ['R5'], i === 0 ? null : `C${i - 1}`));
    const chain = directory({ roles: [role('R5', [])], staff, no_pin_staff: [] });
    const spy = vi.spyOn(chain, 'teamOf');
    expect(walkTeam(chain, 'C0', 'all', { includeNoPin: false })).toEqual(['C1', 'C2', 'C3', 'C4', 'C5']);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(6);
    // a cycle reachable from the lead: still bounded by the staff count
    const looped = directory({
      roles: [role('R5', [])],
      staff: [person('L', ['R5'], null), person('P', ['R5'], 'Q'), person('Q', ['R5'], 'P'), person('R', ['R5'], 'L')],
      no_pin_staff: [],
    });
    const loopSpy = vi.spyOn(looped, 'teamOf');
    expect(walkTeam(looped, 'L', 'all', { includeNoPin: false })).toEqual(['R']);
    expect(walkTeam(looped, 'P', 'all', { includeNoPin: false })).toEqual(['Q']);
    expect(loopSpy.mock.calls.length).toBeLessThanOrEqual(8);
  });
});

describe('01d §3.4.1 presence filter (test #5, BF-8)', () => {
  // presence_today: ALI present = 0, BILAL present = 1; HAMZA not ticked.
  const ticked = () => new Map([[ALI, false], [BILAL, true]]);

  it('[01d BF-8] absent = a row with present = 0; not ticked → present; ticked present → present', () => {
    const r = reads({ presence: ticked() });
    expect(isPresent(r, ALI)).toBe(false);
    expect(isPresent(r, BILAL)).toBe(true);
    expect(isPresent(r, HAMZA)).toBe(true);
  });

  it('[01d #5] nobody ticked → everyone present', () => {
    const r = reads();
    for (const id of [ALI, BILAL, HAMZA, RUNNER]) expect(isPresent(r, id)).toBe(true);
  });

  it('[01d #5] a person signed in anywhere counts as present even when ticked absent', () => {
    const r = reads({ presence: ticked(), sessions: [{ session_id: 'ss1', staff_id: ALI, device_id: 'D_TAB', last_activity_at: 0 }] });
    expect(isPresent(r, ALI)).toBe(true);
  });

  it('[01d #5] team and table_team skip the absent; person is never filtered', () => {
    resolver('table_team', () => new Map());
    const r = reads({
      presence: new Map([[ALI, false], [RUNNER, false]]),
      resolved: new Map([[targetKey({ kind: 'table_team', table_id: 'T12' }), { staff_ids: [KAMRAN, ALI, RUNNER], device_ids: [], owner_staff_id: KAMRAN }]]),
    });
    expect(staffOf(resolveRaised({ kind: 'team', lead_staff_id: KAMRAN, depth: 'all' }, { reads: r }))).toEqual([HAMZA]);
    expect(staffOf(resolveRaised({ kind: 'table_team', table_id: 'T12' }, { reads: r }))).toEqual([KAMRAN]);
    expect(staffOf(resolveRaised({ kind: 'person', staff_id: ALI }, { reads: r }))).toEqual([ALI]);
  });

  it('[01d #5] answerers, holders_informed, managers and permission skip the absent (v0.5 N5)', () => {
    const r = reads({ presence: new Map([[KAMRAN, false], [ZAIN, false], [OWNER, false], [IMRAN, true]]) });
    const step: StepDef = {
      at: { ms: 0 },
      to: [
        { target: { kind: 'answerers' }, set: 'answerer' },
        { target: { kind: 'holders_informed' }, set: 'informed' },
      ],
    };
    expect(staffOf(resolveStep(step, alert(voidAlert(ALI)), r, directory(), ws))).toEqual([IMRAN]);
    expect(staffOf(resolveRaised({ kind: 'managers' }, { reads: r }))).toEqual([IMRAN, MGR2]);
    expect(staffOf(resolveRaised({ kind: 'permission', permission: 'approve-void' }, { reads: r }))).toEqual([IMRAN]);
  });

  it('[01d #5] an absent answerer signed in somewhere is still an answerer', () => {
    const r = reads({
      presence: new Map([[KAMRAN, false]]),
      sessions: [{ session_id: 'ss2', staff_id: KAMRAN, device_id: 'D_KIOSK', last_activity_at: 0 }],
    });
    expect(staffOf(resolveStep(one({ kind: 'answerers' }, 'answerer'), alert(voidAlert(ALI)), r, directory(), ws))).toEqual([IMRAN, KAMRAN]);
  });
});

// ------------------------------------------------------------------------------------------ 02p U-6 (D-1, D-3)

describe('[02p U-6] 01d D-1 table_team full set, D-3 skip_requester', () => {
  const T = (depth?: 'owner' | 'direct') => ({ kind: 'table_team' as const, table_id: 'T12', ...(depth === undefined ? {} : { depth }) });
  const full = (staff_ids: string[], owner: string): ResolvedTarget => ({ staff_ids, device_ids: [], owner_staff_id: owner });

  it('[02p U-6] D-1 (b): no teamOf(owners) added for table_team; the presence filter still applies', () => {
    resolver('table_team', () => new Map());
    // KAMRAN has reports ALI and RUNNER in the directory; the resolver's set is only [KAMRAN, HAMZA]
    const r = reads({
      presence: new Map([[HAMZA, false]]),
      resolved: new Map([[targetKey(T('direct')), full([KAMRAN, HAMZA], KAMRAN)]]),
    });
    expect(staffOf(resolveRaised(T('direct'), { reads: r }))).toEqual([KAMRAN]);
    const all = reads({ resolved: r.resolved });
    expect(staffOf(resolveRaised(T('direct'), { reads: all }))).toEqual([KAMRAN, HAMZA]);
  });

  it('[02p U-6] D-1 (c): the absent-owner marker and the zone fallback use owner_staff_id', () => {
    resolver('table_team', () => new Map());
    // the holder KAMRAN is absent; ALI (a report, present) is in the set but is not the owner
    const r = reads({
      presence: new Map([[KAMRAN, false]]),
      resolved: new Map([[targetKey(T('direct')), full([KAMRAN, ALI], KAMRAN)]]),
    });
    const out = resolveRaised(T('direct'), { reads: r });
    expect(out).toEqual([
      { staff_id: ALI, device_id: null, set: 'recipient' },
      { staff_id: null, device_id: null, set: 'recipient', table_team: { table_id: 'T12', owner_staff_id: KAMRAN } },
    ]);
    // a present holder: origin attached to the holder only, no marker; a set without owner_staff_id → no origin
    const present = reads({ resolved: new Map([[targetKey(T('direct')), full([KAMRAN, ALI], KAMRAN)]]) });
    expect(resolveRaised(T('direct'), { reads: present }).filter((x) => x.table_team !== undefined).map((x) => x.staff_id)).toEqual([KAMRAN]);
    const none = reads({ resolved: new Map([[targetKey(T('direct')), { staff_ids: [ALI], device_ids: [] }]]) });
    expect(resolveRaised(T('direct'), { reads: none })).toEqual([{ staff_id: ALI, device_id: null, set: 'recipient' }]);
  });

  it('[02p U-6] D-1 (c): owner and direct targets for one table in one step, holder absent → exactly one marker', () => {
    resolver('table_team', () => new Map());
    const step: StepDef = {
      at: { ms: 0 },
      to: [
        { target: { kind: 'table_team', from_value: 'table_id', depth: 'owner' }, set: 'recipient' },
        { target: { kind: 'table_team', from_value: 'table_id', depth: 'direct' }, set: 'recipient' },
      ],
    };
    const r = reads({
      presence: new Map([[KAMRAN, false]]),
      resolved: new Map([
        [targetKey(T('owner')), full([KAMRAN], KAMRAN)],
        [targetKey(T('direct')), full([KAMRAN, ALI], KAMRAN)],
      ]),
    });
    const out = resolveStep(step, alert({ values: { table_id: 'T12' } }), r, directory(), ws);
    expect(out.filter((x) => x.staff_id === null && x.device_id === null)).toHaveLength(1);
    expect(staffOf(out)).toEqual([ALI]);
  });

  describe('D-3', () => {
    const defined: string[] = [];
    afterEach(() => {
      for (const k of defined.splice(0)) unregisterAlertKind(k);
    });
    const kindWith = (kind: string, skip: boolean): void => {
      defined.push(kind);
      defineAlertKind({
        kind,
        family: 'info',
        subject: 'hub',
        steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
        closes_on: 'owner',
        values_schema: z.object({}),
        details_schema: null,
        lead_fallback: false,
        ...(skip ? { skip_requester: true } : {}),
        expires_at_day_close: true,
        silent: false,
        labels: { card: `alert.${kind}.card`, lock: `alert.${kind}.lock` },
        request: null,
      });
    };

    it('[02p U-6] D-3: no absent-holder marker when the absent holder is the requester', () => {
      resolver('table_team', () => new Map());
      kindWith('t_skip_m', true);
      kindWith('t_keep_m', false);
      const r = reads({
        presence: new Map([[KAMRAN, false]]),
        resolved: new Map([[targetKey(T('direct')), full([KAMRAN, ALI], KAMRAN)]]),
      });
      const run = (kind: string) => resolveRaised(T('direct'), { reads: r, alert: { kind, requester_staff_id: KAMRAN } });
      expect(run('t_skip_m')).toEqual([{ staff_id: ALI, device_id: null, set: 'recipient' }]);
      expect(run('t_keep_m').filter((x) => x.staff_id === null)).toHaveLength(1);
    });

    it('[02p U-6] D-3: skip_requester drops the requester from every step\'s set', () => {
      kindWith('t_skip', true);
      kindWith('t_keep', false);
      const step: StepDef = {
        at: { ms: 0 },
        to: [
          { target: { kind: 'managers' }, set: 'recipient' },
          { target: { kind: 'managers' }, set: 'recipient' },
        ],
      };
      const run = (kind: string) => staffOf(resolveStep(step, alert({ kind, requester_staff_id: IMRAN }), reads(), directory(), ws));
      expect(run('t_keep')).toEqual([IMRAN, MGR2, OWNER]);
      expect(run('t_skip')).toEqual([MGR2, OWNER]);
    });
  });
});
