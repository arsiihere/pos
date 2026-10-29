import type { CreateVariantGroupRequest, VariantGroupWire } from '@pos/events';
import { owner, type RestaurantFixture } from './restaurant';
import type { TestCloud } from './test-cloud';

// 01c test helpers (task 11; later tasks add stock items, modifier groups, deals and SQL seeds).

// §6.1 through the API: the created group's wire, or a thrown error with the response body.
export async function createVariantGroup(
  cloud: TestCloud,
  f: RestaurantFixture,
  body: CreateVariantGroupRequest,
): Promise<VariantGroupWire> {
  const response = await cloud.app.inject({ method: 'POST', url: '/v1/admin/variant-groups', ...owner(f), payload: body });
  if (response.statusCode !== 201) throw new Error(`create variant group failed: ${response.statusCode} ${response.body}`);
  return response.json().data.variant_group as VariantGroupWire;
}

// A stock item written by SQL until §6.7's route exists (task 16 moves callers to the API).
export async function seedStockItem(
  cloud: TestCloud,
  f: RestaurantFixture,
  o: { stockItemId: string; name?: string; stockUnit: 'piece' | 'g' | 'ml'; archived?: boolean },
): Promise<string> {
  await cloud.pool.query(
    `INSERT INTO stock_items (tenant_id, stock_item_id, name, stock_unit, archived_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 0, 0)`,
    [f.tenantId, o.stockItemId, o.name ?? o.stockItemId, o.stockUnit, o.archived === true ? 1 : null],
  );
  return o.stockItemId;
}

// P-4: a modifier group and its options written by SQL until §6.10's route exists (task 15; §6.5 R4, R10 read them).
export async function seedModifierGroupRows(
  cloud: TestCloud,
  f: RestaurantFixture,
  o: {
    modifierGroupId: string;
    name?: string;
    archived?: boolean;
    options: ReadonlyArray<{ optionId: string; name?: string; linkedItemId?: string; priceMinor?: number; archived?: boolean }>;
  },
): Promise<string> {
  await cloud.pool.query(
    `INSERT INTO modifier_groups (tenant_id, modifier_group_id, name, min_choices, max_choices, archived_at, created_at, updated_at)
     VALUES ($1, $2, $3, 0, 1, $4, 0, 0)`,
    [f.tenantId, o.modifierGroupId, o.name ?? o.modifierGroupId, o.archived === true ? 1 : null],
  );
  for (const [index, option] of o.options.entries()) {
    await cloud.pool.query(
      `INSERT INTO modifier_options (tenant_id, option_id, modifier_group_id, name, price_minor, linked_item_id, sort_order, archived_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        f.tenantId,
        option.optionId,
        o.modifierGroupId,
        option.name ?? option.optionId,
        option.priceMinor ?? (option.linkedItemId === undefined ? 0 : null),
        option.linkedItemId ?? null,
        index,
        option.archived === true ? 1 : null,
      ],
    );
  }
  return o.modifierGroupId;
}

// P-4: a deal, its parts and their choices written by SQL until §6.14's route exists (task 15; §6.5 R4, R6 read them).
export async function seedDealPartRows(
  cloud: TestCloud,
  f: RestaurantFixture,
  o: {
    dealId: string;
    categoryId: string;
    name?: string;
    archived?: boolean;
    parts: ReadonlyArray<{ dealPartId: string; quantity?: number; archived?: boolean; choices: readonly string[] }>;
  },
): Promise<string> {
  await cloud.pool.query(
    `INSERT INTO deals (tenant_id, deal_id, category_id, name, price_minor, archived_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 0, $5, 0, 0)`,
    [f.tenantId, o.dealId, o.categoryId, o.name ?? o.dealId, o.archived === true ? 1 : null],
  );
  for (const [index, part] of o.parts.entries()) {
    await cloud.pool.query(
      `INSERT INTO deal_parts (tenant_id, deal_part_id, deal_id, quantity, sort_order, archived_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [f.tenantId, part.dealPartId, o.dealId, part.quantity ?? 1, index, part.archived === true ? 1 : null],
    );
    for (const [order, itemId] of part.choices.entries()) {
      await cloud.pool.query(
        `INSERT INTO deal_part_choices (tenant_id, deal_part_id, item_id, sort_order) VALUES ($1, $2, $3, $4)`,
        [f.tenantId, part.dealPartId, itemId, order],
      );
    }
  }
  return o.dealId;
}
