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
