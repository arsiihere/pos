import { SCOPES, type Scope } from '@pos/domain';
import { z } from 'zod';

// 01b B18 a, M6 (02p task 7): verbatim copy of the v2 DirectorySchema (packages/events/src/directory.ts) taken
// before directory v3 (01b v1.6 B-2). A hub on v2 code parses with it, so the v3 directory must still parse.
// Never edit.
const ScopeSchema = z.enum(SCOPES as [Scope, ...Scope[]]);

export const DirectorySchemaV2 = z.object({
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
