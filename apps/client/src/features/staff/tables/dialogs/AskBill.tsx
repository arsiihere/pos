import { useRef, useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import type { HubError } from '../../../../api/hub-admin';
import { useShell } from '../../shell/hooks';
import type { SeatingRef } from '../contracts';

// 02a §3.13, §6.12, §8 Offline (02a-D24 AskBill): the action grid turns into "Ask for the bill for F4?" in place.
// Ask = `RequestBill { table_id, seating_id }` through the one Enqueue (Q-3): sent → "Bill asked", or "Already
// asked" for `requested: false`; queued → "Will be sent when the hub is back"; needs_hub (no queue yet) → "Needs the
// hub"; a refusal (409 TABLE_NO_ORDERS, TABLE_SEATING_CHANGED, …) → the sheet's error handling.

export interface AskBillProps {
  code: string;
  /** the seating the confirm opened on (T18) */
  seating: SeatingRef;
  onClose(): void;
  onFailed(error: HubError): void;
}

export function AskBill({ code, seating, onClose, onFailed }: AskBillProps) {
  const { enqueue, toasts } = useShell();
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);

  const close = () => {
    if (!inflight.current) onClose();
  };

  async function ask(): Promise<void> {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    const r = await enqueue<{ requested: boolean }>('RequestBill', { table_id: seating.table_id, seating_id: seating.seating_id }, {
      table_id: seating.table_id,
      seating_id: seating.seating_id,
      label: `${t('sheet.act.bill')} · ${code}`,
    });
    inflight.current = false;
    setBusy(false);
    onClose();
    if (r.status === 'refused') onFailed(r.error);
    else if (r.status === 'queued') toasts.show(r.logged === true ? { text: t('queue.in_log'), tone: 'warn' } : { text: t('tables.toast.queued'), tone: 'info' });
    else if (r.status === 'needs_hub') toasts.show({ text: t('tables.toast.needs_hub'), tone: 'warn' });
    else toasts.show({ text: r.result.requested ? t('bill.asked') : t('tables.toast.already_asked'), tone: r.result.requested ? 'ok' : 'info' });
  }

  return (
    <div className="confirm c-bill" role="group" aria-label={fill(t('bill.confirm'), { table: code })}>
      {fill(t('bill.confirm'), { table: code })}
      <button type="button" className="btn" disabled={busy} onClick={close}>
        {t('common.cancel')}
      </button>
      <button type="button" className="btn btn--tone c-bill" disabled={busy} onClick={() => void ask()}>
        {t('bill.ask')}
      </button>
    </div>
  );
}
