import { BranchConfigSnapshotSchemaV2, type CreateDealRequest, type DealBranchWire, type DealWire } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildSnapshot, type SnapshotHeader } from '../../src/modules/config-sync/builder';
import { createDeal } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const HEADER: SnapshotHeader = {
  config_version: 7,
  currency_code: 'PKR',
  tax_enabled: false,
  day_stale_after_hours: 16,
  day_min_gap_hours: 4,
};

type ListedDeal = DealWire & { branches: DealBranchWire[] };

// 01c §6.13 deal list, §6.14 deal create (§3.3 deal rules, V10, V18); V16 a category or tax class used by an
// active deal cannot be archived.
describe('01c deal list (§6.13) and create (§6.14)', () => {
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
    // IT-0000 … IT-0002: piece items in Karahi (CT-1), routed at branch A
    menu = await seedMenu(cloud.pool, f, { items: 3 });
  });

  const inject = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, headers?: Record<string, string>) =>
    cloud.app.inject({ method, url, headers: { ...owner(f).headers, ...headers }, ...(payload !== undefined ? { payload } : {}) });
  const postDeal = (payload: object, headers?: Record<string, string>) => inject('POST', '/v1/admin/deals', payload, headers);
  const list = (query = '', token?: string) => cloud.app.inject({ method: 'GET', url: `/v1/admin/deals${query}`, headers: owner(f, token).headers });
  const item = async (o: object) => {
    const response = await inject('POST', '/v1/admin/menu-items', {
      category_id: menu.categoryIds[0],
      tax_class_id: null,
      price_minor: 10000,
      serve_mode: 'sync',
      cook_time_ms: 600_000,
      routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId }],
      ...o,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().data.item.item_id as string;
  };
  const versions = async () =>
    (
      await cloud.pool.query<{ config_version: string }>(`SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`, [
        f.tenantId,
      ])
    ).rows.map((row) => Number(row.config_version));
  const counts = async () =>
    (
      await cloud.pool.query<{ deals: number; parts: number; choices: number; windows: number; audit: number }>(
        `SELECT (SELECT count(*)::int FROM deals) AS deals, (SELECT count(*)::int FROM deal_parts) AS parts,
                (SELECT count(*)::int FROM deal_part_choices) AS choices,
                (SELECT count(*)::int FROM availability_windows WHERE deal_id IS NOT NULL) AS windows,
                (SELECT count(*)::int FROM config_audit) AS audit`,
      )
    ).rows[0];
  // The call answers `status` with nothing written and no branch bumped; the error is returned.
  const refused = async (call: () => Promise<{ statusCode: number; body: string; json: () => unknown }>, status: number) => {
    const before = { counts: await counts(), versions: await versions() };
    const response = await call();
    expect(response.statusCode, response.body).toBe(status);
    expect(await counts()).toEqual(before.counts);
    expect(await versions()).toEqual(before.versions);
    return (response.json() as { error: { code: string; details: Record<string, unknown> } }).error;
  };
  const issuePaths = (error: { details: Record<string, unknown> }) => (error.details.issues as Array<{ path: string }>).map((i) => i.path);
  const build = async (branchId: string) => {
    const client = await cloud.pool.connect();
    try {
      const tenant = Object.freeze({ tenantId: f.tenantId, branchIds: Object.freeze([...f.branches]) });
      return BranchConfigSnapshotSchemaV2.parse(await buildSnapshot(client, tenant, branchId, HEADER));
    } finally {
      client.release();
    }
  };
  const plainDeal = (name: string, choices: string[] = [menu.itemIds[0]!]): CreateDealRequest => ({
    name,
    category_id: menu.categoryIds[0]!,
    tax_class_id: null,
    price_minor: 100000,
    parts: [{ quantity: 1, choices: choices.map((item_id) => ({ item_id })) }],
  });

  it('[01c #49] Family karahi deal with 3 parts → 201, one audit row, every branch bumped, replay; in no snapshot until §6.16', async () => {
    const karahi = await item({ name: 'Mutton Karahi', sale_unit: 'g', price_minor: 400 });
    const [roghni, plain, cola] = menu.itemIds as [string, string, string];
    const sprite = await item({ name: 'Sprite' });
    const before = await versions();
    const key = '01J00000000000000000000777';
    const body: CreateDealRequest = {
      name: 'Family karahi',
      category_id: menu.categoryIds[0]!,
      tax_class_id: menu.taxClassId,
      description: 'Karahi, naan and a drink',
      sort_order: 3,
      price_minor: 250000,
      availability_windows: [{ start_ms: 43_200_000, end_ms: 82_800_000 }],
      parts: [
        { quantity: 500, choices: [{ item_id: karahi }] },
        {
          quantity: 2,
          sort_order: 1,
          choices: [
            { item_id: roghni, extra_price_minor: 3000, sort_order: 1 },
            { item_id: plain, sort_order: 0 },
          ],
        },
        { quantity: 1, sort_order: 2, choices: [{ item_id: sprite }, { item_id: cola }] },
      ],
    };
    const created = await postDeal(body, { 'idempotency-key': key });
    expect(created.statusCode, created.body).toBe(201);
    // key insert, tenant-wide check, choice items / category / tax class FOR SHARE, deal / parts / choices / windows
    // inserts, audit, 2 bump, key response, prune
    expect(counter.count).toBe(14);
    const wire = created.json().data.deal as DealWire;
    const partIds = wire.parts.map((p) => p.deal_part_id);
    expect(wire).toEqual({
      deal_id: expect.any(String),
      name: 'Family karahi',
      category_id: menu.categoryIds[0],
      tax_class_id: menu.taxClassId,
      description: 'Karahi, naan and a drink',
      sort_order: 3,
      price_minor: 250000,
      archived_at: null,
      availability_windows: [{ start_ms: 43_200_000, end_ms: 82_800_000 }],
      parts: [
        { deal_part_id: expect.any(String), quantity: 500, sort_order: 0, choices: [{ item_id: karahi, extra_price_minor: 0, sort_order: 0 }] },
        {
          deal_part_id: expect.any(String),
          quantity: 2,
          sort_order: 1,
          choices: [
            { item_id: plain, extra_price_minor: 0, sort_order: 0 },
            { item_id: roghni, extra_price_minor: 3000, sort_order: 1 },
          ],
        },
        {
          deal_part_id: expect.any(String),
          quantity: 1,
          sort_order: 2,
          // equal sort_order → by item_id
          choices: [cola, sprite].sort().map((item_id) => ({ item_id, extra_price_minor: 0, sort_order: 0 })),
        },
      ],
      archived_parts: [],
      version: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(new Set(partIds).size).toBe(3);
    expect(await versions()).toEqual(before.map((v) => v + 1));
    const audit = await cloud.pool.query<{ entity: string; entity_id: string; branch_id: string | null; action: string; before: unknown; after: unknown }>(
      `SELECT entity, entity_id, branch_id, action, before, after FROM config_audit WHERE tenant_id = $1 AND entity = 'deal'`,
      [f.tenantId],
    );
    // V15: the deal with its active parts, choices and windows; no version, no archived_parts
    const audited = Object.fromEntries(Object.entries(wire).filter(([key]) => key !== 'version' && key !== 'archived_parts'));
    expect(audit.rows).toEqual([{ entity: 'deal', entity_id: wire.deal_id, branch_id: null, action: 'create', before: null, after: audited }]);
    const stored = await cloud.pool.query(
      `SELECT d.price_minor, d.tax_class_id, (SELECT count(*)::int FROM deal_branches b WHERE b.deal_id = d.deal_id) AS branch_rows,
              (SELECT json_agg(json_build_object('start_ms', w.start_ms, 'end_ms', w.end_ms)) FROM availability_windows w
                WHERE w.tenant_id = d.tenant_id AND w.deal_id = d.deal_id) AS windows
         FROM deals d WHERE d.deal_id = $1`,
      [wire.deal_id],
    );
    expect(stored.rows).toEqual([
      { price_minor: '250000', tax_class_id: menu.taxClassId, branch_rows: 0, windows: [{ start_ms: 43_200_000, end_ms: 82_800_000 }] },
    ]);

    const replay = await postDeal(body, { 'idempotency-key': key });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(created.json());
    expect(await versions()).toEqual(before.map((v) => v + 1));

    // sold at no branch until §6.16 (V10, V11 e)
    for (const branchId of f.branches) expect((await build(branchId)).deals).toEqual([]);

    // no windows, no tax class: no window insert, no tax class lock
    const simple = await postDeal(plainDeal('Naan pair', [roghni, plain]));
    expect(simple.statusCode, simple.body).toBe(201);
    // key insert, tenant-wide check, choice items / category FOR SHARE, deal / parts / choices inserts, audit, 2 bump,
    // key response, prune
    expect(counter.count).toBe(12);
    expect(simple.json().data.deal).toMatchObject({ tax_class_id: null, description: null, sort_order: 0, availability_windows: [] });
  });

  it('[01c #50] one item twice in a part → 400 at parts.0.choices.1.item_id; the same item in two parts → 201', async () => {
    const [naan, raita] = menu.itemIds as [string, string];
    const twice = await refused(
      () => postDeal({ ...plainDeal('Naan pair'), parts: [{ quantity: 2, choices: [{ item_id: naan }, { item_id: naan }] }] }),
      400,
    );
    expect(twice.code).toBe('VALIDATION_FAILED');
    expect(issuePaths(twice)).toContain('parts.0.choices.1.item_id');
    const twoParts = await postDeal({
      ...plainDeal('Two naan'),
      parts: [
        { quantity: 1, choices: [{ item_id: naan }] },
        { quantity: 1, sort_order: 1, choices: [{ item_id: naan }, { item_id: raita, extra_price_minor: 500 }] },
      ],
    });
    expect(twoParts.statusCode, twoParts.body).toBe(201);
    expect((twoParts.json().data.deal as DealWire).parts.map((p) => p.choices.map((c) => c.item_id))).toEqual([[naan], [naan, raita].sort()]);
  });

  it('[01c #51] choices with different sale_unit → 422 choice_unit_mismatch at parts.N.choices; a single choice with an extra → 400', async () => {
    const naan = menu.itemIds[0]!;
    const karahi = await item({ name: 'Mutton Karahi', sale_unit: 'g', price_minor: 400 });
    const mixed = await refused(
      () =>
        postDeal({
          ...plainDeal('Karahi deal'),
          parts: [
            { quantity: 1, choices: [{ item_id: naan }] },
            { quantity: 500, choices: [{ item_id: naan }, { item_id: karahi }] },
          ],
        }),
      422,
    );
    expect(mixed).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'parts.1.choices', reason: 'choice_unit_mismatch' } });
    const extra = await refused(
      () => postDeal({ ...plainDeal('Naan deal'), parts: [{ quantity: 1, choices: [{ item_id: naan, extra_price_minor: 3000 }] }] }),
      400,
    );
    expect(extra.code).toBe('VALIDATION_FAILED');
    expect(issuePaths(extra)).toContain('parts.0.choices.0.extra_price_minor');
  });

  it('[01c §6.14 V18] a weighed choice item → 422 weighed_item_in_deal at parts.0.choices.0.item_id', async () => {
    const fish = await item({ name: 'Fish', sale_unit: 'g', requires_weighing: true, price_minor: 300 });
    const error = await refused(() => postDeal(plainDeal('Fish deal', [fish])), 422);
    expect(error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'parts.0.choices.0.item_id', reason: 'weighed_item_in_deal' } });
  });

  it('[01c §6.14] edges: unknown / archived choice item, category and tax class → 422; name taken → 409; part ids, empty parts → 400', async () => {
    const menuArchived = await seedArchived();
    const naan = menu.itemIds[0]!;
    const cases: Array<[CreateDealRequest, string, string]> = [
      [plainDeal('D', [naan, 'IT-NOPE']), 'parts.0.choices.1.item_id', 'not_found'],
      [plainDeal('D', [menuArchived.itemId]), 'parts.0.choices.0.item_id', 'archived'],
      [{ ...plainDeal('D'), category_id: 'CT-NOPE' }, 'category_id', 'not_found'],
      [{ ...plainDeal('D'), category_id: menuArchived.categoryId }, 'category_id', 'archived'],
      [{ ...plainDeal('D'), tax_class_id: 'TX-NOPE' }, 'tax_class_id', 'not_found'],
      [{ ...plainDeal('D'), tax_class_id: menuArchived.taxClassId }, 'tax_class_id', 'archived'],
    ];
    for (const [body, field, reason] of cases) {
      expect(await refused(() => postDeal(body), 422), field).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field, reason } });
    }
    // another tenant's item is not_found (never leaked)
    const otherItem = 'B-ITEM-1';
    await cloud.pool.query(`INSERT INTO categories (tenant_id, category_id, name, created_at, updated_at) VALUES ($1, 'B-CT-1', 'B', 0, 0)`, [
      f.other.tenantId,
    ]);
    await cloud.pool.query(
      `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, created_at, updated_at)
       VALUES ($1, $2, 'B-CT-1', 'B item', 1000, 'immediate', 60000, 0, 0)`,
      [f.other.tenantId, otherItem],
    );
    expect(await refused(() => postDeal(plainDeal('D', [otherItem])), 422)).toMatchObject({
      details: { field: 'parts.0.choices.0.item_id', reason: 'not_found' },
    });

    await createDeal(cloud, f, plainDeal('Family deal'));
    expect(await refused(() => postDeal(plainDeal('family DEAL')), 409)).toMatchObject({
      code: 'CONFIG_NAME_TAKEN',
      details: { entity: 'deal', name: 'family DEAL' },
    });
    const withId = await refused(() => postDeal({ ...plainDeal('D'), parts: [{ deal_part_id: 'DP-1', quantity: 1, choices: [{ item_id: naan }] }] }), 400);
    expect(issuePaths(withId)).toContain('parts.0.deal_part_id');
    expect((await refused(() => postDeal({ ...plainDeal('D'), parts: [] }), 400)).code).toBe('VALIDATION_FAILED');
  });

  it('[01c #56] archive a category or a tax class used by an active deal → 409 CONFIG_IN_USE; with the deal archived → 200', async () => {
    const category = (await inject('POST', '/v1/admin/categories', { name: 'Deals' })).json().data.category.category_id as string;
    const taxClass = (await inject('POST', '/v1/admin/tax-classes', { name: 'Deal tax', rate_bp: 500 })).json().data.tax_class
      .tax_class_id as string;
    const deal = await createDeal(cloud, f, { ...plainDeal('Family karahi'), category_id: category, tax_class_id: taxClass });

    const categoryRefused = await refused(() => inject('PATCH', `/v1/admin/categories/${category}`, { archived: true }), 409);
    expect(categoryRefused).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { entity: 'category', id: category, used_by: { entity: 'deal', ids: [deal.deal_id] } },
    });
    const taxRefused = await refused(() => inject('PATCH', `/v1/admin/tax-classes/${taxClass}`, { archived: true }), 409);
    expect(taxRefused).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { entity: 'tax_class', id: taxClass, used_by: { entity: 'deal', ids: [deal.deal_id] } },
    });

    // only active deals count (AD-11): the deal archived by SQL until §6.15 (task 30)
    await cloud.pool.query(`UPDATE deals SET archived_at = 1 WHERE deal_id = $1`, [deal.deal_id]);
    const archivedCategory = await inject('PATCH', `/v1/admin/categories/${category}`, { archived: true });
    expect(archivedCategory.statusCode, archivedCategory.body).toBe(200);
    const archivedTax = await inject('PATCH', `/v1/admin/tax-classes/${taxClass}`, { archived: true });
    expect(archivedTax.statusCode, archivedTax.body).toBe(200);
  });

  it('[01c #78] list: 5 statements for 1 and for 20 deals; branches only for allowed branches; archived parts under archived_parts', async () => {
    const [a, b] = [...f.branches].sort() as [string, string, string];
    const naan = menu.itemIds[0]!;
    const deal = await createDeal(cloud, f, { ...plainDeal('Family karahi'), availability_windows: [{ start_ms: 60_000, end_ms: 120_000 }] });
    // a sold row at a (task 31's PUT writes these) and an archived part, by SQL
    await cloud.pool.query(
      `INSERT INTO deal_branches (tenant_id, branch_id, deal_id, price_minor_override, updated_at) VALUES ($1, $2, $3, 300000, 0)`,
      [f.tenantId, a, deal.deal_id],
    );
    await cloud.pool.query(
      `INSERT INTO deal_parts (tenant_id, deal_part_id, deal_id, quantity, sort_order, archived_at) VALUES ($1, 'DP-OLD', $2, 1, 9, 5)`,
      [f.tenantId, deal.deal_id],
    );
    await cloud.pool.query(`INSERT INTO deal_part_choices (tenant_id, deal_part_id, item_id) VALUES ($1, 'DP-OLD', $2)`, [f.tenantId, naan]);

    const one = await list('', f.tokenFor([a, b]));
    expect(one.statusCode, one.body).toBe(200);
    // coversEveryBranch, deals, parts with choices, windows = ANY, branch rows = ANY
    expect(counter.count).toBe(5);
    const data = one.json().data as { can_edit_tenant: boolean; deals: ListedDeal[] };
    expect(data.can_edit_tenant).toBe(true);
    expect(data.deals).toHaveLength(1);
    const listed = data.deals[0]!;
    expect(listed).toEqual({
      ...deal,
      archived_parts: [{ deal_part_id: 'DP-OLD' }],
      branches: [
        { branch_id: a, is_sold: true, price_minor_override: 300000, version: expect.stringMatching(/^[0-9a-f]{64}$/) },
        { branch_id: b, is_sold: false, price_minor_override: null, version: expect.stringMatching(/^[0-9a-f]{64}$/) },
      ],
    });
    // the archived part is not hashed: the version is the created one
    expect(listed.version).toBe(deal.version);
    expect(listed.branches[0]!.version).not.toBe(listed.branches[1]!.version);

    for (let i = 0; i < 19; i++) {
      await createDeal(cloud, f, { ...plainDeal(`Deal ${String(i).padStart(2, '0')}`), sort_order: 19 - i });
    }
    const twenty = await list();
    expect(twenty.statusCode).toBe(200);
    expect(counter.count).toBe(5);
    const deals = (twenty.json().data as { deals: ListedDeal[] }).deals;
    expect(deals).toHaveLength(20);
    // by sort_order, then id
    expect(deals.map((d) => d.sort_order)).toEqual([0, ...Array.from({ length: 19 }, (_, i) => i + 1)]);
    expect(deals.every((d) => d.branches.map((x) => x.branch_id).join() === [...f.branches].sort().join())).toBe(true);

    // status=archived lists the archived deals only (as §6.6 / §6.10, AD-30)
    await cloud.pool.query(`UPDATE deals SET archived_at = 7 WHERE deal_id = $1`, [deal.deal_id]);
    const archived = await list('?status=archived');
    expect(archived.statusCode).toBe(200);
    expect(counter.count).toBe(5);
    expect((archived.json().data as { deals: ListedDeal[] }).deals.map((d) => [d.deal_id, d.archived_at])).toEqual([[deal.deal_id, 7]]);
    expect((await list()).json().data.deals).toHaveLength(19);
  });

  // One archived item, category and tax class of tenant A, by SQL.
  async function seedArchived(): Promise<{ itemId: string; categoryId: string; taxClassId: string }> {
    await cloud.pool.query(
      `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, archived_at, created_at, updated_at)
       VALUES ($1, 'IT-X', 'CT-1', 'Old item', 1000, 'immediate', 60000, 1, 0, 0)`,
      [f.tenantId],
    );
    await cloud.pool.query(`INSERT INTO categories (tenant_id, category_id, name, archived_at, created_at, updated_at) VALUES ($1, 'CT-X', 'Old', 1, 0, 0)`, [
      f.tenantId,
    ]);
    await cloud.pool.query(
      `INSERT INTO tax_classes (tenant_id, tax_class_id, name, rate_bp, archived_at, created_at, updated_at) VALUES ($1, 'TX-X', 'Old tax', 500, 1, 0, 0)`,
      [f.tenantId],
    );
    return { itemId: 'IT-X', categoryId: 'CT-X', taxClassId: 'TX-X' };
  }
});
