import { z } from 'zod';

// 01c §5.4, §6 (01a D5): the owner admin bodies and wires for variant groups, stock items, modifier groups
// and deals, shared by the cloud routes and apps/client (browser-safe: zod only). Versions are built only in
// apps/cloud/src/modules/menu-variants/versions.ts (V13).

// §3.3 ranges. Name lengths per entity; INT columns keep 01a's sort_order range; descriptions as 01a items.
const Name60 = z.string().trim().min(1).max(60);
const Name40 = z.string().trim().min(1).max(40);
const Id = z.string().min(1);
const Version = z.string().min(1);
const SortOrder = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const Description = z.string().max(300).nullable();
const PriceMinor = z.number().int().min(0).max(1_000_000_000);
const Unit = z.enum(['piece', 'g', 'ml']);
const LowStockThreshold = z.number().int().min(0).max(1_000_000).nullable();
const MinChoices = z.number().int().min(0).max(50);
const MaxChoices = z.number().int().min(1).max(50);
const MaxQuantity = z.number().int().min(1).max(20);
const PartQuantity = z.number().int().min(1).max(1_000_000);
const TargetKind = z.enum(['category', 'variant_group', 'item']);
const LinkMode = z.enum(['attach', 'detach']);
// 01a S47 windows (0–4; minutes of the day, start ≠ end), as the 01a item and category bodies.
const TimeOfDayMs = z.number().int().min(0).max(86_340_000).multipleOf(60_000);
const AvailabilityWindows = z
  .array(
    z
      .object({ start_ms: TimeOfDayMs, end_ms: TimeOfDayMs })
      .refine((w) => w.start_ms !== w.end_ms, { message: 'start_ms and end_ms must differ' }),
  )
  .max(4);

// C6: a second entry for one key → 400 at `<list>.N.<key>`, N the repeat as sent. Entries without the key
// (new options and parts) are not compared.
function uniqueBy<T>(key: (entry: T) => string | undefined, field: string) {
  return (entries: readonly T[], ctx: z.RefinementCtx): void => {
    const seen = new Set<string>();
    entries.forEach((entry, i) => {
      const k = key(entry);
      if (k === undefined) return;
      if (seen.has(k)) ctx.addIssue({ code: 'custom', path: [i, field], message: `duplicate ${field}` });
      seen.add(k);
    });
  };
}

// C9: a PATCH whose only key is expected_version → 400.
function notVersionOnly(body: Record<string, unknown>): boolean {
  return Object.entries(body).some(([key, value]) => key !== 'expected_version' && value !== undefined);
}
const VERSION_ONLY = { message: 'a field besides expected_version is required' };

// ---------------------------------------------------------------------------------------------- variant groups

// §6.1
export const CreateVariantGroupBody = z.object({
  name: Name60,
  category_id: Id,
  description: Description.default(null),
  sort_order: SortOrder.default(0),
});

// §6.2
export const PatchVariantGroupBody = z
  .object({
    expected_version: Version,
    name: Name60.optional(),
    category_id: Id.optional(),
    description: Description.optional(),
    sort_order: SortOrder.optional(),
    archived: z.boolean().optional(),
  })
  .refine(notVersionOnly, VERSION_ONLY);

export const VariantGroupWire = z.object({
  variant_group_id: z.string(),
  name: z.string(),
  category_id: z.string(),
  description: z.string().nullable(),
  sort_order: z.number(),
  archived_at: z.number().nullable(),
  member_ids: z.array(z.string()),
  version: z.string(),
});
export type VariantGroupWire = z.infer<typeof VariantGroupWire>;

export const VariantGroupResponse = z.object({ data: z.object({ variant_group: VariantGroupWire }) });

// ------------------------------------------------------------------------------------------------ stock items

// §6.7
export const CreateStockItemBody = z.object({
  name: Name60,
  stock_unit: Unit,
  carries_over: z.boolean().default(false),
});

// §6.8
export const PatchStockItemBody = z
  .object({
    expected_version: Version,
    name: Name60.optional(),
    stock_unit: Unit.optional(),
    carries_over: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine(notVersionOnly, VERSION_ONLY);

// §6.9: station_id null removes the row; a threshold with it → 400. A set row sends the whole row.
export const PutStockItemBranchBody = z
  .object({
    expected_version: Version,
    station_id: Id.nullable(),
    low_stock_threshold: LowStockThreshold.default(null),
  })
  .refine((body) => body.station_id !== null || body.low_stock_threshold === null, {
    message: 'a removed row has no threshold',
    path: ['low_stock_threshold'],
  });

export const StockItemWire = z.object({
  stock_item_id: z.string(),
  name: z.string(),
  stock_unit: Unit,
  carries_over: z.boolean(),
  archived_at: z.number().nullable(),
  version: z.string(),
});
export type StockItemWire = z.infer<typeof StockItemWire>;

// §5.4: station_id null = no row at that branch (not counted there), with the "no row" version.
export const StockItemBranchWire = z.object({
  branch_id: z.string(),
  station_id: z.string().nullable(),
  low_stock_threshold: z.number().nullable(),
  version: z.string(),
});
export type StockItemBranchWire = z.infer<typeof StockItemBranchWire>;

const StockDrawer = z.object({
  item_id: z.string(),
  name: z.string(),
  variant_name: z.string().nullable(),
  quantity_per_sale_unit: z.number(),
});

// §6.6
export const StockItemListResponse = z.object({
  data: z.object({
    can_edit_tenant: z.boolean(),
    stock_items: z.array(StockItemWire.extend({ branches: z.array(StockItemBranchWire), drawers: z.array(StockDrawer) })),
  }),
});
export const StockItemResponse = z.object({ data: z.object({ stock_item: StockItemWire }) });
export const StockItemBranchResponse = z.object({ data: z.object({ branch: StockItemBranchWire.nullable() }) });

// -------------------------------------------------------------------------------------------- modifier groups

// §3.3: a plain option has a price; a linked option's null price means the item's price.
const optionFields = {
  name: Name40,
  price_minor: PriceMinor.nullable().default(null),
  max_quantity: MaxQuantity.default(1),
  is_default: z.boolean().default(false),
  linked_item_id: Id.nullable().default(null),
  sort_order: SortOrder.default(0),
};
const plainOptionHasPrice = {
  check: (o: { price_minor: number | null; linked_item_id: string | null }) => o.linked_item_id !== null || o.price_minor !== null,
  params: { message: 'a plain option needs price_minor', path: ['price_minor'] },
};
// §6.11: POST options carry no ids.
const NewOption = z
  .object({ option_id: z.never().optional(), ...optionFields })
  .refine(plainOptionHasPrice.check, plainOptionHasPrice.params);
// §6.12, V14: an entry with an id updates (or restores) that option; without one it is new.
const OptionEntry = z
  .object({ option_id: Id.optional(), ...optionFields })
  .refine(plainOptionHasPrice.check, plainOptionHasPrice.params);

// §3.3: detach is not allowed on a category; one link per (target_kind, target_id) (C6).
const Link = z
  .object({ target_kind: TargetKind, target_id: Id, mode: LinkMode })
  .refine((l) => !(l.target_kind === 'category' && l.mode === 'detach'), {
    message: 'a category link cannot detach',
    path: ['mode'],
  });
const Links = z
  .array(Link)
  .max(500)
  .superRefine(uniqueBy((l: z.infer<typeof Link>) => JSON.stringify([l.target_kind, l.target_id]), 'target_id'));

export const CreateModifierGroupBody = z
  .object({
    name: Name40,
    min_choices: MinChoices,
    max_choices: MaxChoices,
    sort_order: SortOrder.default(0),
    options: z.array(NewOption).min(1).max(50),
    links: Links.default([]),
  })
  .refine((body) => body.min_choices <= body.max_choices, {
    message: 'min_choices must not exceed max_choices',
    path: ['min_choices'],
  });

// §6.12: min ≤ max is a merged-row rule (R1), checked by the service.
export const PatchModifierGroupBody = z
  .object({
    expected_version: Version,
    name: Name40.optional(),
    min_choices: MinChoices.optional(),
    max_choices: MaxChoices.optional(),
    sort_order: SortOrder.optional(),
    archived: z.boolean().optional(),
    options: z
      .array(OptionEntry)
      .min(1)
      .max(50)
      .superRefine(uniqueBy((o: z.infer<typeof OptionEntry>) => o.option_id, 'option_id'))
      .optional(),
    links: Links.optional(),
  })
  .refine(notVersionOnly, VERSION_ONLY);

// §6.12a, V19: the whole difference list at one branch (0–50); is_offered: false with an override → 400.
const OptionBranchEntry = z
  .object({ option_id: Id, is_offered: z.boolean(), price_minor_override: PriceMinor.nullable().default(null) })
  .refine((o) => o.is_offered || o.price_minor_override === null, {
    message: 'an option not offered has no price',
    path: ['price_minor_override'],
  });
export const PutModifierGroupBranchBody = z.object({
  expected_version: Version,
  options: z
    .array(OptionBranchEntry)
    .max(50)
    .superRefine(uniqueBy((o: z.infer<typeof OptionBranchEntry>) => o.option_id, 'option_id')),
});

const OptionWire = z.object({
  option_id: z.string(),
  name: z.string(),
  price_minor: z.number().nullable(),
  max_quantity: z.number(),
  is_default: z.boolean(),
  linked_item_id: z.string().nullable(),
  sort_order: z.number(),
});
const LinkWire = z.object({ target_kind: TargetKind, target_id: z.string(), mode: LinkMode });
export const ModifierGroupBranchWire = z.object({
  branch_id: z.string(),
  options: z.array(z.object({ option_id: z.string(), is_offered: z.boolean(), price_minor_override: z.number().nullable() })),
  version: z.string(),
});
export type ModifierGroupBranchWire = z.infer<typeof ModifierGroupBranchWire>;

export const ModifierGroupWire = z.object({
  modifier_group_id: z.string(),
  name: z.string(),
  min_choices: z.number(),
  max_choices: z.number(),
  sort_order: z.number(),
  archived_at: z.number().nullable(),
  options: z.array(OptionWire),
  archived_options: z.array(z.object({ option_id: z.string(), name: z.string() })),
  links: z.array(LinkWire),
  branches: z.array(ModifierGroupBranchWire),
  version: z.string(),
});
export type ModifierGroupWire = z.infer<typeof ModifierGroupWire>;

// §6.10
export const ModifierGroupListResponse = z.object({
  data: z.object({ can_edit_tenant: z.boolean(), modifier_groups: z.array(ModifierGroupWire) }),
});
export const ModifierGroupResponse = z.object({ data: z.object({ modifier_group: ModifierGroupWire }) });
export const ModifierGroupBranchResponse = z.object({ data: z.object({ branch: ModifierGroupBranchWire }) });

// ------------------------------------------------------------------------------------------------------ deals

// §3.3: choices 1–20, one per item_id (C6); a single choice has extra 0 (400).
const Choice = z.object({
  item_id: Id,
  extra_price_minor: PriceMinor.default(0),
  sort_order: SortOrder.default(0),
});
const Choices = z
  .array(Choice)
  .min(1)
  .max(20)
  .superRefine(uniqueBy((c: z.infer<typeof Choice>) => c.item_id, 'item_id'))
  .superRefine((choices, ctx) => {
    if (choices.length === 1 && choices[0]!.extra_price_minor !== 0) {
      ctx.addIssue({ code: 'custom', path: [0, 'extra_price_minor'], message: 'a single choice has no extra price' });
    }
  });
const partFields = { quantity: PartQuantity, sort_order: SortOrder.default(0), choices: Choices };
// §6.14: POST parts carry no ids.
const NewPart = z.object({ deal_part_id: z.never().optional(), ...partFields });
// §6.15, V14: a part with an id updates (or restores) it.
const PartEntry = z.object({ deal_part_id: Id.optional(), ...partFields });

// §6.14: tax_class_id is a required key (null = never taxed, 01a S34).
export const CreateDealBody = z.object({
  name: Name60,
  category_id: Id,
  tax_class_id: Id.nullable(),
  description: Description.default(null),
  sort_order: SortOrder.default(0),
  price_minor: PriceMinor,
  availability_windows: AvailabilityWindows.default([]),
  parts: z.array(NewPart).min(1).max(10),
});

// §6.15
export const PatchDealBody = z
  .object({
    expected_version: Version,
    name: Name60.optional(),
    category_id: Id.optional(),
    tax_class_id: Id.nullable().optional(),
    description: Description.optional(),
    sort_order: SortOrder.optional(),
    price_minor: PriceMinor.optional(),
    availability_windows: AvailabilityWindows.optional(),
    parts: z
      .array(PartEntry)
      .min(1)
      .max(10)
      .superRefine(uniqueBy((p: z.infer<typeof PartEntry>) => p.deal_part_id, 'deal_part_id'))
      .optional(),
    archived: z.boolean().optional(),
  })
  .refine(notVersionOnly, VERSION_ONLY);

// §6.16: is_sold: false with an override → 400.
export const PutDealBranchBody = z
  .object({
    expected_version: Version,
    is_sold: z.boolean(),
    price_minor_override: PriceMinor.nullable().default(null),
  })
  .refine((body) => body.is_sold || body.price_minor_override === null, {
    message: 'a deal not sold has no price',
    path: ['price_minor_override'],
  });

const DealPartWire = z.object({
  deal_part_id: z.string(),
  quantity: z.number(),
  sort_order: z.number(),
  choices: z.array(z.object({ item_id: z.string(), extra_price_minor: z.number(), sort_order: z.number() })),
});

export const DealWire = z.object({
  deal_id: z.string(),
  name: z.string(),
  category_id: z.string(),
  tax_class_id: z.string().nullable(),
  description: z.string().nullable(),
  sort_order: z.number(),
  price_minor: z.number(),
  archived_at: z.number().nullable(),
  availability_windows: z.array(z.object({ start_ms: z.number(), end_ms: z.number() })),
  parts: z.array(DealPartWire),
  archived_parts: z.array(z.object({ deal_part_id: z.string() })),
  version: z.string(),
});
export type DealWire = z.infer<typeof DealWire>;

// §5.4: is_sold false = no row at that branch, with the "no row" version.
export const DealBranchWire = z.object({
  branch_id: z.string(),
  is_sold: z.boolean(),
  price_minor_override: z.number().nullable(),
  version: z.string(),
});
export type DealBranchWire = z.infer<typeof DealBranchWire>;

// §6.13
export const DealListResponse = z.object({
  data: z.object({ can_edit_tenant: z.boolean(), deals: z.array(DealWire.extend({ branches: z.array(DealBranchWire) })) }),
});
export const DealResponse = z.object({ data: z.object({ deal: DealWire }) });
export const DealBranchResponse = z.object({ data: z.object({ branch: DealBranchWire.nullable() }) });

// Parsed bodies (defaults filled), for the cloud services.
export type CreateVariantGroupInput = z.infer<typeof CreateVariantGroupBody>;
export type PatchVariantGroupInput = z.infer<typeof PatchVariantGroupBody>;
export type CreateStockItemInput = z.infer<typeof CreateStockItemBody>;
export type PatchStockItemInput = z.infer<typeof PatchStockItemBody>;
export type PutStockItemBranchInput = z.infer<typeof PutStockItemBranchBody>;
export type CreateModifierGroupInput = z.infer<typeof CreateModifierGroupBody>;
export type PatchModifierGroupInput = z.infer<typeof PatchModifierGroupBody>;
export type PutModifierGroupBranchInput = z.infer<typeof PutModifierGroupBranchBody>;
export type CreateDealInput = z.infer<typeof CreateDealBody>;
export type PatchDealInput = z.infer<typeof PatchDealBody>;
export type PutDealBranchInput = z.infer<typeof PutDealBranchBody>;

// Request types as the client sends them (defaults optional), for apps/client.
export type CreateVariantGroupRequest = z.input<typeof CreateVariantGroupBody>;
export type PatchVariantGroupRequest = z.input<typeof PatchVariantGroupBody>;
export type CreateStockItemRequest = z.input<typeof CreateStockItemBody>;
export type PatchStockItemRequest = z.input<typeof PatchStockItemBody>;
export type PutStockItemBranchRequest = z.input<typeof PutStockItemBranchBody>;
export type CreateModifierGroupRequest = z.input<typeof CreateModifierGroupBody>;
export type PatchModifierGroupRequest = z.input<typeof PatchModifierGroupBody>;
export type PutModifierGroupBranchRequest = z.input<typeof PutModifierGroupBranchBody>;
export type CreateDealRequest = z.input<typeof CreateDealBody>;
export type PatchDealRequest = z.input<typeof PatchDealBody>;
export type PutDealBranchRequest = z.input<typeof PutDealBranchBody>;
