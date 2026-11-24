import { useMemo, useRef, useState } from 'react';
import type { HubError } from '../../../../api/hub-admin';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { billingApi } from '../../../billing/api';
import { billingErrorKey } from '../../../billing/errors';
import { BIco } from '../../../billing/icons';
import { useShell } from '../../shell/hooks';
import './styles';

// 02b-TK C3-2 (05 v1.0.34 §6.3, §3.16; ruling R6): "Print check bill" on the token view and on the cart of an addition
// to a sent token — `PrintCheckBill { bill_ref: { order_id } }` of the token's newest order (05 #44e). The check bill
// prints on the device's route (takeaway, §3.16); with no bill printer the command still succeeds (`printed: false`)
// and the screen says to show it. An unsent cart has none: there is no bill yet, its total is on the screen. A resend
// after a lost reply keeps its command_id (billing api), so a check bill prints once.

/** A PrintCheckBill refusal's text (05 §6.3 errors as the takeaway meets them); never a raw code. */
export function checkBillText(e: HubError): string {
  if (e.kind !== 'api') return t('tables.toast.needs_hub');
  switch (e.code) {
    case 'ORDER_NOT_FOUND':
      return t('line.err.gone');
    case 'BUSINESS_DAY_NOT_OPEN':
      return t('v.check_day');
    case 'PERMISSION_DENIED':
      return t('v.check_denied');
    default:
      return t(billingErrorKey(e.code, e.details));
  }
}

export function CheckBill({ order_id }: { order_id: string }) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const print = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const answer = await api.printCheckBill({ bill_ref: { order_id } });
    inFlight.current = false;
    setBusy(false);
    if (!answer.ok) {
      shell.toasts.show({ text: checkBillText(answer.error), tone: 'warn' });
      return;
    }
    const { printed, printer_name } = answer.data;
    shell.toasts.show(printed ? { text: fill(t('billing.check_sent'), { printer: printer_name ?? '' }), tone: 'ok' } : { text: t('billing.no_printer'), tone: 'warn' });
  };
  return (
    <button type="button" className="tk-btn" aria-disabled={busy} onClick={() => void print()}>
      <BIco name="printer" />
      {t('billing.check_bill')}
    </button>
  );
}
