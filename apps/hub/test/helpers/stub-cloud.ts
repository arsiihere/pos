import { CloudError, CloudUnreachableError, type CloudClient, type RegisterHubBody } from '../../src/setup/cloud-client';

export interface CloudCall {
  body: RegisterHubBody;
  idempotencyKey: string;
}

export interface StubCloud extends CloudClient {
  registerCalls: CloudCall[];
  confirmCalls: Array<{ apiKey: string; body: { hub_version: string } }>;
  registerResult: unknown;
  registerError: Error | null;
  confirmResult: unknown;
  confirmError: Error | null;
}

export function stubCloud(): StubCloud {
  const stub: StubCloud = {
    registerCalls: [],
    confirmCalls: [],
    registerResult: { data: {} },
    registerError: null,
    confirmResult: { data: { branch_id: 'branch-1', hub_confirmed_at: 1 } },
    confirmError: null,
    async registerHub(body, idempotencyKey) {
      stub.registerCalls.push({ body, idempotencyKey });
      if (stub.registerError !== null) throw stub.registerError;
      return stub.registerResult;
    },
    async confirmHub(apiKey, body) {
      stub.confirmCalls.push({ apiKey, body });
      if (stub.confirmError !== null) throw stub.confirmError;
      return stub.confirmResult;
    },
  };
  return stub;
}

export { CloudError, CloudUnreachableError };

// A cloud that cannot be reached (as offline as stubConfigCloud()'s default): boot tests that do not test the confirm call.
export function offlineCloud(): StubCloud {
  const stub = stubCloud();
  stub.confirmError = new CloudUnreachableError();
  stub.registerError = new CloudUnreachableError();
  return stub;
}
