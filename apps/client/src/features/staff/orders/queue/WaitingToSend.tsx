import { useEffect, useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import type { QueueEntry, SubmitOrderPayload } from '../contracts';
import { queueOf } from './enqueue';

// 02b-TK C1-3 (frame SentQueued; 02b §3.12, §8 Queue): a takeaway sent while the hub was away waits in the device
// queue with no token yet. Each one shows as a dashed row "— · Usman · 3 items · Waiting to send" until the queue
// sends it (its token then comes in the QueuedSentCard) or moves it to the queue log. The takeaway queue rail
// (02b-TK C2-1) takes these rows into its Cooking list. Reads the queue only; logs nothing.

function waiting(entries: QueueEntry[]): Array<{ entry_id: string; name: string | null; lines: number }> {
  return entries.flatMap((e) => {
    const p = e.payload as Partial<SubmitOrderPayload> | null;
    if (e.command_type !== 'SubmitOrder' || p?.order_type !== 'takeaway') return [];
    return [{ entry_id: e.entry_id, name: p.takeaway?.customer_name ?? null, lines: (p.lines ?? []).length }];
  });
}

export function WaitingToSend() {
  const shell = useShell();
  const queue = queueOf(shell.enqueue);
  const [, setVersion] = useState(0);
  // a shell without the real queue (a test stub) has nothing waiting
  useEffect(() => queue?.subscribe(() => setVersion((v) => v + 1)), [queue]);
  const rows = queue === null ? [] : waiting(queue.queued());
  if (rows.length === 0) return null;
  return (
    <div className="col">
      {rows.map((r) => (
        <div key={r.entry_id} className="rnd q" role="status">
          <div className="rnd__h">
            <b className="num">—</b>
            <b>{r.name ?? t('order.takeaway')}</b>
            <span className="m">{fill(t('cart.items'), { n: String(r.lines) })}</span>
            <span className="end">
              <span className="bdg c-warn">
                <Ico name="wifioff" />
                {t('q.waiting_send')}
              </span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
