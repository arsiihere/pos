import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useShell } from '../../shell/hooks';
import { useLiveRefetch } from '../lists/OpenOrders';
import { parseBillRows, type BillRead } from './candidate';
import { unpaidRequestsOf } from './requests';

// 02b-TK L-CLIENT-2 item 4 (02b v1.0.25 §6.16, §8 OR-7 "refetch affected rows in one debounced open-orders read"):
// the billing facts of a takeaway / parking order view (the parking / per-line Mark served sheet) — one
// `open-orders?order_type=all` read while `enabled`, again (debounced) on order frames (UnpaidHandoverApproved and
// OpenOrderBillChanged included), a reconnect and the page turning visible; an answer older than a later read is
// dropped. The rows' approval flags feed the page's approvals (requests.ts seed). Null until a read succeeds.

export function useBillRead(enabled: boolean): { read: BillRead | null; reload(): void } {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const [read, setRead] = useState<BillRead | null>(null);
  const asked = useRef(0);
  const unpaid = unpaidRequestsOf(shell);
  useSyncExternalStore(unpaid.subscribe, unpaid.version);
  const load = useCallback(async () => {
    const mine = ++asked.current;
    const at = shellRef.current.clock.nowMs();
    const answer = await shellRef.current.orders.openOrders({ order_type: 'all' }).catch(() => null);
    if (mine !== asked.current || answer === null || !answer.ok) return;
    const next = parseBillRows(answer.data, at);
    if (next === null) return;
    unpaidRequestsOf(shellRef.current).seed([...next.rows].map(([order_id, r]) => ({ order_id, ...r })));
    setRead(next);
  }, []);
  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);
  const on = useRef(enabled);
  on.current = enabled;
  useLiveRefetch(shell.live, () => (on.current ? void load() : undefined));
  return { read, reload: () => void load() };
}
