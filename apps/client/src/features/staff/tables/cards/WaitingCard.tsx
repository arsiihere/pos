import { useEffect, useState, useSyncExternalStore } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { timeText } from '../../../alerts/labels';
import { Ring } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import { tableErrorKey } from '../errors';
import { pendingHandovers } from './pending-handovers';

// 02a §8 Handover waiting card (01d AD-1; 02a-C03 HandoverWaiting, HandoverWaitingLate; Q-14): the sender's
// info card in the table sheet, "Waiting for Sara — 0:42" (live count from the request's raised_at, hub clock),
// "Waiting for an answer" after a reload (receiver unknown), "· ask her in person / Your lead was told" once
// my-requests says ask_in_person. Withdraw = 01d WithdrawRequest (the sender is the requester). Contract for
// lane C (integrator ruling IR-4): `<WaitingCard table_id seating_id table_code />`, self-contained; renders
// nothing when the table has no waiting handover. While shown it reads my-requests once a minute (the
// ask-in-person state has no frame of its own).

export const WAITING_REREAD_MS = 60_000;

function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function WaitingCard({ table_id, table_code }: { table_id: string; seating_id: string; table_code: string | null }) {
  const shell = useShell();
  useSyncExternalStore(pendingHandovers.subscribe, pendingHandovers.version);
  const waiting = pendingHandovers.forTable(table_id, table_code);
  const [now, setNow] = useState(() => shell.clock.nowMs());
  const [busy, setBusy] = useState(false);
  const shown = waiting !== null;

  useEffect(() => {
    if (!shown) return;
    setNow(shell.clock.nowMs());
    const tick = setInterval(() => setNow(shell.clock.nowMs()), 1_000);
    const reread = setInterval(() => void pendingHandovers.refresh(), WAITING_REREAD_MS);
    return () => {
      clearInterval(tick);
      clearInterval(reread);
    };
    // the timers belong to the card being shown; the clock is the shell's one hub clock
  }, [shown]);

  if (waiting === null) return null;
  const waited = waiting.raised_at === null ? 0 : Math.max(0, now - waiting.raised_at);
  const minutes = Math.floor(waited / 60_000);
  const late = waiting.ask_in_person;
  const title = late
    ? waiting.receiver_name === null
      ? fill(t('handover.waiting_answer_late'), { n: String(minutes) })
      : fill(t('handover.waiting_late'), { name: waiting.receiver_name, n: String(minutes) })
    : waiting.receiver_name === null
      ? t('handover.waiting_answer')
      : fill(t('handover.waiting'), { name: waiting.receiver_name });
  const sub = late ? t('handover.lead_told') : waiting.raised_at === null ? null : fill(t('handover.sent'), { time: timeText(waiting.raised_at, shell.clock.utcOffsetMs) });

  const withdraw = async () => {
    setBusy(true);
    const answer = await shell.api.command<{ alert_id: string }>('WithdrawRequest', { alert_id: waiting.alert_id });
    setBusy(false);
    if (answer.ok) {
      pendingHandovers.withdrawn(waiting.alert_id);
      return;
    }
    // answered or closed meanwhile: the read brings the result
    if (answer.error.kind === 'api' && answer.error.code === 'REQUEST_NOT_PENDING') {
      void pendingHandovers.refresh();
      return;
    }
    shell.toasts.show({ text: t(tableErrorKey(answer.error)), tone: 'warn' });
  };

  return (
    <div className="wcard c-info" role="status">
      <Ring size={56} pct={Math.min(100, (waited / 120_000) * 100)} tone="info">
        <span className="clockn num">{late ? String(minutes) : clockText(waited)}</span>
      </Ring>
      <div>
        <b>{title}</b>
        {sub !== null && <small>{sub}</small>}
      </div>
      <button type="button" className="btn btn--tone c-info" disabled={busy || !shell.online} onClick={() => void withdraw()}>
        {t('handover.withdraw')}
      </button>
    </div>
  );
}
