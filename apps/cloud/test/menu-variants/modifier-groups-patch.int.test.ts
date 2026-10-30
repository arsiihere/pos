import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateModifierGroupRequest, ModifierGroupWire } from '@pos/events';
import { createModifierGroup } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

// 01c §6.12: modifier group PATCH — whole options (V14: upsert sent, archive omitted, restore by id) and whole
// links (delete + insert; only added or changed links re-checked, m15); versioned (V13); one audit row (V15).
describe('01c modifier group PATCH (§6.12): options and links rewrite', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let menu: SeededMenu;
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
    menu = await seedMenu(cloud.pool, f, { items: 1 });
  });

  const inject = (method: 'POST' | 'PATCH', url: string, payload: object) =>
    cloud.app.inject({ method, url, headers: owner(f).headers, payload });
  const patch = (id: string, payload: object) => inject('PATCH', `/v1/admin/modifier-groups/${id}`, payload);
  const category = async (name: string) => (await inject('POST', '/v1/admin/categories', { name })).json().data.category.category_id as string;
  const versions = async () =>
    (
      await cloud.pool.query<{ config_version: string }>(`SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`, [
        f.tenantId,
      ])
    ).rows.map((row) => Number(row.config_version));
  const storedOptions = async (groupId: string) =>
    (
      await cloud.pool.query<{ option_id: string; name: string; archived: boolean }>(
        `SELECT option_id, name, archived_at IS NOT NULL AS archived FROM modifier_options WHERE modifier_group_id = $1 ORDER BY option_id`,
        [groupId],
      )
    ).rows;
  const counts = async () =>
    (
      await cloud.pool.query<{ groups: number; options: number; links: number; audit: number }>(
        `SELECT (SELECT count(*)::int FROM modifier_groups) AS groups, (SELECT count(*)::int FROM modifier_options) AS options,
                (SELECT count(*)::int FROM modifier_group_links) AS links, (SELECT count(*)::int FROM config_audit) AS audit`,
      )
    ).rows[0];
  const everything = async () => ({
    counts: await counts(),
    versions: await versions(),
    options: (await cloud.pool.query(`SELECT * FROM modifier_options ORDER BY tenant_id, option_id`)).rows,
    links: (await cloud.pool.query(`SELECT * FROM modifier_group_links ORDER BY tenant_id, modifier_group_id, target_kind, target_id`)).rows,
    groups: (await cloud.pool.query(`SELECT * FROM modifier_groups ORDER BY tenant_id, modifier_group_id`)).rows,
  });
  // The call answers `status` with nothing written and no branch bumped; the error is returned.
  const refused = async (call: () => Promise<{ statusCode: number; body: string; json: () => unknown }>, status: number) => {
    const before = await everything();
    const response = await call();
    expect(response.statusCode, response.body).toBe(status);
    expect(await everything()).toEqual(before);
    return (response.json() as { error: { code: string; details: Record<string, unknown> } }).error;
  };
  const issuePaths = (error: { details: Record<string, unknown> }) => (error.details.issues as Array<{ path: string }>).map((i) => i.path);
  const groupAudit = async (groupId: string) =>
    (
      await cloud.pool.query<{ action: string; before: Record<string, unknown> | null; after: Record<string, unknown> }>(
        `SELECT action, before, after FROM config_audit WHERE tenant_id = $1 AND entity_id = $2 ORDER BY at, audit_id`,
        [f.tenantId, groupId],
      )
    ).rows;
  const spice = (o?: Partial<CreateModifierGroupRequest>): Promise<ModifierGroupWire> =>
    createModifierGroup(cloud, f, {
      name: 'Spice level',
      min_choices: 0,
      max_choices: 2,
      options: [
        { name: 'Mild', price_minor: 0, sort_order: 0 },
        { name: 'Hot', price_minor: 50, sort_order: 1 },
      ],
      ...o,
    });
  const ok = async (id: string, payload: object): Promise<ModifierGroupWire> => {
    const response = await patch(id, payload);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.modifier_group as ModifierGroupWire;
  };

  it('[01c #42] keeps O1 (renamed), omits O2, adds O3 → O1 same id, O2 archived, O3 new ULID; sending O2 again → restored, same id', async () => {
    const group = await spice();
    const [o1, o2] = group.options;
    const before = await versions();
    const first = await patch(group.modifier_group_id, {
      expected_version: group.version,
      options: [
        { option_id: o1!.option_id, name: 'Mild (less chilli)', price_minor: 0, sort_order: 0 },
        { name: 'Extra hot', price_minor: 80, sort_order: 2 },
      ],
    });
    expect(first.statusCode, first.body).toBe(200);
    // tenant-wide check, group lock, options read, links read, group update, options upsert, archive omitted,
    // audit, 2 bump, branch rows read
    expect(counter.count).toBe(11);
    const patched = first.json().data.modifier_group as ModifierGroupWire;
    expect(patched.options).toEqual([
      { option_id: o1!.option_id, name: 'Mild (less chilli)', price_minor: 0, max_quantity: 1, is_default: false, linked_item_id: null, sort_order: 0 },
      { option_id: expect.any(String), name: 'Extra hot', price_minor: 80, max_quantity: 1, is_default: false, linked_item_id: null, sort_order: 2 },
    ]);
    const o3 = patched.options[1]!.option_id;
    expect(o3).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect([o1!.option_id, o2!.option_id]).not.toContain(o3);
    expect(patched.archived_options).toEqual([{ option_id: o2!.option_id, name: 'Hot' }]);
    expect(patched.version).not.toBe(group.version);
    expect(patched.branches.map((b) => b.branch_id)).toEqual([...f.branches].sort());
    expect(await versions()).toEqual(before.map((v) => v + 1));
    expect(await storedOptions(group.modifier_group_id)).toEqual(
      [
        { option_id: o1!.option_id, name: 'Mild (less chilli)', archived: false },
        { option_id: o2!.option_id, name: 'Hot', archived: true },
        { option_id: o3, name: 'Extra hot', archived: false },
      ].sort((a, b) => (a.option_id < b.option_id ? -1 : 1)),
    );

    const restored = await ok(group.modifier_group_id, {
      expected_version: patched.version,
      options: [
        { option_id: o1!.option_id, name: 'Mild (less chilli)', price_minor: 0, sort_order: 0 },
        { option_id: o2!.option_id, name: 'Hot', price_minor: 60, sort_order: 1 },
        { option_id: o3, name: 'Extra hot', price_minor: 80, sort_order: 2 },
      ],
    });
    expect(restored.options.map((o) => [o.option_id, o.name, o.price_minor])).toEqual([
      [o1!.option_id, 'Mild (less chilli)', 0],
      [o2!.option_id, 'Hot', 60],
      [o3, 'Extra hot', 80],
    ]);
    expect(restored.archived_options).toEqual([]);
    expect((await storedOptions(group.modifier_group_id)).every((o) => !o.archived)).toBe(true);
    expect((await counts()).options).toBe(3);
  });

  it('[01c #43] swap the names of O1 and O2 in one PATCH → 200 (rewrite, no unique-index failure)', async () => {
    const group = await spice();
    const [o1, o2] = group.options;
    const swapped = await ok(group.modifier_group_id, {
      expected_version: group.version,
      options: [
        { option_id: o1!.option_id, name: 'Hot', price_minor: 0, sort_order: 0 },
        { option_id: o2!.option_id, name: 'Mild', price_minor: 50, sort_order: 1 },
      ],
    });
    expect(swapped.options.map((o) => [o.option_id, o.name])).toEqual([
      [o1!.option_id, 'Hot'],
      [o2!.option_id, 'Mild'],
    ]);
  });

  it('[01c #44] option id from another group → 422 not_found; from another tenant → 422 not_found; nothing created', async () => {
    const group = await spice();
    const other = await createModifierGroup(cloud, f, { name: 'Extras', min_choices: 0, max_choices: 1, options: [{ name: 'Raita', price_minor: 100 }] });
    await cloud.pool.query(
      `INSERT INTO modifier_groups (tenant_id, modifier_group_id, name, min_choices, max_choices, created_at, updated_at)
       VALUES ($1, 'B-MODIFIER-GROUP-000000001', 'B group', 0, 1, 0, 0)`,
      [f.other.tenantId],
    );
    await cloud.pool.query(
      `INSERT INTO modifier_options (tenant_id, option_id, modifier_group_id, name, price_minor)
       VALUES ($1, 'B-OPTION-0000000000000001', 'B-MODIFIER-GROUP-000000001', 'B option', 0)`,
      [f.other.tenantId],
    );
    for (const foreign of [other.options[0]!.option_id, 'B-OPTION-0000000000000001', 'OP-UNKNOWN']) {
      const error = await refused(
        () =>
          patch(group.modifier_group_id, {
            expected_version: group.version,
            options: [
              { option_id: group.options[0]!.option_id, name: 'Mild', price_minor: 0 },
              { option_id: foreign, name: 'Stolen', price_minor: 0 },
            ],
          }),
        422,
      );
      expect(error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'options.1.option_id', reason: 'not_found' } });
    }
    // the other group's option is untouched
    expect(await storedOptions(other.modifier_group_id)).toEqual([{ option_id: other.options[0]!.option_id, name: 'Raita', archived: false }]);
  });

  it('[01c #45] repeated option_id → 400 at options.1.option_id', async () => {
    const group = await spice();
    const id = group.options[0]!.option_id;
    const error = await refused(
      () =>
        patch(group.modifier_group_id, {
          expected_version: group.version,
          options: [
            { option_id: id, name: 'Mild', price_minor: 0 },
            { option_id: id, name: 'Mild again', price_minor: 0 },
          ],
        }),
      400,
    );
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(issuePaths(error)).toContain('options.1.option_id');
    // options: [] → 400 (1–50)
    expect((await refused(() => patch(group.modifier_group_id, { expected_version: group.version, options: [] }), 400)).code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('[01c #46] tab A adds O3; tab B (stale) saves without O3 → 409 CONFIG_STALE; O3 still active', async () => {
    const group = await spice();
    const [o1, o2] = group.options;
    const tabA = await ok(group.modifier_group_id, {
      expected_version: group.version,
      options: [
        { option_id: o1!.option_id, name: 'Mild', price_minor: 0, sort_order: 0 },
        { option_id: o2!.option_id, name: 'Hot', price_minor: 50, sort_order: 1 },
        { name: 'Extra hot', price_minor: 80, sort_order: 2 },
      ],
    });
    const o3 = tabA.options[2]!.option_id;
    const stale = await refused(
      () =>
        patch(group.modifier_group_id, {
          expected_version: group.version,
          options: [
            { option_id: o1!.option_id, name: 'Mild', price_minor: 0, sort_order: 0 },
            { option_id: o2!.option_id, name: 'Hot', price_minor: 50, sort_order: 1 },
          ],
        }),
      409,
    );
    expect(stale).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'modifier_group', id: group.modifier_group_id } });
    expect((await storedOptions(group.modifier_group_id)).find((o) => o.option_id === o3)).toMatchObject({ archived: false });
    // a stale no-op is stale too (the version check comes before the no-op)
    expect((await refused(() => patch(group.modifier_group_id, { expected_version: group.version, name: 'Spice level' }), 409)).code).toBe(
      'CONFIG_STALE',
    );
  });

  it('[01c #47] a group write → exactly one audit row with the whole active lists before / after; no per-option rows', async () => {
    const karahi = menu.categoryIds[0]!;
    const group = await spice({ links: [{ target_kind: 'category', target_id: karahi, mode: 'attach' }] });
    const [o1, o2] = group.options;
    const auditBefore = (await counts()).audit;
    const patched = await ok(group.modifier_group_id, {
      expected_version: group.version,
      name: 'Spice',
      options: [
        { option_id: o1!.option_id, name: 'Mild', price_minor: 0, sort_order: 0 },
        { name: 'Extra hot', price_minor: 80, sort_order: 2 },
      ],
      links: [
        { target_kind: 'category', target_id: karahi, mode: 'attach' },
        { target_kind: 'item', target_id: menu.itemIds[0], mode: 'detach' },
      ],
    });
    expect((await counts()).audit).toBe(auditBefore + 1);
    const rows = await groupAudit(group.modifier_group_id);
    expect(rows.map((row) => row.action)).toEqual(['create', 'update']);
    const update = rows[1]!;
    expect(update.before).toEqual({
      modifier_group_id: group.modifier_group_id,
      name: 'Spice level',
      min_choices: 0,
      max_choices: 2,
      sort_order: 0,
      archived_at: null,
      options: group.options,
      links: group.links,
    });
    expect(update.after).toEqual({
      modifier_group_id: group.modifier_group_id,
      name: 'Spice',
      min_choices: 0,
      max_choices: 2,
      sort_order: 0,
      archived_at: null,
      options: patched.options,
      links: patched.links,
    });
    // only the active options are in the lists (O2, archived, is not)
    expect((update.after.options as Array<{ option_id: string }>).map((o) => o.option_id)).not.toContain(o2!.option_id);
    const perOption = await cloud.pool.query(`SELECT 1 FROM config_audit WHERE entity_id = ANY($1)`, [[o1!.option_id, o2!.option_id]]);
    expect(perOption.rowCount).toBe(0);

    // archive and restore: one row each, action archive / restore
    const archived = await ok(group.modifier_group_id, { expected_version: patched.version, archived: true });
    expect(archived.archived_at).not.toBeNull();
    await ok(group.modifier_group_id, { expected_version: archived.version, archived: false });
    expect((await groupAudit(group.modifier_group_id)).map((row) => row.action)).toEqual(['create', 'update', 'archive', 'restore']);
  });

  it('[01c §6.12] links rewrite: whole list replaced; an unchanged link is not re-checked (m15), an added or changed one is', async () => {
    const karahi = menu.categoryIds[0]!;
    const old = await category('Old');
    const group = await spice({
      links: [
        { target_kind: 'category', target_id: karahi, mode: 'attach' },
        { target_kind: 'category', target_id: old, mode: 'attach' },
      ],
    });
    expect((await inject('PATCH', `/v1/admin/categories/${old}`, { archived: true })).statusCode).toBe(200);
    // the archived category's link is re-sent unchanged → not re-checked; the karahi link is dropped, an item link added
    const rewritten = await patch(group.modifier_group_id, {
      expected_version: group.version,
      links: [
        { target_kind: 'category', target_id: old, mode: 'attach' },
        { target_kind: 'item', target_id: menu.itemIds[0], mode: 'attach' },
      ],
    });
    expect(rewritten.statusCode, rewritten.body).toBe(200);
    // tenant-wide check, group lock, options read, links read, item FOR SHARE (the added link only), group update,
    // links delete, links insert, audit, 2 bump, branch rows read
    expect(counter.count).toBe(12);
    const wire = rewritten.json().data.modifier_group as ModifierGroupWire;
    expect(wire.links).toEqual([
      { target_kind: 'category', target_id: old, mode: 'attach' },
      { target_kind: 'item', target_id: menu.itemIds[0], mode: 'attach' },
    ]);
    const stored = await cloud.pool.query(`SELECT target_kind, target_id, mode FROM modifier_group_links ORDER BY target_kind, target_id`);
    expect(stored.rows).toEqual(wire.links);

    // a changed link (same target, other mode) is re-checked
    const old2 = await category('Old 2');
    const withVg = await ok(group.modifier_group_id, {
      expected_version: wire.version,
      links: [...wire.links, { target_kind: 'category', target_id: old2, mode: 'attach' }],
    });
    expect((await inject('PATCH', `/v1/admin/categories/${old2}`, { archived: true })).statusCode).toBe(200);
    const added = await refused(
      () =>
        patch(group.modifier_group_id, {
          expected_version: withVg.version,
          links: [
            { target_kind: 'category', target_id: old, mode: 'attach' },
            { target_kind: 'item', target_id: menu.itemIds[0], mode: 'detach' },
            { target_kind: 'variant_group', target_id: 'VG-UNKNOWN', mode: 'attach' },
          ],
        }),
      422,
    );
    expect(added).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'links.2.target_id', reason: 'not_found' } });
    // a changed link (the item link's mode) is re-checked too: an item archived since → 422 archived
    expect((await inject('PATCH', `/v1/admin/menu-items/${menu.itemIds[0]}`, { archived: true })).statusCode).toBe(200);
    const changed = await refused(
      () =>
        patch(group.modifier_group_id, {
          expected_version: withVg.version,
          links: [
            { target_kind: 'category', target_id: old, mode: 'attach' },
            { target_kind: 'item', target_id: menu.itemIds[0], mode: 'detach' },
          ],
        }),
      422,
    );
    expect(changed.details).toMatchObject({ field: 'links.1.target_id', reason: 'archived' });
    // an added link to an archived target → 422 archived; re-sent, unchanged, the links to old2 (archived) and the
    // archived item are not re-checked
    const freshOld = await category('Old 3');
    expect((await inject('PATCH', `/v1/admin/categories/${freshOld}`, { archived: true })).statusCode).toBe(200);
    const archivedAdd = await refused(
      () =>
        patch(group.modifier_group_id, {
          expected_version: withVg.version,
          links: [...withVg.links, { target_kind: 'category', target_id: freshOld, mode: 'attach' }],
        }),
      422,
    );
    expect(archivedAdd.details).toMatchObject({ field: `links.${withVg.links.length}.target_id`, reason: 'archived' });
    const resent = await ok(group.modifier_group_id, { expected_version: withVg.version, name: 'Spice', links: withVg.links });
    expect(resent.links).toEqual(withVg.links);
    // links: [] → every link deleted, none inserted
    const cleared = await patch(group.modifier_group_id, { expected_version: resent.version, links: [] });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().data.modifier_group.links).toEqual([]);
    expect((await counts()).links).toBe(0);
  });

  it('[01c §6.12] sent options linked items checked as on create: not_found, archived, linked_item_not_piece at options.N.linked_item_id', async () => {
    const group = await spice();
    const keep = { option_id: group.options[0]!.option_id, name: 'Mild', price_minor: 0 };
    const fish = await inject('POST', '/v1/admin/menu-items', {
      category_id: menu.categoryIds[0],
      tax_class_id: null,
      name: 'Fish',
      price_minor: 10000,
      sale_unit: 'g',
      serve_mode: 'sync',
      cook_time_ms: 600_000,
      routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId }],
    });
    expect(fish.statusCode, fish.body).toBe(201);
    const fishId = fish.json().data.item.item_id as string;
    for (const [itemId, reason] of [
      ['IT-UNKNOWN', 'not_found'],
      [fishId, 'linked_item_not_piece'],
    ] as const) {
      const error = await refused(
        () => patch(group.modifier_group_id, { expected_version: group.version, options: [keep, { name: 'Side', linked_item_id: itemId }] }),
        422,
      );
      expect(error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'options.1.linked_item_id', reason } });
    }
    const linked = await ok(group.modifier_group_id, {
      expected_version: group.version,
      options: [keep, { name: 'Extra item', linked_item_id: menu.itemIds[0] }],
    });
    expect(linked.options[1]).toMatchObject({ name: 'Extra item', linked_item_id: menu.itemIds[0], price_minor: null });
  });

  it('[01c §6.12] 404 unknown or another tenant group; no-op → 200, nothing written; group name taken → 409; scalar fields', async () => {
    const group = await spice();
    expect((await refused(() => patch('MG-UNKNOWN', { expected_version: group.version, name: 'X' }), 404)).code).toBe('MODIFIER_GROUP_NOT_FOUND');
    await cloud.pool.query(
      `INSERT INTO modifier_groups (tenant_id, modifier_group_id, name, min_choices, max_choices, created_at, updated_at)
       VALUES ($1, 'B-MODIFIER-GROUP-000000001', 'B group', 0, 1, 0, 0)`,
      [f.other.tenantId],
    );
    expect((await refused(() => patch('B-MODIFIER-GROUP-000000001', { expected_version: 'x', name: 'X' }), 404)).code).toBe(
      'MODIFIER_GROUP_NOT_FOUND',
    );

    // the same values again (options and links as stored) → 200 with the stored wire, no write, no audit, no bump
    const before = await everything();
    const same = await patch(group.modifier_group_id, {
      expected_version: group.version,
      name: 'Spice level',
      options: group.options.map(({ option_id, name, price_minor, sort_order }) => ({ option_id, name, price_minor, sort_order })),
      links: [],
    });
    expect(same.statusCode, same.body).toBe(200);
    // tenant-wide check, group lock, options read, links read, branch rows read
    expect(counter.count).toBe(5);
    expect(same.json().data.modifier_group).toEqual(group);
    expect(await everything()).toEqual(before);

    await createModifierGroup(cloud, f, { name: 'Extras', min_choices: 0, max_choices: 1, options: [{ name: 'Raita', price_minor: 100 }] });
    const taken = await refused(() => patch(group.modifier_group_id, { expected_version: group.version, name: 'EXTRAS' }), 409);
    expect(taken).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'modifier_group', name: 'EXTRAS' } });

    const scalars = await ok(group.modifier_group_id, { expected_version: group.version, min_choices: 1, max_choices: 1, sort_order: 4 });
    expect(scalars).toMatchObject({ min_choices: 1, max_choices: 1, sort_order: 4, options: group.options });
  });
});
