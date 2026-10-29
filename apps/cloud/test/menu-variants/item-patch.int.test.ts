import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createVariantGroup } from '../helpers/menu-variants';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

// 01c §6.5: the item PATCH's lock order and restart rule (M3, N2), its variant fields and the T4 check order.
describe('01c item PATCH: lock order, restart, variant fields (§6.5)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let menu: SeededMenu;
  let hook: ((attempt: number) => Promise<void>) | undefined;

  beforeAll(async () => {
    cloud = await createTestCloud({
      testHooks: {
        beforeItemLock: async (attempt) => {
          await hook?.(attempt);
        },
      },
    });
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    hook = undefined;
    f = await restaurantFixture(cloud);
    menu = await seedMenu(cloud.pool, f, { items: 1, archived: true });
  });

  const inject = (method: 'POST' | 'PATCH', url: string, payload: object) => cloud.app.inject({ method, url, ...owner(f), payload });
  const patch = (itemId: string, payload: object) => inject('PATCH', `/v1/admin/menu-items/${itemId}`, payload);
  const create = async (o: object = {}) => {
    const response = await inject('POST', '/v1/admin/menu-items', {
      category_id: menu.categoryIds[0],
      tax_class_id: null,
      name: 'Chicken Karahi Half',
      price_minor: 115000,
      serve_mode: 'sync',
      cook_time_ms: 1_200_000,
      routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId }],
      ...o,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().data.item as { item_id: string } & Record<string, unknown>;
  };
  const group = (name: string, categoryId = menu.categoryIds[0]) => createVariantGroup(cloud, f, { name, category_id: categoryId });
  const patchGroup = async (variantGroupId: string, version: string, payload: object) => {
    const response = await inject('PATCH', `/v1/admin/variant-groups/${variantGroupId}`, { expected_version: version, ...payload });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.variant_group as { version: string };
  };
  const stored = async (itemId: string) =>
    (await cloud.pool.query(`SELECT * FROM menu_items WHERE item_id = $1`, [itemId])).rows[0] as Record<string, unknown>;
  const itemAudit = async (itemId: string) =>
    (
      await cloud.pool.query<{ action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>(
        `SELECT action, before, after FROM config_audit WHERE entity = 'menu_item' AND entity_id = $1 ORDER BY at, audit_id`,
        [itemId],
      )
    ).rows;
  const auditCount = async () => Number((await cloud.pool.query(`SELECT count(*) AS n FROM config_audit`)).rows[0].n);
  const versions = async () =>
    (
      await cloud.pool.query<{ config_version: string }>(
        `SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`,
        [f.tenantId],
      )
    ).rows.map((row) => Number(row.config_version));
  // The response is the error (or a no-op 200); the row, every audit row and every branch version are unchanged.
  const nothingWritten = async (itemId: string, call: () => ReturnType<typeof patch>, status: number) => {
    const before = { row: await stored(itemId), audit: await auditCount(), versions: await versions() };
    const response = await call();
    expect(response.statusCode, response.body).toBe(status);
    expect(await stored(itemId)).toEqual(before.row);
    expect(await auditCount()).toBe(before.audit);
    expect(await versions()).toEqual(before.versions);
    return response.json() as { error: { code: string; details: Record<string, unknown> } };
  };

  it('[01c #101] an archived member moves with its group; restoring a member whose group is archived → 422 archived, nothing written', async () => {
    const karahi = await group('Chicken Karahi');
    const half = await create({ variant_group_id: karahi.variant_group_id, variant_name: 'Half' });
    const full = await create({ name: 'Chicken Karahi Full', variant_group_id: karahi.variant_group_id, variant_name: 'Full' });
    expect((await patch(full.item_id, { archived: true })).statusCode).toBe(200);
    const auditBefore = (await itemAudit(full.item_id)).length;

    const moved = await patchGroup(karahi.variant_group_id, karahi.version, { category_id: menu.categoryIds[1] });
    expect(await stored(full.item_id)).toMatchObject({ category_id: menu.categoryIds[1], variant_group_id: karahi.variant_group_id });
    const fullAudit = await itemAudit(full.item_id);
    expect(fullAudit).toHaveLength(auditBefore + 1);
    expect(fullAudit.at(-1)).toMatchObject({ action: 'update', before: { category_id: menu.categoryIds[0] }, after: { category_id: menu.categoryIds[1] } });

    expect((await patch(half.item_id, { archived: true })).statusCode).toBe(200);
    await patchGroup(karahi.variant_group_id, moved.version, { archived: true });
    const body = await nothingWritten(full.item_id, () => patch(full.item_id, { archived: false }), 422);
    expect(body.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'variant_group_id', reason: 'archived' } });
  });

  it('[01c #111] PATCH a member’s category_id alone to another category → 422 category_mismatch, nothing written', async () => {
    const karahi = await group('Chicken Karahi');
    const half = await create({ variant_group_id: karahi.variant_group_id, variant_name: 'Half' });
    const body = await nothingWritten(half.item_id, () => patch(half.item_id, { category_id: menu.categoryIds[1] }), 422);
    expect(body.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'category_id', reason: 'category_mismatch' } });
  });

  it('[01c #120] restart: (a) moved to another group before the item lock → second attempt commits; (b) joined from no group → restart, R1 under the new group; (c) a change on every attempt → 503 after 3, nothing written', async () => {
    // (a) group path: I in A; another PATCH moves I to B between the unlocked read and the item lock
    const a = await group('Chicken Karahi');
    const b = await group('Mutton Karahi');
    const item = await create({ variant_group_id: a.variant_group_id, variant_name: 'Half' });
    const attempts: number[] = [];
    let inner = false;
    hook = async (attempt) => {
      if (inner) return;
      attempts.push(attempt);
      if (attempt !== 1) return;
      inner = true;
      const moved = await patch(item.item_id, { variant_group_id: b.variant_group_id, variant_name: 'Half' });
      inner = false;
      expect(moved.statusCode, moved.body).toBe(200);
    };
    const renamed = await patch(item.item_id, { name: 'Karahi Half Renamed' });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(attempts).toEqual([1, 2]);
    expect(renamed.json().data.item).toMatchObject({ name: 'Karahi Half Renamed', variant_group_id: b.variant_group_id });
    expect(await stored(item.item_id)).toMatchObject({ name: 'Karahi Half Renamed', variant_group_id: b.variant_group_id });

    // (b) no-group path: I in no group; another PATCH joins I to B (category 1) while I is moved to category 2
    const loose = await create({ name: 'Loose Karahi' });
    attempts.length = 0;
    hook = async (attempt) => {
      if (inner) return;
      attempts.push(attempt);
      if (attempt !== 1) return;
      inner = true;
      const joined = await patch(loose.item_id, { variant_group_id: b.variant_group_id, variant_name: 'Full' });
      inner = false;
      expect(joined.statusCode, joined.body).toBe(200);
    };
    const mismatch = await patch(loose.item_id, { category_id: menu.categoryIds[1] });
    expect(mismatch.statusCode, mismatch.body).toBe(422);
    expect(mismatch.json().error).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'category_id', reason: 'category_mismatch' },
    });
    expect(attempts).toEqual([1, 2]);
    expect(await stored(loose.item_id)).toMatchObject({ category_id: menu.categoryIds[0], variant_group_id: b.variant_group_id });

    // (c) the hook moves I to the other group on every attempt → 503 after 3; the PATCH itself wrote nothing
    attempts.length = 0;
    hook = async (attempt) => {
      attempts.push(attempt);
      await cloud.pool.query(
        `UPDATE menu_items SET variant_group_id = CASE WHEN variant_group_id = $2 THEN $3 ELSE $2 END WHERE item_id = $1`,
        [item.item_id, a.variant_group_id, b.variant_group_id],
      );
    };
    const before = { name: (await stored(item.item_id)).name, audit: await auditCount(), versions: await versions() };
    const unavailable = await patch(item.item_id, { name: 'Never written' });
    expect(unavailable.statusCode, unavailable.body).toBe(503);
    expect(unavailable.json().error).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(attempts).toEqual([1, 2, 3]);
    expect((await stored(item.item_id)).name).toBe(before.name);
    expect(await auditCount()).toBe(before.audit);
    expect(await versions()).toEqual(before.versions);
  });

  it('[01c §6.5] leave a group with both null → 200; one of them null alone → 400; a group without a name → 400', async () => {
    const karahi = await group('Chicken Karahi');
    const half = await create({ variant_group_id: karahi.variant_group_id, variant_name: 'Half' });
    for (const payload of [{ variant_group_id: null }, { variant_name: null }, { variant_group_id: null, variant_name: 'Half' }]) {
      const body = await nothingWritten(half.item_id, () => patch(half.item_id, payload), 400);
      expect(body.error.code, JSON.stringify(payload)).toBe('VALIDATION_FAILED');
    }
    const left = await patch(half.item_id, { variant_group_id: null, variant_name: null });
    expect(left.statusCode, left.body).toBe(200);
    expect(left.json().data.item).toMatchObject({ variant_group_id: null, variant_name: null });
    expect(await stored(half.item_id)).toMatchObject({ variant_group_id: null, variant_name: null });
    expect((await itemAudit(half.item_id)).at(-1)).toMatchObject({
      action: 'update',
      before: { variant_group_id: karahi.variant_group_id, variant_name: 'Half' },
      after: { variant_group_id: null, variant_name: null },
    });

    // the merged row needs both: a group sent onto a standalone item without a name → 400 at variant_name
    const body = await nothingWritten(half.item_id, () => patch(half.item_id, { variant_group_id: karahi.variant_group_id }), 400);
    expect(body.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'variant_name' }] } });
    // rejoin with a name → 200
    const rejoined = await patch(half.item_id, { variant_group_id: karahi.variant_group_id, variant_name: 'Half' });
    expect(rejoined.statusCode, rejoined.body).toBe(200);
  });

  it('[01c §6.5] R5: a variant name taken in the group → 409 CONFIG_NAME_TAKEN { entity: variant }, nothing written', async () => {
    const karahi = await group('Chicken Karahi');
    await create({ variant_group_id: karahi.variant_group_id, variant_name: 'Half' });
    const full = await create({ name: 'Chicken Karahi Full', variant_group_id: karahi.variant_group_id, variant_name: 'Full' });
    const body = await nothingWritten(full.item_id, () => patch(full.item_id, { variant_name: ' half ' }), 409);
    expect(body.error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'variant', name: 'half' } });
  });

  it('[01c §6.5 T4] re-sending an unchanged archived category → 200 no-op (no-op before references), nothing written', async () => {
    const archivedItem = menu.archived!.itemId;
    await cloud.pool.query(`UPDATE menu_items SET category_id = $2 WHERE item_id = $1`, [archivedItem, menu.archived!.categoryId]);
    await nothingWritten(archivedItem, () => patch(archivedItem, { category_id: menu.archived!.categoryId }), 200);
    // also on an active item whose stored category was archived meanwhile: the no-op wins over the 422 archived
    const active = await create({ name: 'Plain' });
    await cloud.pool.query(`UPDATE menu_items SET category_id = $2 WHERE item_id = $1`, [active.item_id, menu.archived!.categoryId]);
    await nothingWritten(active.item_id, () => patch(active.item_id, { category_id: menu.archived!.categoryId }), 200);
  });

  it('[01c §6 C4] an owner whose row misses a branch → 403 tenant_wide_write before the no-op and the 404, nothing written', async () => {
    const plain = await create({ name: 'Plain' });
    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      f.tenantId,
      f.userId,
      [f.branches[0]],
    ]);
    for (const call of [() => patch(plain.item_id, { name: 'Plain' }), () => patch(plain.item_id, { price_minor: 1 })]) {
      const body = await nothingWritten(plain.item_id, call, 403);
      expect(body.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'tenant_wide_write' } });
    }
    const audit = await auditCount();
    const unknown = await patch('IT-UNKNOWN', { name: 'Ghost' });
    expect(unknown.statusCode, unknown.body).toBe(403);
    expect(unknown.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'tenant_wide_write' } });
    expect(await auditCount()).toBe(audit);
  });
});
