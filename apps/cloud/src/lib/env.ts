/// <reference types="node" />
import { z } from 'zod';

const secret = (name: string) =>
  z.string().refine((value) => Buffer.byteLength(value) >= 32, { message: `${name} must be at least 32 bytes` });

export const CloudEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: secret('JWT_SECRET'),
  REFRESH_TOKEN_SECRET: secret('REFRESH_TOKEN_SECRET'),
  PORT: z.coerce.number().int().positive(),
  HUB_MIN_VERSION: z.string().min(1),
});

export type CloudEnv = z.infer<typeof CloudEnvSchema>;

export function loadCloudEnv(source: Record<string, string | undefined>): CloudEnv {
  const parsed = CloudEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(issue?.message ?? 'invalid cloud env');
  }
  return parsed.data;
}
