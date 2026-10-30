import { BranchConfigSnapshotSchemaV2, type BranchConfig, type CreateDealRequest, type DealBranchWire, type DealWire } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildSnapshot, type SnapshotHeader } from '../../src/modules/config-sync/builder';
import { createDeal, createModifierGroup } from '../helpers/menu-variants';
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
type ApiError = { error: { code: string; details: Record<string, unknown> } };

// 01c §6.16 deal branch PUT (per-branch sale and price, M4, AD-6) and §4.6 rule 5 (V11 e, m5, AU-11): the deals of
// a branch's schema-2 snapshot, written through the API (§6.14, §6.15, §6.16). Branch A is Gulberg.
describe('01c deal branch PUT (§6.16) and snapshot deals (§4.6 rule 5)', () => {
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
    // stations ST-1 (A), ST-B (B); category CT-1, tax class TX-1
    menu = await seedMenu(cloud.pool, f);
  });

  const build = async (branchId: string): Promise<BranchConfig> => {
    const client = await cloud.pool.connect();
    try {
      const tenant = Object.freeze({ tenantId: f.tenantId, branchIds: Object.freeze([...f.branches]) });
      return BranchConfigSnapshotSchemaV2.parse(await buildSnapshot(client, tenant, branchId, HEADER));
    } finally {
      client.release();
    }
  };
  // The builder's statement count (01c #62; transaction control excluded).
  const countBuild = async (branchId: string) => {
    const client = await cloud.pool.connect();
    try {
      const tenant = Object.freeze({ tenantId: f.tenantId, branchIds: Object.freeze([...f.branches]) });
      counter.reset();
      BranchConfigSnapshotSchemaV2.parse(await buildSnapshot(client, tenant, branchId, HEADER));
      return counter.count;
    } finally {
      client.release();
    }
  };
  const stationAt = (branchId: string) => (branchId === f.branches[0] ? menu.slotStationId : 'ST-B');
  // A piece item in CT-1, routed at the given branches (A: ST-1, B: ST-B).
  const item = async (name: string, branchIds: readonly string[], price_minor = 10_000) => {
    const response = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/menu-items',
      ...owner(f),
      payload: {
        category_id: menu.categoryIds[0],
        tax_class_id: null,
        name,
        price_minor,
        serve_mode: 'sync',
        cook_time_ms: 600_000,
        routes: branchIds.map((branch_id) => ({ branch_id, station_id: stationAt(branch_id) })),
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().data.item.item_id as string;
  };
  const putDealBranch = (dealId: string, branchId: string, payload: object, token?: string) =>
    cloud.app.inject({ method: 'PUT', url: `/v1/admin/deals/${dealId}/branches/${branchId}`, headers: owner(f, token).headers, payload });
  const listed = async (dealId: string, status = 'active'): Promise<ListedDeal> => {
    const response = await cloud.app.inject({ method: 'GET', url: `/v1/admin/deals?status=${status}`, headers: owner(f).headers });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json().data.deals as ListedDeal[]).find((d) => d.deal_id === dealId)!;
  };
  const branchVersion = async (dealId: string, branchId: string, status = 'active') =>
    (await listed(dealId, status)).branches.find((b) => b.branch_id === branchId)!.version;
  // §6.16 at the current branch version; the response's branch entry.
  const sell = async (dealId: string, branchId: string, price_minor_override: number | null = null) => {
    const response = await putDealBranch(dealId, branchId, {
      expected_version: await branchVersion(dealId, branchId),
      is_sold: true,
      price_minor_override,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.branch as DealBranchWire;
  };
  const versions = async () =>
    (
      await cloud.pool.query<{ branch_id: string; config_version: string }>(`SELECT branch_id, config_version FROM branches WHERE tenant_id = $1`, [
        f.tenantId,
      ])
    ).rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.branch_id]: Number(row.config_version) }), {});
  const branchRows = async () =>
    (
      await cloud.pool.query<{ branch_id: string; deal_id: string; price_minor_override: string | null }>(
        `SELECT branch_id, deal_id, price_minor_override FROM deal_branches WHERE tenant_id = $1 ORDER BY branch_id, deal_id`,
        [f.tenantId],
      )
    ).rows;
  const branchAudit = async () =>
    (
      await cloud.pool.query<{ entity_id: string; branch_id: string | null; action: string; before: unknown; after: unknown }>(
        `SELECT entity_id, branch_id, action, before, after FROM config_audit
          WHERE tenant_id = $1 AND entity = 'deal_branch' ORDER BY at, audit_id`,
        [f.tenantId],
      )
    ).rows;
  // The call answers `status`, writes no deal_branches row or audit row and bumps no branch; the error is returned.
  const refused = async (call: () => Promise<{ statusCode: number; body: string; json: () => unknown }>, status: number) => {
    const before = { rows: await branchRows(), audit: await branchAudit(), versions: await versions() };
    const response = await call();
    expect(response.statusCode, response.body).toBe(status);
    expect(await branchRows()).toEqual(before.rows);
    expect(await branchAudit()).toEqual(before.audit);
    expect(await versions()).toEqual(before.versions);
    return (response.json() as ApiError).error;
  };
  const dealIn = (snapshot: BranchConfig, dealId: string) => snapshot.deals.find((d) => d.deal_id === dealId);

  // Family karahi deal (§4.6 example): karahi ×1; naan ×4 with plain naan (sort 1) or roghni (+Rs 30, sort 2);
  // Rs 3 200, Lunch window. Karahi and naan routed at A and B, roghni at A only.
  const familyDeal = async () => {
    const [a, b] = f.branches;
    const karahi = await item('Chicken Karahi', [a, b], 115_000);
    const naan = await item('Naan', [a, b], 3_000);
    const roghni = await item('Roghni naan', [a], 6_000);
    const body: CreateDealRequest = {
      name: 'Family karahi deal',
      category_id: menu.categoryIds[0]!,
      tax_class_id: menu.taxClassId,
      sort_order: 1,
      price_minor: 320_000,
      availability_windows: [{ start_ms: 43_200_000, end_ms: 54_000_000 }],
      parts: [
        { quantity: 1, sort_order: 1, choices: [{ item_id: karahi, sort_order: 1 }] },
        {
          quantity: 4,
          sort_order: 2,
          choices: [
            { item_id: roghni, extra_price_minor: 3_000, sort_order: 2 },
            { item_id: naan, sort_order: 1 },
          ],
        },
      ],
    };
    const deal = await createDeal(cloud, f, body);
    return { deal, karahi, naan, roghni };
  };

  // ------------------------------------------------------------------------------------------- §6.16 PUT

  it('[01c §6.16] sell at A with an override: 200 with is_sold (AD-6), one deal_branch / branch_set audit row with branch_id, only A bumped; same again → no-op; 6 / 3 statements', async () => {
    const [a, b] = f.branches;
    const { deal } = await familyDeal();
    const before = await versions();
    const noRow = await branchVersion(deal.deal_id, a);

    const set = await putDealBranch(deal.deal_id, a, { expected_version: noRow, is_sold: true, price_minor_override: 300_000 });
    expect(set.statusCode, set.body).toBe(200);
    // deal lock, branch read, stored row, upsert, audit, bump
    expect(counter.count).toBe(6);
    const branch = set.json().data.branch as DealBranchWire;
    expect(branch).toEqual({ branch_id: a, is_sold: true, price_minor_override: 300_000, version: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(branch.version).not.toBe(noRow);
    // the list's branch version is the one the PUT returned
    expect((await listed(deal.deal_id)).branches.find((x) => x.branch_id === a)).toEqual(branch);
    expect(await branchRows()).toEqual([{ branch_id: a, deal_id: deal.deal_id, price_minor_override: '300000' }]);
    expect(await branchAudit()).toEqual([
      { entity_id: deal.deal_id, branch_id: a, action: 'branch_set', before: null, after: { price_minor_override: 300_000 } },
    ]);
    const after = await versions();
    expect(after[a]).toBe(before[a]! + 1);
    expect(Object.entries(after).filter(([id]) => id !== a)).toEqual(Object.entries(before).filter(([id]) => id !== a));

    // same values again: no-op 200 with the stored entry, nothing written (S26)
    const again = await putDealBranch(deal.deal_id, a, { expected_version: branch.version, is_sold: true, price_minor_override: 300_000 });
    expect(again.statusCode, again.body).toBe(200);
    // deal lock, branch read, stored row
    expect(counter.count).toBe(3);
    expect(again.json().data.branch).toEqual(branch);
    expect(await branchAudit()).toHaveLength(1);
    expect(await versions()).toEqual(after);

    // override changed to the base price (null): branch_set, before / after
    const base = await putDealBranch(deal.deal_id, a, { expected_version: branch.version, is_sold: true, price_minor_override: null });
    expect(base.statusCode, base.body).toBe(200);
    expect(base.json().data.branch).toEqual({ branch_id: a, is_sold: true, price_minor_override: null, version: expect.any(String) });
    expect((await branchAudit()).at(-1)).toEqual({
      entity_id: deal.deal_id,
      branch_id: a,
      action: 'branch_set',
      before: { price_minor_override: 300_000 },
      after: { price_minor_override: null },
    });
    expect((await versions())[a]).toBe(after[a]! + 1);

    // an owner allowed only at B sells at B (branch-scoped, no tenant-wide check)
    const bOnly = await putDealBranch(deal.deal_id, b, { expected_version: await branchVersion(deal.deal_id, b), is_sold: true }, f.tokenFor([b]));
    expect(bOnly.statusCode, bOnly.body).toBe(200);
    expect(bOnly.json().data.branch).toMatchObject({ branch_id: b, is_sold: true, price_minor_override: null });
  });

  it('[01c §6.16] withdraw: is_sold false → 200 { branch: null }, row deleted, branch_removed audited, A bumped; again (no row) → no-op 200 { branch: null }', async () => {
    const [a] = f.branches;
    const { deal } = await familyDeal();
    const sold = await sell(deal.deal_id, a, 250_000);
    const before = await versions();

    const removed = await putDealBranch(deal.deal_id, a, { expected_version: sold.version, is_sold: false });
    expect(removed.statusCode, removed.body).toBe(200);
    // deal lock, branch read, stored row, delete, audit, bump
    expect(counter.count).toBe(6);
    expect(removed.json()).toEqual({ data: { branch: null } });
    expect(await branchRows()).toEqual([]);
    expect((await branchAudit()).at(-1)).toEqual({
      entity_id: deal.deal_id,
      branch_id: a,
      action: 'branch_removed',
      before: { price_minor_override: 250_000 },
      after: null,
    });
    expect((await versions())[a]).toBe(before[a]! + 1);
    const noRow = await branchVersion(deal.deal_id, a);
    expect((await listed(deal.deal_id)).branches.find((x) => x.branch_id === a)).toEqual({
      branch_id: a,
      is_sold: false,
      price_minor_override: null,
      version: noRow,
    });

    // is_sold false on a branch with no row: no-op 200 { branch: null }, no audit, no bump
    const audited = await branchAudit();
    const bumped = await versions();
    const none = await putDealBranch(deal.deal_id, a, { expected_version: noRow, is_sold: false });
    expect(none.statusCode, none.body).toBe(200);
    expect(counter.count).toBe(3);
    expect(none.json()).toEqual({ data: { branch: null } });
    expect(await branchAudit()).toEqual(audited);
    expect(await versions()).toEqual(bumped);
  });

  it('[01c §6.16] edges: is_sold false with an override → 400; stale → 409 deal_branch; two first-time PUTs → one 200, one 409 (M4); unknown deal → 404; foreign / unknown branch → 404 BRANCH_NOT_FOUND; nothing written', async () => {
    const [a, b] = f.branches;
    const { deal } = await familyDeal();
    const noRow = await branchVersion(deal.deal_id, a);

    const withPrice = await refused(() => putDealBranch(deal.deal_id, a, { expected_version: noRow, is_sold: false, price_minor_override: 100 }), 400);
    expect(withPrice.code).toBe('VALIDATION_FAILED');
    expect((await refused(() => putDealBranch(deal.deal_id, a, { expected_version: noRow, is_sold: true, price_minor_override: -1 }), 400)).code).toBe(
      'VALIDATION_FAILED',
    );

    const stale = await refused(() => putDealBranch(deal.deal_id, a, { expected_version: 'stale', is_sold: true }), 409);
    expect(stale).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'deal_branch', id: deal.deal_id } });

    // two tabs that both loaded "no row" (M4): the first sells, the second is stale
    expect((await putDealBranch(deal.deal_id, a, { expected_version: noRow, is_sold: true })).statusCode).toBe(200);
    const second = await refused(() => putDealBranch(deal.deal_id, a, { expected_version: noRow, is_sold: true, price_minor_override: 1 }), 409);
    expect(second.code).toBe('CONFIG_STALE');
    // a stale withdraw is refused too
    expect((await refused(() => putDealBranch(deal.deal_id, a, { expected_version: noRow, is_sold: false }), 409)).code).toBe('CONFIG_STALE');

    let statements = 0;
    const unknown = await refused(async () => {
      const response = await putDealBranch('01JUNKNOWNDEAL000000000000', a, { expected_version: noRow, is_sold: true });
      statements = counter.count;
      return response;
    }, 404);
    expect(unknown).toMatchObject({ code: 'DEAL_NOT_FOUND', details: { deal_id: '01JUNKNOWNDEAL000000000000' } });
    // deal lock only
    expect(statements).toBe(1);

    // C2 inside the transaction: a branch the JWT does not allow, another tenant's branch, an unknown one
    const bVersion = await branchVersion(deal.deal_id, b);
    for (const [branchId, token] of [
      [b, f.tokenFor([a])],
      [f.other.branchId, undefined],
      ['01JUNKNOWNBRANCH0000000000', undefined],
    ] as const) {
      const error = await refused(() => putDealBranch(deal.deal_id, branchId, { expected_version: bVersion, is_sold: true }, token), 404);
      expect(error).toMatchObject({ code: 'BRANCH_NOT_FOUND', details: { branch_id: branchId } });
    }
  });

  it('[01c §6.16] archived deal: is_sold true → 422 deal_id archived (nothing written); withdrawing it → 200 branch_removed; restored → sellable again', async () => {
    const [a, b] = f.branches;
    const { deal } = await familyDeal();
    await sell(deal.deal_id, a);
    const archive = await cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/deals/${deal.deal_id}`,
      ...owner(f),
      payload: { expected_version: deal.version, archived: true },
    });
    expect(archive.statusCode, archive.body).toBe(200);
    const archived = archive.json().data.deal as DealWire;

    const bVersion = await branchVersion(deal.deal_id, b, 'archived');
    const error = await refused(() => putDealBranch(deal.deal_id, b, { expected_version: bVersion, is_sold: true }), 422);
    expect(error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'deal_id', reason: 'archived' } });
    // the version is compared first: a stale sell on an archived deal is 409
    expect((await refused(() => putDealBranch(deal.deal_id, b, { expected_version: 'stale', is_sold: true }), 409)).code).toBe('CONFIG_STALE');
    // an archived deal is in no snapshot, sold or not
    expect((await build(a)).deals).toEqual([]);

    const withdraw = await putDealBranch(deal.deal_id, a, { expected_version: await branchVersion(deal.deal_id, a, 'archived'), is_sold: false });
    expect(withdraw.statusCode, withdraw.body).toBe(200);
    expect(withdraw.json().data.branch).toBeNull();
    expect((await branchAudit()).map((row) => row.action)).toEqual(['branch_set', 'branch_removed']);

    const restore = await cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/deals/${deal.deal_id}`,
      ...owner(f),
      payload: { expected_version: archived.version, archived: false },
    });
    expect(restore.statusCode, restore.body).toBe(200);
    await sell(deal.deal_id, b);
    expect(dealIn(await build(b), deal.deal_id)).toBeDefined();
  });

  // ------------------------------------------------------------------------------------------- §4.6 rule 5

  it('[01c #54] sold at Gulberg with override 300 000 → Gulberg snapshot price 300 000; other branches lack the deal; the override cleared → the deal price', async () => {
    const [a, b, c] = f.branches;
    const { deal, karahi, naan, roghni } = await familyDeal();
    const [p1, p2] = deal.parts.map((part) => part.deal_part_id);
    await sell(deal.deal_id, a, 300_000);

    const gulberg = await build(a);
    expect(gulberg.deals).toEqual([
      {
        deal_id: deal.deal_id,
        category_id: menu.categoryIds[0],
        name: 'Family karahi deal',
        description: null,
        sort_order: 1,
        price_minor: 300_000,
        tax_class_id: menu.taxClassId,
        availability_windows: [{ start_ms: 43_200_000, end_ms: 54_000_000 }],
        parts: [
          { deal_part_id: p1, quantity: 1, sort_order: 1, choices: [{ item_id: karahi, extra_price_minor: 0, sort_order: 1 }] },
          {
            deal_part_id: p2,
            quantity: 4,
            sort_order: 2,
            choices: [
              { item_id: naan, extra_price_minor: 0, sort_order: 1 },
              { item_id: roghni, extra_price_minor: 3_000, sort_order: 2 },
            ],
          },
        ],
      },
    ]);
    expect((await build(b)).deals).toEqual([]);
    expect((await build(c)).deals).toEqual([]);

    // per branch: sold at B without an override → B lists the deal price; A keeps its override
    await sell(deal.deal_id, b);
    expect(dealIn(await build(b), deal.deal_id)?.price_minor).toBe(320_000);
    expect(dealIn(await build(a), deal.deal_id)?.price_minor).toBe(300_000);
    // the override cleared at A → the deal price; the deal price changed → every branch without an override follows
    await sell(deal.deal_id, a, null);
    expect(dealIn(await build(a), deal.deal_id)?.price_minor).toBe(320_000);
    const repriced = await cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/deals/${deal.deal_id}`,
      ...owner(f),
      payload: { expected_version: deal.version, price_minor: 330_000 },
    });
    expect(repriced.statusCode, repriced.body).toBe(200);
    await sell(deal.deal_id, b, 0);
    expect(dealIn(await build(a), deal.deal_id)?.price_minor).toBe(330_000);
    // an override of 0 is a price, not "none"
    expect(dealIn(await build(b), deal.deal_id)?.price_minor).toBe(0);
  });

  it('[01c #55] a part whose only choice is not routed at Gulberg → the deal is absent there; a pick-one with one routed choice → present with that choice only (AU-11: the first routed choice leads)', async () => {
    const [a, b] = f.branches;
    const { deal, karahi, naan } = await familyDeal();
    const roghniOnly = await item('Roghni platter', [b], 9_000);
    // Gulberg is A here: the platter is routed at B only
    const platter = await createDeal(cloud, f, {
      name: 'Platter deal',
      category_id: menu.categoryIds[0]!,
      tax_class_id: null,
      sort_order: 2,
      price_minor: 150_000,
      parts: [
        { quantity: 1, sort_order: 1, choices: [{ item_id: karahi }] },
        { quantity: 1, sort_order: 2, choices: [{ item_id: roghniOnly }] },
      ],
    });
    for (const id of [deal.deal_id, platter.deal_id]) {
      await sell(id, a);
      await sell(id, b);
    }

    const gulberg = await build(a);
    expect(gulberg.deals.map((d) => d.deal_id)).toEqual([deal.deal_id]);
    const bSnapshot = await build(b);
    expect(bSnapshot.deals.map((d) => d.deal_id)).toEqual([deal.deal_id, platter.deal_id]);
    // at B, roghni (A only) is left out of the naan part: plain naan is its only, reference choice
    expect(dealIn(bSnapshot, deal.deal_id)?.parts[1]?.choices).toEqual([{ item_id: naan, extra_price_minor: 0, sort_order: 1 }]);

    // AU-11: with plain naan's route removed at B, the naan part keeps no choice there → the deal leaves B
    const unroute = await cloud.app.inject({
      method: 'PUT',
      url: `/v1/admin/menu-items/${naan}/routes/${b}`,
      ...owner(f),
      payload: { station_id: null },
    });
    expect(unroute.statusCode, unroute.body).toBe(200);
    expect((await build(b)).deals.map((d) => d.deal_id)).toEqual([platter.deal_id]);
    // at A the first choice by sort_order is unchanged (plain naan, then roghni)
    expect(dealIn(await build(a), deal.deal_id)?.parts[1]?.choices.map((choice) => choice.item_id)).toEqual([naan, expect.any(String)]);
  });

  it('[01c #107] a group attached only to items not routed at Gulberg → absent from its modifier_groups; choices with sort_order 2, 1 → listed 1, 2; the version changes when only a choice sort_order changes', async () => {
    const [a, b] = f.branches;
    const { deal, naan, roghni } = await familyDeal();
    // m5: Extras attached only to roghni (routed at A only) is absent at B (Gulberg is B here), present at A
    const extras = await createModifierGroup(cloud, f, {
      name: 'Extras',
      min_choices: 0,
      max_choices: 1,
      options: [{ name: 'Butter', price_minor: 500 }],
      links: [{ target_kind: 'item', target_id: roghni, mode: 'attach' }],
    });
    expect((await build(b)).modifier_groups.map((g) => g.modifier_group_id)).not.toContain(extras.modifier_group_id);
    expect((await build(a)).modifier_groups.map((g) => g.modifier_group_id)).toContain(extras.modifier_group_id);

    // the naan part was sent as roghni sort_order 2, naan sort_order 1 → the snapshot lists naan, roghni
    await sell(deal.deal_id, a);
    const choices = () => build(a).then((s) => dealIn(s, deal.deal_id)!.parts[1]!.choices.map((c) => [c.item_id, c.sort_order]));
    expect(await choices()).toEqual([
      [naan, 1],
      [roghni, 2],
    ]);

    // only the choices' sort_order swapped: the deal version changes (not a no-op), and the snapshot follows
    const [p1, p2] = deal.parts;
    const swapped = await cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/deals/${deal.deal_id}`,
      ...owner(f),
      payload: {
        expected_version: deal.version,
        parts: [
          { deal_part_id: p1!.deal_part_id, quantity: 1, sort_order: 1, choices: p1!.choices },
          {
            deal_part_id: p2!.deal_part_id,
            quantity: 4,
            sort_order: 2,
            choices: [
              { item_id: naan, extra_price_minor: 0, sort_order: 2 },
              { item_id: roghni, extra_price_minor: 3_000, sort_order: 1 },
            ],
          },
        ],
      },
    });
    expect(swapped.statusCode, swapped.body).toBe(200);
    expect((swapped.json().data.deal as DealWire).version).not.toBe(deal.version);
    expect(await choices()).toEqual([
      [roghni, 1],
      [naan, 2],
    ]);
  });

  it('[01c #62] builder statement count fixed: 16 with no deal, 1 deal and 50 deals sold here', async () => {
    const [a, b] = f.branches;
    // 01c §6.17: 01a's 7 + 9 (… modifier groups with options, option rows, links, deals with parts and choices, deal
    // windows, deal branch rows)
    expect(await countBuild(a)).toBe(16);
    const karahi = await item('Chicken Karahi', [a, b], 115_000);
    const naan = await item('Naan', [a, b], 3_000);
    const make = (i: number) =>
      createDeal(cloud, f, {
        name: `Deal ${String(i).padStart(2, '0')}`,
        category_id: menu.categoryIds[0]!,
        tax_class_id: null,
        sort_order: i,
        price_minor: 100_000 + i,
        availability_windows: [{ start_ms: 0, end_ms: 3_600_000 }],
        parts: [
          { quantity: 1, sort_order: 1, choices: [{ item_id: karahi }] },
          { quantity: 2, sort_order: 2, choices: [{ item_id: naan }, { item_id: menu.itemIds[1]!, extra_price_minor: 500 }] },
        ],
      });
    const first = await make(0);
    await sell(first.deal_id, a, 90_000);
    expect(await countBuild(a)).toBe(16);
    expect((await build(a)).deals).toHaveLength(1);

    for (let i = 1; i < 50; i += 1) {
      const deal = await make(i);
      await sell(deal.deal_id, a);
    }
    expect(await countBuild(a)).toBe(16);
    const fifty = await build(a);
    expect(fifty.deals).toHaveLength(50);
    expect(fifty.deals.map((d) => d.sort_order)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(fifty.deals[0]!.price_minor).toBe(90_000);
    expect(fifty.deals[49]!.price_minor).toBe(100_049);
    expect(fifty.deals.every((d) => d.availability_windows.length === 1 && d.parts[1]!.choices.length === 2)).toBe(true);
    // B: none sold there; the same statements
    expect(await countBuild(b)).toBe(16);
    expect((await build(b)).deals).toEqual([]);
  }, 120_000);
});
