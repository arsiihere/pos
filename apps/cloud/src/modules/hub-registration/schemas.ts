import { ULID_RE } from '@pos/domain';
import { DirectorySchema } from '@pos/events';
import { z } from 'zod';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

export const RegisterBody = z.object({
  registration_code: z.string().min(1),
  hub_version: z.string().regex(SEMVER),
  accepted_kinds: z.array(z.enum(['new_branch', 'replace_hub'])).min(1),
});

export const IdempotencyKey = z.string().regex(ULID_RE);

export const RegisterResponse = z.object({
  data: z.object({
    tenant_id: z.string(),
    branch_id: z.string(),
    branch_name: z.string(),
    currency_code: z.string(),
    kind: z.enum(['new_branch', 'replace_hub']),
    branch_api_key: z.string(),
    directory: DirectorySchema,
  }),
});

export type RegisterBodyInput = z.infer<typeof RegisterBody>;

export const ConfirmBody = z.object({
  hub_version: z.string().regex(SEMVER),
});

export const ConfirmResponse = z.object({
  data: z.object({
    branch_id: z.string(),
    hub_confirmed_at: z.number(),
  }),
});
