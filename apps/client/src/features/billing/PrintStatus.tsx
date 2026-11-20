import { useMemo, useState } from 'react';
import { t } from '../../i18n';
import { en, fill, type MessageKey } from '../../i18n/en';
import { Ico } from '../alerts/ui';
import { useShell } from '../staff/shell/hooks';
import { billingApi } from './api';
import type { BillPrint, BillRef, PrintCheckBillResult } from './contracts';
import { billingErrorKey } from './errors';
import { BIco } from './icons';
import './styles';

// 05 v1.0.14 §8 "Print status", §6.1 `prints[]`, §6.3 (plan §3.1 task 38; brief §3.2.7, §3.4; frame PrintStatus):
// each bill document's job shows waiting (spinner) / printed / failed with the printer's name; a failed job's error
// is the 03c word (`printers.error.*`), never the raw code. Print check bill sends `PrintCheckBill`; with no bill
// printer the command still succeeds (`printed: false`, §3.16) and the screen says so. Not here (task 27): the
// Print to picker (`GET /queries/bill-printers`, `RetargetBillPrint`) and the receipt / credit-note reprints.

const KIND: Record<string, MessageKey> = {
  check: 'billing.print.kind.check',
  receipt: 'billing.print.kind.receipt',
  credit: 'billing.print.kind.credit',
};

const isKey = (key: string): key is MessageKey => key in en;

function kindText(kind: string): string {
  return t(KIND[kind] ?? 'billing.print.kind.check');
}

function Row({ print }: { print: BillPrint }) {
  const printer = print.printer_name ?? '';
  if (print.state === 'printed')
    return (
      <div className="b5-pr c-ok">
        <Ico name="check" />
        <span className="t">
          <span className="k">{kindText(print.doc_kind)}</span>
          <span>{fill(t('billing.print.printed'), { printer })}</span>
        </span>
      </div>
    );
  if (print.state === 'failed') {
    const errorKey = `printers.error.${print.last_error ?? ''}`;
    const text = isKey(errorKey) ? fill(t('billing.print.failed'), { printer, error: t(errorKey) }) : fill(t('billing.print.failed_plain'), { printer });
    return (
      <div className="b5-pr c-danger">
        <Ico name="warn" />
        <span className="t">
          <span className="k">{kindText(print.doc_kind)}</span>
          <span>{text}</span>
        </span>
      </div>
    );
  }
  // waiting and printing (sent, no ack yet) read the same: on its way
  return (
    <div className="b5-pr c-info">
      <span className="spin" />
      <span className="t">
        <span className="k">{kindText(print.doc_kind)}</span>
        <span>{fill(t('billing.print.waiting'), { printer })}</span>
      </span>
    </div>
  );
}

/**
 * The bill's print rows (the bill view's `prints[]`, cancelled jobs left out). `noPrinter` adds the muted "No bill
 * printer set up" row for a document whose print command answered `printed: false`.
 */
export function PrintRows({ prints, noPrinter }: { prints: readonly BillPrint[]; noPrinter?: 'check' | null }) {
  const shown = prints.filter((p) => p.state !== 'cancelled');
  if (shown.length === 0 && (noPrinter ?? null) === null) return null;
  return (
    <div className="col b5-prints" role="status">
      {shown.map((p) => (
        <Row key={p.job_id} print={p} />
      ))}
      {noPrinter === 'check' && (
        <div className="b5-pr c-mute">
          <BIco name="printer" />
          <span className="t">
            <span className="k">{kindText('check')}</span>
            <span>{t('billing.print.none')}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/** §6.3 Print check bill (`take-order`): a toast with the printer, or the no-printer line (§3.16). */
export function CheckBillButton({ billRef, onPrinted }: { billRef: BillRef; onPrinted: (r: Pick<PrintCheckBillResult, 'printed' | 'printer_name'>) => void }) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const [busy, setBusy] = useState(false);
  const print = async () => {
    if (busy) return;
    setBusy(true);
    const answer = await api.printCheckBill({ bill_ref: billRef });
    setBusy(false);
    if (answer.ok) {
      const { printed, printer_name } = answer.data;
      shell.toasts.show(
        printed ? { text: fill(t('billing.check_sent'), { printer: printer_name ?? '' }), tone: 'ok' } : { text: t('billing.no_printer'), tone: 'warn' },
      );
      onPrinted({ printed, printer_name });
      return;
    }
    shell.toasts.show({ text: answer.error.kind === 'api' ? t(billingErrorKey(answer.error.code, answer.error.details)) : t('tables.toast.needs_hub'), tone: 'warn' });
  };
  return (
    <button type="button" className="btn" aria-disabled={busy} onClick={() => void print()}>
      <BIco name="printer" />
      {t('billing.check_bill')}
    </button>
  );
}
