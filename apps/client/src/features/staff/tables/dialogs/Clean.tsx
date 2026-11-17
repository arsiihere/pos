import { useRef, useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import type { HubError } from '../../../../api/hub-admin';
import { useShell } from '../../shell/hooks';
import type { SeatingRef } from '../contracts';
import { DialogFrame } from './TableBusy';

// 02a §3.13, §6.13, §8 Offline (02-D13 Clean, CleanWhileLocked, CleanOpenOrders): `CleanTable { table_id,
// seating_id }` through the one Enqueue (Q-3). Someone else's lock → "Clean anyway?" (client-side: his order stays
// on his screen as a draft; the fold ends his lock). `409 TABLE_HAS_OPEN_ORDERS { order_count }` → "The bill must be
// paid first" with OK. Other refusals → the sheet's error handling.

export interface CleanProps {
  code: string;
  /** the seating the dialog opened on (T18) */
  seating: SeatingRef;
  /** someone else is taking an order here */
  lockedBy: string | null;
  onClose(): void;
  onCleaned(): void;
  onFailed(error: HubError): void;
}

export function Clean({ code, seating, lockedBy, onClose, onCleaned, onFailed }: CleanProps) {
  const { enqueue, toasts, localFlags } = useShell();
  const [busy, setBusy] = useState(false);
  const [openOrders, setOpenOrders] = useState<number | null>(null);
  const inflight = useRef(false);

  /** Cancel / Close do nothing while the send is in flight */
  const close = () => {
    if (!inflight.current) onClose();
  };

  async function clean(): Promise<void> {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    const r = await enqueue<{ reason: 'cleaned' | 'left_without_order' }>('CleanTable', { table_id: seating.table_id, seating_id: seating.seating_id }, {
      table_id: seating.table_id,
      seating_id: seating.seating_id,
      label: `${t('clean.label')} · ${code}`,
    });
    inflight.current = false;
    setBusy(false);
    if (r.status === 'refused') {
      if (r.error.code === 'TABLE_HAS_OPEN_ORDERS') {
        const n = r.error.details['order_count'];
        setOpenOrders(typeof n === 'number' ? n : 0);
        return;
      }
      onFailed(r.error);
      return;
    }
    if (r.status === 'queued') toasts.show(r.logged === true ? { text: t('queue.in_log'), tone: 'warn' } : { text: t('tables.toast.queued'), tone: 'info' });
    else if (r.status === 'needs_hub') toasts.show({ text: t('tables.toast.needs_hub'), tone: 'warn' });
    else {
      // the party left: this device's "Call sent" (Q-16, keyed by table) must not stick to the next party
      localFlags.clearCallSent(seating.table_id);
      toasts.show({ text: fill(t('tables.toast.free'), { table: code }), tone: 'ok' });
    }
    onCleaned();
  }

  if (openOrders !== null) {
    return (
      <DialogFrame code={code} title={fill(t('clean.title'), { table: code })} onClose={close}>
        <div className="msg c-danger" role="alert">
          <span>{fill(t('clean.open_orders'), { table: code, n: String(openOrders) })}</span>
        </div>
        <div className="acts acts--1">
          <button type="button" className="btn" onClick={onClose}>
            {t('tables.ok')}
          </button>
        </div>
      </DialogFrame>
    );
  }
  if (lockedBy !== null) {
    return (
      <DialogFrame code={code} title={fill(t('busy.title'), { name: lockedBy })} onClose={close}>
        <p className="dlg__line">{fill(t('clean.anyway_body'), { table: code })}</p>
        <div className="acts">
          <button type="button" className="btn" disabled={busy} onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void clean()}>
            {t('clean.anyway')}
          </button>
        </div>
      </DialogFrame>
    );
  }
  return (
    <DialogFrame code={code} title={fill(t('clean.title'), { table: code })} onClose={close}>
      <p className="dlg__line">{t('clean.body')}</p>
      <div className="acts">
        <button type="button" className="btn" disabled={busy} onClick={close}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void clean()}>
          {t('sheet.mark_clean')}
        </button>
      </div>
    </DialogFrame>
  );
}
