import { z } from 'zod';

// 01b B18 a, plan P-2: verbatim copies of the v1.4 DirectorySchema (packages/events/src/directory.ts) and
// SyncConfigEnvelopeSchema (packages/events/src/config.ts), taken before directory v2. A v1.4 hub parses
// with these, so the v2 directory must still parse with them. Never edit.

export const DirectorySchemaV1 = z.object({
  directory_version: z.number().int().positive(),
  staff: z.array(
    z.object({
      staff_id: z.string(),
      display_name: z.string(),
      pin_hash: z.string(),
      role_ids: z.array(z.string()),
      denied_permissions: z.array(z.string()),
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
        }),
      ),
    }),
  ),
});

export const SyncConfigEnvelopeSchemaV1 = z.object({
  data: z.object({
    config: z
      .object({
        snapshot_hash: z.string(),
        snapshot: z.record(z.string(), z.unknown()),
      })
      .nullable(),
    directory: DirectorySchemaV1.nullable(),
  }),
});
