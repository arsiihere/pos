import type pg from 'pg';
import type { ModifierGroupWire } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createStockItem } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { stockItem } from '../inventory/fixtures';
import { recipeFixture, type RecipeFixture } from './fixtures';

// 08 v1.1 Part B B17, §3.3 last row, §4.5 C-11, C-13, C-14, C-15, C-16, P-2; §10.2 test 22. The recipe in-use
// guards on the 01c / 08a writes: 409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } }, archived recipes never
// block, +1 statement (a recipes / recipe_lines read without a lock) only when the guarded field changes. Recipes
// are inserted by SQL (lane R's routes are not this task's). The restore-then-422 half of test 22 is test 18 (r3).
describe('08b B17 recipe in-use guards (C-11, C-14, C-15, P-2; test 22)', () => {
  let cloud: TestCloud;
  let fx: RecipeFixture;
  let counter: ReturnType<typeof pgCounter>;
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
    fx = await recipeFixture(cloud);
  });

  // ------------------------------------------------------------------------------------------- SQL recipe seeds
  let seq = 0;
  type Line = { stock_item_id: string; stock_unit: 'piece' | 'g' | 'ml' };
  type Version = { status: 'draft' | 'published' | 'superseded'; lines?: Line[] };
  type Basis =
    | { basis: 'per_unit' }
    | { basis: 'per_measure'; measure_unit: 'g' | 'ml' }
    | { basis: 'per_batch'; batch_stock_unit: 'piece' | 'g' | 'ml' };
  const insertRecipe = async (owner_type: 'menu_item' | 'modifier_option' | 'stock_item', owner_id: string, basis: Basis, versions: Version[]) => {
    seq += 1;
    const recipeId = `RCP${String(seq).padStart(23, '0')}`;
    const q = (sql: string, params: unknown[]) => cloud.pool.query(sql, [fx.f.tenantId, ...params]);
    await q(`INSERT INTO recipes (tenant_id, recipe_id, owner_type, owner_id, created_at, updated_at) VALUES ($1, $2, $3, $4, 1, 1)`, [
      recipeId,
      owner_type,
      owner_id,
    ]);
    for (const [i, v] of versions.entries()) {
      const versionId = `${recipeId}V${i + 1}`;
      const published = v.status === 'draft' ? null : 1000 + i;
      await q(
        `INSERT INTO recipe_versions (tenant_id, recipe_version_id, recipe_id, version_no, status, basis, base_qty, batch_yield_qty,
           batch_stock_unit, measure_unit, created_by, created_at, updated_at, published_by, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, 1, $12, $13)`,
        [
          versionId,
          recipeId,
          i + 1,
          v.status,
          basis.basis,
          basis.basis === 'per_measure' ? 1000 : null,
          basis.basis === 'per_batch' ? 10 : null,
          basis.basis === 'per_batch' ? basis.batch_stock_unit : null,
          basis.basis === 'per_measure' ? basis.measure_unit : null,
          fx.f.userId,
          published === null ? null : fx.f.userId,
          published,
        ],
      );
      for (const [n, line] of (v.lines ?? []).entries()) {
        await q(
          `INSERT INTO recipe_lines (tenant_id, recipe_version_id, line_no, stock_item_id, unit_name, entered_num, entered_den,
             stock_qty_num, stock_qty_den, stock_unit, qty_basis)
           VALUES ($1, $2, $3, $4, $5, 100, 1, 100, 1, $5, 'AP')`,
          [versionId, n + 1, line.stock_item_id, line.stock_unit],
        );
      }
    }
    return recipeId;
  };
  const archiveRecipe = (recipeId: string) =>
    cloud.pool.query(`UPDATE recipes SET archived_at = 2 WHERE tenant_id = $1 AND recipe_id = $2`, [fx.f.tenantId, recipeId]);
  const recipeReads = () => statements.filter((s) => /\brecipe(s|_lines|_versions)\b/.test(s)).length;

  // ------------------------------------------------------------------------------------------------- the routes
  const patchStock = async (stockItemId: string, payload: object) => {
    const { version } = await stockItem(cloud, fx.f, stockItemId);
    return cloud.app.inject({ method: 'PATCH', url: `/v1/admin/stock-items/${stockItemId}`, ...owner(fx.f), payload: { expected_version: version, ...payload } });
  };
  const patchItem = (itemId: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/menu-items/${itemId}`, ...owner(fx.f), payload });
  const choices = async (): Promise<ModifierGroupWire> => {
    const response = await cloud.app.inject({ method: 'GET', url: '/v1/admin/modifier-groups', ...owner(fx.f) });
    return (response.json().data.modifier_groups as ModifierGroupWire[]).find((g) => g.modifier_group_id === fx.options.groupId)!;
  };
  // the group's whole options list as stored, with `change` applied to the named option
  const patchOptions = async (change: Record<string, Record<string, unknown>>) => {
    const group = await choices();
    const options = group.options.map(({ option_id, name, price_minor, max_quantity, is_default, linked_item_id, sort_order }) => ({
      option_id,
      name,
      price_minor,
      max_quantity,
      is_default,
      linked_item_id,
      sort_order,
      ...(change[option_id] ?? {}),
    }));
    return cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/modifier-groups/${fx.options.groupId}`,
      ...owner(fx.f),
      payload: { expected_version: group.version, options },
    });
  };
  const inUse = (response: { statusCode: number; body: string; json(): unknown }, ids: string[]) => {
    expect(response.statusCode, response.body).toBe(409);
    expect((response.json() as { error: unknown }).error).toMatchObject({ code: 'CONFIG_IN_USE', details: { used_by: { entity: 'recipe', ids } } });
  };

  // ------------------------------------------------------------------------------------------------------ C-11
  it('[08b #22] C-11 archive: a line of a non-archived recipe’s draft or published version → 409 recipe; superseded or archived → 200; +1 statement only when archiving', async () => {
    const { beef, ghee, onion, makhan } = fx.stock;
    const draftUse = await insertRecipe('menu_item', fx.items.tawaPiece, { basis: 'per_unit' }, [{ status: 'draft', lines: [{ stock_item_id: beef, stock_unit: 'g' }] }]);
    const publishedUse = await insertRecipe('menu_item', fx.items.naan, { basis: 'per_unit' }, [
      { status: 'published', lines: [{ stock_item_id: beef, stock_unit: 'g' }, { stock_item_id: ghee, stock_unit: 'g' }] },
    ]);
    // onion only on a superseded version; makhan only on an archived recipe's lines
    await insertRecipe('menu_item', fx.items.lassi, { basis: 'per_measure', measure_unit: 'ml' }, [
      { status: 'superseded', lines: [{ stock_item_id: onion, stock_unit: 'g' }] },
      { status: 'published', lines: [{ stock_item_id: ghee, stock_unit: 'g' }] },
    ]);
    const archived = await insertRecipe('modifier_option', fx.options.spicy, { basis: 'per_unit' }, [
      { status: 'published', lines: [{ stock_item_id: makhan, stock_unit: 'g' }] },
    ]);
    await archiveRecipe(archived);

    const refused = await patchStock(beef, { archived: true });
    inUse(refused, [draftUse, publishedUse].sort());
    // tenant-wide, lock, drawers (R2), recipe uses (C-11) → 409
    expect(counter.count).toBe(4);
    expect(recipeReads()).toBe(1);

    // a name-only change reads no recipe
    const renamed = await patchStock(beef, { name: 'Beef (boneless)' });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(recipeReads()).toBe(0);
    expect(counter.count).toBe(6); // tenant-wide, lock, update, audit, 2 bump

    for (const id of [onion, makhan]) {
      const ok = await patchStock(id, { archived: true });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(counter.count).toBe(8); // tenant-wide, lock, drawers, recipe uses (+1, C-11), update, audit, 2 bump
      expect(recipeReads()).toBe(1);
    }

    await archiveRecipe(draftUse);
    inUse(await patchStock(beef, { archived: true }), [publishedUse]);
    await archiveRecipe(publishedUse);
    const archivedBeef = await patchStock(beef, { archived: true });
    expect(archivedBeef.statusCode, archivedBeef.body).toBe(200);
    expect(archivedBeef.json().data.stock_item.archived_at).not.toBeNull();
  });

  it('[08b #22] C-11 stock_unit: a non-archived published line freezes it → 409 recipe; a draft-only line does not; +1 statement only when stock_unit changes', async () => {
    const { beef, ghee, onion } = fx.stock;
    const published = await insertRecipe('menu_item', fx.items.tawaPiece, { basis: 'per_unit' }, [
      { status: 'published', lines: [{ stock_item_id: beef, stock_unit: 'g' }] },
      { status: 'draft', lines: [{ stock_item_id: ghee, stock_unit: 'g' }] },
    ]);
    await insertRecipe('menu_item', fx.items.naan, { basis: 'per_unit' }, [{ status: 'draft', lines: [{ stock_item_id: onion, stock_unit: 'g' }] }]);

    inUse(await patchStock(beef, { stock_unit: 'ml' }), [published]);
    expect(counter.count).toBe(4); // tenant-wide, lock, drawers (R1), recipe uses (C-11)
    expect(recipeReads()).toBe(1);

    // a draft line freezes nothing (it is re-resolved at publish, B6 unit_changed)
    for (const id of [ghee, onion]) {
      const ok = await patchStock(id, { stock_unit: 'ml' });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(counter.count).toBe(8);
      expect(recipeReads()).toBe(1);
    }

    await archiveRecipe(published);
    const ok = await patchStock(beef, { stock_unit: 'ml' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().data.stock_item.stock_unit).toBe('ml');
  });

  it('[08b #22] C-11 (N-1 b): a prepared owner’s own stock_unit change → 409 recipe; archiving the owner stays allowed; 200 after the recipe is archived', async () => {
    const { payeCooked } = fx.stock;
    const own = await insertRecipe('stock_item', payeCooked, { basis: 'per_batch', batch_stock_unit: 'piece' }, [
      { status: 'draft', lines: [{ stock_item_id: fx.stock.payeRaw, stock_unit: 'g' }] },
    ]);
    // even a draft-only recipe: batch_yield_qty is in the owner's unit
    inUse(await patchStock(payeCooked, { stock_unit: 'g' }), [own]);
    expect(recipeReads()).toBe(1);

    await archiveRecipe(own);
    const ok = await patchStock(payeCooked, { stock_unit: 'g' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().data.stock_item.stock_unit).toBe('g');

    // an owner that owns a non-archived recipe can itself be archived (B17 last sentence); only lines block archive
    const gravy = (await createStockItem(cloud, fx.f, { name: 'Gravy base', stock_unit: 'g', carries_over: false })).stock_item_id;
    await insertRecipe('stock_item', gravy, { basis: 'per_batch', batch_stock_unit: 'g' }, [
      { status: 'published', lines: [{ stock_item_id: fx.stock.oil, stock_unit: 'ml' }] },
    ]);
    const archived = await patchStock(gravy, { archived: true });
    expect(archived.statusCode, archived.body).toBe(200);
  });

  // ------------------------------------------------------------------------------------------------------- P-2
  it('[08b #22] P-2 (08a R4): a kind change of a stock item that owns a non-archived recipe → 409 recipe; +1 statement only when kind changes; 200 after archive', async () => {
    const gravy = (await createStockItem(cloud, fx.f, { name: 'Gravy base', stock_unit: 'g', carries_over: false })).stock_item_id;
    const own = await insertRecipe('stock_item', gravy, { basis: 'per_batch', batch_stock_unit: 'g' }, [
      { status: 'published', lines: [{ stock_item_id: fx.stock.oil, stock_unit: 'ml' }] },
    ]);
    // a recipe that only USES gravy as a line does not block its kind change; only ownership does
    await insertRecipe('menu_item', fx.items.naan, { basis: 'per_unit' }, [{ status: 'published', lines: [{ stock_item_id: gravy, stock_unit: 'g' }] }]);
    inUse(await patchStock(gravy, { kind: 'ingredient' }), [own]);
    expect(counter.count).toBe(5); // tenant-wide, lock, drawers (R4), branch rows (R4), recipe owner (P-2)
    expect(recipeReads()).toBe(1);

    const recategorised = await patchStock(gravy, { cost_category: 'packaging' });
    expect(recategorised.statusCode, recategorised.body).toBe(200);
    expect(recipeReads()).toBe(0);
    expect(counter.count).toBe(6); // tenant-wide, lock, update, audit, 2 bump (⚠️ 08b P-1, B16: cost_category is in inventory.items[])

    await archiveRecipe(own);
    const ok = await patchStock(gravy, { kind: 'ingredient' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().data.stock_item.kind).toBe('ingredient');
    expect(recipeReads()).toBe(1);
    expect(counter.count).toBe(9); // tenant-wide, lock, drawers, branch rows, recipes (+1, P-2), update, audit, 2 bump (⚠️ 08b P-1)

    // any kind change reads recipes (P-2 "+1 only when kind changes"), not only one away from prepared
    const packet = await patchStock(gravy, { kind: 'packet' });
    expect(packet.statusCode, packet.body).toBe(200);
    expect(recipeReads()).toBe(1);
    expect(counter.count).toBe(7); // tenant-wide, lock, recipes (+1, P-2), update, audit, 2 bump (⚠️ 08b P-1)
  });

  // ------------------------------------------------------------------------------------------------------ C-14
  it('[08b #22] C-14: any sale_unit change (g ↔ ml included) of an item owning a non-archived recipe → 409 recipe; +1 statement only when sale_unit changes; 200 after archive', async () => {
    const karahi = fx.items.chickenKarahi;
    const own = await insertRecipe('menu_item', karahi, { basis: 'per_measure', measure_unit: 'g' }, [
      { status: 'published', lines: [{ stock_item_id: fx.stock.beef, stock_unit: 'g' }] },
    ]);
    const refused = await patchItem(karahi, { sale_unit: 'ml' });
    inUse(refused, [own]);
    expect(recipeReads()).toBe(1);
    expect(counter.count).toBe(10); // tenant-wide, item read, item lock, windows, draws, routes, goes_with, category FOR SHARE, R6 deal read, C-14 recipes read

    const repriced = await patchItem(karahi, { price_minor: 230_000 });
    expect(repriced.statusCode, repriced.body).toBe(200);
    expect(recipeReads()).toBe(0);
    expect(counter.count).toBe(12); // the same PATCH without sale_unit: no R6 read, no recipes read

    // an item with no recipe: the read runs (+1) and finds nothing
    const lassi = await patchItem(fx.items.lassi, { sale_unit: 'g' });
    expect(lassi.statusCode, lassi.body).toBe(200);
    expect(recipeReads()).toBe(1);
    expect(counter.count).toBe(14); // 12 + R6's deal read + the C-14 recipes read

    await archiveRecipe(own);
    const ok = await patchItem(karahi, { sale_unit: 'ml' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().data.item.sale_unit).toBe('ml');
    expect(recipeReads()).toBe(1);
  });

  // ------------------------------------------------------------------------------------------------------ C-15
  it('[08b #22] C-15: a plain option owning a non-archived recipe cannot gain a linked_item_id → 409 recipe; +1 statement only when an option becomes linked; 200 after archive', async () => {
    const { spicy, noOnion } = fx.options;
    const own = await insertRecipe('modifier_option', spicy, { basis: 'per_unit' }, [{ status: 'published', lines: [{ stock_item_id: fx.stock.ghee, stock_unit: 'g' }] }]);
    inUse(await patchOptions({ [spicy]: { linked_item_id: fx.items.naan } }), [own]);
    expect(recipeReads()).toBe(1);
    expect(counter.count).toBe(7); // tenant-wide, group lock, options, links, items FOR SHARE, R4 names, C-15 recipes read

    // a rename of the recipe's option (no link gained) reads no recipe
    const renamed = await patchOptions({ [spicy]: { name: 'Extra spicy' } });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(recipeReads()).toBe(0);
    expect(counter.count).toBe(13);

    // another plain option without a recipe becomes linked: the read runs (+1), nothing found
    const linked = await patchOptions({ [noOnion]: { linked_item_id: fx.items.naan } });
    expect(linked.statusCode, linked.body).toBe(200);
    expect(recipeReads()).toBe(1);
    expect(counter.count).toBe(14); // the same write as the rename + the C-15 recipes read

    await archiveRecipe(own);
    const ok = await patchOptions({ [spicy]: { linked_item_id: fx.items.tawaPiece } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().data.modifier_group.options.find((o: { option_id: string }) => o.option_id === spicy).linked_item_id).toBe(fx.items.tawaPiece);
  });
});
