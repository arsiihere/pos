import { useEffect, useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { timeText } from '../../../alerts/labels';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import { queueOf } from './enqueue';

// 02b v1.0.11 §8 Queue / 02-D07 `OpenOrdersQueued`: a takeaway queued offline and sent later (reconnect, sign-in
// drain) gets its token only from the replay's 2xx — the kiosk shows a sticky card "57 · Takeaway sent · Queued at
// 8:11 PM · call the token" until OK. One card per such send, oldest first. A send whose reply was the device's own
// ORDER_ITEM_ID_IN_USE (no result) has no token to show: no card.

interface Card {
  entry_id: string;
  token: number;
  queued_at: number;
}

export function QueuedSentCard() {
  const shell = useShell();
  const queue = queueOf(shell.enqueue);
  const [cards, setCards] = useState<Card[]>([]);
  useEffect(() => {
    if (queue === null) return;
    return queue.onSent((n) => {
      if (!n.later || n.entry.command_type !== 'SubmitOrder') return;
      const token = (n.result as { token?: unknown } | undefined)?.token;
      if (typeof token !== 'number') return;
      setCards((c) => [...c, { entry_id: n.entry.entry_id, token, queued_at: n.entry.queued_at }]);
    });
  }, [queue]);
  const card = cards[0];
  if (card === undefined) return null;
  return (
    <div className="tokc" role="status">
      <b className="tk num">{card.token}</b>
      <div>
        <span className="t1">{t('send.queued_sent')}</span>
        <small>{fill(t('queue.sent_card_sub'), { time: timeText(card.queued_at, shell.clock.utcOffsetMs) })}</small>
      </div>
      <button type="button" className="btn" onClick={() => setCards((c) => c.slice(1))}>
        <Ico name="check" />
        {t('queue.ok')}
      </button>
    </div>
  );
}
