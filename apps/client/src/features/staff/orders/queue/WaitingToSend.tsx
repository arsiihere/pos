import { useEffect, useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import type { QueueEntry, SubmitOrderPayload } from '../contracts';
import { queueOf } from './enqueue';

// 02b-TK C1-3 (frame SentQueued; 02b §3.12, §8 Queue): a takeaway sent while the hub was away waits in the device
// queue with no token yet. Each one shows as a dashed row "— · Usman · 3 items · Waiting to send" until the queue
// sends it (its token then comes in the QueuedSentCard) or moves it to the queue log. 02b-TK C2-1: the rows sit in the
// takeaway queue rail, before its Cooking rows (frame ReadyTiles "Waiting to send (offline)"). Reads the queue only;
// logs nothing.

export function waitingTakeaways(entries: QueueEntry[]): Array<{ entry_id: string; name: string | null; lines: number }> {
  return entries.flatMap((e) => {
    const p = e.payload as Partial<SubmitOrderPayload> | null;
    if (e.command_type !== 'SubmitOrder' || p?.order_type !== 'takeaway') return [];
    return [{ entry_id: e.entry_id, name: p.takeaway?.customer_name ?? null, lines: (p.lines ?? []).length }];
  });
}

export function WaitingRows() {
  const shell = useShell();
  const queue = queueOf(shell.enqueue);
  const [, setVersion] = useState(0);
  // a shell without the real queue (a test stub) has nothing waiting
  useEffect(() => queue?.subscribe(() => setVersion((v) => v + 1)), [queue]);
  const rows = queue === null ? [] : waitingTakeaways(queue.queued());
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((r) => (
        <div key={r.entry_id} className="tk-qr tk-qr--q" role="status">
          <span className="tk-tok tk-tok--q" dir="ltr">
            —
          </span>
          <span className="tk-qr__m">
            <b dir="auto">{r.name ?? t('order.takeaway')}</b>
            <small>{fill(t('cart.items'), { n: String(r.lines) })}</small>
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
