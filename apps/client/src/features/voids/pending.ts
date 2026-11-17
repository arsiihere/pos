import type { VoidDisposition, VoidReasonCode } from '@pos/domain';

// 04 §8 Pending tag (handoff decision 9, frame VoidPending "×1 · Customer changed mind · Move to ready stock"):
// pending-voids (§6.4) gives no reason or disposition, so the requester's card shows them only for requests this
// device sent (its memory, for the page's life); elsewhere it shows the units alone.

export interface SentVoid {
  alert_id: string;
  reason: VoidReasonCode;
  disposition: VoidDisposition;
}

const sentPerPage = new WeakMap<object, Map<string, SentVoid>>();

function sentOf(shell: { orders: object }): Map<string, SentVoid> {
  let m = sentPerPage.get(shell.orders);
  if (m === undefined) {
    m = new Map();
    sentPerPage.set(shell.orders, m);
  }
  return m;
}

/** A VoidItems pending answer of this device (one per entry). */
export function rememberVoid(shell: { orders: object }, sent: SentVoid): void {
  sentOf(shell).set(sent.alert_id, sent);
}

export function sentVoid(shell: { orders: object }, alert_id: string): SentVoid | null {
  return sentOf(shell).get(alert_id) ?? null;
}
