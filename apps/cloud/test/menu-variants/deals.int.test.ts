import { canonicalJson, sha256hex } from '@pos/domain/hash';
import { BranchConfigSnapshotSchemaV4, type CreateDealRequest, type DealBranchWire, type DealWire, type PatchDealRequest } from '@pos/events';
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

// 01c §6.13 deal list, §6.14 deal create (§3.3 deal rules, V10, V18), §6.15 deal PATCH (V14 parts upsert, m3,
// V18); §6.5 R8 (weighed item in a deal, item side); V16 a category or tax class used by an active deal cannot be
// archived.
describe('01c deal list (§6.13), create (§6.14) and PATCH (§6.15)', () => {
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
  // Every deal, part, choice and deal window row of tenant A, as stored.
  const dealRows = async () =>
    (
      await cloud.pool.query<{ rows: unknown }>(
        `SELECT json_build_object(
                  'deals', (SELECT json_agg(d ORDER BY d.deal_id) FROM deals d WHERE d.tenant_id = $1),
                  'parts', (SELECT json_agg(p ORDER BY p.deal_part_id) FROM deal_parts p WHERE p.tenant_id = $1),
                  'choices', (SELECT json_agg(c ORDER BY c.deal_part_id, c.item_id) FROM deal_part_choices c WHERE c.tenant_id = $1),
                  'windows', (SELECT json_agg(w ORDER BY w.window_id) FROM availability_windows w WHERE w.tenant_id = $1 AND w.deal_id IS NOT NULL)
                ) AS rows`,
        [f.tenantId],
      )
    ).rows[0]!.rows;
  // The call answers `status` with nothing written and no branch bumped; the error is returned.
  const refused = async (call: () => Promise<{ statusCode: number; body: string; json: () => unknown }>, status: number) => {
    const before = { counts: await counts(), versions: await versions(), rows: await dealRows() };
    const response = await call();
    expect(response.statusCode, response.body).toBe(status);
    expect(await counts()).toEqual(before.counts);
    expect(await versions()).toEqual(before.versions);
    expect(await dealRows()).toEqual(before.rows);
    return (response.json() as { error: { code: string; details: Record<string, unknown> } }).error;
  };
  const issuePaths = (error: { details: Record<string, unknown> }) => (error.details.issues as Array<{ path: string }>).map((i) => i.path);
  const build = async (branchId: string) => {
    const client = await cloud.pool.connect();
    try {
      const tenant = Object.freeze({ tenantId: f.tenantId, branchIds: Object.freeze([...f.branches]) });
      return BranchConfigSnapshotSchemaV4.parse(await buildSnapshot(client, tenant, branchId, HEADER));
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

  const patchDeal = (dealId: string, payload: object) => inject('PATCH', `/v1/admin/deals/${dealId}`, payload);
  const patched = async (dealId: string, payload: PatchDealRequest) => {
    const response = await patchDeal(dealId, payload);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.deal as DealWire;
  };
  const patchItem = async (itemId: string, payload: object) => {
    const response = await inject('PATCH', `/v1/admin/menu-items/${itemId}`, payload);
    expect(response.statusCode, response.body).toBe(200);
  };
  const storedParts = async (dealId: string) =>
    (
      await cloud.pool.query<{ deal_part_id: string; quantity: number; archived_at: string | null }>(
        `SELECT deal_part_id, quantity, archived_at FROM deal_parts WHERE tenant_id = $1 AND deal_id = $2 ORDER BY deal_part_id`,
        [f.tenantId, dealId],
      )
    ).rows;
  const storedChoices = async (dealPartId: string) =>
    (
      await cloud.pool.query<{ item_id: string; extra_price_minor: string; sort_order: number }>(
        `SELECT item_id, extra_price_minor, sort_order FROM deal_part_choices WHERE tenant_id = $1 AND deal_part_id = $2 ORDER BY item_id`,
        [f.tenantId, dealPartId],
      )
    ).rows;
  const dealAudit = async (dealId: string) =>
    (
      await cloud.pool.query<{ action: string; before: unknown; after: unknown }>(
        `SELECT action, before, after FROM config_audit WHERE tenant_id = $1 AND entity = 'deal' AND entity_id = $2 ORDER BY at, audit_id`,
        [f.tenantId, dealId],
      )
    ).rows;
  // V15: the audited deal is the wire without version and archived_parts
  const auditedDeal = (wire: DealWire) => Object.fromEntries(Object.entries(wire).filter(([key]) => key !== 'version' && key !== 'archived_parts'));
  const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

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
      archived_parts: [{ deal_part_id: 'DP-OLD', quantity: 1, choices: [{ item_id: naan }] }],
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

  // ------------------------------------------------------------------------------------------- §6.15 deal PATCH

  it('[01c #52] keeps P1 (quantity changed), omits P2, adds P3 → P1 same id, P2 archived, P3 new ULID; sending P2 again → restored, same id', async () => {
    const [naan, roghni, raita] = menu.itemIds as [string, string, string];
    const deal = await createDeal(cloud, f, {
      ...plainDeal('Family karahi'),
      parts: [
        { quantity: 1, choices: [{ item_id: naan }] },
        { quantity: 2, sort_order: 1, choices: [{ item_id: roghni }] },
      ],
    });
    const [p1, p2] = deal.parts.map((p) => p.deal_part_id) as [string, string];
    const before = await versions();
    const first = await patchDeal(deal.deal_id, {
      expected_version: deal.version,
      parts: [
        { deal_part_id: p1, quantity: 3, choices: [{ item_id: naan }] },
        { quantity: 1, sort_order: 2, choices: [{ item_id: raita }] },
      ],
    });
    expect(first.statusCode, first.body).toBe(200);
    // tenant-wide check, deal lock, parts read, windows read, choice items FOR SHARE, deal update, sent parts'
    // choices delete, parts upsert, archive omitted, choices insert, audit, 2 bump
    expect(counter.count).toBe(13);
    const wire = first.json().data.deal as DealWire;
    const p3 = wire.parts[1]!.deal_part_id;
    expect(wire.parts).toEqual([
      { deal_part_id: p1, quantity: 3, sort_order: 0, choices: [{ item_id: naan, extra_price_minor: 0, sort_order: 0 }] },
      { deal_part_id: p3, quantity: 1, sort_order: 2, choices: [{ item_id: raita, extra_price_minor: 0, sort_order: 0 }] },
    ]);
    expect(p3).toMatch(ULID);
    expect([p1, p2]).not.toContain(p3);
    expect(wire.archived_parts).toEqual([{ deal_part_id: p2, quantity: 2, choices: [{ item_id: roghni }] }]);
    expect(wire.version).not.toBe(deal.version);
    expect(await versions()).toEqual(before.map((v) => v + 1));
    expect((await storedParts(deal.deal_id)).map((p) => [p.deal_part_id, p.quantity, p.archived_at !== null])).toEqual(
      [
        [p1, 3, false],
        [p2, 2, true],
        [p3, 1, false],
      ].sort((a, b) => (a[0]! < b[0]! ? -1 : 1)),
    );

    const restored = await patched(deal.deal_id, {
      expected_version: wire.version,
      parts: [
        { deal_part_id: p1, quantity: 3, choices: [{ item_id: naan }] },
        { deal_part_id: p2, quantity: 2, sort_order: 1, choices: [{ item_id: roghni }] },
        { deal_part_id: p3, quantity: 1, sort_order: 2, choices: [{ item_id: raita }] },
      ],
    });
    expect(restored.parts.map((p) => p.deal_part_id)).toEqual([p1, p2, p3]);
    expect(restored.archived_parts).toEqual([]);
    expect((await storedParts(deal.deal_id)).every((p) => p.archived_at === null)).toBe(true);
    expect((await counts())!.parts).toBe(3);
    expect((await dealAudit(deal.deal_id)).map((row) => row.action)).toEqual(['create', 'update', 'update']);
  });

  it('[01c #105] m3: omitting P2 keeps its row (archived_at, same ULID) and its choices; the sent parts’ choices are rewritten; sending P2’s id restores it with its choices', async () => {
    const [naan, roghni, raita] = menu.itemIds as [string, string, string];
    const deal = await createDeal(cloud, f, {
      ...plainDeal('Family karahi'),
      parts: [
        { quantity: 2, choices: [{ item_id: naan }, { item_id: roghni, extra_price_minor: 3000, sort_order: 1 }] },
        { quantity: 1, sort_order: 1, choices: [{ item_id: raita }] },
      ],
    });
    const [p1, p2] = deal.parts.map((p) => p.deal_part_id) as [string, string];
    const wire = await patched(deal.deal_id, {
      expected_version: deal.version,
      parts: [{ deal_part_id: p1, quantity: 2, choices: [{ item_id: naan }, { item_id: raita, extra_price_minor: 500, sort_order: 1 }] }],
    });
    expect(wire.parts).toEqual([
      {
        deal_part_id: p1,
        quantity: 2,
        sort_order: 0,
        choices: [
          { item_id: naan, extra_price_minor: 0, sort_order: 0 },
          { item_id: raita, extra_price_minor: 500, sort_order: 1 },
        ],
      },
    ]);
    // P1's choices rewritten (Roghni gone); P2 kept with archived_at and its choices
    expect(await storedChoices(p1)).toEqual(
      [
        { item_id: naan, extra_price_minor: '0', sort_order: 0 },
        { item_id: raita, extra_price_minor: '500', sort_order: 1 },
      ].sort((a, b) => (a.item_id < b.item_id ? -1 : 1)),
    );
    expect(await storedChoices(p2)).toEqual([{ item_id: raita, extra_price_minor: '0', sort_order: 0 }]);
    expect((await storedParts(deal.deal_id)).find((p) => p.deal_part_id === p2)).toEqual({
      deal_part_id: p2,
      quantity: 1,
      archived_at: String(cloud.clock.branchNow()),
    });
    expect(wire.archived_parts).toEqual([{ deal_part_id: p2, quantity: 1, choices: [{ item_id: raita }] }]);

    const restored = await patched(deal.deal_id, {
      expected_version: wire.version,
      parts: [
        { deal_part_id: p1, quantity: 2, choices: [{ item_id: naan }, { item_id: raita, extra_price_minor: 500, sort_order: 1 }] },
        { deal_part_id: p2, quantity: 1, sort_order: 1, choices: [{ item_id: raita }] },
      ],
    });
    expect(restored.parts[1]).toEqual({ deal_part_id: p2, quantity: 1, sort_order: 1, choices: [{ item_id: raita, extra_price_minor: 0, sort_order: 0 }] });
    expect(await storedChoices(p2)).toEqual([{ item_id: raita, extra_price_minor: '0', sort_order: 0 }]);
    expect(restored.archived_parts).toEqual([]);
  });

  it('[01c #129] archived_parts carries quantity and choices in sort_order (then item_id), not hashed; restoring the part is unchanged', async () => {
    // naan sorts after roghni by item_id, so sort_order (naan 1, roghni 2) is not the item_id order
    const [roghni, naan, karahi] = menu.itemIds as [string, string, string];
    const deal = await createDeal(cloud, f, {
      ...plainDeal('Family karahi'),
      parts: [
        { quantity: 1, choices: [{ item_id: karahi }] },
        {
          quantity: 4,
          sort_order: 1,
          choices: [
            { item_id: roghni, extra_price_minor: 2000, sort_order: 2 },
            { item_id: naan, sort_order: 1 },
          ],
        },
      ],
    });
    const [karahiPart, naanPart] = deal.parts.map((p) => p.deal_part_id) as [string, string];
    const naanChoices = [
      { item_id: naan, extra_price_minor: 0, sort_order: 1 },
      { item_id: roghni, extra_price_minor: 2000, sort_order: 2 },
    ];
    expect(deal.parts[1]).toEqual({ deal_part_id: naanPart, quantity: 4, sort_order: 1, choices: naanChoices });

    const omitted = await patched(deal.deal_id, {
      expected_version: deal.version,
      parts: [{ deal_part_id: karahiPart, quantity: 1, choices: [{ item_id: karahi }] }],
    });
    const archivedNaan = { deal_part_id: naanPart, quantity: 4, choices: [{ item_id: naan }, { item_id: roghni }] };
    expect(omitted.archived_parts).toEqual([archivedNaan]);

    const listed = ((await list()).json().data as { deals: ListedDeal[] }).deals.find((d) => d.deal_id === deal.deal_id)!;
    expect(listed.archived_parts).toEqual([archivedNaan]);
    // §5.4: the version is the hash of the version input alone (no archived_parts)
    const versionInput = {
      deal_id: listed.deal_id,
      name: listed.name,
      category_id: listed.category_id,
      tax_class_id: listed.tax_class_id,
      description: listed.description,
      sort_order: listed.sort_order,
      price_minor: listed.price_minor,
      archived: false,
      availability_windows: listed.availability_windows,
      parts: listed.parts,
    };
    expect(listed.version).toBe(sha256hex(canonicalJson(versionInput)));
    expect(listed.version).toBe(omitted.version);
    // a no-op PATCH with the listed version answers the same deal, nothing written
    const before = await dealRows();
    const noop = await patched(deal.deal_id, { expected_version: listed.version, name: 'Family karahi' });
    expect(noop).toEqual(omitted);
    expect(await dealRows()).toEqual(before);

    // restore from what archived_parts carries: same id, quantity and choices
    const restored = await patched(deal.deal_id, {
      expected_version: listed.version,
      parts: [
        { deal_part_id: karahiPart, quantity: 1, choices: [{ item_id: karahi }] },
        {
          deal_part_id: archivedNaan.deal_part_id,
          quantity: archivedNaan.quantity,
          sort_order: 1,
          choices: [
            { item_id: naan, sort_order: 1 },
            { item_id: roghni, extra_price_minor: 2000, sort_order: 2 },
          ],
        },
      ],
    });
    expect(restored.parts[1]).toEqual({ deal_part_id: naanPart, quantity: 4, sort_order: 1, choices: naanChoices });
    expect(restored.archived_parts).toEqual([]);
    expect(restored.version).toBe(deal.version);
  });

  it('[01c #53] part id of another deal → 422 not_found; stale → 409 CONFIG_STALE; body only version → 400; repeated deal_part_id → 400; unknown deal → 404', async () => {
    const naan = menu.itemIds[0]!;
    const deal = await createDeal(cloud, f, plainDeal('Family karahi'));
    const other = await createDeal(cloud, f, plainDeal('Lunch deal'));
    const own = deal.parts[0]!.deal_part_id;
    const foreign = other.parts[0]!.deal_part_id;
    for (const [id, i] of [
      [foreign, 1],
      ['DP-NOPE', 1],
    ] as const) {
      const error = await refused(
        () =>
          patchDeal(deal.deal_id, {
            expected_version: deal.version,
            parts: [
              { deal_part_id: own, quantity: 1, choices: [{ item_id: naan }] },
              { deal_part_id: id, quantity: 1, choices: [{ item_id: naan }] },
            ],
          }),
        422,
      );
      expect(error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: `parts.${i}.deal_part_id`, reason: 'not_found' } });
    }
    // another tenant's part id is not_found too, never leaked
    await cloud.pool.query(`INSERT INTO categories (tenant_id, category_id, name, created_at, updated_at) VALUES ($1, 'B-CT-1', 'B', 0, 0)`, [
      f.other.tenantId,
    ]);
    await cloud.pool.query(
      `INSERT INTO deals (tenant_id, deal_id, category_id, name, price_minor, created_at, updated_at) VALUES ($1, 'B-DEAL', 'B-CT-1', 'B', 0, 0, 0)`,
      [f.other.tenantId],
    );
    await cloud.pool.query(`INSERT INTO deal_parts (tenant_id, deal_part_id, deal_id, quantity) VALUES ($1, 'B-PART', 'B-DEAL', 1)`, [
      f.other.tenantId,
    ]);
    expect(
      await refused(
        () => patchDeal(deal.deal_id, { expected_version: deal.version, parts: [{ deal_part_id: 'B-PART', quantity: 1, choices: [{ item_id: naan }] }] }),
        422,
      ),
    ).toMatchObject({ details: { field: 'parts.0.deal_part_id', reason: 'not_found' } });

    const stale = await refused(() => patchDeal(deal.deal_id, { expected_version: 'stale', name: 'Family deal' }), 409);
    expect(stale).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'deal', id: deal.deal_id } });
    // a stale no-op is stale too
    expect((await refused(() => patchDeal(deal.deal_id, { expected_version: 'stale', name: deal.name }), 409)).code).toBe('CONFIG_STALE');
    expect((await refused(() => patchDeal(deal.deal_id, { expected_version: deal.version }), 400)).code).toBe('VALIDATION_FAILED');
    const repeated = await refused(
      () =>
        patchDeal(deal.deal_id, {
          expected_version: deal.version,
          parts: [
            { deal_part_id: own, quantity: 1, choices: [{ item_id: naan }] },
            { deal_part_id: own, quantity: 2, choices: [{ item_id: naan }] },
          ],
        }),
      400,
    );
    expect(issuePaths(repeated)).toContain('parts.1.deal_part_id');
    expect((await refused(() => patchDeal(deal.deal_id, { expected_version: deal.version, parts: [] }), 400)).code).toBe('VALIDATION_FAILED');
    for (const id of ['DL-NOPE', 'B-DEAL']) {
      expect(await refused(() => patchDeal(id, { expected_version: deal.version, name: 'X' }), 404)).toMatchObject({
        code: 'DEAL_NOT_FOUND',
        details: { deal_id: id },
      });
    }
  });

  it('[01c §6.15 R3] a single-choice part with an extra: stale version → 409 CONFIG_STALE (not 400); fresh → 400 at parts.0.choices.0.extra_price_minor', async () => {
    const naan = menu.itemIds[0]!;
    const deal = await createDeal(cloud, f, plainDeal('Family karahi'));
    const parts = [{ deal_part_id: deal.parts[0]!.deal_part_id, quantity: 1, choices: [{ item_id: naan, extra_price_minor: 3000 }] }];
    const stale = await refused(() => patchDeal(deal.deal_id, { expected_version: 'stale', parts }), 409);
    expect(stale).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'deal', id: deal.deal_id } });
    const fresh = await refused(() => patchDeal(deal.deal_id, { expected_version: deal.version, parts }), 400);
    expect(fresh.code).toBe('VALIDATION_FAILED');
    expect(issuePaths(fresh)).toEqual(['parts.0.choices.0.extra_price_minor']);
    // a new part (no id) too; two choices may carry an extra
    const added = await refused(
      () => patchDeal(deal.deal_id, { expected_version: deal.version, parts: [parts[0]!, { quantity: 1, choices: [{ item_id: naan, extra_price_minor: 1 }] }] }),
      400,
    );
    expect(issuePaths(added)).toEqual(['parts.0.choices.0.extra_price_minor', 'parts.1.choices.0.extra_price_minor']);
    const two = await patched(deal.deal_id, {
      expected_version: deal.version,
      parts: [{ ...parts[0]!, choices: [...parts[0]!.choices, { item_id: menu.itemIds[1]! }] }],
    });
    expect(two.parts[0]!.choices.map((c) => c.extra_price_minor).sort()).toEqual([0, 3000]);
  });

  it('[01c §6.15 AD-11] restore re-checks every active choice item without parts: archived item, mixed units, weighed item → 422, nothing written; then → 200 restore', async () => {
    const naan = await item({ name: 'Naan' });
    const roghni = await item({ name: 'Roghni naan' });
    const raita = await item({ name: 'Raita' });
    const deal = await createDeal(cloud, f, {
      ...plainDeal('Family karahi'),
      parts: [
        { quantity: 1, choices: [{ item_id: naan }] },
        { quantity: 1, sort_order: 1, choices: [{ item_id: roghni }, { item_id: raita, sort_order: 1 }] },
      ],
    });
    const archived = await patched(deal.deal_id, { expected_version: deal.version, archived: true });
    expect(archived.archived_at).toBe(cloud.clock.branchNow());
    const restore = { expected_version: archived.version, archived: false };

    // the choice item archived while the deal was archived (§6.5 R4 counts active deals only, AD-11)
    await patchItem(raita, { archived: true });
    expect(await refused(() => patchDeal(deal.deal_id, restore), 422)).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'parts.1.choices.1.item_id', reason: 'archived' },
    });
    await patchItem(raita, { archived: false });

    // a choice item's sale_unit changed so its part mixes units (§6.5 R6 counts active deals only): R2
    await patchItem(roghni, { sale_unit: 'g' });
    expect(await refused(() => patchDeal(deal.deal_id, restore), 422)).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'parts.1.choices', reason: 'choice_unit_mismatch' },
    });
    await patchItem(roghni, { sale_unit: 'piece' });

    // a choice item turned weighed (§6.5 R8 counts active deals only): R5
    await patchItem(naan, { sale_unit: 'g', requires_weighing: true });
    expect(await refused(() => patchDeal(deal.deal_id, restore), 422)).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'parts.0.choices.0.item_id', reason: 'weighed_item_in_deal' },
    });
    await patchItem(naan, { sale_unit: 'piece', requires_weighing: false });

    const before = await versions();
    const restored = await patched(deal.deal_id, restore);
    // tenant-wide check, deal lock, parts read, windows read, the stored active parts' choice items FOR SHARE, the
    // merged category FOR SHARE (AD-34; tax class null: not read), deal update, audit, 2 bump
    expect(counter.count).toBe(10);
    expect(restored).toEqual(deal);
    expect(await versions()).toEqual(before.map((v) => v + 1));
    expect((await dealAudit(deal.deal_id)).map((row) => row.action)).toEqual(['create', 'archive', 'restore']);
  });

  it('[01c §6.15 AD-34] restore re-checks the merged category and tax class without them sent: archived → 422, nothing written; both active → 200', async () => {
    const category = (await inject('POST', '/v1/admin/categories', { name: 'Deals' })).json().data.category.category_id as string;
    const taxClass = (await inject('POST', '/v1/admin/tax-classes', { name: 'Deal tax', rate_bp: 500 })).json().data.tax_class
      .tax_class_id as string;
    const deal = await createDeal(cloud, f, { ...plainDeal('Family karahi'), category_id: category, tax_class_id: taxClass });
    const archived = await patched(deal.deal_id, { expected_version: deal.version, archived: true });
    const restore = { expected_version: archived.version, archived: false };
    const setArchived = async (table: 'categories' | 'tax_classes', id: string, on: boolean) => {
      const response = await inject('PATCH', `/v1/admin/${table === 'categories' ? 'categories' : 'tax-classes'}/${id}`, { archived: on });
      expect(response.statusCode, response.body).toBe(200);
    };

    // the category archived while the deal was archived (V16 counts active deals only, AD-11)
    await setArchived('categories', category, true);
    expect(await refused(() => patchDeal(deal.deal_id, restore), 422)).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'category_id', reason: 'archived' },
    });
    await setArchived('categories', category, false);

    await setArchived('tax_classes', taxClass, true);
    expect(await refused(() => patchDeal(deal.deal_id, restore), 422)).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'tax_class_id', reason: 'archived' },
    });
    await setArchived('tax_classes', taxClass, false);

    // control: both active → 200
    const restored = await patchDeal(deal.deal_id, restore);
    expect(restored.statusCode, restored.body).toBe(200);
    // tenant-wide check, deal lock, parts read, windows read, choice items, category, tax class FOR SHARE, deal
    // update, audit, 2 bump
    expect(counter.count).toBe(11);
    expect(restored.json().data.deal).toEqual(deal);
  });

  it('[01c #86] deal side: PATCH parts with a weighed choice → 422 weighed_item_in_deal at parts.N.choices.M.item_id (§6.15 R5); item side: requires_weighing on an offered item → 422 at requires_weighing (§6.5 R8)', async () => {
    const naan = menu.itemIds[1]!;
    const fish = await item({ name: 'Fish', sale_unit: 'g', requires_weighing: true, price_minor: 300 });
    const karahi = await item({ name: 'Mutton Karahi', sale_unit: 'g', price_minor: 400 });
    const deal = await createDeal(cloud, f, {
      ...plainDeal('Family karahi'),
      parts: [
        { quantity: 1, choices: [{ item_id: naan }] },
        { quantity: 500, sort_order: 1, choices: [{ item_id: karahi }] },
      ],
    });
    const [p1, p2] = deal.parts.map((p) => p.deal_part_id) as [string, string];
    const weighedChoice = await refused(
      () =>
        patchDeal(deal.deal_id, {
          expected_version: deal.version,
          parts: [
            { deal_part_id: p1, quantity: 1, choices: [{ item_id: naan }] },
            { deal_part_id: p2, quantity: 500, choices: [{ item_id: karahi }, { item_id: fish, sort_order: 1 }] },
          ],
        }),
      422,
    );
    expect(weighedChoice).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'parts.1.choices.1.item_id', reason: 'weighed_item_in_deal' } });

    // item side: the karahi is the only choice of an active part of an active deal
    const before = { rows: await dealRows(), versions: await versions(), counts: await counts() };
    const itemBefore = (await cloud.pool.query(`SELECT * FROM menu_items WHERE item_id = $1`, [karahi])).rows;
    const weighing = await inject('PATCH', `/v1/admin/menu-items/${karahi}`, { requires_weighing: true });
    expect(weighing.statusCode, weighing.body).toBe(422);
    expect(weighing.json().error).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'requires_weighing', reason: 'weighed_item_in_deal' },
    });
    expect((await cloud.pool.query(`SELECT * FROM menu_items WHERE item_id = $1`, [karahi])).rows).toEqual(itemBefore);
    expect({ rows: await dealRows(), versions: await versions(), counts: await counts() }).toEqual(before);
  });

  it('[01c §6.5 R8 AD-11] R8 counts active parts of active deals only: the part archived → 200; the deal archived → 200', async () => {
    const karahi = await item({ name: 'Mutton Karahi', sale_unit: 'g', price_minor: 400 });
    const naan = menu.itemIds[1]!;
    const deal = await createDeal(cloud, f, {
      ...plainDeal('Family karahi'),
      parts: [
        { quantity: 500, choices: [{ item_id: karahi }] },
        { quantity: 1, sort_order: 1, choices: [{ item_id: naan }] },
      ],
    });
    // the karahi's part archived (omitted from the parts list)
    const omitted = await patched(deal.deal_id, {
      expected_version: deal.version,
      parts: [{ deal_part_id: deal.parts[1]!.deal_part_id, quantity: 1, sort_order: 1, choices: [{ item_id: naan }] }],
    });
    await patchItem(karahi, { requires_weighing: true });
    await patchItem(karahi, { requires_weighing: false });
    // the part active again, the deal archived
    const back = await patched(deal.deal_id, {
      expected_version: omitted.version,
      parts: deal.parts.map((p) => ({ deal_part_id: p.deal_part_id, quantity: p.quantity, sort_order: p.sort_order, choices: p.choices })),
    });
    const weighing = await inject('PATCH', `/v1/admin/menu-items/${karahi}`, { requires_weighing: true });
    expect(weighing.statusCode).toBe(422);
    await patched(deal.deal_id, { expected_version: back.version, archived: true });
    await patchItem(karahi, { requires_weighing: true });
  });

  it('[01c §6.15] fields and windows; no-op → 200, nothing written; archive / restore audited; name taken → 409; sent references checked, unsent trusted (R4); R2 on sent parts', async () => {
    const [naan, roghni] = menu.itemIds as [string, string];
    const karahi = await item({ name: 'Mutton Karahi', sale_unit: 'g', price_minor: 400 });
    const deal = await createDeal(cloud, f, plainDeal('Family karahi', [naan, roghni]));
    const category = (await inject('POST', '/v1/admin/categories', { name: 'Deals' })).json().data.category.category_id as string;
    const before = await versions();
    const first = await patchDeal(deal.deal_id, {
      expected_version: deal.version,
      name: 'Family deal',
      category_id: category,
      tax_class_id: menu.taxClassId,
      description: 'For four',
      sort_order: 4,
      price_minor: 260000,
      availability_windows: [{ start_ms: 43_200_000, end_ms: 82_800_000 }],
    });
    expect(first.statusCode, first.body).toBe(200);
    // tenant-wide check, deal lock, parts read, windows read, category / tax class FOR SHARE, deal update, windows
    // delete + insert, audit, 2 bump (no parts: no choice items lock)
    expect(counter.count).toBe(12);
    const wire = first.json().data.deal as DealWire;
    expect(wire).toEqual({
      ...deal,
      name: 'Family deal',
      category_id: category,
      tax_class_id: menu.taxClassId,
      description: 'For four',
      sort_order: 4,
      price_minor: 260000,
      availability_windows: [{ start_ms: 43_200_000, end_ms: 82_800_000 }],
      version: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(wire.version).not.toBe(deal.version);
    expect(await versions()).toEqual(before.map((v) => v + 1));
    const audit = await dealAudit(deal.deal_id);
    expect(audit[1]).toEqual({ action: 'update', before: auditedDeal(deal), after: auditedDeal(wire) });

    // no-op: the same values (and the same parts by id) → 200 with the stored deal, nothing written
    const sameParts = wire.parts.map((p) => ({ deal_part_id: p.deal_part_id, quantity: p.quantity, sort_order: p.sort_order, choices: p.choices }));
    const unchanged = { counts: await counts(), versions: await versions(), rows: await dealRows() };
    const noop = await patchDeal(deal.deal_id, { expected_version: wire.version, name: 'Family deal', price_minor: 260000, parts: sameParts });
    expect(noop.statusCode, noop.body).toBe(200);
    // tenant-wide check, deal lock, parts read, windows read, choice items FOR SHARE (C4 step 4 before the no-op)
    expect(counter.count).toBe(5);
    expect(noop.json().data.deal).toEqual(wire);
    expect({ counts: await counts(), versions: await versions(), rows: await dealRows() }).toEqual(unchanged);
    expect(((await patchDeal(deal.deal_id, { expected_version: wire.version, sort_order: 4 })).json().data.deal as DealWire).version).toBe(wire.version);

    // sent references: unknown / archived category or tax class → 422; an unsent archived category is trusted (R4)
    const seeded = await seedArchived();
    const cases: Array<[object, string, string]> = [
      [{ category_id: 'CT-NOPE' }, 'category_id', 'not_found'],
      [{ category_id: seeded.categoryId }, 'category_id', 'archived'],
      [{ tax_class_id: 'TX-NOPE' }, 'tax_class_id', 'not_found'],
      [{ tax_class_id: seeded.taxClassId }, 'tax_class_id', 'archived'],
      [{ parts: [{ quantity: 1, choices: [{ item_id: seeded.itemId }] }] }, 'parts.0.choices.0.item_id', 'archived'],
      [{ parts: [{ quantity: 1, choices: [{ item_id: naan }, { item_id: 'IT-NOPE' }] }] }, 'parts.0.choices.1.item_id', 'not_found'],
      // R2 on the sent parts with the items' current sale_unit
      [{ parts: [{ quantity: 1, choices: [{ item_id: naan }, { item_id: karahi }] }] }, 'parts.0.choices', 'choice_unit_mismatch'],
    ];
    for (const [body, field, reason] of cases) {
      expect(await refused(() => patchDeal(deal.deal_id, { expected_version: wire.version, ...body }), 422), field).toMatchObject({
        code: 'CONFIG_REFERENCE_INVALID',
        details: { field, reason },
      });
    }
    const listed = async () => ((await list()).json().data.deals as ListedDeal[]).find((d) => d.deal_id === deal.deal_id)!;
    await cloud.pool.query(`UPDATE deals SET category_id = $2 WHERE deal_id = $1`, [deal.deal_id, seeded.categoryId]);
    const trusted = await patched(deal.deal_id, { expected_version: (await listed()).version, name: 'Family deal 2' });
    expect(trusted.category_id).toBe(seeded.categoryId);
    await cloud.pool.query(`UPDATE deals SET category_id = $2 WHERE deal_id = $1`, [deal.deal_id, category]);
    const current = await listed();

    // name taken by another active deal (case-insensitive) → 409; windows cleared → []
    await createDeal(cloud, f, plainDeal('Lunch deal'));
    expect(await refused(() => patchDeal(deal.deal_id, { expected_version: current.version, name: 'LUNCH deal' }), 409)).toMatchObject({
      code: 'CONFIG_NAME_TAKEN',
      details: { entity: 'deal', name: 'LUNCH deal' },
    });
    const cleared = await patched(deal.deal_id, { expected_version: current.version, availability_windows: [], tax_class_id: null });
    expect(cleared).toMatchObject({ availability_windows: [], tax_class_id: null });
    expect((await counts())!.windows).toBe(0);

    // archive → audited 'archive'; the name is then free for another deal; restore while it is taken → 409
    const archived = await patched(deal.deal_id, { expected_version: cleared.version, archived: true });
    expect(archived.archived_at).toBe(cloud.clock.branchNow());
    await createDeal(cloud, f, plainDeal('Family deal 2'));
    expect((await refused(() => patchDeal(deal.deal_id, { expected_version: archived.version, archived: false }), 409)).code).toBe('CONFIG_NAME_TAKEN');
    expect((await dealAudit(deal.deal_id)).map((row) => row.action)).toEqual(['create', 'update', 'update', 'update', 'archive']);
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
