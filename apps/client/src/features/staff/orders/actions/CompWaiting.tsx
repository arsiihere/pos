import { useEffect, useState, useSyncExternalStore } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import type { LineView } from '../contracts';
import { money } from '../money';
import { showOrderError } from '../view/LineActions';
import { pendingCompsOf } from './pending-comps';

// 02b v1.0.11 §8 Table view (frame 02b-C03 CompWaiting; 01d AD-1; Q-11): the waiting card under a line with an open
// comp request — "Waiting for approval — Rs 2,200 comp" (the hub's requested amount; no amount when the hub sent
// none) + Withdraw (01d WithdrawRequest by its alert_id) for the person who asked. Anchored on `line.pending_comp`
// (H6); on a hub without H6, on this device's memory (pending-comps.ts), cleared when the request closes.

export interface CompWaitingProps {
  line: LineView;
  onChanged(): void;
}

export function CompWaiting({ line, onChanged }: CompWaitingProps) {
  const shell = useShell();
  const store = pendingCompsOf(shell);
  useSyncExternalStore(store.subscribe, store.version);
  const waiting = store.forLine(line);
  const [busy, setBusy] = useState(false);
  const alertId = waiting?.alert_id ?? null;
  useEffect(() => {
    store.setLoader(() => shell.api.query<{ requests?: unknown }>('/queries/my-requests'));
    // a card this device did not send (another device, after a reload): my-requests says whose it is
    if (alertId !== null && !store.isMine(alertId)) void store.sync();
  }, [alertId, store, shell.api]);
  if (waiting === null) return null;
  const mine = store.isMine(waiting.alert_id);
  const withdraw = async () => {
    if (busy) return;
    setBusy(true);
    const answer = await shell.api.command('WithdrawRequest', { alert_id: waiting.alert_id });
    setBusy(false);
    if (!answer.ok) {
      // answered or closed meanwhile: the card goes, the line is read again
      if (answer.error.kind === 'api' && answer.error.code === 'REQUEST_NOT_PENDING') {
        store.forget(waiting.alert_id);
        onChanged();
        return;
      }
      showOrderError(shell, answer.error, onChanged);
      return;
    }
    store.forget(waiting.alert_id);
    onChanged();
  };
  const title = waiting.value_minor === null ? t('comp.waiting_plain') : fill(t('comp.waiting'), { amount: money(waiting.value_minor) });
  const sub = [waiting.units === null ? line.name : `${line.name} ×${waiting.units}`, waiting.reason, waiting.value_minor === null ? null : t('comp.as_asked')]
    .filter((x) => x !== null)
    .join(' · ');
  return (
    <div className="ol__ctrl" onClick={(e) => e.stopPropagation()}>
      <div className="wcard c-brand" data-alert={waiting.alert_id}>
        <Ico name="clock" />
        <div>
          <b>{title}</b>
          <small dir="auto">{sub}</small>
        </div>
        {mine && (
          <button type="button" className="btn btn--tone c-brand" disabled={busy} onClick={() => void withdraw()}>
            <Ico name="undo" />
            {t('comp.withdraw')}
          </button>
        )}
      </div>
    </div>
  );
}
