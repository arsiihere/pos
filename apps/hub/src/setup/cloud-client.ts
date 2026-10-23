/// <reference types="node" />

export class CloudUnreachableError extends Error {
  constructor() {
    super('cloud unreachable');
    this.name = 'CloudUnreachableError';
  }
}

export class CloudError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, details: Record<string, unknown>) {
    super(code);
    this.name = 'CloudError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface RegisterHubBody {
  registration_code: string;
  hub_version: string;
  accepted_kinds: Array<'new_branch' | 'replace_hub'>;
}

export interface CloudClient {
  registerHub(body: RegisterHubBody, idempotencyKey: string): Promise<unknown>;
  confirmHub(apiKey: string, body: { hub_version: string }): Promise<unknown>;
}

export function httpCloudClient(baseUrl: string, timeoutMs = 10_000): CloudClient {
  const root = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  return {
    registerHub(body, idempotencyKey) {
      return call(`${root}/v1/hubs/register`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    },
    confirmHub(apiKey, body) {
      return call(`${root}/v1/hubs/confirm`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    },
  };
}

async function call(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new CloudUnreachableError();
  }
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = record(json)?.error;
    const body = record(error);
    const code = typeof body?.code === 'string' ? body.code : 'INTERNAL_ERROR';
    const details = record(body?.details) ?? {};
    throw new CloudError(response.status, code, details);
  }
  return json;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}
