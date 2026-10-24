/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { ConfigError, HubConfigSchema, type HubConfig } from './schema.js';

export function loadHubConfig(path: string): HubConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new ConfigError(error instanceof Error ? error.message : 'cannot read config');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError('malformed config');
  }
  const result = HubConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ConfigError(issue?.message ?? 'invalid config', issue === undefined ? undefined : issue.path.join('.'));
  }
  return result.data;
}
