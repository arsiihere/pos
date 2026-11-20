import type { HubResult } from '../../api/hub-admin';
import { newUlid } from '../../app/ulid';
import type { BillRef, OpenBillsBody, PrintCheckBillResult } from './contracts';

// 05 §6 (task 34 on): the billing queries and commands on the staff api's query() / command() (the shell's own
// transport, features/staff/api.ts — no second client, socket or token).

export interface BillingTransport {
  query<T>(path: string): Promise<HubResult<T>>;
  command<T>(commandType: string, payload: unknown, opts?: { commandId?: string }): Promise<HubResult<T>>;
}

export interface BillingApi {
  /** §6.2: every bill that still needs money, in server order; `floor_id` narrows it to one floor. */
  openBills(floor_id?: string): Promise<HubResult<OpenBillsBody>>;
  /** §6.3: the check bill on the bill printer of the zone / floor (or `printer_id`). */
  printCheckBill(payload: { bill_ref: BillRef; printer_id?: string }): Promise<HubResult<PrintCheckBillResult>>;
}

export function billingApi(staff: BillingTransport, newCommandId: () => string = () => newUlid()): BillingApi {
  // a command's id is kept per command type + payload until the hub answers (a network error keeps it), as the KDS
  // api does (features/kds/actions/actions.ts): a resend after a lost reply is the same command, applied once
  const pending = new Map<string, string>();
  async function command<T>(type: string, payload: object): Promise<HubResult<T>> {
    const key = `${type} ${JSON.stringify(payload)}`;
    let commandId = pending.get(key);
    if (commandId === undefined) pending.set(key, (commandId = newCommandId()));
    const answer = await staff.command<T>(type, payload, { commandId });
    if (answer.ok || answer.error.kind !== 'network') pending.delete(key);
    return answer;
  }
  return {
    printCheckBill: (payload) => command<PrintCheckBillResult>('PrintCheckBill', payload),
    openBills: (floor_id) =>
      staff.query<OpenBillsBody>(floor_id === undefined ? '/queries/open-bills' : `/queries/open-bills?floor_id=${encodeURIComponent(floor_id)}`),
  };
}
