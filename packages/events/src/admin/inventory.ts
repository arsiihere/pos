import { yieldBpFromTest } from '@pos/domain';
import { z } from 'zod';
// 08a §5.3, §6.1–§6.7: inventory config wires and bodies, shared by the cloud routes and apps/client (browser-safe:
// zod only). BIGINT values travel as decimal strings where §5.3 says so (m-12); money is integer minor units.
import { StockDrawer, StockItemBranchWire, StockItemKind, StockItemWire } from './menu-variants.js';

const Unit = z.enum(['piece', 'g', 'ml']);
const Id = z.string().min(1);
const DecimalString = z.string().regex(/^[0-9]+$/);

// §3.3: ≤ 200 chars after trim; empty → null
export const InventoryNote = z
  .string()
  .trim()
  .max(200)
  .transform((s) => (s === '' ? null : s))
  .nullable()
  .default(null);

// ------------------------------------------------------------------------------------------------------- wires

// §5.3; is_current = the latest row among those with its name and base_unit = the item's current stock_unit (N-1)
export const ItemUnitWire = z.object({
  unit_row_id: z.string(),
  unit_name: z.string(),
  base_unit: Unit,
  factor_num: DecimalString,
  factor_den: z.number().int(),
  is_current: z.boolean(),
  note: z.string().nullable(),
  recorded_by: z.string(),
  recorded_by_name: z.string(),
  created_at: z.number(),
});
export type ItemUnitWire = z.infer<typeof ItemUnitWire>;

export const ItemPriceKind = z.enum(['manual', 'market_rate']);
export type ItemPriceKind = z.infer<typeof ItemPriceKind>;

export const ItemPriceWire = z.object({
  price_id: z.string(),
  branch_id: z.string().nullable(),
  kind: ItemPriceKind,
  unit_name: z.string(),
  price_minor: z.number().int(),
  stock_qty_num: DecimalString,
  stock_qty_den: DecimalString,
  stock_unit: Unit,
  created_at: z.number(),
  valid_until_at: z.number().nullable(),
  note: z.string().nullable(),
  recorded_by: z.string(),
  recorded_by_name: z.string(),
});
export type ItemPriceWire = z.infer<typeof ItemPriceWire>;

// §5.3: display only, never stored or reused in a calculation; below_one_minor → "< Rs 0.01" (m-1)
export const MenuCostWire = z.object({
  branch_id: z.string().nullable(),
  price_id: z.string(),
  per_stock_unit: z.object({ num: DecimalString, den: DecimalString }),
  display_per: z.object({ unit: z.enum(['kg', 'l', 'piece']), minor: DecimalString, below_one_minor: z.boolean() }),
});
export type MenuCostWire = z.infer<typeof MenuCostWire>;

export const YieldProfileWire = z.object({
  yield_profile_id: z.string(),
  yield_bp: z.number().int(),
  test_ap_qty: DecimalString.nullable(),
  test_ep_qty: DecimalString.nullable(),
  test_unit: Unit.nullable(),
  note: z.string().nullable(),
  recorded_by: z.string(),
  recorded_by_name: z.string(),
  created_at: z.number(),
});
export type YieldProfileWire = z.infer<typeof YieldProfileWire>;

// ----------------------------------------------------------------------------------------- §6.1 list (changed)

export const StockItemListQuery = z.object({
  status: z.enum(['active', 'archived']).default('active'),
  kind: StockItemKind.optional(),
  branch_id: Id.optional(),
});
export type StockItemListQueryInput = z.infer<typeof StockItemListQuery>;

export const StockItemListResponse = z.object({
  data: z.object({
    can_edit_tenant: z.boolean(),
    stock_items: z.array(
      StockItemWire.extend({
        branches: z.array(StockItemBranchWire),
        drawers: z.array(StockDrawer),
        menu_cost: MenuCostWire.nullable(),
      }),
    ),
  }),
});

// ---------------------------------------------------------------------------------------------- §6.4 detail

export const InventoryDetailQuery = z.object({ branch_id: Id.optional() });

export const BuiltinUnitWire = z.object({ unit_name: z.string(), base: Unit, num: z.number().int(), den: z.number().int() });

export const InventoryDetailResponse = z.object({
  data: z.object({
    can_edit_tenant: z.boolean(),
    stock_item: StockItemWire,
    builtin_units: z.array(BuiltinUnitWire),
    units: z.array(ItemUnitWire),
    prices: z.array(ItemPriceWire),
    menu_cost: MenuCostWire.nullable(),
    yields: z.array(YieldProfileWire),
    active_yield: YieldProfileWire.nullable(),
  }),
});

// ------------------------------------------------------------------------------------------------ §6.5 units

// I4: 1–20 chars, trimmed, lowercase, [a-z0-9 ._-]
export const ItemUnitName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9 ._-]{1,20}$/);

export const CreateItemUnitBody = z.object({
  unit_name: ItemUnitName,
  factor_num: z.number().int().min(1).max(1_000_000_000),
  factor_den: z.number().int().min(1).max(1_000_000).default(1),
  note: InventoryNote,
});
export type CreateItemUnitInput = z.infer<typeof CreateItemUnitBody>;
export type CreateItemUnitRequest = z.input<typeof CreateItemUnitBody>;
export const ItemUnitResponse = z.object({ data: z.object({ unit: ItemUnitWire }) });

// ----------------------------------------------------------------------------------------------- §6.6 prices

export const VALID_FOR_HOURS_DEFAULT = 24;

// manual: no branch_id, no valid_for_hours (400, M-6, OQ-3); market_rate: valid_for_hours 1 … 720, default 24
export const CreateItemPriceBody = z
  .object({
    kind: ItemPriceKind,
    branch_id: Id.nullable().default(null),
    valid_for_hours: z.number().int().min(1).max(720).optional(),
    unit_name: ItemUnitName, // I4 pattern; resolution (422 not_convertible) is the route's
    price_minor: z.number().int().min(1).max(1_000_000_000),
    note: InventoryNote,
  })
  .refine((b) => b.kind === 'market_rate' || b.branch_id === null, { message: 'a manual price is for every branch', path: ['branch_id'] })
  .refine((b) => b.kind === 'market_rate' || b.valid_for_hours === undefined, {
    message: 'only a market rate has a validity',
    path: ['valid_for_hours'],
  })
  .transform((b) => ({ ...b, valid_for_hours: b.kind === 'market_rate' ? (b.valid_for_hours ?? VALID_FOR_HOURS_DEFAULT) : null }));
export type CreateItemPriceInput = z.infer<typeof CreateItemPriceBody>;
export type CreateItemPriceRequest = z.input<typeof CreateItemPriceBody>;
export const ItemPriceResponse = z.object({ data: z.object({ price: ItemPriceWire, menu_cost: MenuCostWire.nullable() }) });

// ----------------------------------------------------------------------------------------------- §6.7 yields

const TestQty = z.number().int().min(1).max(1_000_000_000);

// exactly one form; a computed yield_bp outside 1 … 50 000 → 400 (I8, yieldBpFromTest)
export const CreateYieldBody = z
  .object({
    yield_bp: z.number().int().min(1).max(50_000).optional(),
    test_ap_qty: TestQty.optional(),
    test_ep_qty: TestQty.optional(),
    note: InventoryNote,
  })
  .refine(
    (b) =>
      b.yield_bp !== undefined
        ? b.test_ap_qty === undefined && b.test_ep_qty === undefined
        : b.test_ap_qty !== undefined && b.test_ep_qty !== undefined,
    { message: 'send yield_bp or both test quantities' },
  )
  .refine(
    (b) => {
      if (b.test_ap_qty === undefined || b.test_ep_qty === undefined) return true;
      try {
        yieldBpFromTest(b.test_ap_qty, b.test_ep_qty);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'yield out of range (0.01 % … 500 %)', path: ['test_ep_qty'] },
  );
export type CreateYieldInput = z.infer<typeof CreateYieldBody>;
export type CreateYieldRequest = z.input<typeof CreateYieldBody>;
export const YieldProfileResponse = z.object({ data: z.object({ yield: YieldProfileWire }) });

// inferred response data types (client, u1)
export type StockItemListData = z.infer<typeof StockItemListResponse>['data'];
export type StockItemListEntry = StockItemListData['stock_items'][number];
export type InventoryDetail = z.infer<typeof InventoryDetailResponse>['data'];
export type ItemUnitCreated = z.infer<typeof ItemUnitResponse>['data'];
export type ItemPriceCreated = z.infer<typeof ItemPriceResponse>['data'];
export type YieldProfileCreated = z.infer<typeof YieldProfileResponse>['data'];
export type BuiltinUnitWire = z.infer<typeof BuiltinUnitWire>;
