import { useEffect, useMemo, useRef, useState } from 'react';
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
// printer the command still succeeds (`printed: false`, §3.16) and the screen says so. After hub task 27: a failed
// row, or one waiting more than 10 s (a timer from when this screen first saw it waiting, §8), offers Print to — the
// picker reads `GET /queries/bill-printers` when it opens and `RetargetBillPrint` moves the job (B18: nothing prints
// twice); `ReprintButton` sends `PrintBillDocument` (§6.22) for an invoice whose id the caller knows.

const KIND: Record<string, MessageKey> = {
  check: 'billing.print.kind.check',
  receipt: 'billing.print.kind.receipt',
  credit: 'billing.print.kind.credit',
};

const isKey = (key: string): key is MessageKey => key in en;

function kindText(kind: string): string {
  return t(KIND[kind] ?? 'billing.print.kind.check');
}

/** §8: a waiting job offers Print to after this long on the screen. */
export const PRINT_TO_AFTER_MS = 10_000;
/** R-2 (E2E re-run, §8 Print status): no live frame carries a print job's ack; after a print action the bill screen
 * reads the bill again every PRINT_WATCH_MS while a job is waiting / printing, at most PRINT_WATCH_TRIES times (30 s). */
export const PRINT_WATCH_MS = 1_500;
export const PRINT_WATCH_TRIES = 20;

function PrintToButton({ tone, onClick }: { tone: 'danger' | null; onClick: () => void }) {
  return (
    <button type="button" className={tone === 'danger' ? 'btn btn--tone c-danger' : 'btn'} onClick={onClick}>
      <BIco name="printer" />
      {t('billing.print.print_to')}
    </button>
  );
}

function Row({ print, onPrintTo }: { print: BillPrint; onPrintTo: (() => void) | null }) {
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
        {onPrintTo !== null && <PrintToButton tone="danger" onClick={onPrintTo} />}
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
      {onPrintTo !== null && <PrintToButton tone={null} onClick={onPrintTo} />}
    </div>
  );
}

/**
 * The bill's print rows (the bill view's `prints[]`, cancelled jobs left out). `noPrinter` adds the muted "No bill
 * printer set up" row for a document whose print command answered `printed: false`.
 */
export function PrintRows({ prints, noPrinter, onChanged }: { prints: readonly BillPrint[]; noPrinter?: 'check' | null; onChanged?: () => void }) {
  const shown = prints.filter((p) => p.state !== 'cancelled');
  const [late, setLate] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<BillPrint | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // §8 "waiting": a job sent to the printer (`printing`) can no longer be moved (RetargetBillPrint refuses it)
  const waitingIds = shown.filter((p) => p.state === 'waiting').map((p) => p.job_id).join(',');
  useEffect(() => {
    const ids = new Set(waitingIds === '' ? [] : waitingIds.split(','));
    for (const id of ids)
      if (!timers.current.has(id)) timers.current.set(id, setTimeout(() => setLate((l) => new Set(l).add(id)), PRINT_TO_AFTER_MS));
    for (const [id, timer] of timers.current)
      if (!ids.has(id)) {
        // the job left waiting (printed, failed, sent, or moved back to waiting later: its 10 s start again)
        clearTimeout(timer);
        timers.current.delete(id);
        setLate((l) => {
          if (!l.has(id)) return l;
          const next = new Set(l);
          next.delete(id);
          return next;
        });
      }
  }, [waitingIds]);
  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const timer of all.values()) clearTimeout(timer);
      all.clear();
    };
  }, []);
  if (shown.length === 0 && (noPrinter ?? null) === null) return null;
  const printTo = (p: BillPrint) => (onChanged !== undefined && (p.state === 'failed' || (p.state === 'waiting' && late.has(p.job_id))) ? () => setOpen(p) : null);
  return (
    <div className="col b5-prints" role="status">
      {shown.map((p) => (
        <Row key={p.job_id} print={p} onPrintTo={printTo(p)} />
      ))}
      {open !== null && onChanged !== undefined && (
        <PrintToSheet
          job={open}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            onChanged();
          }}
        />
      )}
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

const TITLE: Record<string, MessageKey> = {
  check: 'billing.print.title_check',
  receipt: 'billing.print.title_receipt',
  credit: 'billing.print.title_credit',
};

/**
 * §8 Print to (frames PrintTo, PrintToPhone): the branch's active printers by name, read when the picker opens
 * (`GET /queries/bill-printers`, §6.23a); the job's own printer is marked and not offered again; picking one sends
 * `RetargetBillPrint { job_id, printer_id }`. `PRINT_JOB_NOT_PENDING` (it printed or was cancelled meanwhile) closes
 * the picker and reads the bill again; `PRINTER_NOT_FOUND` reads the list again.
 */
function PrintToSheet({ job, onDone, onClose }: { job: BillPrint; onDone: () => void; onClose: () => void }) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const [printers, setPrinters] = useState<Array<{ printer_id: string; name: string }> | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const answer = await api.billPrinters();
    if (answer.ok) setPrinters(answer.data.printers);
    else setMsg(answer.error.kind === 'api' ? t(billingErrorKey(answer.error.code, answer.error.details)) : t('tables.toast.needs_hub'));
  };
  useEffect(() => {
    // read once when the picker opens (R-27)
    void load();
  }, []);
  const target = printers?.find((x) => x.printer_id === picked) ?? null;
  const move = async () => {
    if (target === null || busy) return;
    setBusy(true);
    setMsg(null);
    const answer = await api.retargetBillPrint({ job_id: job.job_id, printer_id: target.printer_id });
    setBusy(false);
    if (answer.ok) {
      shell.toasts.show({ text: fill(t('billing.print.moved'), { printer: target.name }), tone: 'ok' });
      onDone();
      return;
    }
    const e = answer.error;
    if (e.kind !== 'api') {
      setMsg(t('tables.toast.needs_hub'));
      return;
    }
    if (e.code === 'PRINT_JOB_NOT_PENDING' || e.code === 'PRINT_JOB_NOT_FOUND') {
      shell.toasts.show({ text: e.code === 'PRINT_JOB_NOT_FOUND' ? t('billing.print.err.job_gone') : t(billingErrorKey(e.code, e.details)), tone: 'warn' });
      onDone();
      return;
    }
    setMsg(e.code === 'PRINTER_NOT_FOUND' ? t('billing.print.err.printer_gone') : t(billingErrorKey(e.code, e.details)));
    if (e.code === 'PRINTER_NOT_FOUND') {
      setPicked(null);
      await load();
    }
  };
  const errorKey = `printers.error.${job.last_error ?? ''}`;
  const here = (name: string) =>
    name !== job.printer_name
      ? null
      : job.state === 'failed'
        ? isKey(errorKey)
          ? fill(t('billing.print.failed_here'), { error: t(errorKey) })
          : t('billing.print.failed_here_plain')
        : t('billing.print.waiting_here');
  return (
    <div className={shell.portrait || shell.phone ? 'scrim scrim--sheet' : 'scrim'}>
      <div className="dlg b5-dlg w6" role="dialog" aria-modal="true" aria-label={t(TITLE[job.doc_kind] ?? 'billing.print.title_check')}>
        {(shell.portrait || shell.phone) && <span className="dlg__grip" aria-hidden="true" />}
        <div className="dlg__h">
          <div className="dlg__t">
            <h2>{t(TITLE[job.doc_kind] ?? 'billing.print.title_check')}</h2>
            <div className="ac__who">{kindText(job.doc_kind)}</div>
          </div>
          <button type="button" className="btn btn--icon dlg__x" aria-label={t('common.close')} onClick={onClose}>
            <Ico name="x" />
          </button>
        </div>
        {printers === null && msg === null && <p className="muted">{t('common.loading')}</p>}
        {printers !== null && (
          <div className="b5-chips b5-chips--one">
            {printers.map((x) => (
              <button
                key={x.printer_id}
                type="button"
                className="b5-chip"
                aria-pressed={picked === x.printer_id}
                disabled={x.name === job.printer_name}
                onClick={() => setPicked(x.printer_id)}
              >
                <BIco name="printer" />
                <span>
                  {x.name}
                  {here(x.name) !== null && <small>{here(x.name)}</small>}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="b5-note">{t('billing.print.note')}</div>
        {msg !== null && (
          <div className="msg c-warn" role="alert">
            <Ico name="warn" />
            <span>{msg}</span>
          </div>
        )}
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" aria-disabled={target === null || busy} onClick={() => void move()}>
            {target !== null && <BIco name="printer" />}
            {target === null ? t('billing.print.pick') : fill(t('billing.print.print_on'), { printer: target.name })}
          </button>
        </div>
      </div>
    </div>
  );
}

/** §6.22 Reprint receipt / Reprint credit note (`take-payment`) for an invoice the caller knows by id. */
export function ReprintButton({ doc, invoiceId, onPrinted }: { doc: 'receipt' | 'credit_note'; invoiceId: string; onPrinted: () => void }) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const [busy, setBusy] = useState(false);
  const reprint = async () => {
    if (busy) return;
    setBusy(true);
    const answer = await api.printBillDocument({ doc, ref_id: invoiceId });
    setBusy(false);
    if (answer.ok) {
      const { printed, printer_name } = answer.data;
      shell.toasts.show(printed ? { text: fill(t('billing.print.reprint_sent'), { printer: printer_name ?? '' }), tone: 'ok' } : { text: t('billing.no_printer'), tone: 'warn' });
      onPrinted();
      return;
    }
    shell.toasts.show({ text: answer.error.kind === 'api' ? t(billingErrorKey(answer.error.code, answer.error.details)) : t('tables.toast.needs_hub'), tone: 'warn' });
  };
  return (
    <button type="button" className="btn" aria-disabled={busy} onClick={() => void reprint()}>
      <BIco name="printer" />
      {t(doc === 'receipt' ? 'billing.reprint_receipt' : 'billing.reprint_credit')}
    </button>
  );
}
