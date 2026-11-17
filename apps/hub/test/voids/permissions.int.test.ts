// Lane T1, task t2 — 04 §10 test 32, the permission matrix (G1-7, K-7, OQ-A), hub side: who voids directly, who must
// ask and with which approver roles, who may approve (`approve-void` `branch` vs `my_team` by the staff tree; self;
// approver role removed after the raise; no `approve-void`), `move-item-to-stock` allowed-only, and the cloud defaults
// as the hub directory holds them, end to end through the real VoidItems and 01d's real AnswerRequest.
//
// The default roles are built from the cloud's own DEFAULT_ROLES (01b §6.15; B-1 added void-item requires_approval by
// Manager and move-item-to-stock allowed to Cashier and Order taker), the run-pass-default precedent. The mapper below
// (`defaultRoles`: default_key → role_id, approver_key → approver_role_ids) is a COPY of what the cloud's directory
// export does, not the export itself: the real cloud seed → directory export → hub end-to-end test is tracked
// separately. The cloud halves of #32 run against Postgres in apps/cloud: seed-tenant (01b #108,
// `seed-tenant.int.test.ts`), the 0013 backfill incl. the stray requires_approval → allowed rewrite and one
// directory_version bump (01b #109, `void-defaults-backfill.int.test.ts`), the roles API 422 (01b #110,
// `allowed-only.int.test.ts`).
//
// `approve-void` at `my_team` covers the approver's whole subtree (direct reports and below), never no-PIN staff
// (01d `covers` → `walkTeam(…, 'all', { includeNoPin: false })`, `apps/hub/src/alerts/targets.ts:470`).
import type { Permission } from '@pos/domain';
import type { DirectoryInput } from '@pos/events';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ROLES } from '../../../cloud/src/modules/staff-roles/default-roles';
import { currentDirectory } from '../../src/auth/guards';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory, PIN, pinHash } from '../helpers/fixtures';
import { seedDirectory, type TestHub } from '../helpers/test-hub';
import { answer, post, signIn, STAFF, stagedOrder, startVoids, type Reply, type Who } from './fixtures';

let hub: TestHub;

afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

/** default_key → the hub role_id this file uses (aDirectory's ids for the four it has). */
const ROLE_OF = { owner: 'R_OWNER', manager: 'R_MGR', cashier: 'R_CASH', order_taker: 'R_WAIT', waiter: 'R_WAITER', cook: 'R_COOK' } as const;

type Grant = DirectoryInput['roles'][number]['permissions'][number];
const allowed = (permission: Permission, scope: Grant['scope'] = 'branch'): Grant => ({ permission, grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope });
const ask = (permission: Permission, approver: string): Grant => ({ permission, grant_type: 'requires_approval', approver_role_id: approver, approver_role_ids: [approver], scope: 'branch' });

/** The cloud's DEFAULT_ROLES as hub directory roles. */
function defaultRoles(): DirectoryInput['roles'] {
  return DEFAULT_ROLES.map((r) => ({
    role_id: ROLE_OF[r.default_key],
    name: r.name,
    session_idle_ttl_ms: r.session_idle_ttl_ms,
    permissions: r.grants.map((g) =>
      g.grant_type === 'allowed' ? allowed(g.permission, g.scope ?? 'branch') : { ...ask(g.permission, ROLE_OF[g.approver_key!]), scope: g.scope ?? 'branch' },
    ),
  }));
}

/** Matrix-only roles (not defaults): each isolates one row of #32. */
const EXTRA_ROLES: DirectoryInput['roles'] = [
  { role_id: 'R_LEAD', name: 'Shift lead', session_idle_ttl_ms: 3_600_000, permissions: [allowed('approve-void', 'my_team')] },
  { role_id: 'R_TRAINEE', name: 'Trainee', session_idle_ttl_ms: 900_000, permissions: [ask('void-item', 'R_LEAD')] },
  { role_id: 'R_VOIDER', name: 'Voider', session_idle_ttl_ms: 900_000, permissions: [allowed('void-item')] },
  { role_id: 'R_NOAV', name: 'Approver without approve-void', session_idle_ttl_ms: 900_000, permissions: [allowed('take-order')] },
  { role_id: 'R_ASKNOAV', name: 'Asks R_NOAV', session_idle_ttl_ms: 900_000, permissions: [ask('void-item', 'R_NOAV')] },
  { role_id: 'R_SELF', name: 'Asks own role', session_idle_ttl_ms: 900_000, permissions: [ask('void-item', 'R_SELF'), allowed('approve-void')] },
  // a stray allowed-only grant the cloud would refuse (B-2) and the backfill rewrites; the hub still never lets it pass
  { role_id: 'R_STRAY', name: 'Stray', session_idle_ttl_ms: 900_000, permissions: [allowed('void-item'), ask('move-item-to-stock', 'R_MGR')] },
];

const S = {
  waiter: 'S_WAITER',
  cook: 'S_COOK',
  lead: 'S_LEAD',
  team: 'S_TEAM', // lead S_LEAD
  sub: 'S_SUB', // lead S_TEAM: a grand-report of S_LEAD
  out: 'S_OUT', // lead S_MGR: outside S_LEAD's tree
  two: 'S_TWO', // Cashier + Voider
  denied: 'S_DENIED', // Manager, per-person denied void-item
  noav: 'S_NOAV',
  asknoav: 'S_ASKNOAV',
  self: 'S_SELF',
  stray: 'S_STRAY',
  voidOnly: 'S_VOIDONLY', // Voider only: void-item allowed, no move-item-to-stock grant
} as const;

let BASE: DirectoryInput;

beforeAll(async () => {
  const base = await aDirectory();
  const hash = await pinHash(PIN.a);
  const person = (staff_id: string, role_ids: string[], o: { lead?: string; denied?: Permission[] } = {}) => ({
    staff_id,
    display_name: staff_id,
    pin_hash: hash,
    role_ids,
    denied_permissions: o.denied ?? [],
    lead_staff_id: o.lead ?? null,
    floor_ids: [],
  });
  BASE = {
    ...base,
    roles: [...defaultRoles(), ...EXTRA_ROLES],
    staff: [
      ...base.staff, // S_OWNER, S_MGR, S_CASH, S_WAIT on R_OWNER / R_MGR / R_CASH / R_WAIT (now the cloud defaults)
      person(S.waiter, ['R_WAITER']),
      person(S.cook, ['R_COOK']),
      person(S.lead, ['R_LEAD']),
      person(S.team, ['R_TRAINEE'], { lead: S.lead }),
      person(S.sub, ['R_TRAINEE'], { lead: S.team }),
      person(S.out, ['R_TRAINEE'], { lead: STAFF.manager }),
      person(S.two, ['R_CASH', 'R_VOIDER']),
      person(S.denied, ['R_MGR'], { denied: ['void-item'] }),
      person(S.noav, ['R_NOAV']),
      person(S.asknoav, ['R_ASKNOAV']),
      person(S.self, ['R_SELF']),
      person(S.stray, ['R_STRAY']),
      person(S.voidOnly, ['R_VOIDER']),
    ],
  };
});

const PIN_OF: Record<string, string> = { [STAFF.manager]: PIN.b, [STAFF.cashier]: PIN.c };
const pinOf = (who: Who) => PIN_OF[who.staffId] ?? PIN.a;

async function start(directory: DirectoryInput = BASE): Promise<TestHub> {
  hub = await startVoids({ directory });
  return hub;
}

const events = () => hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number;
const ofType = (r: Reply, t: string) => r.events.filter((e) => e.event_type === t);

function voidOne(who: Who, order_id: string, order_item_id: string, disposition: 'moved' | 'wastage' = 'wastage'): Promise<Reply> {
  return post(hub, who, 'void-items', 'VoidItems', { order_id, reason_code: 'quality', note: null, disposition_note: null, lines: [{ order_item_id, disposition }] });
}

/** VoidItems by `who` on the order's served naan; asserts the request path; the request's alert_id. */
async function asks(who: Who, o: { order_id: string; line: string; disposition?: 'moved' | 'wastage' }): Promise<{ alert_id: string; raised: Reply }> {
  const r = await voidOne(who, o.order_id, o.line, o.disposition);
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  expect(ofType(r, 'ItemVoided')).toEqual([]);
  const pending = (r.result as { pending: Array<{ alert_id: string }> }).pending;
  expect(pending).toHaveLength(1);
  return { alert_id: pending[0]!.alert_id, raised: r };
}

const approve = (who: Who, alert_id: string) => answer(hub, who, alert_id, 'approve', pinOf(who));
const refused = (r: Reply, reason: string) => expect([r.status, r.error?.code, r.error?.details.reason], JSON.stringify(r.error)).toEqual([403, 'PERMISSION_DENIED', reason]);
const applied = (r: Reply, o: { requester: string; approver: string }) => {
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  expect(ofType(r, 'ItemVoided').map((e) => e.payload)).toEqual([expect.objectContaining({ requester_staff_id: o.requester, approver_staff_id: o.approver })]);
};

// ------------------------------------------------------------------------------------------- who may void

describe('[04 #32] void-item grant → path', () => {
  it('[04 #32] not granted (Waiter, Cook defaults) → 403 PERMISSION_DENIED, nothing written', async () => {
    await start();
    const s = stagedOrder(hub);
    for (const id of [S.waiter, S.cook]) {
      const who = signIn(hub, id); // pairing the tablet writes its own event
      const before = events();
      const r = await voidOne(who, s.order_id, s.served);
      expect([r.status, r.error?.code], id).toEqual([403, 'PERMISSION_DENIED']);
      expect(events(), id).toBe(before);
    }
  });

  it('[04 #32] allowed (Manager, Owner defaults) → direct: ItemVoided, approver null, no request', async () => {
    await start();
    for (const [i, id] of [STAFF.manager, 'S_OWNER'].entries()) {
      const s = stagedOrder(hub, { prefix: `A${i}` });
      const r = await voidOne(signIn(hub, id), s.order_id, s.served);
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      expect(ofType(r, 'AlertRaised')).toEqual([]);
      expect(ofType(r, 'ItemVoided').map((e) => e.payload)).toEqual([expect.objectContaining({ requester_staff_id: id, approver_staff_id: null, alert_id: null })]);
    }
  });

  it('[04 #32] requires_approval (Cashier, Order taker defaults) → a request carrying the grant\'s approver roles [R_MGR]; Trainee → [R_LEAD]', async () => {
    await start();
    for (const [i, [id, roles]] of ([[STAFF.cashier, ['R_MGR']], [STAFF.orderTaker, ['R_MGR']], [S.team, ['R_LEAD']]] as const).entries()) {
      const s = stagedOrder(hub, { prefix: `Q${i}` });
      const { raised } = await asks(signIn(hub, id), { order_id: s.order_id, line: s.served });
      const alert = ofType(raised, 'AlertRaised').find((e) => e.payload.kind === 'void_approval')!;
      expect(alert.payload, id).toMatchObject({ requester_staff_id: id, request: { right_mode: 'approval', base_permission: 'void-item', range_permission: 'approve-void', approver_role_ids: roles } });
    }
  });

  it('[04 #32] per-person denied over an allowed role grant (Manager role, void-item denied) → 403, nothing written', async () => {
    await start();
    expect(currentDirectory(hub.app).resolve(S.denied, 'void-item')).toEqual({ grant: 'denied' });
    const s = stagedOrder(hub);
    const who = signIn(hub, S.denied);
    const before = events();
    const r = await voidOne(who, s.order_id, s.served);
    expect([r.status, r.error?.code]).toEqual([403, 'PERMISSION_DENIED']);
    expect(events()).toBe(before);
  });

  it('[04 #32, D19] two roles, allowed + requires_approval (Cashier + Voider) → allowed: direct void', async () => {
    await start();
    expect(currentDirectory(hub.app).resolve(S.two, 'void-item')).toEqual({ grant: 'allowed', scope: 'branch' });
    const s = stagedOrder(hub);
    const r = await voidOne(signIn(hub, S.two), s.order_id, s.served);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(ofType(r, 'AlertRaised')).toEqual([]);
    expect(ofType(r, 'ItemVoided')).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------- who may approve

describe('[04 #32] approver ranges (01d §3.3 rules 5–6, read now)', () => {
  it('[04 #32] approve-void `branch` (Manager default) covers every requester: Cashier and Order taker requests applied, approver = Manager', async () => {
    await start();
    const mgr = signIn(hub, STAFF.manager);
    for (const [i, id] of [STAFF.cashier, STAFF.orderTaker].entries()) {
      const s = stagedOrder(hub, { prefix: `B${i}` });
      const { alert_id } = await asks(signIn(hub, id), { order_id: s.order_id, line: s.served });
      applied(await approve(mgr, alert_id), { requester: id, approver: STAFF.manager });
    }
  });

  it('[04 #32] approve-void `my_team` (Shift lead): a direct report and a grand-report → applied; a requester outside the tree → out_of_range, nothing written', async () => {
    await start();
    const lead = signIn(hub, S.lead);
    for (const [i, id] of [S.team, S.sub].entries()) {
      const s = stagedOrder(hub, { prefix: `T${i}` });
      const { alert_id } = await asks(signIn(hub, id), { order_id: s.order_id, line: s.served });
      applied(await approve(lead, alert_id), { requester: id, approver: S.lead });
    }
    const s = stagedOrder(hub, { prefix: 'TO' });
    const { alert_id } = await asks(signIn(hub, S.out), { order_id: s.order_id, line: s.served });
    const before = events();
    refused(await approve(lead, alert_id), 'out_of_range');
    expect(events()).toBe(before);
    // the Manager is not in the Trainee's approver roles, though his approve-void is `branch`
    refused(await approve(signIn(hub, STAFF.manager), alert_id), 'not_approver');
  });

  it('[04 #32] self: a requester holding the approver role and approve-void cannot approve their own request → self', async () => {
    await start();
    const me = signIn(hub, S.self);
    const s = stagedOrder(hub);
    const { alert_id } = await asks(me, { order_id: s.order_id, line: s.served });
    refused(await approve(me, alert_id), 'self');
  });

  it('[04 #32] approver without approve-void (in the approver role, no range permission) → not_approver', async () => {
    await start();
    expect(currentDirectory(hub.app).resolve(S.noav, 'approve-void')).toEqual({ grant: 'not_granted' });
    const s = stagedOrder(hub);
    const { alert_id } = await asks(signIn(hub, S.asknoav), { order_id: s.order_id, line: s.served });
    refused(await approve(signIn(hub, S.noav), alert_id), 'not_approver');
  });

  it('[04 #32] approver role removed after the raise (a directory apply): the Cashier\'s approver becomes Owner → the Manager is not_approver, the Owner approves; then the Manager loses R_MGR (moved to Owner: approve-void branch kept, not an approver role) → not_approver on a new request', async () => {
    await start();
    const cashier = signIn(hub, STAFF.cashier);
    const mgr = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const { alert_id } = await asks(cashier, { order_id: s.order_id, line: s.served });
    const swapApprover = (r: DirectoryInput['roles'][number]) =>
      r.role_id !== 'R_CASH' ? r : { ...r, permissions: r.permissions.map((p) => (p.permission === 'void-item' ? ask('void-item', 'R_OWNER') : p)) };
    await seedDirectory(hub, { ...BASE, directory_version: BASE.directory_version + 1, roles: BASE.roles.map(swapApprover) });
    refused(await approve(mgr, alert_id), 'not_approver');
    applied(await approve(signIn(hub, 'S_OWNER'), alert_id), { requester: STAFF.cashier, approver: 'S_OWNER' });

    const s2 = stagedOrder(hub, { prefix: 'R2' });
    const second = await asks(cashier, { order_id: s2.order_id, line: s2.served });
    await seedDirectory(hub, { ...BASE, directory_version: BASE.directory_version + 2, staff: BASE.staff.map((p) => (p.staff_id === STAFF.manager ? { ...p, role_ids: ['R_OWNER'] } : p)) });
    refused(await approve(mgr, second.alert_id), 'not_approver');
  });
});

// ------------------------------------------------------------------------------------------- move-item-to-stock (B-2)

describe('[04 #32, B-2] move-item-to-stock is allowed-only', () => {
  it('[04 #32] Order taker default (void-item requires_approval + move allowed) → `moved` raises a request (nothing applied, V4); the Manager approves → ItemMovedToStock + ItemVoided{moved}', async () => {
    await start();
    const s = stagedOrder(hub);
    const { alert_id, raised } = await asks(signIn(hub, STAFF.orderTaker), { order_id: s.order_id, line: s.cooking, disposition: 'moved' });
    expect(ofType(raised, 'ItemMovedToStock')).toEqual([]);
    const alert = ofType(raised, 'AlertRaised').find((e) => e.payload.kind === 'void_approval')!;
    expect(alert.payload.values).toMatchObject({ disposition: 'moved', line_dispositions: { [s.cooking]: 'moved' } });
    const r = await approve(signIn(hub, STAFF.manager), alert_id);
    applied(r, { requester: STAFF.orderTaker, approver: STAFF.manager });
    expect(ofType(r, 'ItemMovedToStock').map((e) => e.payload)).toEqual([{ order_item_id: s.cooking, units: 1, alert_id }]);
    expect(ofType(r, 'ItemVoided')[0]!.payload.disposition).toBe('moved');
  });

  it('[04 #32] a stray move-item-to-stock requires_approval on the hub → `moved` is 403 move_not_granted (never a request), nothing written; wastage still voids', async () => {
    await start();
    expect(currentDirectory(hub.app).resolve(S.stray, 'move-item-to-stock')).toMatchObject({ grant: 'requires_approval' });
    const stray = signIn(hub, S.stray);
    const s = stagedOrder(hub);
    const before = events();
    refused(await voidOne(stray, s.order_id, s.cooking, 'moved'), 'move_not_granted');
    expect(events()).toBe(before);
    const ok = await voidOne(stray, s.order_id, s.cooking, 'wastage');
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
  });

  it('[04 #32] void-item allowed but no move-item-to-stock grant (Voider only) → `moved` 403 move_not_granted', async () => {
    await start();
    expect(currentDirectory(hub.app).resolve(S.voidOnly, 'move-item-to-stock')).toEqual({ grant: 'not_granted' });
    const s = stagedOrder(hub);
    refused(await voidOne(signIn(hub, S.voidOnly), s.order_id, s.cooking, 'moved'), 'move_not_granted');
  });

  it('[04 #32] Manager (move allowed, void allowed) → `moved` direct', async () => {
    await start();
    const s = stagedOrder(hub);
    const r = await voidOne(signIn(hub, STAFF.manager), s.order_id, s.cooking, 'moved');
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(ofType(r, 'ItemMovedToStock')).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------- defaults (B-1)

describe('[04 #32, B-1] cloud defaults → hub directory → VoidItems', () => {
  it('[04 #32] the hub directory built from DEFAULT_ROLES resolves the B-1 defaults: Cashier / Order taker void-item requires_approval by [R_MGR] (branch), move allowed; Owner / Manager void-item and approve-void allowed (branch); Waiter / Cook neither', async () => {
    await start();
    const d = currentDirectory(hub.app);
    for (const id of [STAFF.cashier, STAFF.orderTaker]) {
      expect(d.resolve(id, 'void-item'), id).toEqual({ grant: 'requires_approval', approver_role_ids: ['R_MGR'], scope: 'branch' });
      expect(d.resolve(id, 'move-item-to-stock'), id).toEqual({ grant: 'allowed', scope: 'branch' });
      expect(d.resolve(id, 'approve-void'), id).toEqual({ grant: 'not_granted' });
    }
    for (const id of [STAFF.manager, 'S_OWNER']) {
      for (const p of ['void-item', 'approve-void', 'move-item-to-stock'] as const) expect(d.resolve(id, p), `${id} ${p}`).toEqual({ grant: 'allowed', scope: 'branch' });
    }
    for (const id of [S.waiter, S.cook]) {
      for (const p of ['void-item', 'approve-void', 'move-item-to-stock'] as const) expect(d.resolve(id, p), `${id} ${p}`).toEqual({ grant: 'not_granted' });
    }
    // the cloud source itself: no default role holds move-item-to-stock as requires_approval (B-2)
    for (const r of DEFAULT_ROLES) for (const g of r.grants) if (g.permission === 'move-item-to-stock') expect(g.grant_type, r.default_key).toBe('allowed');
  });

  it('[04 #32] end to end on the defaults: a Cashier void raises a request routed to Manager; the Cashier cannot approve it; the Order taker cannot either; the Manager approves → applied', async () => {
    await start();
    const cashier = signIn(hub, STAFF.cashier);
    const s = stagedOrder(hub);
    const { alert_id } = await asks(cashier, { order_id: s.order_id, line: s.served });
    refused(await approve(cashier, alert_id), 'self');
    refused(await approve(signIn(hub, STAFF.orderTaker), alert_id), 'not_approver');
    applied(await approve(signIn(hub, STAFF.manager), alert_id), { requester: STAFF.cashier, approver: STAFF.manager });
  });
});
