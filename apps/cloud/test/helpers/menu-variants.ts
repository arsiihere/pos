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
