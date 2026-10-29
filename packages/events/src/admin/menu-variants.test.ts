import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  CreateDealBody,
  CreateModifierGroupBody,
  CreateStockItemBody,
  CreateVariantGroupBody,
  PatchDealBody,
  PatchModifierGroupBody,
  PatchStockItemBody,
  PatchVariantGroupBody,
  PutDealBranchBody,
  PutModifierGroupBranchBody,
  PutStockItemBranchBody,
} from './menu-variants';

const V = 'a'.repeat(64);

function issuePaths(schema: z.ZodType, body: unknown): string[] {
  const result = schema.safeParse(body);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join('.'));
}

const option = (o: Record<string, unknown> = {}) => ({ name: 'Raita', price_minor: 5_000, ...o });
const choice = (item_id: string, o: Record<string, unknown> = {}) => ({ item_id, ...o });
const aDeal = (o: Record<string, unknown> = {}) => ({
  name: 'Family deal',
  category_id: 'C1',
  tax_class_id: null,
  price_minor: 250_000,
  parts: [{ quantity: 2, choices: [choice('I1')] }],
  ...o,
});

describe('01c admin wires (§6, C6, C9)', () => {
  it('[01c §6, C6] a repeated option_id on the modifier group PATCH → issue path options.1.option_id', () => {
    const body = {
      expected_version: V,
      options: [option({ option_id: 'O1' }), option({ option_id: 'O1', name: 'Salad' })],
    };
    expect(issuePaths(PatchModifierGroupBody, body)).toContain('options.1.option_id');
  });

  it('[01c §6.11, C6] two links for one target → issue path links.1.target_id; another kind is a different key', () => {
    const links = [
      { target_kind: 'item', target_id: 'I1', mode: 'attach' },
      { target_kind: 'item', target_id: 'I1', mode: 'detach' },
    ];
    expect(issuePaths(CreateModifierGroupBody, { name: 'Sides', min_choices: 0, max_choices: 1, options: [option()], links })).toContain(
      'links.1.target_id',
    );
    expect(issuePaths(PatchModifierGroupBody, { expected_version: V, links })).toContain('links.1.target_id');
    const distinct = [
      { target_kind: 'item', target_id: 'X1', mode: 'attach' },
      { target_kind: 'variant_group', target_id: 'X1', mode: 'attach' },
    ];
    expect(CreateModifierGroupBody.safeParse({ name: 'Sides', min_choices: 0, max_choices: 1, options: [option()], links: distinct }).success).toBe(
      true,
    );
  });

  it('[01c §6.14, C6] one item twice in a part → issue path parts.0.choices.1.item_id (create and PATCH)', () => {
    const parts = [{ quantity: 1, choices: [choice('I1'), choice('I1')] }];
    expect(issuePaths(CreateDealBody, aDeal({ parts }))).toContain('parts.0.choices.1.item_id');
    expect(issuePaths(PatchDealBody, { expected_version: V, parts })).toContain('parts.0.choices.1.item_id');
  });

  it('[01c §6.15, C6] a repeated deal_part_id → issue path parts.1.deal_part_id', () => {
    const parts = [
      { deal_part_id: 'P1', quantity: 1, choices: [choice('I1')] },
      { deal_part_id: 'P1', quantity: 1, choices: [choice('I2')] },
    ];
    expect(issuePaths(PatchDealBody, { expected_version: V, parts })).toContain('parts.1.deal_part_id');
  });

  it('[01c §6.12a, C6] a repeated option_id on the branch PUT → issue path options.1.option_id', () => {
    const body = {
      expected_version: V,
      options: [
        { option_id: 'O1', is_offered: false },
        { option_id: 'O1', is_offered: true, price_minor_override: 100 },
      ],
    };
    expect(issuePaths(PutModifierGroupBranchBody, body)).toContain('options.1.option_id');
  });

  it('[01c C9] each PATCH body with only expected_version fails; one more field passes', () => {
    for (const schema of [PatchVariantGroupBody, PatchStockItemBody, PatchModifierGroupBody, PatchDealBody]) {
      expect(schema.safeParse({ expected_version: V }).success).toBe(false);
      expect(schema.safeParse({ expected_version: V, archived: true }).success).toBe(true);
      expect(schema.safeParse({ archived: true }).success).toBe(false);
    }
  });

  it('[01c §6.11] POST options carrying an option_id fail; POST parts carrying a deal_part_id fail', () => {
    const group = { name: 'Sides', min_choices: 0, max_choices: 1, options: [option({ option_id: 'O1' })] };
    expect(CreateModifierGroupBody.safeParse(group).success).toBe(false);
    expect(CreateModifierGroupBody.safeParse({ ...group, options: [option()] }).success).toBe(true);
    const parts = [{ deal_part_id: 'P1', quantity: 1, choices: [choice('I1')] }];
    expect(CreateDealBody.safeParse(aDeal({ parts })).success).toBe(false);
  });

  it('[01c §6.14, §6.15 R3] a single choice with an extra fails on POST; the PATCH schema parses it (R3 is the service\'s)', () => {
    const parts = [{ quantity: 1, choices: [choice('I1', { extra_price_minor: 100 })] }];
    expect(issuePaths(CreateDealBody, aDeal({ parts }))).toContain('parts.0.choices.0.extra_price_minor');
    expect(PatchDealBody.safeParse({ expected_version: V, parts }).success).toBe(true);
  });

  it('[01c §6.16] { is_sold: false, price_minor_override: 1 } fails; is_sold: true with it passes', () => {
    expect(PutDealBranchBody.safeParse({ expected_version: V, is_sold: false, price_minor_override: 1 }).success).toBe(false);
    expect(PutDealBranchBody.safeParse({ expected_version: V, is_sold: true, price_minor_override: 1 }).success).toBe(true);
    expect(PutDealBranchBody.parse({ expected_version: V, is_sold: false })).toEqual({
      expected_version: V,
      is_sold: false,
      price_minor_override: null,
    });
  });

  it('[01c §6.12a, V19] is_offered: false with an override fails', () => {
    const body = { expected_version: V, options: [{ option_id: 'O1', is_offered: false, price_minor_override: 1 }] };
    expect(PutModifierGroupBranchBody.safeParse(body).success).toBe(false);
    expect(PutModifierGroupBranchBody.safeParse({ expected_version: V, options: [] }).success).toBe(true);
  });

  it('[01c §6.9] station_id null with a threshold fails; a set row defaults the threshold to null', () => {
    expect(PutStockItemBranchBody.safeParse({ expected_version: V, station_id: null, low_stock_threshold: 0 }).success).toBe(false);
    expect(PutStockItemBranchBody.parse({ expected_version: V, station_id: 'ST1' })).toEqual({
      expected_version: V,
      station_id: 'ST1',
      low_stock_threshold: null,
    });
  });

  it('[01c §3.3] ranges and defaults of the create bodies', () => {
    expect(CreateVariantGroupBody.parse({ name: ' Karahi ', category_id: 'C1' })).toEqual({
      name: 'Karahi',
      category_id: 'C1',
      description: null,
      sort_order: 0,
    });
    expect(CreateVariantGroupBody.safeParse({ name: 'x'.repeat(61), category_id: 'C1' }).success).toBe(false);
    expect(CreateStockItemBody.parse({ name: 'Naan dough', stock_unit: 'g' })).toEqual({
      name: 'Naan dough',
      stock_unit: 'g',
      carries_over: false,
    });
    expect(CreateStockItemBody.safeParse({ name: 'Naan', stock_unit: 'kg' }).success).toBe(false);
    const group = (o: Record<string, unknown>) => ({ name: 'Sides', min_choices: 0, max_choices: 1, options: [option()], ...o });
    expect(CreateModifierGroupBody.safeParse(group({ name: 'x'.repeat(41) })).success).toBe(false);
    expect(CreateModifierGroupBody.safeParse(group({ min_choices: 2, max_choices: 1 })).success).toBe(false);
    expect(CreateModifierGroupBody.safeParse(group({ options: [] })).success).toBe(false);
    expect(CreateModifierGroupBody.safeParse(group({ options: [option({ price_minor: undefined })] })).success).toBe(false);
    expect(CreateModifierGroupBody.safeParse(group({ options: [option({ max_quantity: 21 })] })).success).toBe(false);
    expect(CreateModifierGroupBody.safeParse(group({ links: [{ target_kind: 'category', target_id: 'C1', mode: 'detach' }] })).success).toBe(
      false,
    );
    const parsed = CreateModifierGroupBody.parse(group({ options: [{ name: 'Naan', linked_item_id: 'I1' }] }));
    expect(parsed.options[0]).toEqual({ name: 'Naan', price_minor: null, max_quantity: 1, is_default: false, linked_item_id: 'I1', sort_order: 0 });
    expect(parsed.links).toEqual([]);
    expect(CreateDealBody.safeParse(aDeal({ parts: [] })).success).toBe(false);
    expect(
      CreateDealBody.safeParse(aDeal({ parts: [{ quantity: 1, choices: [choice('I1'), choice('I2', { extra_price_minor: 100 })] }] })).success,
    ).toBe(true);
    expect(CreateDealBody.safeParse(aDeal({ tax_class_id: undefined })).success).toBe(false);
  });
});
