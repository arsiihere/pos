import type { HubAdminOptions } from '../../../api/hub-admin';
import { createAdminPageApi } from '../kitchen-screens/api';

// 05 row H-2 (00 v1.12): the hub client of /admin/fiscal/ (admin session, `manage-fiscal-settings`). Shell only:
// sign-in is the 03 admin pages' shared part; task 31a adds the fiscal-status read and `SetFiscalToken`.
export function createFiscalApi(options: HubAdminOptions) {
  return createAdminPageApi(options);
}

export type FiscalApi = ReturnType<typeof createFiscalApi>;
