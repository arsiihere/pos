import { z } from 'zod';

// D5, §7.7: the hub admin request bodies and responses the /admin/stock page uses, shared by the hub
// routes and apps/client (browser-safe: zod only).

const int = z.number().int();
const Unit = z.enum(['piece', 'g', 'ml']);
const Level = z.enum(['not_counted', 'out', 'low', 'ok']);
const Window = z.object({ start_ms: int, end_ms: int });

// 00 §8.2: the admin roster and PIN login.
export const AdminRosterResponse = z.object({
  data: z.object({
    staff: z.array(z.object({ staff_id: z.string(), display_name: z.string(), locked_until: int.nullable() })),
  }),
});

export const AdminAuthBody = z.object({
  staff_id: z.string().min(1),
  pin: z.string().regex(/^\d{4,6}$/),
});

export const AdminAuthResponse = z.object({
  data: z.object({
    admin_session_token: z.string(),
    session_id: z.string(),
    staff_id: z.string(),
    display_name: z.string(),
    idle_ttl_ms: int,
    // 00 v1.3 M89
    permissions: z.object({ 'manage-devices': z.boolean(), 'manage-staff': z.boolean() }),
  }),
});

// §6.21, S29, S40 N4; tenant_id and branch_id extended by D7 (the provisioned values, for the command
// envelope).
export const ConfigStatusResponse = z.object({
  data: z.object({
    tenant_id: z.string().nullable(),
    branch_id: z.string().nullable(),
    config_version: int.nullable(),
    snapshot_schema_version: int.nullable(),
    applied_at: int.nullable(),
    directory_version: int.nullable(),
    last_poll: z
      .object({
        outcome: z.enum(['applied', 'unchanged', 'offline', 'rejected', 'unauthorized', 'not_ready']),
        at: int,
      })
      .nullable(),
    last_problem: z
      .object({
        outcome: z.enum(['rejected', 'unauthorized']),
        reason: z.enum(['malformed', 'hash_mismatch', 'schema_unsupported', 'schema_invalid', 'apply_failed']).nullable(),
        at: int,
      })
      .nullable(),
  }),
});

const BusinessDay = z.object({ business_date: z.string(), opened_at: int, closed_at: int.nullable() });

// §6.19 (review 2 S-5): a config part and a stock part, each only when its version moved.
export const StockQueryResponse = z.object({
  data: z.object({
    unchanged: z.boolean(),
    config_version: int.nullable(),
    meta_version: z.string(),
    stock_version: int,
    hub_time: z.object({ now_ms: int, utc_offset_ms: int }),
    hub_local_date: z.string(),
    business_day: BusinessDay.nullable(),
    business_day_started_at: int.nullable(),
    day_stale: z.boolean(),
    day_stale_after_hours: int,
    day_min_gap_hours: int,
    items_meta: z
      .array(
        z.object({
          item_id: z.string(),
          name: z.string(),
          group_label: z.string().nullable(),
          category_id: z.string(),
          category_name: z.string(),
          is_stock_tracked: z.boolean(),
          out_of_stock_behaviour: z.enum(['cook_fresh', 'sold_out']),
          stock_unit: Unit,
          sale_unit: Unit,
          stock_per_sale_unit: int,
          low_stock_threshold: int.nullable(),
          carries_over: z.boolean(),
          item_windows: z.array(Window),
          category_windows: z.array(Window),
        }),
      )
      .nullable(),
    items: z
      .array(
        z.object({
          item_id: z.string(),
          on_hand: int,
          reserved: int,
          unit: Unit,
          available: int,
          level: Level,
          set_at: int.nullable(),
          is_available: z.boolean(),
          unavailable_since: int.nullable(),
        }),
      )
      .nullable(),
  }),
});

// §6.17, §6.17a, §6.18, §6.18a, §6.18b payloads.
export const SetPrecookedStockPayload = z.object({
  entries: z.array(z.object({ item_id: z.string(), on_hand: int })),
});
export const AddPrecookedStockPayload = z.object({
  entries: z.array(z.object({ item_id: z.string(), quantity: int })),
});
export const SetItemAvailabilityPayload = z.object({ item_id: z.string(), is_available: z.boolean() });
export const OpenBusinessDayPayload = z.object({});
export const CloseBusinessDayPayload = z.object({});

const StockResultItem = z.object({
  item_id: z.string(),
  on_hand: int,
  reserved: int,
  unit: Unit,
  available: int,
  level: Level,
  set_at: int.nullable(),
});

export const SetPrecookedStockResult = z.object({ items: z.array(StockResultItem) });
export const AddPrecookedStockResult = z.object({
  items: z.array(StockResultItem.extend({ recorded_as: z.enum(['added', 'set']) })),
});
export const SetItemAvailabilityResult = z.object({
  item_id: z.string(),
  is_available: z.boolean(),
  changed: z.boolean(),
});
export const OpenBusinessDayResult = z.object({
  business_date: z.string(),
  opened_at: int,
  changed: z.boolean(),
  reason: z.enum(['opened', 'already_open']),
});
export const CloseBusinessDayResult = z.object({
  business_date: z.string(),
  opened_at: int,
  closed_at: int.nullable(),
  changed: z.boolean(),
  reason: z.enum(['closed', 'not_open', 'opened_recently']),
});

// F §6.3: the command response envelope.
export function commandResponse<T extends z.ZodType>(result: T) {
  return z.object({ data: z.object({ command_id: z.string(), event_ids: z.array(z.string()), result }) });
}

export type HubAdminRoster = z.infer<typeof AdminRosterResponse>['data'];
export type HubAdminLogin = z.infer<typeof AdminAuthResponse>['data'];
export type HubConfigStatus = z.infer<typeof ConfigStatusResponse>['data'];
export type HubStockAnswer = z.infer<typeof StockQueryResponse>['data'];
export type HubStockItemMeta = NonNullable<HubStockAnswer['items_meta']>[number];
export type HubStockItem = NonNullable<HubStockAnswer['items']>[number];
export type SetPrecookedStockRequest = z.infer<typeof SetPrecookedStockPayload>;
export type AddPrecookedStockRequest = z.infer<typeof AddPrecookedStockPayload>;
export type SetItemAvailabilityRequest = z.infer<typeof SetItemAvailabilityPayload>;
export type SetPrecookedStockAnswer = z.infer<typeof SetPrecookedStockResult>;
export type AddPrecookedStockAnswer = z.infer<typeof AddPrecookedStockResult>;
export type SetItemAvailabilityAnswer = z.infer<typeof SetItemAvailabilityResult>;
export type OpenBusinessDayAnswer = z.infer<typeof OpenBusinessDayResult>;
export type CloseBusinessDayAnswer = z.infer<typeof CloseBusinessDayResult>;
