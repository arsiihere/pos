import { useRef, useState } from 'react';
import { t } from '../../../../i18n';
import { errorKey } from '../../../../i18n/en';
import { BIco } from '../../../billing/icons';
import { useShell } from '../../shell/hooks';
import { slipMissesOf } from './slips';
import './styles';

// ⚠️ 02b-TK L-CLIENT-3 item 2 (03c v1.0.16 §3.11 trigger 2, §6.14, §8; ruling R6): the token view's Print token on a Due
// token — `PrintTakeawaySlip { order_id: <newest>, reason: 'reprint' }` (a reprint always prints, with REPRINT). Not
// queueable: off while offline, one request in flight; a resend after a lost reply keeps its command_id (the shell's
// transport takes one per call: the tap is debounced instead). `TAKEAWAY_SLIP_NOT_ALLOWED` (the token turned paid)
// refreshes the view, which then hides the action. Errors through `errors.<code>`.

export function PrintSlip({ order_id, order_ids, onRefused }: { order_id: string; order_ids: readonly string[]; onRefused(): void }) {
  const shell = useShell();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const print = async () => {
    if (inFlight.current || !shell.online) return;
    inFlight.current = true;
    setBusy(true);
    const answer = await shell.api.command<{ printed: boolean; job_id: string | null; skipped: string | null }>('PrintTakeawaySlip', { order_id, reason: 'reprint' });
    inFlight.current = false;
    setBusy(false);
    if (!answer.ok) {
      if (answer.error.kind !== 'api') return shell.toasts.show({ text: t('tables.toast.needs_hub'), tone: 'warn' });
      if (answer.error.code === 'TAKEAWAY_SLIP_NOT_ALLOWED') onRefused();
      return shell.toasts.show({ text: t(errorKey(answer.error.code)), tone: 'warn' });
    }
    const { printed, skipped } = answer.data;
    if (printed) {
      slipMissesOf(shell).clear(order_ids);
      return shell.toasts.show({ text: t('takeaway.slip.printing'), tone: 'ok' });
    }
    shell.toasts.show({ text: t(skipped === 'setting_off' ? 'takeaway.slip.off' : 'takeaway.slip.no_printer'), tone: 'warn' });
  };
  return (
    <button type="button" className="tk-btn" aria-disabled={busy || !shell.online} onClick={() => void print()}>
      <BIco name="printer" />
      {t('v.print')}
    </button>
  );
}
