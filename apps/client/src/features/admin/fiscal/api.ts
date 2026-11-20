import type { HubAdminOptions } from '../../../api/hub-admin';
import { createAdminPageApi } from '../kitchen-screens/api';

// 05 row H-2 (00 v1.12), §6.28a, §6.28b (R-63), B22: the hub client of /admin/fiscal/ (admin session,
// `manage-fiscal-settings`). Sign-in is the 03 admin pages' shared part. The token goes out in the SetFiscalToken
// payload only: it is never read back (no query returns it) and this client keeps no copy of it.

/** §6.28b: one (pos_id, credential name) entry; `set_at` null = not set. Never the token. */
export interface FiscalCredential {
  pos_id: string;
  label: string;
  name: string;
  set_at: number | null;
}

/** §6.28a result: `{ pos_id, name, set_at }`, never the token. */
export interface FiscalTokenSetResult {
  pos_id: string;
  name: string;
  set_at: number;
}

export function createFiscalApi(options: HubAdminOptions) {
  const page = createAdminPageApi(options);
  return {
    ...page,
    // §6.28b
    credentials: () => page.query<{ credentials: FiscalCredential[] }>('fiscal-credentials'),
    // §6.28a: write-only
    setToken: (payload: { pos_id: string; name: string; token: string }, commandId: string) =>
      page.command<FiscalTokenSetResult>('SetFiscalToken', { pos_id: payload.pos_id, name: payload.name, token: payload.token }, commandId),
  };
}

export type FiscalApi = ReturnType<typeof createFiscalApi>;
