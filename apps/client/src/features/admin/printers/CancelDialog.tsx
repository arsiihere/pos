import { useState } from 'react';
import { BusyButton } from '../../../components/BusyButton';
import { Dialog } from '../../../components/Dialog';
import { t } from '../../../i18n';
import type { HubError } from '../kitchen-screens/api';
import { errorText } from '../kitchen-screens/KitchenScreens';

// 03c §6.5; 03c-D05 (frame QueueCancel): "Cancel this ticket? It will not print." → POST
// /admin/print/jobs/:job_id/cancel. A refusal closes the dialog and is said in a toast (brief §3.5.6):
// 409 PRINT_JOB_NOT_PENDING { state: 'acked' } "Already printed", { state: 'cancelled' } "Already cancelled",
// 404 PRINT_JOB_NOT_FOUND its catalogue text. The page re-reads once either way.

export function cancelRefusalText(error: HubError): string {
  if (error.kind === 'api' && error.code === 'PRINT_JOB_NOT_PENDING') {
    const state = error.details['state'];
    if (state === 'acked') return t('print_queue.already_printed');
    if (state === 'cancelled') return t('print_queue.already_cancelled');
  }
  return errorText(error);
}

export function CancelDialog({
  what,
  cancel,
  onClose,
}: {
  /** "Grill · Ticket" */
  what: string;
  /** sends the cancel; resolves with the refusal, or null when cancelled */
  cancel: () => Promise<HubError | null>;
  onClose: (refusal: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    const refused = await cancel();
    setBusy(false);
    onClose(refused === null ? null : cancelRefusalText(refused));
  };
  // while the cancel runs the dialog stays: its answer (toast, re-read) belongs to it
  const keep = () => {
    if (!busy) onClose(null);
  };
  return (
    <Dialog
      title={t('print_queue.cancel_confirm')}
      onClose={keep}
      form={false}
      footer={
        <>
          <button type="button" className="pos-btn" disabled={busy} onClick={keep}>
            {t('print_queue.keep')}
          </button>
          <BusyButton danger busy={busy} onClick={() => void confirm()}>
            {t('print_queue.cancel_ticket')}
          </BusyButton>
        </>
      }
    >
      <p className="pos-dialog__body">{what}</p>
    </Dialog>
  );
}
