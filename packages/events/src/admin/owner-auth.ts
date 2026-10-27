import { z } from 'zod';

// D5, §7.7: the owner login, refresh and logout bodies and responses, shared by the cloud routes and
// apps/client (browser-safe: zod only).

export const LoginBody = z.object({
  email: z.string().min(1),
  password: z.string().min(8).max(200),
});

const User = z.object({
  user_id: z.string(),
  display_name: z.string(),
  tenant_id: z.string(),
  allowed_branch_ids: z.array(z.string()),
  must_change_password: z.boolean(), // 01b §6.13: read from the owner row
});

// 01b §3.7, M73: shown once after a lock, then cleared.
const LockoutNotice = z.object({ locked_at: z.number(), failed_count: z.number().int() });

export const LoginResponse = z.object({
  data: z.object({
    access_token: z.string(),
    access_expires_at: z.number(),
    refresh_token: z.string(),
    refresh_expires_at: z.number(),
    user: User,
    lockout_notice: LockoutNotice.nullable(),
  }),
});

export const RefreshBody = z.object({
  refresh_token: z.string().min(1),
});

export const LogoutBody = z.object({
  refresh_token: z.string().min(1),
});

export const LogoutResponse = z.object({
  data: z.object({
    revoked: z.boolean(),
  }),
});

export type OwnerUser = z.infer<typeof User>;
export type OwnerLogin = z.infer<typeof LoginResponse>['data'];
