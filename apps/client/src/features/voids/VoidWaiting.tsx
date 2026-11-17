import { useState } from 'react';
import { t } from '../../i18n';
import { fill } from '../../i18n/en';
import { timeText } from '../alerts/labels';
import { Ico, Ring, RING_FULL_MS } from '../alerts/ui';
import { useShell } from '../staff/shell/hooks';
import type { LineView } from '../staff/orders/contracts';
import { showOrderError } from '../staff/orders/view/LineActions';
import { REASON_KEY } from './model';
import { pendingVoidsOf, useLinePendingVoid } from './pending';
import { DISPOSITION_KEY } from './ui';

// 04 §8 Pending tag (frames VoidPending, VoidPendingOther, VoidBlocked, VoidPendingUrdu; handoff decisions 9–10): the
// card under the named line of an open void request. The requester: "Void pending" + Withdraw (01d WithdrawRequest);
// blocked (`pending-voids.blocked: not_movable_stage`, served meanwhile) → amber "Can't be approved as stock any more —
// withdraw and ask again", Withdraw stays. Anyone else: "Asked by … · waiting for a manager", no buttons.

export function VoidWaiting({ line, onChanged }: { line: LineView; onChanged(): void }) {
  const shell = useShell();
  const pending = useLinePendingVoid(line.order_item_id);
  const [busy, setBusy] = useState(false);
  if (pending === null || pending.order_item_id !== line.order_item_id) return null;
  const store = pendingVoidsOf(shell);
  const mine = shell.me !== null && pending.requester_staff_id === shell.me.staff_id;
  const withdraw = async () => {
    if (busy) return;
    setBusy(true);
    const answer = await shell.api.command('WithdrawRequest', { alert_id: pending.alert_id });
    setBusy(false);
    if (!answer.ok) {
      // answered or closed meanwhile: the card goes, the line is read again
      if (answer.error.kind === 'api' && answer.error.code === 'REQUEST_NOT_PENDING') {
        store.forget(pending.alert_id);
        onChanged();
        return;
      }
      showOrderError(shell, answer.error, onChanged);
      return;
    }
    store.forget(pending.alert_id);
    shell.toasts.show({ text: t('void.toast.withdrawn'), sub: fill(t('void.toast.withdrawn.sub'), { item: line.name }) });
    onChanged();
  };
  const button = (tone: 'danger' | 'warn') => (
    <button type="button" className={`btn btn--tone c-${tone}`} disabled={busy} onClick={() => void withdraw()}>
      <Ico name="undo" />
      {t('comp.withdraw')}
    </button>
  );
  if (mine && pending.blocked === 'not_movable_stage') {
    return (
      <div className="ol__ctrl" onClick={(e) => e.stopPropagation()}>
        <div className="wcard wcard--blocked" data-alert={pending.alert_id}>
          <Ico name="warn" />
          <div>
            <b>{t('void.pending.blocked')}</b>
            <small>{t('void.pending.blocked_why')}</small>
          </div>
          {button('warn')}
        </div>
      </div>
    );
  }
  const waited = Math.max(0, shell.clock.nowMs() - pending.raised_at);
  const minutes = Math.floor(waited / 60_000);
  let sub: string;
  if (mine) {
    const sent = store.sent(pending.alert_id);
    sub =
      sent === null
        ? fill(t('void.pending.units'), { units: String(pending.units) })
        : fill(t('void.pending.mine'), { units: String(pending.units), reason: t(REASON_KEY[sent.reason]), disposition: t(DISPOSITION_KEY[sent.disposition].label) });
  } else {
    const name = store.nameOf(pending.requester_staff_id);
    const time = timeText(pending.raised_at, shell.clock.utcOffsetMs);
    sub = name === null ? fill(t('void.pending.other_noname'), { time }) : fill(t('void.pending.other'), { name, time });
  }
  return (
    <div className="ol__ctrl" onClick={(e) => e.stopPropagation()}>
      <div className="wcard c-danger" data-alert={pending.alert_id}>
        <Ring size={56} pct={(waited / RING_FULL_MS) * 100} tone="danger" label={fill(t('alerts.waiting'), { n: String(minutes) })}>
          <span className="wt">
            <b className="num">{minutes}</b>
          </span>
        </Ring>
        <div>
          <b>{t('void.pending.title')}</b>
          <small dir="auto">{sub}</small>
        </div>
        {mine ? button('danger') : <span />}
      </div>
    </div>
  );
}
