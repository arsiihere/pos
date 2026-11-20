import type { HubResult } from '../../api/hub-admin';
import type { OpenBillsBody } from './contracts';

// 05 §6 (task 34 on): the billing queries and commands on the staff api's query() / command() (the shell's own
// transport, features/staff/api.ts — no second client, socket or token).

export interface BillingTransport {
  query<T>(path: string): Promise<HubResult<T>>;
}

export interface BillingApi {
  /** §6.2: every bill that still needs money, in server order; `floor_id` narrows it to one floor. */
  openBills(floor_id?: string): Promise<HubResult<OpenBillsBody>>;
}

export function billingApi(staff: BillingTransport): BillingApi {
  return {
    openBills: (floor_id) =>
      staff.query<OpenBillsBody>(floor_id === undefined ? '/queries/open-bills' : `/queries/open-bills?floor_id=${encodeURIComponent(floor_id)}`),
  };
}
