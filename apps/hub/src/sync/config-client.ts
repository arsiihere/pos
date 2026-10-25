/// <reference types="node" />

export interface ConfigQuery {
  config_version: number;
  directory_version: number;
}

export type ConfigFetch =
  | { kind: 'not_modified' }
  | { kind: 'ok'; text: string }
  | { kind: 'offline' }
  | { kind: 'error'; status: number; code: string; details: Record<string, unknown> };

export interface ConfigClient {
  fetchConfig(q: ConfigQuery): Promise<ConfigFetch>;
}

// §3.4 step 3, S48: gzip accepted; fetch decompresses, so the body is read as text (never json()).
export function httpConfigClient(baseUrl: string, branchApiKey: string, timeoutMs = 30_000): ConfigClient {
  const root = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  return {
    async fetchConfig(q) {
      const url = `${root}/v1/sync/config?config_version=${q.config_version}&directory_version=${q.directory_version}`;
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: { authorization: `Bearer ${branchApiKey}`, 'accept-encoding': 'gzip' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status === 304) return { kind: 'not_modified' };
        if (response.status >= 500) return { kind: 'offline' };
        if (response.ok) return { kind: 'ok', text: await response.text() };
        const json: unknown = await response.json().catch(() => undefined);
        const error = record(record(json)?.error);
        return {
          kind: 'error',
          status: response.status,
          code: typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR',
          details: record(error?.details) ?? {},
        };
      } catch {
        return { kind: 'offline' };
      }
    },
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}
