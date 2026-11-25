import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { HubError } from '../../../../api/hub-admin';
import { navigate } from '../../../../app/router';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { timeText } from '../../../alerts/labels';
import { Ico } from '../../../alerts/ui';
import { billingApi } from '../../../billing/api';
import { activeModes, duesOf, refusalText, type Mode } from '../../../billing/BillScreen';
import type { BillView, BillViewSplit } from '../../../billing/contracts';
import { billMoney, parseMinor } from '../../../billing/money';
import { useShell } from '../../shell/hooks';
import { MONEY_DIR, money } from '../money';
import './styles';

// 02b-TK C3-1 (05 v1.0.34 §6.1, §6.9, §6.12, B12, B16; frames PayCash, PayCashShort, PayCard, PayDone, PayError,
// PayUrdu; MAPPING TK-D06): the takeaway pay panel over the cart (the menu and the queue stay live). The bill is the
// hub's (`GET /queries/bill?order_id=` of the order paid — the token's NEWEST order, 05 #44e); To pay is the open
// split's due at the picked mode's class (§3.5 (7): cash and card dues differ, the hub's numbers). Cash: the notes
// Exact / 4,000 / 5,000 / 10,000 or a typed amount (never pre-filled, M-6), the change it leaves or "Short by" in red
// (Paid off); card: the mode's reference when `reference_required`. Paid = `AddPayment` then `CloseSplit` with the
// total the payment answered (rule 7); the receipt prints as today (§3.16). Money commands are never queued (B12):
// offline the panel says so and offers no Paid; the order stays Due. A lost reply resends the same command_id
// (billing api, handbook §10), so Try again never takes the money twice.
// SHIFT_NOT_OPEN is the AddPayment answer, not a pre-check: the money shift may be the DEVICE's drawer shift of
// another person (B11), which `GET /queries/shift` (the caller's own) does not show.

export interface PayTarget {
  /** the order whose bill is paid; null while Send & pay is still sending it */
  order_id: string | null;
  /** the token as shown ("57"), or null */
  ident: string | null;
  name: string | null;
  promise_ms: number | null;
}

export interface PayPanelProps {
  target: PayTarget;
  /** Pay later / close: the order stays Due */
  onLater(): void;
  /** Next customer (after the bill closed) */
  onDone(): void;
  /** A completed first close of the whole bill, for the counter display. */
  onClosed?(payment: { kind: 'paid'; change_minor: number }, totalMinor: number): void;
  /** phone / portrait: over the whole screen (no cart column to cover) */
  fixed?: boolean;
}

/** The cash notes the frames offer, in major units. */
const NOTES = [4_000, 5_000, 10_000] as const;

type Phase =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'form' }
  | { kind: 'busy' }
  /** AddPayment did not go through: nothing was charged (or, `offline`, the hub did not answer) */
  | { kind: 'not_paid'; text: string; offline: boolean; shift: boolean }
  /** the payment is in, CloseSplit was refused (or not answered): `expected` is the close to send again */
  | { kind: 'not_closed'; text: string; expected: number }
  | { kind: 'done'; total_minor: number; change_minor: number; receipt: boolean };

/** The split this panel pays: the first open one. */
function openSplit(b: BillView): BillViewSplit | undefined {
  return b.splits.find((s) => s.state === 'open');
}

/** §3.5 (7) the due at a mode's class: the hub's dues where the view gives them, else the split's balance. */
function dueAt(split: BillViewSplit, mode: Mode): number {
  const dues = duesOf(split, null);
  if (dues === null) return Math.max(0, split.balance_minor);
  return mode.payment_class === 'cash' ? dues.cash_due_minor : dues.card_due_minor;
}

export function PayPanel({ target, onLater, onDone, onClosed, fixed }: PayPanelProps) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const modes = useSyncExternalStore(shell.config.subscribe, () => activeModes(shell.config.snapshot()));
  const [bill, setBill] = useState<BillView | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [modeId, setModeId] = useState<string | null>(null);
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');
  const [banner, setBanner] = useState<string | null>(null);
  const busy = useRef(false);
  const orderId = target.order_id;

  const request = useRef(0);
  const load = useCallback(async (): Promise<BillView | null> => {
    if (orderId === null) return null;
    const mine = ++request.current;
    const answer = await api.bill({ order_id: orderId });
    if (mine !== request.current) return null;
    if (!answer.ok) {
      setPhase((p) => (p.kind === 'loading' ? { kind: 'failed' } : p));
      return null;
    }
    setBill(answer.data);
    setPhase((p) => (p.kind === 'loading' || p.kind === 'failed' ? { kind: 'form' } : p));
    return answer.data;
  }, [api, orderId]);
  useEffect(() => {
    void load();
  }, [load]);

  const mode = modes.find((m) => m.mode_id === modeId) ?? modes[0] ?? null;
  const split = bill === null ? undefined : openSplit(bill);
  const exponent = bill?.currency.exponent ?? 2;
  const due = split === undefined || mode === null ? null : dueAt(split, mode);
  const cash = mode?.payment_class === 'cash';
  const tenderedMinor = tendered.trim() === '' ? null : parseMinor(tendered, exponent);
  const short = cash && due !== null && tenderedMinor !== null && tenderedMinor < due ? due - tenderedMinor : null;
  const change = cash && due !== null && tenderedMinor !== null && tenderedMinor > due ? tenderedMinor - due : null;
  const online = shell.online;
  const ready =
    phase.kind === 'form' &&
    online &&
    split !== undefined &&
    mode !== null &&
    due !== null &&
    (due === 0 || (cash ? tenderedMinor !== null && tenderedMinor >= due : !mode.reference_required || reference.trim() !== ''));
  const billRef = { order_id: orderId ?? '' };
  const ctxOf = (b: BillView, s: BillViewSplit) => ({ bill: b, split: s, dues: duesOf(s, null), mode, modes, direction: 'in' as const });
  const textOf = (e: HubError, b: BillView, s: BillViewSplit) => {
    if (e.kind === 'api' && e.code === 'BUSINESS_DAY_NOT_OPEN') return t('p.err_day');
    return refusalText(e, ctxOf(b, s));
  };

  const close = async (b: BillView, s: BillViewSplit, expected: number, report?: PayPanelProps['onClosed']) => {
    const answer = await api.closeSplit({ bill_ref: billRef, split_no: s.split_no, expected_total_minor: expected });
    if (!answer.ok) {
      const e = answer.error;
      if (e.kind === 'api' && (e.code === 'BILL_TOTAL_CHANGED' || e.code === 'BILL_BALANCE_DUE')) {
        // rule 7: read again and show the new total; never close by itself (the payment is in, the rest is due)
        setBanner(
          e.code === 'BILL_TOTAL_CHANGED'
            ? fill(t('billing.total_changed'), { amount: typeof e.details['total_minor'] === 'number' ? billText(e.details['total_minor'], b) : '' })
            : textOf(e, b, s),
        );
        await load();
        setPhase({ kind: 'form' });
        return;
      }
      setPhase({ kind: 'not_closed', text: e.kind === 'network' ? t('p.offline') : textOf(e, b, s), expected });
      if (e.kind === 'api') void load();
      return;
    }
    const r = answer.data;
    if ('empty' in r) {
      setPhase({ kind: 'done', total_minor: 0, change_minor: 0, receipt: false });
      report?.({ kind: 'paid', change_minor: 0 }, 0);
      return;
    }
    if (r.bill_state !== 'closed') {
      // another split of this bill is still open (a split bill): the panel goes on with it
      await load();
      setPhase({ kind: 'form' });
      return;
    }
    setPhase({ kind: 'done', total_minor: r.total_minor, change_minor: r.change_minor, receipt: r.receipt.job_id !== null });
    report?.({ kind: 'paid', change_minor: r.change_minor }, r.total_minor);
  };

  const pay = async () => {
    if (!ready || busy.current || bill === null || split === undefined || mode === null || due === null) return;
    busy.current = true;
    setBanner(null);
    setPhase({ kind: 'busy' });
    try {
      let expected = split.totals.as_paid.total_minor;
      if (due > 0) {
        const answer = await api.addPayment({
          bill_ref: billRef,
          split_no: split.split_no,
          mode_id: mode.mode_id,
          direction: 'in',
          amount_minor: due,
          ...(cash ? { tendered_minor: tenderedMinor! } : {}),
          ...(!cash && reference.trim() !== '' ? { reference: reference.trim() } : {}),
        });
        if (!answer.ok) {
          const e = answer.error;
          // 00 command pipeline: the first send was applied (its reply lost) and the resend differs — the payment may be in
          const reused = e.kind === 'api' && e.code === 'VALIDATION_FAILED' && Array.isArray(e.details['issues']) && (e.details['issues'] as Array<{ path?: unknown }>).some((i) => i.path === 'command_id');
          if (reused) {
            setBanner(t('pad.maybe_in'));
            await load();
            setPhase({ kind: 'form' });
            return;
          }
          const shift = e.kind === 'api' && e.code === 'SHIFT_NOT_OPEN' && e.details['reason'] === 'no_shift' && shell.permissions.allowed('manage-own-shift');
          setPhase({ kind: 'not_paid', text: e.kind === 'network' ? t('p.offline') : textOf(e, bill, split), offline: e.kind === 'network', shift });
          // a refusal means the screen was stale (a due, the split's state): read the bill again
          if (e.kind === 'api') void load();
          return;
        }
        // B30: the reference is not kept once sent
        setReference('');
        if (answer.data.balance_minor > 0) {
          await load();
          setPhase({ kind: 'form' });
          return;
        }
        expected = answer.data.totals?.as_paid?.total_minor ?? expected;
      }
      await close(bill, split, expected, onClosed);
    } finally {
      busy.current = false;
    }
  };

  const retryClose = async (expected: number) => {
    if (busy.current || bill === null || split === undefined) return;
    busy.current = true;
    setPhase({ kind: 'busy' });
    try {
      await close(bill, split, expected);
    } finally {
      busy.current = false;
    }
  };

  // Enter = Paid on the pad, Next customer when paid (frames PayCash, PayDone; a focused button takes its own Enter)
  const keys = useRef({ pay, onDone, phase, ready });
  keys.current = { pay, onDone, phase, ready };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.target instanceof HTMLTextAreaElement) return;
      // a tapped note or mode keeps the focus: its Enter is Paid ("Exact ⏎", TAPS row 1); any other button its own
      if (e.target instanceof HTMLButtonElement && e.target.closest('.tk-notes, .tk-modes') === null) return;
      const k = keys.current;
      if (k.phase.kind === 'done') {
        e.preventDefault();
        k.onDone();
      } else if (k.ready) {
        e.preventDefault();
        void k.pay();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const pickMode = (m: Mode) => {
    setModeId(m.mode_id);
    setTendered('');
    setReference('');
  };
  const sub = [target.name, target.promise_ms === null ? null : `${t('t.sent')} ${timeText(target.promise_ms, shell.clock.utcOffsetMs)}`].filter((x) => x !== null).join(' · ');

  const head = (
    <div className="tk-pay__h">
      {target.ident !== null && (
        <span className="tk-tok" dir="ltr">
          {target.ident}
        </span>
      )}
      <div className="grow">
        <b className="tk-pay__t">{t('p.title')}</b>
        {sub !== '' && <div className="muted">{sub}</div>}
      </div>
      <button type="button" className="tk-x" aria-label={t('common.close')} onClick={onLater}>
        <Ico name="x" />
      </button>
    </div>
  );

  if (phase.kind === 'done')
    return (
      <section className={fixed === true ? 'tk-paypanel tk-paypanel--fixed' : 'tk-paypanel'} role="dialog" aria-label={t('p.title')}>
        {head}
        <div className="tk-empty tk-pay__done" role="status">
          <div className="tk-empty__ic tk-empty__ic--ok">
            <Ico name="check" />
          </div>
          <b>
            {t('p.paid_t')} · <span dir={MONEY_DIR}>{money(phase.total_minor)}</span>
          </b>
          {phase.change_minor > 0 && (
            <div className="tk-change tk-change--block">
              <span>{t('p.change_big')}</span>
              <span className="money" dir={MONEY_DIR}>
                {money(phase.change_minor)}
              </span>
            </div>
          )}
          <p>{phase.receipt ? t('p.receipt') : t('billing.no_printer')}</p>
        </div>
        <div className="tk-foot">
          <button type="button" className="tk-btn tk-btn--xl tk-btn--block tk-btn--primary" onClick={onDone}>
            {t('p.next')} <span className="tk-kbd" dir="ltr">Enter</span>
          </button>
        </div>
      </section>
    );

  const later = (
    <button type="button" className="tk-btn tk-btn--lg" onClick={onLater}>
      {t('p.later')}
    </button>
  );
  let body: ReactNode;
  let primary: ReactNode = null;
  if (orderId === null) body = <p className="tk-hint tk-pay__pad">{t('send.sending')}</p>;
  else if (phase.kind === 'loading') body = <p className="tk-hint tk-pay__pad">{t('common.loading')}</p>;
  else if (phase.kind === 'failed') {
    body = (
      <div className="tk-msg tk-msg--danger tk-pay__pad" role="alert">
        <Ico name="warn" />
        <span>{t('billing.bill.load_failed')}</span>
      </div>
    );
    primary = (
      <button type="button" className="tk-btn tk-btn--xl tk-btn--primary" onClick={() => void load()}>
        {t('q.retry')}
      </button>
    );
  } else if (phase.kind === 'not_paid' || phase.kind === 'not_closed') {
    const paid = phase.kind === 'not_closed';
    body = (
      <div className="tk-pay__err" role="alert">
        <h2>
          <Ico name="warn" /> {t(paid ? 'p.close_err' : 'p.err')}
        </h2>
        <p>{paid ? t('p.close_err_sub') : phase.offline ? null : `${t('p.err_sub')} ${t('p.err_kitchen')}`}</p>
        <p className="tk-pay__why">{phase.text}</p>
        {phase.kind === 'not_paid' && phase.shift && (
          <button type="button" className="tk-btn" onClick={() => navigate('/shift')}>
            {t('billing.shift.nav')}
          </button>
        )}
        {paid && (
          <button type="button" className="tk-btn" onClick={() => navigate(`/bill?order_id=${encodeURIComponent(orderId)}`)}>
            {t('p.open_bill')}
          </button>
        )}
      </div>
    );
    primary = (
      <button
        type="button"
        className="tk-btn tk-btn--xl tk-btn--primary"
        onClick={() => {
          if (phase.kind === 'not_closed') void retryClose(phase.expected);
          else if (phase.offline) {
            setPhase({ kind: 'form' });
            // the same payment again: the billing api resends the kept command_id (never a second payment)
            setTimeout(() => void keys.current.pay(), 0);
          } else setPhase({ kind: 'form' });
        }}
      >
        {t('q.retry')}
      </button>
    );
  } else if (split === undefined || mode === null || due === null) {
    body = <p className="tk-hint tk-pay__pad">{t('billing.closed_empty')}</p>;
  } else {
    const noteMinor = (major: number) => major * 10 ** exponent;
    body = (
      <>
        <div className="tk-pay__due">
          <span>{t('p.due')}</span>
          <span className="money" dir={MONEY_DIR}>
            {money(due)}
          </span>
        </div>
        {banner !== null && (
          <div className="tk-msg tk-pay__pad" role="status">
            <Ico name="info" />
            <span>{banner}</span>
          </div>
        )}
        <div className="tk-modes">
          {modes.map((m) => (
            <button key={m.mode_id} type="button" className={m.mode_id === mode.mode_id ? 'tk-mode is-sel' : 'tk-mode'} aria-pressed={m.mode_id === mode.mode_id} onClick={() => pickMode(m)}>
              {m.name}
            </button>
          ))}
        </div>
        {!online ? (
          <div className="tk-msg tk-pay__pad" role="alert">
            <Ico name="warn" />
            <span>{t('p.offline')}</span>
          </div>
        ) : cash ? (
          due > 0 && (
            <>
              <div className="tk-sec tk-pay__sec">{t('p.given')}</div>
              <div className="tk-notes">
                <button type="button" className={tenderedMinor === due ? 'is-sel' : ''} onClick={() => setTendered(plain(due, exponent))}>
                  {t('p.exact')}
                  <small dir={MONEY_DIR}>{money(due)}</small>
                </button>
                {NOTES.map((n) => (
                  <button key={n} type="button" className={tenderedMinor === noteMinor(n) && tenderedMinor !== due ? 'is-sel' : ''} onClick={() => setTendered(String(n))}>
                    <span dir={MONEY_DIR}>{money(noteMinor(n))}</span>
                  </button>
                ))}
              </div>
              <label className="tk-tendered">
                <span>{t('p.given')}</span>
                <input className="money" inputMode="decimal" dir={MONEY_DIR} autoComplete="off" value={tendered} onChange={(e) => setTendered(e.currentTarget.value)} />
              </label>
              {short !== null && (
                <div className="tk-change tk-change--short" role="alert">
                  <span>{t('p.short')}</span>
                  <span className="money" dir={MONEY_DIR}>
                    {money(short)}
                  </span>
                </div>
              )}
              {change !== null && (
                <div className="tk-change">
                  <span>{t('p.change')}</span>
                  <span className="money" dir={MONEY_DIR}>
                    {money(change)}
                  </span>
                </div>
              )}
            </>
          )
        ) : (
          <div className="tk-qrbox tk-qrbox--start">
            <b>{t('p.machine')}</b>
            {mode.reference_required && (
              <label className="tk-field">
                <span>{t('p.ref')}</span>
                <input className="tk-input" dir="ltr" autoComplete="off" maxLength={60} value={reference} onChange={(e) => setReference(e.currentTarget.value)} />
              </label>
            )}
          </div>
        )}
      </>
    );
    if (online)
      primary = (
        <button type="button" className="tk-btn tk-btn--xl tk-btn--ok" aria-disabled={!ready} onClick={() => void pay()}>
          {t('p.done')} <span className="tk-kbd" dir="ltr">Enter</span>
        </button>
      );
  }
  if (phase.kind === 'busy' && split !== undefined)
    primary = (
      <button type="button" className="tk-btn tk-btn--xl tk-btn--ok" aria-disabled="true">
        {t('p.done')}
      </button>
    );

  return (
    <section className={fixed === true ? 'tk-paypanel tk-paypanel--fixed' : 'tk-paypanel'} role="dialog" aria-label={t('p.title')}>
      {head}
      <div className="tk-pay__b">{body}</div>
      <div className="tk-foot">
        <div className={primary === null ? 'tk-acts tk-acts--one' : 'tk-acts'}>
          {later}
          {primary}
        </div>
      </div>
    </section>
  );
}

/** A minor amount as typed text in major units ("3650", "3650.5"), for the tendered field. */
function plain(minor: number, exponent: number): string {
  if (exponent === 0) return String(minor);
  const whole = Math.floor(minor / 10 ** exponent);
  const frac = String(minor % 10 ** exponent).padStart(exponent, '0').replace(/0+$/, '');
  return frac === '' ? String(whole) : `${whole}.${frac}`;
}

/** An amount in the bill's own currency format (the billing texts' "Rs 3,850.00"). */
function billText(minor: number, b: BillView): string {
  return billMoney(minor, b.currency.code);
}
