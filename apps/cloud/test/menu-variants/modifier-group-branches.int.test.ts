import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateModifierGroupRequest, ModifierGroupBranchWire, ModifierGroupWire } from '@pos/events';
import { modifierGroupBranchVersion } from '../../src/modules/menu-variants/versions';
import type { CloudTestHooks } from '../../src/server';
import { createModifierGroup } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

// 01c §6.10 modifier group list; §6.12a a group's option differences at one branch (V19: rows hold differences
// only; versioned per group and branch; the group lock serialises it with §6.12).
describe('01c modifier group list (§6.10) and branch PUT (§6.12a)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let counter: ReturnType<typeof pgCounter>;
  const control: { beforeBump?: () => Promise<void> } = {};

  beforeAll(async () => {
    const testHooks: CloudTestHooks = {
      handlerStart: () => counter.reset(),
      beforeBump: () => control.beforeBump?.() ?? Promise.resolve(),
    };
    cloud = await createTestCloud({ testHooks });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
    await seedMenu(cloud.pool, f, { items: 1 });
  });

  const list = (query = '', token?: string) => cloud.app.inject({ method: 'GET', url: `/v1/admin/modifier-groups${query}`, headers: owner(f, token).headers });
  const put = (groupId: string, branchId: string, payload: object, token?: string) =>
    cloud.app.inject({ method: 'PUT', url: `/v1/admin/modifier-groups/${groupId}/branches/${branchId}`, ...owner(f, token), payload });
  const patch = (groupId: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/modifier-groups/${groupId}`, ...owner(f), payload });
  const versions = async () =>
    (
      await cloud.pool.query<{ config_version: string }>(`SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`, [
        f.tenantId,
      ])
    ).rows.map((row) => Number(row.config_version));
  const bumpedOnly = (before: number[], branchId: string) => {
    const order = [...f.branches].sort();
    return before.map((v, i) => (order[i] === branchId ? v + 1 : v));
  };
  const storedRows = async () =>
    (
      await cloud.pool.query<{ branch_id: string; option_id: string; is_offered: boolean; price_minor_override: string | null }>(
        `SELECT branch_id, option_id, is_offered, price_minor_override FROM modifier_option_branches ORDER BY branch_id, option_id`,
      )
    ).rows;
  const auditRows = async () =>
    (
      await cloud.pool.query<{ entity: string; entity_id: string; branch_id: string | null; action: string; before: unknown; after: unknown }>(
        `SELECT entity, entity_id, branch_id, action, before, after FROM config_audit WHERE tenant_id = $1 ORDER BY at, audit_id`,
        [f.tenantId],
      )
    ).rows;
  let statements = 0;
  const nothingWritten = async (call: () => Promise<LightMyRequestResponse>, status: number) => {
    const before = { rows: await storedRows(), audit: await auditRows(), versions: await versions() };
    const response = await call();
    statements = counter.count;
    expect(response.statusCode, response.body).toBe(status);
    expect({ rows: await storedRows(), audit: await auditRows(), versions: await versions() }).toEqual(before);
    return response.json() as { data?: { branch: ModifierGroupBranchWire }; error: { code: string; details: Record<string, unknown> } };
  };
  const ok = async (call: Promise<LightMyRequestResponse>) => {
    const response = await call;
    expect(response.statusCode, response.body).toBe(200);
    statements = counter.count;
    return response.json().data.branch as ModifierGroupBranchWire;
  };
  const extras = (o?: Partial<CreateModifierGroupRequest>): Promise<ModifierGroupWire> =>
    createModifierGroup(cloud, f, {
      name: 'Extras',
      min_choices: 0,
      max_choices: 3,
      options: [
        { name: 'Raita', price_minor: 100, sort_order: 0 },
        { name: 'Salad', price_minor: 150, sort_order: 1 },
        { name: 'Naan', price_minor: 50, sort_order: 2 },
      ],
      ...o,
    });
  const branchOf = (group: ModifierGroupWire, branchId: string) => group.branches.find((b) => b.branch_id === branchId)!;
  const sortRows = <T extends { option_id: string }>(rows: T[]) => [...rows].sort((a, b) => (a.option_id < b.option_id ? -1 : 1));
  const issuePaths = (error: { details: Record<string, unknown> }) => (error.details.issues as Array<{ path: string }>).map((i) => i.path);

  it('[01c #77] list: 5 statements for 1 and for 30 groups; branches only for allowed branches; archived options under archived_options', async () => {
    const [a, b, c] = f.branches;
    const group = await extras();
    const [raita, salad, naan] = group.options;
    await ok(put(group.modifier_group_id, a, { expected_version: branchOf(group, a).version, options: [{ option_id: raita!.option_id, is_offered: true, price_minor_override: 120 }] }));
    await ok(put(group.modifier_group_id, c, { expected_version: branchOf(group, c).version, options: [{ option_id: salad!.option_id, is_offered: false }] }));
    // Naan archived through §6.12
    const archived = await patch(group.modifier_group_id, {
      expected_version: group.version,
      options: [raita, salad].map((o) => ({ option_id: o!.option_id, name: o!.name, price_minor: o!.price_minor, sort_order: o!.sort_order })),
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const stored = archived.json().data.modifier_group as ModifierGroupWire;

    const one = await list('', f.tokenFor([a, b]));
    expect(one.statusCode, one.body).toBe(200);
    // coversEveryBranch, groups, options = ANY, links = ANY, branch rows = ANY
    expect(counter.count).toBe(5);
    const data = one.json().data as { can_edit_tenant: boolean; modifier_groups: ModifierGroupWire[] };
    expect(data.can_edit_tenant).toBe(true);
    expect(data.modifier_groups).toHaveLength(1);
    const listed = data.modifier_groups[0]!;
    expect(listed).toEqual({
      ...stored,
      branches: [
        { branch_id: a, options: [{ option_id: raita!.option_id, is_offered: true, price_minor_override: 120 }], version: expect.stringMatching(/^[0-9a-f]{64}$/) },
        { branch_id: b, options: [], version: expect.stringMatching(/^[0-9a-f]{64}$/) },
      ].sort((x, y) => (x.branch_id < y.branch_id ? -1 : 1)),
    });
    expect(listed.archived_options).toEqual([{ option_id: naan!.option_id, name: 'Naan' }]);
    expect(listed.branches.map((x) => x.branch_id)).not.toContain(c);
    // the list's branch version is the one a PUT compares
    expect(branchOf(listed, a)).toEqual(branchOf(stored, a));

    for (let i = 0; i < 29; i += 1) {
      const name = `Group ${String(i).padStart(2, '0')}`;
      await createModifierGroup(cloud, f, { name, min_choices: 0, max_choices: 1, sort_order: 30 - i, options: [{ name: 'Yes', price_minor: 0 }] });
    }
    const thirty = await list();
    expect(thirty.statusCode).toBe(200);
    expect(counter.count).toBe(5);
    const groups = thirty.json().data.modifier_groups as ModifierGroupWire[];
    expect(groups).toHaveLength(30);
    // by sort_order, then id
    const order = groups.map((g) => [g.sort_order, g.modifier_group_id] as const);
    expect(order).toEqual([...order].sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : 1)));
    expect(groups.every((g) => g.branches.length === 3)).toBe(true);

    // status=archived lists the archived groups only; an unknown status → 400; an empty list is 5 statements too
    await cloud.pool.query(`UPDATE modifier_groups SET archived_at = 9 WHERE tenant_id = $1 AND modifier_group_id = $2`, [f.tenantId, group.modifier_group_id]);
    const archivedList = await list('?status=archived');
    expect(archivedList.statusCode).toBe(200);
    expect(counter.count).toBe(5);
    expect((archivedList.json().data.modifier_groups as ModifierGroupWire[]).map((g) => g.modifier_group_id)).toEqual([group.modifier_group_id]);
    expect((await list('?status=gone')).statusCode).toBe(400);
    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [f.tenantId, f.userId, [a]]);
    await cloud.pool.query(`UPDATE modifier_groups SET archived_at = 9 WHERE tenant_id = $1`, [f.tenantId]);
    const empty = await list();
    expect(empty.statusCode).toBe(200);
    expect(counter.count).toBe(5);
    expect(empty.json().data).toEqual({ can_edit_tenant: false, modifier_groups: [] });
  });

  it('[01c §6.12a] PUT at A: rows written, audit branch_set with branch_id and the difference lists, only A bumped; 8 statements', async () => {
    const [a] = f.branches;
    const group = await extras();
    const [raita, salad, naan] = group.options;
    const before = await versions();
    const branch = await ok(
      put(group.modifier_group_id, a, {
        expected_version: branchOf(group, a).version,
        options: [
          { option_id: salad!.option_id, is_offered: false },
          { option_id: raita!.option_id, is_offered: true, price_minor_override: 120 },
          { option_id: naan!.option_id, is_offered: true },
        ],
      }),
    );
    // group lock, branch read, stored rows, options check, delete, insert, audit, bump
    expect(statements).toBe(8);
    const expected = sortRows([
      { option_id: raita!.option_id, is_offered: true, price_minor_override: 120 },
      { option_id: salad!.option_id, is_offered: false, price_minor_override: null },
    ]);
    expect(branch).toEqual({
      branch_id: a,
      options: expected,
      version: modifierGroupBranchVersion(group.modifier_group_id, a, expected, new Set(group.options.map((o) => o.option_id))).version,
    });
    expect(await versions()).toEqual(bumpedOnly(before, a));
    // the default entry (Naan offered, no override) is not stored
    expect(await storedRows()).toEqual(
      sortRows([
        { branch_id: a, option_id: raita!.option_id, is_offered: true, price_minor_override: '120' },
        { branch_id: a, option_id: salad!.option_id, is_offered: false, price_minor_override: null },
      ]),
    );
    const audit = (await auditRows()).filter((row) => row.action === 'branch_set');
    expect(audit).toEqual([{ entity: 'modifier_group', entity_id: group.modifier_group_id, branch_id: a, action: 'branch_set', before: [], after: expected }]);
  });

  it('[01c #90] §6.12a edges: 400s, 422 not_found, 404 foreign branch, 409 stale, options [] deletes and audits, the same list is a no-op', async () => {
    const [a, , c] = f.branches;
    const group = await extras();
    const [raita, salad, naan] = group.options;
    const fresh = branchOf(group, a).version;

    const priced = await nothingWritten(
      () => put(group.modifier_group_id, a, { expected_version: fresh, options: [{ option_id: raita!.option_id, is_offered: false, price_minor_override: 10 }] }),
      400,
    );
    expect(priced.error.code).toBe('VALIDATION_FAILED');
    const repeated = await nothingWritten(
      () =>
        put(group.modifier_group_id, a, {
          expected_version: fresh,
          options: [
            { option_id: raita!.option_id, is_offered: false },
            { option_id: raita!.option_id, is_offered: true, price_minor_override: 10 },
          ],
        }),
      400,
    );
    expect(issuePaths(repeated.error)).toContain('options.1.option_id');

    // another group's option, another tenant's, an archived option of this group, an unknown id → 422 not_found
    const other = await createModifierGroup(cloud, f, { name: 'Breads', min_choices: 0, max_choices: 1, options: [{ name: 'Roti', price_minor: 30 }] });
    await cloud.pool.query(
      `INSERT INTO modifier_groups (tenant_id, modifier_group_id, name, min_choices, max_choices, created_at, updated_at) VALUES ($1, 'B-MG', 'B', 0, 1, 0, 0)`,
      [f.other.tenantId],
    );
    await cloud.pool.query(
      `INSERT INTO modifier_options (tenant_id, option_id, modifier_group_id, name, price_minor) VALUES ($1, 'B-OPTION-1', 'B-MG', 'B', 0)`,
      [f.other.tenantId],
    );
    await cloud.pool.query(`UPDATE modifier_options SET archived_at = 3 WHERE option_id = $1`, [naan!.option_id]);
    const afterArchive = branchOf(
      (await list()).json().data.modifier_groups.find((g: ModifierGroupWire) => g.modifier_group_id === group.modifier_group_id),
      a,
    ).version;
    for (const foreign of [other.options[0]!.option_id, 'B-OPTION-1', naan!.option_id, 'OP-UNKNOWN']) {
      const refused = await nothingWritten(
        () =>
          put(group.modifier_group_id, a, {
            expected_version: afterArchive,
            options: [
              { option_id: raita!.option_id, is_offered: false },
              { option_id: foreign, is_offered: false },
            ],
          }),
        422,
      );
      expect(refused.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'options.1.option_id', reason: 'not_found' } });
    }

    // a foreign branch (another tenant's, or one outside the JWT's allowed branches) → 404 BRANCH_NOT_FOUND
    const foreignBranch = await nothingWritten(() => put(group.modifier_group_id, f.other.branchId, { expected_version: afterArchive, options: [] }), 404);
    expect(foreignBranch.error.code).toBe('BRANCH_NOT_FOUND');
    const outside = await nothingWritten(() => put(group.modifier_group_id, c, { expected_version: afterArchive, options: [] }, f.tokenFor([a])), 404);
    expect(outside.error.code).toBe('BRANCH_NOT_FOUND');
    // an unknown group → 404 MODIFIER_GROUP_NOT_FOUND
    expect((await nothingWritten(() => put('MG-UNKNOWN', a, { expected_version: afterArchive, options: [] }), 404)).error.code).toBe(
      'MODIFIER_GROUP_NOT_FOUND',
    );

    const set = await ok(put(group.modifier_group_id, a, { expected_version: afterArchive, options: [{ option_id: salad!.option_id, is_offered: false }] }));
    // stale (the version before the set) → 409 modifier_group_branch
    const stale = await nothingWritten(() => put(group.modifier_group_id, a, { expected_version: afterArchive, options: [] }), 409);
    expect(stale.error).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'modifier_group_branch', id: group.modifier_group_id } });

    // the same list again → no-op 200, no audit, no bump; a default entry added to it is still the same list
    const same = await nothingWritten(
      () =>
        put(group.modifier_group_id, a, {
          expected_version: set.version,
          options: [
            { option_id: salad!.option_id, is_offered: false },
            { option_id: raita!.option_id, is_offered: true, price_minor_override: null },
          ],
        }),
      200,
    );
    // group lock, branch read, stored rows, options check
    expect(statements).toBe(4);
    expect(same.data!.branch).toEqual(set);

    // options [] → every row of the group's active options at A deleted, audited; again → no-op
    const before = await versions();
    const cleared = await ok(put(group.modifier_group_id, a, { expected_version: set.version, options: [] }));
    // group lock, branch read, stored rows, delete, audit, bump (no options to check, nothing to insert)
    expect(statements).toBe(6);
    expect(cleared).toEqual({ branch_id: a, options: [], version: fresh });
    expect(await storedRows()).toEqual([]);
    expect(await versions()).toEqual(bumpedOnly(before, a));
    const last = (await auditRows()).at(-1)!;
    expect(last).toEqual({
      entity: 'modifier_group',
      entity_id: group.modifier_group_id,
      branch_id: a,
      action: 'branch_set',
      before: [{ option_id: salad!.option_id, is_offered: false, price_minor_override: null }],
      after: [],
    });
    await nothingWritten(() => put(group.modifier_group_id, a, { expected_version: cleared.version, options: [] }), 200);

    // an archived group → 422 modifier_group_id archived
    await cloud.pool.query(`UPDATE modifier_groups SET archived_at = 4 WHERE modifier_group_id = $1`, [group.modifier_group_id]);
    const archivedGroup = await nothingWritten(() => put(group.modifier_group_id, a, { expected_version: cleared.version, options: [] }), 422);
    expect(archivedGroup.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'modifier_group_id', reason: 'archived' } });
  });

  it('[01c §6.12a m4] the PUT deletes only the rows of active options: an archived option keeps its row at the branch', async () => {
    const [a] = f.branches;
    const group = await extras();
    const [raita, salad] = group.options;
    const set = await ok(
      put(group.modifier_group_id, a, {
        expected_version: branchOf(group, a).version,
        options: [
          { option_id: raita!.option_id, is_offered: false },
          { option_id: salad!.option_id, is_offered: true, price_minor_override: 200 },
        ],
      }),
    );
    expect(set.options).toHaveLength(2);
    await cloud.pool.query(`UPDATE modifier_options SET archived_at = 3 WHERE option_id = $1`, [salad!.option_id]);
    // the branch version covers active options only: Salad's row is not in it
    const current = modifierGroupBranchVersion(group.modifier_group_id, a, [{ option_id: raita!.option_id, is_offered: false, price_minor_override: null }], new Set([raita!.option_id])).version;
    await ok(put(group.modifier_group_id, a, { expected_version: current, options: [] }));
    expect(await storedRows()).toEqual([{ branch_id: a, option_id: salad!.option_id, is_offered: true, price_minor_override: '200' }]);
  });

  // Pauses the first request that reaches beforeBump (inside its transaction, holding the group lock) until released.
  function pauseFirstBump() {
    let paused = false;
    let reachedResolve!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => (reachedResolve = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    control.beforeBump = async () => {
      if (paused) return;
      paused = true;
      reachedResolve();
      await released;
    };
    return { reached, release };
  }

  async function waitForLockWait(): Promise<void> {
    for (let waited = 0; waited < 2_000; waited += 20) {
      const rows = await cloud.pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
      );
      if (Number(rows.rows[0]!.n) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('the second request never waited on a lock');
  }

  async function race(first: () => Promise<LightMyRequestResponse>, second: () => Promise<LightMyRequestResponse>) {
    const gate = pauseFirstBump();
    try {
      const one = first();
      await gate.reached;
      const two = second();
      await waitForLockWait();
      gate.release();
      return await Promise.all([one, two]);
    } finally {
      gate.release();
      delete control.beforeBump;
    }
  }

  it('[01c #91] concurrent §6.12 archive of O2 and §6.12a override of O2 at Gulberg serialise on the group lock', async () => {
    const gulberg = f.branches[0];
    // PATCH first: the PUT waits, then finds O2 archived → 422 not_found, nothing written
    const group = await extras();
    const o2 = group.options[1]!;
    const keepO1andO3 = (g: ModifierGroupWire) =>
      [g.options[0], g.options[2]].map((o) => ({ option_id: o!.option_id, name: o!.name, price_minor: o!.price_minor, sort_order: o!.sort_order }));
    const [archivedFirst, putAfter] = await race(
      () => patch(group.modifier_group_id, { expected_version: group.version, options: keepO1andO3(group) }),
      () => put(group.modifier_group_id, gulberg, { expected_version: branchOf(group, gulberg).version, options: [{ option_id: o2.option_id, is_offered: true, price_minor_override: 300 }] }),
    );
    expect(archivedFirst.statusCode, archivedFirst.body).toBe(200);
    expect(putAfter.statusCode, putAfter.body).toBe(422);
    expect(putAfter.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'options.0.option_id', reason: 'not_found' } });
    expect(await storedRows()).toEqual([]);
    expect((await auditRows()).filter((row) => row.action === 'branch_set')).toEqual([]);

    // PUT first: the PATCH waits, then succeeds (its version covers only the group's fields, options and links);
    // O2's Gulberg row stays
    const second = await createModifierGroup(cloud, f, {
      name: 'Sides',
      min_choices: 0,
      max_choices: 3,
      options: [
        { name: 'Raita', price_minor: 100, sort_order: 0 },
        { name: 'Salad', price_minor: 150, sort_order: 1 },
        { name: 'Naan', price_minor: 50, sort_order: 2 },
      ],
    });
    const s2 = second.options[1]!;
    const [putFirst, archivedAfter] = await race(
      () => put(second.modifier_group_id, gulberg, { expected_version: branchOf(second, gulberg).version, options: [{ option_id: s2.option_id, is_offered: true, price_minor_override: 300 }] }),
      () => patch(second.modifier_group_id, { expected_version: second.version, options: keepO1andO3(second) }),
    );
    expect(putFirst.statusCode, putFirst.body).toBe(200);
    expect(archivedAfter.statusCode, archivedAfter.body).toBe(200);
    expect(archivedAfter.json().data.modifier_group.archived_options).toEqual([{ option_id: s2.option_id, name: 'Salad' }]);
    expect(await storedRows()).toEqual([{ branch_id: gulberg, option_id: s2.option_id, is_offered: true, price_minor_override: '300' }]);
    // the archived option's row is not in the branch wire
    expect(branchOf(archivedAfter.json().data.modifier_group as ModifierGroupWire, gulberg).options).toEqual([]);
  });
});
