import type pg from 'pg';
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
  // §12.7 T1: the statements of the last handler, as sent (pgCounter counts only); reset with the counter.
  let statements: string[] = [];

  beforeAll(async () => {
    cloud = await createTestCloud({
      testHooks: {
        handlerStart: () => {
          counter.reset();
          statements = [];
        },
      },
    });
    counter = pgCounter(cloud.pool);
    const logged = new WeakSet<pg.PoolClient>();
    cloud.pool.on('acquire', (client) => {
      if (logged.has(client)) return;
      logged.add(client);
      const original = client.query.bind(client) as (...args: unknown[]) => unknown;
      (client as { query: unknown }).query = (...args: unknown[]) => {
        const first = args[0];
        statements.push(typeof first === 'string' ? first : ((first as { text?: string } | undefined)?.text ?? ''));
        return original(...args);
      };
    });
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
    // tenant-wide check, group lock, options read, links read, option names (R4), group update, options upsert,
    // archive omitted, audit, 2 bump, branch rows read
    expect(counter.count).toBe(12);
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
    // tenant-wide check, group lock, options read, links read, item FOR SHARE (the added link only), effective-set
    // read (R5), group update, links delete, links insert, audit, 2 bump, branch rows read
    expect(counter.count).toBe(13);
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

  // ------------------------------------------------------------------------------ merged-row rules R1–R6 (task 25)

  const item = async (name: string, o: object = {}) => {
    const response = await inject('POST', '/v1/admin/menu-items', {
      category_id: menu.categoryIds[0],
      tax_class_id: null,
      name,
      price_minor: 10000,
      sale_unit: 'piece',
      serve_mode: 'sync',
      cook_time_ms: 600_000,
      routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId }],
      ...o,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().data.item.item_id as string;
  };
  const patchItem = (id: string, payload: object) => inject('PATCH', `/v1/admin/menu-items/${id}`, payload);
  const okItem = async (id: string, payload: object) => {
    const response = await patchItem(id, payload);
    expect(response.statusCode, response.body).toBe(200);
  };
  const itemRow = async (id: string) =>
    (
      await cloud.pool.query<{ sale_unit: string; requires_weighing: boolean; archived: boolean }>(
        `SELECT sale_unit, requires_weighing, archived_at IS NOT NULL AS archived FROM menu_items WHERE item_id = $1`,
        [id],
      )
    ).rows[0];
  const groupArchived = async (id: string) =>
    (await cloud.pool.query<{ archived: boolean }>(`SELECT archived_at IS NOT NULL AS archived FROM modifier_groups WHERE modifier_group_id = $1`, [id]))
      .rows[0]!.archived;
  const linkedItemLocks = () => statements.filter((text) => /FROM menu_items/.test(text) && /FOR SHARE/.test(text));

  it('[01c #48] PATCH min_choices alone above the merged options capacity → 422 choices_unsatisfiable (R2)', async () => {
    const fresh = await createModifierGroup(cloud, f, {
      name: 'Sides',
      min_choices: 0,
      max_choices: 3,
      options: [
        { name: 'Raita', price_minor: 100 },
        { name: 'Salad', price_minor: 100 },
      ],
    });
    const unsatisfiable = await refused(() => patch(fresh.modifier_group_id, { expected_version: fresh.version, min_choices: 3 }), 422);
    expect(unsatisfiable).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'min_choices', reason: 'choices_unsatisfiable' } });
    // the merged options count: sending options whose Σ max_quantity covers the stored min_choices 3 → 200
    const raised = await ok(fresh.modifier_group_id, {
      expected_version: fresh.version,
      min_choices: 3,
      options: fresh.options.map(({ option_id, name, price_minor }) => ({ option_id, name, price_minor, max_quantity: 2 })),
    });
    expect(raised.min_choices).toBe(3);
    // and options that no longer cover it → 422
    const shrunk = await refused(
      () => patch(fresh.modifier_group_id, { expected_version: raised.version, options: [{ option_id: fresh.options[0]!.option_id, name: 'Raita', price_minor: 100, max_quantity: 2 }] }),
      422,
    );
    expect(shrunk.details).toMatchObject({ field: 'min_choices', reason: 'choices_unsatisfiable' });
  });

  it('[01c §6.12 R1] merged min_choices > max_choices → 400 at the sent field (not the DB CHECK); R3 defaults_exceed_max on the merged max', async () => {
    const group = await spice({ min_choices: 1, max_choices: 2 });
    const minSent = await refused(() => patch(group.modifier_group_id, { expected_version: group.version, min_choices: 3 }), 400);
    expect(minSent.code).toBe('VALIDATION_FAILED');
    expect(issuePaths(minSent)).toEqual(['min_choices']);
    const maxSent = await refused(() => patch(group.modifier_group_id, { expected_version: group.version, max_choices: 1, min_choices: 2 }), 400);
    expect(issuePaths(maxSent)).toEqual(['min_choices']);
    const onlyMax = await createModifierGroup(cloud, f, {
      name: 'Two',
      min_choices: 2,
      max_choices: 2,
      options: [
        { name: 'A', price_minor: 0 },
        { name: 'B', price_minor: 0 },
      ],
    });
    expect(issuePaths(await refused(() => patch(onlyMax.modifier_group_id, { expected_version: onlyMax.version, max_choices: 1 }), 400))).toEqual([
      'max_choices',
    ]);

    // R3: two defaults stored, max lowered to 1 → 422 defaults_exceed_max at options
    const defaults = await createModifierGroup(cloud, f, {
      name: 'Defaults',
      min_choices: 0,
      max_choices: 2,
      options: [
        { name: 'A', price_minor: 0, is_default: true },
        { name: 'B', price_minor: 0, is_default: true },
      ],
    });
    const exceeded = await refused(() => patch(defaults.modifier_group_id, { expected_version: defaults.version, max_choices: 1 }), 422);
    expect(exceeded).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'options', reason: 'defaults_exceed_max' } });
    // one default left in the sent options → 200
    const fixed = await ok(defaults.modifier_group_id, {
      expected_version: defaults.version,
      max_choices: 1,
      options: defaults.options.map(({ option_id, name }, i) => ({ option_id, name, price_minor: 0, is_default: i === 0 })),
    });
    expect(fixed.max_choices).toBe(1);
  });

  it('[01c #112] a PATCH whose body is only expected_version → 400', async () => {
    const group = await spice();
    const error = await refused(() => patch(group.modifier_group_id, { expected_version: group.version }), 400);
    expect(error.code).toBe('VALIDATION_FAILED');
  });

  it('[01c #116] options "Raita" and "raita" in one group → 409 CONFIG_NAME_TAKEN modifier_option on PATCH (R4); an archived option name is free', async () => {
    const group = await spice();
    const [mild, hot] = group.options;
    const error = await refused(
      () =>
        patch(group.modifier_group_id, {
          expected_version: group.version,
          options: [
            { option_id: mild!.option_id, name: 'Raita', price_minor: 0 },
            { option_id: hot!.option_id, name: 'raita', price_minor: 50 },
          ],
        }),
      409,
    );
    expect(error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'modifier_option', name: 'raita' } });
    // Hot archived (omitted), then a new active option named "hot" → 200: only active options count
    const renamed = await ok(group.modifier_group_id, {
      expected_version: group.version,
      options: [
        { option_id: mild!.option_id, name: 'Mild', price_minor: 0 },
        { name: 'HOT', price_minor: 70 },
      ],
    });
    expect(renamed.archived_options).toEqual([{ option_id: hot!.option_id, name: 'Hot' }]);
  });

  it('[01c §6.12 R5] links sent → effective-set limit (V8, 20); the group own stored links are replaced, not counted with the new ones', async () => {
    const naan = await item('Naan');
    const others = [];
    for (let i = 0; i < 20; i += 1) {
      others.push(
        await createModifierGroup(cloud, f, {
          name: `G${String(i).padStart(2, '0')}`,
          min_choices: 0,
          max_choices: 1,
          options: [{ name: 'Yes', price_minor: 0 }],
          links: [{ target_kind: 'item', target_id: naan, mode: 'attach' }],
        }),
      );
    }
    const karahi = menu.categoryIds[0]!;
    // attach on Naan's category, detach on Naan: Naan keeps 20 effective groups
    const group = await spice({
      links: [
        { target_kind: 'category', target_id: karahi, mode: 'attach' },
        { target_kind: 'item', target_id: naan, mode: 'detach' },
      ],
    });
    // dropping the detach would make Bread Naan's 21st group → 422 at links
    const error = await refused(
      () => patch(group.modifier_group_id, { expected_version: group.version, links: [{ target_kind: 'category', target_id: karahi, mode: 'attach' }] }),
      422,
    );
    expect(error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'links', reason: 'too_many_groups' } });
    // the same links again with a rename → 200 (the stored links are not counted beside the sent ones)
    const same = await ok(group.modifier_group_id, { expected_version: group.version, name: 'Spice', links: group.links });
    expect(same.links).toEqual(group.links);
    expect(others).toHaveLength(20);
  });

  it('[01c #125] Naan linked by active Bread: §6.5 R10 refuses the unit change; §6.12 R6 refuses restoring Bread onto a non-piece or archived Naan (T1 steps)', async () => {
    const naan = await item('Naan');
    let bread = await createModifierGroup(cloud, f, {
      name: 'Bread',
      min_choices: 0,
      max_choices: 2,
      options: [
        { name: 'Naan', linked_item_id: naan, sort_order: 0 },
        { name: 'Butter', price_minor: 50, sort_order: 1 },
      ],
    });
    const [naanOption, butter] = bread.options;
    const inUse = { code: 'CONFIG_IN_USE', details: { entity: 'menu_item', id: naan, used_by: { entity: 'modifier_group', ids: [bread.modifier_group_id] } } };
    const restore = () => patch(bread.modifier_group_id, { expected_version: bread.version, archived: false });
    const restoreRefused = async (reason: string) => {
      const error = await refused(restore, 422);
      expect(error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'options.0.linked_item_id', reason } });
      expect(await groupArchived(bread.modifier_group_id)).toBe(true);
    };

    // (1) Naan → g → 409 modifier group, nothing written
    expect(await refused(() => patchItem(naan, { sale_unit: 'g' }), 409)).toMatchObject(inUse);
    expect(await itemRow(naan)).toEqual({ sale_unit: 'piece', requires_weighing: false, archived: false });
    // (2) weighed and g → the same 409
    expect(await refused(() => patchItem(naan, { requires_weighing: true, sale_unit: 'g' }), 409)).toMatchObject(inUse);
    expect(await itemRow(naan)).toEqual({ sale_unit: 'piece', requires_weighing: false, archived: false });
    // (3) the linking option archived → the unit change 200
    bread = await ok(bread.modifier_group_id, { expected_version: bread.version, options: [{ option_id: butter!.option_id, name: 'Butter', price_minor: 50, sort_order: 1 }] });
    expect(bread.archived_options).toEqual([{ option_id: naanOption!.option_id, name: 'Naan' }]);
    await okItem(naan, { sale_unit: 'g' });
    // (4) Naan back to piece, the option restored → 200
    await okItem(naan, { sale_unit: 'piece' });
    bread = await ok(bread.modifier_group_id, {
      expected_version: bread.version,
      options: [
        { option_id: naanOption!.option_id, name: 'Naan', linked_item_id: naan, sort_order: 0 },
        { option_id: butter!.option_id, name: 'Butter', price_minor: 50, sort_order: 1 },
      ],
    });
    expect(bread.options.map((o) => o.option_id)).toEqual([naanOption!.option_id, butter!.option_id]);
    // (5) Bread archived → Naan g → 200
    bread = await ok(bread.modifier_group_id, { expected_version: bread.version, archived: true });
    await okItem(naan, { sale_unit: 'g' });
    // (6) restore Bread → 422 linked_item_not_piece at options.0, Bread still archived; the stored linked item is
    // locked FOR SHARE (R6 runs: a restore without options)
    await restoreRefused('linked_item_not_piece');
    expect(linkedItemLocks()).toHaveLength(1);
    // (7) Naan weighed (still g) → restore → 422 linked_item_not_piece
    await okItem(naan, { requires_weighing: true });
    expect(await itemRow(naan)).toEqual({ sale_unit: 'g', requires_weighing: true, archived: false });
    await restoreRefused('linked_item_not_piece');
    // (8) Naan not weighed, piece, then archived → restore → 422 archived
    await okItem(naan, { requires_weighing: false, sale_unit: 'piece' });
    await okItem(naan, { archived: true });
    expect(await itemRow(naan)).toEqual({ sale_unit: 'piece', requires_weighing: false, archived: true });
    await restoreRefused('archived');
    // (9) Naan archived and g → 422 archived (archived checked first, T1)
    await okItem(naan, { sale_unit: 'g' });
    expect(await itemRow(naan)).toEqual({ sale_unit: 'g', requires_weighing: false, archived: true });
    await restoreRefused('archived');
    // (10) Naan restored as an active piece item → restore Bread 200
    await okItem(naan, { sale_unit: 'piece', archived: false });
    expect(await itemRow(naan)).toEqual({ sale_unit: 'piece', requires_weighing: false, archived: false });
    const restored = await ok(bread.modifier_group_id, { expected_version: bread.version, archived: false });
    expect(restored.archived_at).toBeNull();
    expect(restored.options.map((o) => o.linked_item_id)).toEqual([naan, null]);
  });

  it('[01c §12.7 T1] a rename of an active group takes no FOR SHARE on its linked items; R6 on a restore indexes the stored active options by sort_order, then option_id', async () => {
    const naan = await item('Naan');
    const roti = await item('Roti');
    const bread = await createModifierGroup(cloud, f, {
      name: 'Bread',
      min_choices: 0,
      max_choices: 3,
      options: [
        { name: 'Butter', price_minor: 50, sort_order: 0 },
        { name: 'Roti', linked_item_id: roti, sort_order: 1 },
        { name: 'Naan', linked_item_id: naan, sort_order: 1 },
      ],
    });
    const renamed = await patch(bread.modifier_group_id, { expected_version: bread.version, name: 'Breads' });
    expect(renamed.statusCode, renamed.body).toBe(200);
    // tenant-wide check, group lock, options read, links read, group update, audit, 2 bump, branch rows read
    expect(counter.count).toBe(9);
    expect(statements.filter((text) => /menu_items/.test(text))).toEqual([]);
    const archived = await ok(bread.modifier_group_id, { expected_version: renamed.json().data.modifier_group.version, archived: true });

    // of the two options at sort_order 1, the one with the later option_id is index 2
    const tied = bread.options.filter((o) => o.sort_order === 1).sort((a, b) => (a.option_id < b.option_id ? -1 : 1));
    await okItem(tied[1]!.linked_item_id!, { sale_unit: 'g' });
    const error = await refused(() => patch(bread.modifier_group_id, { expected_version: archived.version, archived: false }), 422);
    expect(error.details).toEqual({ field: 'options.2.linked_item_id', reason: 'linked_item_not_piece' });
    // both stored linked items in one = ANY lock, by item_id
    expect(linkedItemLocks()).toHaveLength(1);
  });
});
