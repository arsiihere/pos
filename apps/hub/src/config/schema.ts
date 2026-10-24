/// <reference types="node" />
import { z } from 'zod';

const AuthSchema = z.object({
  pin_max_failures: z.number().int().positive().default(5),
  device_max_failures: z.number().int().positive().default(10),
  device_failure_window_ms: z.number().int().positive().default(300_000),
  pin_lockout_ms: z.number().int().positive().default(900_000),
  argon2_concurrency: z.number().int().positive().default(2),
  admin_argon2_concurrency: z.number().int().positive().default(1),
});

export const HubConfigSchema = z.object({
  cloud_base_url: z.string().min(1),
  http_port: z.number().int().positive(),
  data_dir: z.string().min(1),
  backup_dir: z.string().min(1),
  min_client_version: z.string().min(1),
  cors_origins: z.array(z.string().min(1)).default(['http://localhost']),
  maintenance_hour: z.number().int().min(0).max(23).default(4),
  auth: AuthSchema.default({
    pin_max_failures: 5,
    device_max_failures: 10,
    device_failure_window_ms: 300_000,
    pin_lockout_ms: 900_000,
    argon2_concurrency: 2,
    admin_argon2_concurrency: 1,
  }),
  advertised_host: z.string().min(1).optional(),
  guest_network_cidrs: z.array(z.string().min(1)).optional(),
  setup_attempt_id: z.string().min(1).optional(),
  provisioned: z
    .object({
      tenant_id: z.string().min(1),
      branch_id: z.string().min(1),
      branch_name: z.string(),
      branch_api_key: z.string(),
      confirmed_at: z.number().int().nonnegative().optional(),
    })
    .optional(),
  backup_encryption_key: z
    .string()
    .refine((value) => Buffer.from(value, 'base64').length === 32, { message: 'expected 32 bytes' })
    .optional(),
});

export type HubConfig = z.infer<typeof HubConfigSchema>;

export class ConfigError extends Error {
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ConfigError';
    this.field = field;
  }
}

export const DEFAULT_CONFIG_PATH = '/etc/pos-hub/config.json';

export function isProvisioned(cfg: HubConfig): boolean {
  return Boolean(cfg.provisioned?.branch_id && cfg.provisioned.branch_api_key);
}

export function isConfirmed(cfg: HubConfig): boolean {
  return cfg.provisioned?.confirmed_at !== undefined;
}
