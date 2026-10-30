import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createVariantGroup } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

describe('01c variant groups (§6.1, §6.2)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let counter: ReturnType<typeof pgCounter>;

  beforeAll(async () => {
    cloud = await createTestCloud({ testHooks: { handlerStart: () => counter.reset() } });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
  });

  const post = (url: string, payload: object, headers?: Record<string, string>) =>
    cloud.app.inject({ method: 'POST', url, headers: { ...owner(f).headers, ...headers }, payload });
  const patch = (url: string, payload: object) => cloud.app.inject({ method: 'PATCH', url, ...owner(f), payload });
  const patchGroup = (id: string, payload: object) => patch(`/v1/admin/variant-groups/${id}`, payload);
  const versions = async () =>
    (
      await cloud.pool.query<{ config_version: string }>(
        `SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`,
        [f.tenantId],
      )
    ).rows.map((row) => Number(row.config_version));
  const auditRows = async () =>
    (
      await cloud.pool.query<{ entity: string; entity_id: string; branch_id: string | null; action: string; before: unknown; after: unknown }>(
        `SELECT entity, entity_id, branch_id, action, before, after FROM config_audit
          WHERE tenant_id = $1 AND entity IN ('variant_group', 'menu_item') ORDER BY entity DESC, entity_id`,
        [f.tenantId],
      )
    ).rows;
  const category = async (name: string, archived = false) => {
    const id = (await post('/v1/admin/categories', { name })).json().data.category.category_id as string;
    if (archived) await patch(`/v1/admin/categories/${id}`, { archived: true });
    return id;
  };
  // A member written by SQL until the item routes take variant_group_id (task 12).
  const addMember = (itemId: string, groupId: string, categoryId: string, variantName: string, o?: { archived?: boolean }) =>
    cloud.pool.query(
      `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms,
                               variant_group_id, variant_name, archived_at, created_at, updated_at)
       VALUES ($1, $2, $3, $2, 100, 'immediate', 60000, $4, $5, $6, 0, 0)`,
      [f.tenantId, itemId, categoryId, groupId, variantName, o?.archived === true ? 1 : null],
    );
  const itemCategories = async () =>
    (
      await cloud.pool.query<{ item_id: string; category_id: string }>(
        `SELECT item_id, category_id FROM menu_items WHERE tenant_id = $1 ORDER BY item_id`,
        [f.tenantId],
      )
    ).rows;

  it('[01c #15] create group → 201, audit row, every branch bumped; replay with the same key → stored response', async () => {
    const categoryId = await category('Karahi');
    const before = await versions();
    const key = '01J00000000000000000000099';
    const created = await post(
      '/v1/admin/variant-groups',
      { name: 'Chicken Karahi', category_id: categoryId, description: 'Desi murgh', sort_order: 3 },
      { 'idempotency-key': key },
    );
    expect(created.statusCode).toBe(201);
    expect(counter.count).toBe(9); // key insert, category share, insert, audit, 3 bump, key response, prune
    const group = created.json().data.variant_group;
    expect(group).toEqual({
      variant_group_id: expect.any(String),
      name: 'Chicken Karahi',
      category_id: categoryId,
      description: 'Desi murgh',
      sort_order: 3,
      archived_at: null,
      member_ids: [],
      version: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(await versions()).toEqual(before.map((v) => v + 1));
    const audit = await auditRows();
    expect(audit).toEqual([
      {
        entity: 'variant_group',
        entity_id: group.variant_group_id,
        branch_id: null,
        action: 'create',
        before: null,
        after: expect.objectContaining({ name: 'Chicken Karahi', category_id: categoryId }),
      },
    ]);
    expect(audit[0]!.after).not.toHaveProperty('version');

    const replay = await post(
      '/v1/admin/variant-groups',
      { name: 'Chicken Karahi', category_id: categoryId, description: 'Desi murgh', sort_order: 3 },
      { 'idempotency-key': key },
    );
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(created.json());
    expect(await versions()).toEqual(before.map((v) => v + 1));
    expect(await auditRows()).toHaveLength(1);

    const taken = await post('/v1/admin/variant-groups', { name: 'chicken karahi', category_id: categoryId });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'variant_group' } });
    expect((await post('/v1/admin/variant-groups', { name: '', category_id: categoryId })).statusCode).toBe(400);
  });

  it('[01c #16] unknown, foreign-tenant and archived category_id → 422 not_found / not_found / archived', async () => {
    const archived = await category('Old', true);
    const foreign = 'B-CATEGORY-000000000000001';
    await cloud.pool.query(
      `INSERT INTO categories (tenant_id, category_id, name, created_at, updated_at) VALUES ($1, $2, 'B category', 0, 0)`,
      [f.other.tenantId, foreign],
    );
    const before = await versions();
    for (const [categoryId, reason] of [
      ['NO-SUCH-CATEGORY', 'not_found'],
      [foreign, 'not_found'],
      [archived, 'archived'],
    ] as const) {
      const refused = await post('/v1/admin/variant-groups', { name: 'Karahi', category_id: categoryId });
      expect(refused.statusCode, categoryId).toBe(422);
      expect(refused.json().error).toMatchObject({
        code: 'CONFIG_REFERENCE_INVALID',
        details: { field: 'category_id', reason },
      });
    }
    expect(await versions()).toEqual(before);
    expect(await auditRows()).toEqual([]);

    // the same rule on the PATCH (C4 step 4, a sent field as on create)
    const group = await createVariantGroup(cloud, f, { name: 'Karahi', category_id: await category('Karahi') });
    for (const [categoryId, reason] of [
      [foreign, 'not_found'],
      [archived, 'archived'],
    ] as const) {
      const refused = await patchGroup(group.variant_group_id, { expected_version: group.version, category_id: categoryId });
      expect(refused.statusCode).toBe(422);
      expect(refused.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'category_id', reason } });
    }
  });

  it('[01c #17] archive a group with an active member → 409 CONFIG_IN_USE listing the member', async () => {
    const categoryId = await category('Karahi');
    const group = await createVariantGroup(cloud, f, { name: 'Karahi', category_id: categoryId });
    await addMember('IT-FULL', group.variant_group_id, categoryId, 'Full');
    await addMember('IT-OLD', group.variant_group_id, categoryId, 'Old', { archived: true });
    const before = await versions();
    const refused = await patchGroup(group.variant_group_id, { expected_version: group.version, archived: true });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { entity: 'variant_group', id: group.variant_group_id, used_by: { entity: 'menu_item', ids: ['IT-FULL'] } },
    });
    expect(await versions()).toEqual(before);

    // with only an archived member left, the archive goes through; a restore writes a restore row
    await cloud.pool.query(`UPDATE menu_items SET archived_at = 1 WHERE tenant_id = $1 AND item_id = 'IT-FULL'`, [f.tenantId]);
    const archived = await patchGroup(group.variant_group_id, { expected_version: group.version, archived: true });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().data.variant_group).toMatchObject({ archived_at: cloud.clock.branchNow(), member_ids: ['IT-FULL', 'IT-OLD'] });
    const restored = await patchGroup(group.variant_group_id, {
      expected_version: archived.json().data.variant_group.version,
      archived: false,
    });
    expect(restored.statusCode).toBe(200);
    expect((await auditRows()).filter((row) => row.entity === 'variant_group').map((row) => row.action).sort()).toEqual([
      'archive',
      'create',
      'restore',
    ]);
  });

  it('[01c #18] move a group with 2 members to another category → 3 audit rows (group + 2 menu_item), members moved', async () => {
    const from = await category('Karahi');
    const to = await category('Handi');
    const group = await createVariantGroup(cloud, f, { name: 'Chicken', category_id: from });
    await addMember('IT-FULL', group.variant_group_id, from, 'Full');
    await addMember('IT-HALF', group.variant_group_id, from, 'Half', { archived: true });
    await cloud.pool.query(
      `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, created_at, updated_at)
       VALUES ($1, 'IT-PLAIN', $2, 'Plain', 100, 'immediate', 60000, 0, 0)`,
      [f.tenantId, from],
    );
    const before = await versions();
    const auditBefore = (await auditRows()).length;
    const moved = await patchGroup(group.variant_group_id, { expected_version: group.version, category_id: to });
    expect(moved.statusCode).toBe(200);
    // lock, members lock, category share, R3 links read, update, members update, audit (1 multi-row), 3 bump
    expect(counter.count).toBe(10);
    expect(moved.json().data.variant_group).toMatchObject({ category_id: to, member_ids: ['IT-FULL', 'IT-HALF'] });
    expect(moved.json().data.variant_group.version).not.toBe(group.version);
    expect(await itemCategories()).toEqual([
      { item_id: 'IT-FULL', category_id: to },
      { item_id: 'IT-HALF', category_id: to },
      { item_id: 'IT-PLAIN', category_id: from },
    ]);
    expect(await versions()).toEqual(before.map((v) => v + 1));
    const audit = await auditRows();
    expect(audit).toHaveLength(auditBefore + 3);
    expect(audit.filter((row) => row.action !== 'create')).toEqual([
      {
        entity: 'variant_group',
        entity_id: group.variant_group_id,
        branch_id: null,
        action: 'update',
        before: expect.objectContaining({ category_id: from }),
        after: expect.objectContaining({ category_id: to }),
      },
      {
        entity: 'menu_item',
        entity_id: 'IT-FULL',
        branch_id: null,
        action: 'update',
        before: expect.objectContaining({ item_id: 'IT-FULL', category_id: from }),
        after: expect.objectContaining({ item_id: 'IT-FULL', category_id: to }),
      },
      {
        entity: 'menu_item',
        entity_id: 'IT-HALF',
        branch_id: null,
        action: 'update',
        before: expect.objectContaining({ item_id: 'IT-HALF', category_id: from }),
        after: expect.objectContaining({ item_id: 'IT-HALF', category_id: to }),
      },
    ]);
  });

  it('[01c #19] stale expected_version → 409 CONFIG_STALE, nothing written; also when the body is a no-op', async () => {
    const categoryId = await category('Karahi');
    const group = await createVariantGroup(cloud, f, { name: 'Karahi', category_id: categoryId });
    const renamed = await patchGroup(group.variant_group_id, { expected_version: group.version, name: 'Karahi 2' });
    expect(renamed.statusCode).toBe(200);
    const before = await versions();
    const auditBefore = await auditRows();
    for (const body of [{ name: 'Karahi 3' }, { name: 'Karahi 2' }]) {
      const stale = await patchGroup(group.variant_group_id, { expected_version: group.version, ...body });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error).toMatchObject({
        code: 'CONFIG_STALE',
        details: { entity: 'variant_group', id: group.variant_group_id },
      });
    }
    expect(await versions()).toEqual(before);
    expect(await auditRows()).toEqual(auditBefore);
    const stored = await cloud.pool.query(`SELECT name FROM variant_groups WHERE variant_group_id = $1`, [group.variant_group_id]);
    expect(stored.rows[0]).toEqual({ name: 'Karahi 2' });
  });

  it('[01c #20] a PATCH body with only expected_version → 400', async () => {
    const group = await createVariantGroup(cloud, f, { name: 'Karahi', category_id: await category('Karahi') });
    const refused = await patchGroup(group.variant_group_id, { expected_version: group.version });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('[01c §6.2] unknown group → 404; no-op → 200 with no audit or bump; name taken → 409; a plain edit is 7 statements', async () => {
    const unknown = await patchGroup('NO-SUCH-GROUP', { expected_version: 'x', name: 'A' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toMatchObject({ code: 'VARIANT_GROUP_NOT_FOUND', details: { variant_group_id: 'NO-SUCH-GROUP' } });

    const categoryId = await category('Karahi');
    const group = await createVariantGroup(cloud, f, { name: 'Karahi', category_id: categoryId });
    await createVariantGroup(cloud, f, { name: 'Handi', category_id: categoryId });
    const before = await versions();
    const auditBefore = await auditRows();
    const noOp = await patchGroup(group.variant_group_id, { expected_version: group.version, name: 'Karahi', category_id: categoryId });
    expect(noOp.statusCode).toBe(200);
    expect(noOp.json().data.variant_group).toEqual(group);
    expect(await versions()).toEqual(before);
    expect(await auditRows()).toEqual(auditBefore);

    const taken = await patchGroup(group.variant_group_id, { expected_version: group.version, name: 'HANDI' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'variant_group' } });

    const edited = await patchGroup(group.variant_group_id, { expected_version: group.version, sort_order: 5, description: null });
    expect(edited.statusCode).toBe(200);
    // lock, members read, update, audit, 3 bump
    expect(counter.count).toBe(7);
  });

  it('[01c §6 C4] an owner row missing a branch → 403 tenant_wide_write before 404, 409, 422 and the no-op; nothing written', async () => {
    const categoryId = await category('Karahi');
    const group = await createVariantGroup(cloud, f, { name: 'Karahi', category_id: categoryId });
    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      f.tenantId,
      f.userId,
      [f.branches[0]],
    ]);
    const before = await versions();
    const auditBefore = await auditRows();
    const groupsBefore = (await cloud.pool.query(`SELECT * FROM variant_groups ORDER BY variant_group_id`)).rows;
    const writes = [
      () => post('/v1/admin/variant-groups', { name: 'Handi', category_id: categoryId }),
      () => post('/v1/admin/variant-groups', { name: 'Handi', category_id: 'NO-SUCH-CATEGORY' }), // else 422
      () => patchGroup(group.variant_group_id, { expected_version: group.version, name: 'Karahi 2' }),
      () => patchGroup('NO-SUCH-GROUP', { expected_version: 'x', name: 'A' }), // else 404
      () => patchGroup(group.variant_group_id, { expected_version: 'stale', name: 'A' }), // else 409
      () => patchGroup(group.variant_group_id, { expected_version: group.version, name: 'Karahi' }), // else no-op 200
    ];
    for (const write of writes) {
      const response = await write();
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'tenant_wide_write' } });
    }
    expect(await versions()).toEqual(before);
    expect(await auditRows()).toEqual(auditBefore);
    expect((await cloud.pool.query(`SELECT * FROM variant_groups ORDER BY variant_group_id`)).rows).toEqual(groupsBefore);
    const keys = await cloud.pool.query(`SELECT count(*)::int AS n FROM idempotency_keys WHERE route = 'POST /v1/admin/variant-groups'`);
    expect(keys.rows[0]).toEqual({ n: 1 }); // only the create above; the refused POSTs stored no key
  });

  it('[01c §6.2 AD-7] restoring a group whose category is archived → 422 archived, nothing written; category restored → 200', async () => {
    const categoryId = await category('Karahi');
    const group = await createVariantGroup(cloud, f, { name: 'Karahi', category_id: categoryId });
    const archived = (await patchGroup(group.variant_group_id, { expected_version: group.version, archived: true })).json().data
      .variant_group;
    expect((await patch(`/v1/admin/categories/${categoryId}`, { archived: true })).statusCode).toBe(200);
    const before = await versions();
    const auditBefore = await auditRows();
    const refused = await patchGroup(group.variant_group_id, { expected_version: archived.version, archived: false });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'category_id', reason: 'archived' },
    });
    expect(await versions()).toEqual(before);
    expect(await auditRows()).toEqual(auditBefore);

    expect((await patch(`/v1/admin/categories/${categoryId}`, { archived: false })).statusCode).toBe(200);
    const restored = await patchGroup(group.variant_group_id, { expected_version: archived.version, archived: false });
    expect(restored.statusCode).toBe(200);
    // tenant-wide check, lock, members read, category share, update, audit, 2 bump
    expect(counter.count).toBe(8);
    expect(restored.json().data.variant_group.archived_at).toBeNull();
  });

  it('[01c V16] archive a category used by an active variant group → 409 CONFIG_IN_USE; with the group archived → 200', async () => {
    const categoryId = await category('Karahi');
    const group = await createVariantGroup(cloud, f, { name: 'Karahi', category_id: categoryId });
    const before = await versions();
    const refused = await patch(`/v1/admin/categories/${categoryId}`, { archived: true });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { entity: 'category', id: categoryId, used_by: { entity: 'variant_group', ids: [group.variant_group_id] } },
    });
    expect(await versions()).toEqual(before);

    expect((await patchGroup(group.variant_group_id, { expected_version: group.version, archived: true })).statusCode).toBe(200);
    const archived = await patch(`/v1/admin/categories/${categoryId}`, { archived: true });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().data.category.archived_at).not.toBeNull();
  });
});
