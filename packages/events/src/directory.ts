import { SCOPES, type Scope } from '@pos/domain';
import { z } from 'zod';

// 01b §4.3.1 (B18 a): directory v2, additive over v1. Every v1 key keeps its v1 meaning
// (`approver_role_id` = the first of the sorted `approver_role_ids`, or null), so a v1.4 hub drops the
// new keys and keeps applying. v2 hubs read `approver_role_ids` and ignore `approver_role_id`.
export const ScopeSchema = z.enum(SCOPES as [Scope, ...Scope[]]);

export const DirectorySchema = z.object({
  directory_version: z.number().int().positive(),
  staff: z.array(
    z.object({
      staff_id: z.string(),
      display_name: z.string(),
      pin_hash: z.string(),
      role_ids: z.array(z.string()),
      denied_permissions: z.array(z.string()),
      lead_staff_id: z.string().nullable(),
      floor_ids: z.array(z.string()),
    }),
  ),
  roles: z.array(
    z.object({
      role_id: z.string(),
      name: z.string(),
      session_idle_ttl_ms: z.number().int().positive(),
      permissions: z.array(
        z.object({
          permission: z.string(),
          grant_type: z.enum(['allowed', 'requires_approval']),
          approver_role_id: z.string().nullable(),
          approver_role_ids: z.array(z.string()),
          scope: ScopeSchema,
        }),
      ),
    }),
  ),
  responsibilities: z.array(
    z.object({
      responsibility: z.enum(['count_stock', 'run_station']), // 01b v1.5 B-4
      station_id: z.string(),
      staff_ids: z.array(z.string()),
      role_ids: z.array(z.string()),
    }),
  ),
  // 01b v1.4 B-1: active staff at the branch without a PIN, for alert targeting only. Optional: an older
  // cloud omits it (B18 a).
  no_pin_staff: z
    .array(
      z.object({
        staff_id: z.string(),
        display_name: z.string(),
        lead_staff_id: z.string().nullable(),
      }),
    )
    .optional(),
});

export type DirectoryInput = z.infer<typeof DirectorySchema>;
