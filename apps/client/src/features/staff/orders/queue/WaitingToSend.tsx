import { useEffect, useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import type { BranchConfig } from '@pos/events';
import type { QueueEntry, SubmitLine, SubmitOrderPayload } from '../contracts';
import { groupedSummary } from '../takeaway/book';
import { queueOf } from './enqueue';

// 02b-TK C1-3 (frame SentQueued; 02b §3.12, §8 Queue): a takeaway sent while the hub was away waits in the device
// queue with no token yet. Each one shows as a dashed row "— · Usman · 3 items · Waiting to send" until the queue
// sends it (its token then comes in the QueuedSentCard) or moves it to the queue log. 02b-TK C2-1: the rows sit in the
// takeaway queue rail, at the top of its Cooking rows (L-CLIENT-6a item 4, frame SentQueued). Reads the queue only;
// logs nothing.

export function waitingTakeaways(entries: QueueEntry[], config: BranchConfig | null = null): Array<{ entry_id: string; name: string | null; lines: number; summary: string }> {
  // L-CLIENT-6a item 4 (frame SentQueued): the row names what was ordered ("2× Naan · Raita"), from this device's menu
  const nameOf = (l: SubmitLine) => (l.item_id !== undefined ? config?.items.find((i) => i.item_id === l.item_id)?.name : config?.deals.find((d) => d.deal_id === l.deal_id)?.name) ?? null;
  return entries.flatMap((e) => {
    const p = e.payload as Partial<SubmitOrderPayload> | null;
    if (e.command_type !== 'SubmitOrder' || p?.order_type !== 'takeaway') return [];
    const lines = p.lines ?? [];
    const named = lines.flatMap((l) => {
      const name = nameOf(l);
      return name === null ? [] : [{ name, qty: l.quantity ?? 1 }];
    });
    return [{ entry_id: e.entry_id, name: p.takeaway?.customer_name ?? null, lines: lines.length, summary: named.length === lines.length ? groupedSummary(named) : '' }];
  });
}

/** The takeaways waiting in this device's queue, read again as the queue changes. */
export function useWaitingTakeaways(): ReturnType<typeof waitingTakeaways> {
  const shell = useShell();
  const queue = queueOf(shell.enqueue);
  const [, setVersion] = useState(0);
  // a shell without the real queue (a test stub) has nothing waiting
  useEffect(() => queue?.subscribe(() => setVersion((v) => v + 1)), [queue]);
  return queue === null ? [] : waitingTakeaways(queue.queued(), shell.config.snapshot());
}

export function WaitingRows({ showContact }: { showContact: boolean }) {
  const rows = useWaitingTakeaways();
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((r) => (
        <div key={r.entry_id} className="tk-qr tk-qr--q" role="status">
          <span className="tk-tok tk-tok--q" dir="ltr">
            —
          </span>
          <span className="tk-qr__m">
            <b dir="auto">{(showContact ? r.name : null) ?? t('order.takeaway')}</b>
            <small dir="auto">{r.summary !== '' ? r.summary : fill(t('cart.items'), { n: String(r.lines) })}</small>
          </span>
          <span className="tk-qr__r">
            <span className="tk-chip tk-chip--warn">
              <Ico name="wifioff" />
              {t('q.waiting_send')}
            </span>
          </span>
        </div>
      ))}
    </>
  );
}
