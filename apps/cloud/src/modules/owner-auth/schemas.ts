import { z } from 'zod';

export const LoginBody = z.object({
  email: z.string().min(1),
  password: z.string().min(8).max(200),
});

const User = z.object({
  user_id: z.string(),
  display_name: z.string(),
  tenant_id: z.string(),
  allowed_branch_ids: z.array(z.string()),
});

export const LoginResponse = z.object({
  data: z.object({
    access_token: z.string(),
    access_expires_at: z.number(),
    refresh_token: z.string(),
    refresh_expires_at: z.number(),
    user: User,
  }),
});

export type LoginBodyInput = z.infer<typeof LoginBody>;
