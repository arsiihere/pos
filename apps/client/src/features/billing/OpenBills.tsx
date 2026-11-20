import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { t } from '../../i18n';
import { fill, type MessageKey } from '../../i18n/en';
import { timeText } from '../alerts/labels';
import { Ico } from '../alerts/ui';
import { useLiveRefetch } from '../staff/orders/lists/OpenOrders';
import { useShell } from '../staff/shell/hooks';
import { billingApi } from './api';
import type { BillRef, OpenBillRow } from './contracts';
import { BILL_LIST_FRAMES } from './frames';
import { BIco, type BillIconName } from './icons';
import { billMoney, durationText, MONEY_DIR } from './money';
import './styles';

// 05 v1.0.12 §8 "Cashier screen", §6.2 (plan §3.1 task 34; brief §3.1.1; frames OpenBills, OpenBillsEmpty,
// OpenBillsOffline, OpenBillsUrdu): every bill that still needs money, in the server's order (check bill printed
// first, then opened_at — never re-sorted here). Read on mount, on bill / order / table frames, on reconnect and when
// the page turns visible (no push, no sound for a bill request, Q13). Badges: check bill printed (+ time), partly
// paid (+ Paid line), waiting for approval, open too long (`flagged`). Offline the last list stays "as of <time>".
// Not here: the floor switch (designer choice, needs a floors read), the fiscal line (task 31's fiscal-status) and
// the shift card (05-2); a tap opens the bill screen of task 35 through `onOpen`.

/** 05 §6 header (bill_ref rule): bill_id, else seating_id, else order_id. */
export function billRefOf(row: OpenBillRow): BillRef {
  if (row.bill_id !== null) return { bill_id: row.bill_id };
  if (row.seating_id !== null) return { seating_id: row.seating_id };
  return { order_id: row.order_id ?? '' };
}

const TYPE: Record<OpenBillRow['order_type'], { key: MessageKey; icon: BillIconName }> = {
  dine_in: { key: 'billing.type.dine_in', icon: 'dine_in' },
  takeaway: { key: 'billing.type.takeaway', icon: 'takeaway' },
  parking: { key: 'billing.type.parking', icon: 'parking' },
};

/** A code longer than a table chip ("T4 + T5") wraps in the tile (frame: "PARKING ABC 123 SEDAN", "Family 2"). */
const LONG_CODE = 7;

function keyOf(row: OpenBillRow): string {
  return row.bill_id ?? `${row.seating_id ?? ''}:${row.order_id ?? ''}:${row.identifier}`;
}

/** A copy text with one `{name}` placeholder, the slot rendered where the placeholder sits (any language order). */
function Slot({ text, name, children }: { text: string; name: string; children: ReactNode }) {
  const at = text.indexOf(`{${name}}`);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      {children}
      {text.slice(at + name.length + 2)}
    </>
  );
}

function Badges({ row, utcOffsetMs }: { row: OpenBillRow; utcOffsetMs: number }) {
  return (
    <span className="bds">
      {row.check_printed_at !== null && (
        <span className="b5-bd c-ok">
          <BIco name="printer" />
          <Slot text={t('billing.badge.check_printed')} name="time">
            <span className="num">{timeText(row.check_printed_at, utcOffsetMs)}</span>
          </Slot>
        </span>
      )}
      {row.partly_paid && (
        <span className="b5-bd c-info">
          <BIco name="split" />
          {t('billing.badge.partly_paid')}
        </span>
      )}
      {row.has_open_request && (
        <span className="b5-bd c-info">
          <BIco name="wait" />
          {t('billing.badge.waiting')}
        </span>
      )}
      {row.flagged && (
        <span className="b5-bd c-warn">
          <BIco name="clock" />
          <Slot text={t('billing.badge.open_too_long')} name="duration">
            <span className="num">{durationText(row.open_minutes)}</span>
          </Slot>
        </span>
      )}
    </span>
  );
}

function Row({ row, currency, stale, utcOffsetMs, onOpen }: { row: OpenBillRow; currency: string | null; stale: boolean; utcOffsetMs: number; onOpen: (() => void) | undefined }) {
  const type = TYPE[row.order_type];
  const money = (minor: number) => (currency === null ? '—' : billMoney(minor, currency));
  const code = ['tcode', row.order_type === 'dine_in' ? null : 'q', row.identifier.length > LONG_CODE ? 'long' : null].filter((c) => c !== null).join(' ');
  const cells = (
    <>
      <span className={code}>{row.identifier}</span>
      <span className="ty">
        <BIco name={type.icon} />
        {t(type.key)}
      </span>
      <Badges row={row} utcOffsetMs={utcOffsetMs} />
      <span className="op num">{durationText(row.open_minutes)}</span>
      <span className="am">
        <b dir={MONEY_DIR}>{money(row.total_default_minor)}</b>
        {row.paid_minor > 0 && (
          <span className="paid">
            <Slot text={t('billing.list.paid')} name="amount">
              <span className="num" dir={MONEY_DIR}>
                {money(row.paid_minor)}
              </span>
            </Slot>
          </span>
        )}
      </span>
      <BIco name="chev" className="flip" />
    </>
  );
  const className = stale ? 'b5-wr stale' : 'b5-wr';
  if (onOpen === undefined) return <div className={className}>{cells}</div>;
  return (
    <button type="button" className={className} onClick={onOpen}>
      {cells}
    </button>
  );
}

function Skeleton() {
  return (
    <div className="b5-scroll col" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="b5-wr b5-wr--sk">
          <span className="sk" />
          <span className="sk" />
          <span className="sk" />
          <span className="sk" />
          <span className="sk" />
          <span />
        </div>
      ))}
    </div>
  );
}

/** #/bills (cashier kiosk / tablet with `take-payment`). */
export function OpenBills({ onOpen }: { onOpen?: (ref: BillRef) => void }) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  // the snapshot's top-level currency (row F-6); a string, so the store read is stable between renders
  const currency = useSyncExternalStore(shell.config.subscribe, () => shell.config.snapshot()?.currency_code ?? null);
  const [rows, setRows] = useState<OpenBillRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  // each read replaces the list; a reply older than the last request is dropped
  const request = useRef(0);
  const load = useCallback(async () => {
    const mine = ++request.current;
    const answer = await api.openBills();
    if (mine !== request.current) return;
    if (!answer.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setRows(answer.data.bills);
    setLoadedAt(shellRef.current.clock.nowMs());
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefetch(shell.live, () => void load(), BILL_LIST_FRAMES);

  const offset = shell.clock.utcOffsetMs;
  // hub down, or the last read failed: the kept list reads as stale, "as of" its read
  const stale = rows !== null && (!shell.online || failed);
  let body;
  if (rows === null && failed) {
    body = (
      <div className="msg c-danger" role="alert">
        <Ico name="warn" />
        <span>{t('billing.list.load_failed')}</span>
        <button type="button" className="btn" onClick={() => void load()}>
          {t('orders.retry')}
        </button>
      </div>
    );
  } else if (rows === null) {
    body = <Skeleton />;
  } else if (rows.length === 0) {
    body = (
      <div className="empty">
        <span className="ring c-ok">
          <BIco name="bill" />
        </span>
        <b>{t('billing.list.empty')}</b>
        <span>{t('billing.list.empty_sub')}</span>
      </div>
    );
  } else {
    body = (
      <>
        <div className="b5-wr th">
          <span>{t('billing.list.col.bill')}</span>
          <span>{t('billing.list.col.type')}</span>
          <span>{t('billing.list.col.status')}</span>
          <span>{t('billing.list.col.open')}</span>
          <span>{t('billing.list.col.total')}</span>
          <span />
        </div>
        <div className="b5-scroll col">
          {rows.map((r) => (
            <Row key={keyOf(r)} row={r} currency={currency} stale={stale} utcOffsetMs={offset} onOpen={onOpen === undefined ? undefined : () => onOpen(billRefOf(r))} />
          ))}
        </div>
      </>
    );
  }

  return (
    <div className="b5 b5--page">
      <main className="b5-home b5-home--one">
        <section className="b5-wl">
          <div className="b5-wl__h">
            <h1>{t('billing.list.title')}</h1>
            <span className="cnt">{rows?.length ?? 0}</span>
            {stale && loadedAt !== null && <span className="b5-note">{fill(t('billing.list.as_of'), { time: timeText(loadedAt, offset) })}</span>}
          </div>
          <div className="b5-wl__b b5-wl__b--fill">{body}</div>
        </section>
      </main>
    </div>
  );
}
