import { z } from 'zod';

export const DirectorySchema = z.object({
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

export type DirectoryInput = z.infer<typeof DirectorySchema>;
