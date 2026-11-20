import type { ReportDocInput } from '@pos/domain';
import { defaultBillingSettings } from '@pos/events';
import { currencyExponent } from '@pos/domain';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { HubError } from '../../api/hub-admin';
import { t } from '../../i18n';
import { fill, type MessageKey } from '../../i18n/en';
import { timeText } from '../alerts/labels';
import { Ico } from '../alerts/ui';
import { dayText, shortDayText } from '../audit/days';
import { useShell } from '../staff/shell/hooks';
import { billingApi } from './api';
import type { ZReportView } from './contracts';
import { billingErrorKey } from './errors';
import { BIco } from './icons';
import { amountText, billMoney, durationText, rateText, signedAmountText } from './money';
import './styles';

// 05 v1.0.24 §8 "Reports" (X any time and the Z list, `view-reports`), §6.26 (R-83 field names of ReportDocInput;
// R-85: a Z is keyed by `z_no`, a date can have several, the list is newest `z_no` first, cursor-paged), §6.28
// (Retry fiscal now, `close-business-day`), B26 (plan §4.1 task 42, after hub task 26b; frames XReport, ZList,
// ZReport, ReportsTablet). Every figure is the hub's: the client formats, never sums (D47). Names from `staff_names`
// (H16-5: the report carries ids only); brought / carried forward as their rows (R-83 (5)), never a client total. Print (§6.22 PrintReport) is not offered: no hub task builds it yet; the Z
// prints by itself when it is issued (26b's live print fold).

type Tab = 'x' | 'z';

function errText(e: HubError): string {
  if (e.kind === 'signed_out') return t('billing.shift.signed_out');
  if (e.kind !== 'api') return t('tables.toast.needs_hub');
  return t(billingErrorKey(e.code, e.details));
}

const dateOf = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};

export function ReportsScreen() {
  const shell = useShell();
  const [tab, setTab] = useState<Tab>('x');
  return (
    <main className="b5-page b5-rep">
      <div className="row b5-rep-h">
        <div className="b5-seg" role="group" aria-label={t('billing.report.title')}>
          <button type="button" aria-pressed={tab === 'x'} onClick={() => setTab('x')}>
            <BIco name="bill" />
            {t('billing.report.tab_x')}
          </button>
          <button type="button" aria-pressed={tab === 'z'} onClick={() => setTab('z')}>
            <BIco name="clock" />
            {t('billing.report.tab_z')}
          </button>
        </div>
      </div>
      {tab === 'x' ? <XView key="x" offset={shell.clock.utcOffsetMs} onShowZ={() => setTab('z')} /> : <ZView key="z" offset={shell.clock.utcOffsetMs} />}
    </main>
  );
}

function Failed({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="col b5-stack">
      <div className="msg c-warn" role="alert">
        <Ico name="warn" />
        <span>{text}</span>
      </div>
      <button type="button" className="btn" onClick={onRetry}>
        {t('billing.shift.retry')}
      </button>
    </div>
  );
}

function XView({ offset, onShowZ }: { offset: number; onShowZ: () => void }) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const [view, setView] = useState<{ report: ReportDocInput; staff_names: Record<string, string> } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [closedDay, setClosedDay] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const answer = await api.xReport();
    if (answer.ok) {
      setView(answer.data);
      setErr(null);
      setClosedDay(false);
    } else if (answer.error.kind === 'api' && answer.error.code === 'BUSINESS_DAY_NOT_OPEN') {
      // no open day, so no X: the day's figures are its Z (review m4)
      setView(null);
      setClosedDay(true);
    } else setErr(errText(answer.error));
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  if (closedDay)
    return (
      <div className="col b5-stack">
        <p className="b5-note">{t('billing.report.no_open_day')}</p>
        <button type="button" className="btn" onClick={onShowZ}>
          {t('billing.report.see_z')}
        </button>
      </div>
    );
  if (view === null) return err === null ? null : <Failed text={err} onRetry={() => void load()} />;
  const r = view.report;
  const run = async () => {
        if (busy) return;
        setBusy(true);
        const answer = await api.retryFiscalNow();
        setBusy(false);
        if (!answer.ok) {
          shell.toasts.show({ text: errText(answer.error), tone: 'warn' });
          return;
        }
        shell.toasts.show({ text: fill(t('billing.report.retry_done'), { count: String(answer.data.pending_count) }), tone: 'ok' });
        await load();
      };
  const retry = shell.permissions.allowed('close-business-day') ? { busy, run: () => void run() } : null;
  return (
    <>
      <p className="b5-note b5-rep-line">
        {fill(t('billing.report.x_line'), { date: dayText(dateOf(r.business_date), 0), time: timeText(r.issued_at, offset), currency: r.currency_code })}
      </p>
      {err !== null && <Failed text={err} onRetry={() => void load()} />}
      <ReportBody report={r} names={view.staff_names} offset={offset} retry={retry} />
    </>
  );
}

interface ZState {
  rows: ZReportView[];
  next: string | null;
  selected: number;
}

function ZView({ offset }: { offset: number }) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const [state, setState] = useState<ZState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reading = useRef(false);
  const more = useCallback(
    async (cursor: string | null) => {
      if (reading.current) return;
      reading.current = true;
      setBusy(true);
      const answer = await api.zReports(cursor);
      reading.current = false;
      setBusy(false);
      if (!answer.ok) {
        setErr(errText(answer.error));
        return;
      }
      setErr(null);
      // R-85: the hub's order (newest z_no first); a later page goes after the rows already shown
      setState((s) => {
        const kept = cursor === null ? [] : (s?.rows ?? []);
        const seen = new Set(kept.map((z) => z.z_no));
        return { rows: [...kept, ...answer.data.data.reports.filter((z) => !seen.has(z.z_no))], next: answer.data.next_cursor, selected: cursor === null ? 0 : (s?.selected ?? 0) };
      });
    },
    [api],
  );
  useEffect(() => {
    void more(null);
  }, [more]);
  if (state === null) return err === null ? null : <Failed text={err} onRetry={() => void more(null)} />;
  const picked = state.rows[state.selected] ?? null;
  return (
    <div className="b5-rep-z">
      <section className="b5-wl">
        <div className="b5-wl__h">
          <h1>{t('billing.report.z_title')}</h1>
          <span className="b5-note">{t('billing.report.newest_first')}</span>
        </div>
        <div className="b5-wl__b">
          {state.rows.length === 0 && <p className="b5-note">{t('billing.report.no_z')}</p>}
          {state.rows.map((z, i) => (
            <button key={z.z_no} type="button" className={i === state.selected ? 'b5-zl is-sel' : 'b5-zl'} aria-pressed={i === state.selected} onClick={() => setState({ ...state, selected: i })}>
              <span className="z">{zNo(z.z_no)}</span>
              <span>
                <b>{dayText(dateOf(z.business_date), 0)}</b>
                <span>{fill(t('billing.report.z_row'), { count: String(z.report.sales.invoice_count), time: timeText(z.report.issued_at, offset) })}</span>
              </span>
              <span className="v">
                {billMoney(z.report.net_after_credits_minor, z.report.currency_code)}
                <small>{t('billing.report.net')}</small>
              </span>
              <BIco name="chev" />
            </button>
          ))}
          {err !== null && <Failed text={err} onRetry={() => void more(state.next)} />}
          {state.next !== null && (
            <button type="button" className="btn" disabled={busy} aria-disabled={busy} onClick={() => void more(state.next)}>
              {t('billing.report.older')}
            </button>
          )}
        </div>
      </section>
      {picked !== null && (
        <div className="col b5-stack">
          <p className="b5-note b5-rep-line">
            {fill(t('billing.report.z_line'), { z: zNo(picked.z_no), date: dayText(dateOf(picked.business_date), 0), time: timeText(picked.report.issued_at, offset), currency: picked.report.currency_code })}
          </p>
          <ReportBody report={picked.report} names={picked.staff_names} offset={offset} retry={null} />
        </div>
      )}
    </div>
  );
}

const zNo = (n: number) => fill(t('billing.report.z_no'), { no: String(n).padStart(4, '0') });

/** The discount reasons' labels (settings, else the built-in ones). */
function useDiscountLabels(code: string): Map<string, string> {
  const shell = useShell();
  const json = useSyncExternalStore(shell.config.subscribe, () => JSON.stringify((shell.config.snapshot() as { billing?: { discount_reasons?: unknown } } | null)?.billing?.discount_reasons ?? null));
  return useMemo(() => {
    const list = JSON.parse(json) as Array<{ code: string; label: string }> | null;
    const source = Array.isArray(list) ? list : defaultBillingSettings({ currency_code: code, currency_exponent: currencyExponent(code) ?? 2 }).discount_reasons;
    return new Map(source.map((x) => [x.code, x.label]));
  }, [json, code]);
}

const CREDIT_REASONS = new Set(['wrong_item_billed', 'wrong_payment_mode', 'customer_returned_item', 'price_error', 'other']);
const VOID_KEYS: Record<string, MessageKey> = {
  wastage: 'void.disposition.wastage',
  staff_meal: 'void.disposition.staff_meal',
  moved: 'void.disposition.moved',
  other: 'void.disposition.other',
};
const PETTY_KEYS: Record<string, MessageKey> = { advance: 'billing.petty.kind_advance', out: 'billing.petty.kind_out', in: 'billing.petty.kind_in' };
/** The hub's `signoff_state` strings (report.ts SIGNOFF_LABEL); an unknown one shows as is, never as "within". */
const SIGNOFF: Partial<Record<string, { key: MessageKey; tone: string }>> = {
  'pending sign-off': { key: 'billing.report.signoff_pending', tone: 'c-warn' },
  approved: { key: 'billing.report.signoff_approved', tone: 'c-ok' },
  disputed: { key: 'billing.report.signoff_disputed', tone: 'c-danger' },
};

function Row({ k, v, cls, children }: { k: ReactNode; v?: ReactNode; cls?: 'ind' | 'b' | 'rnd'; children?: ReactNode }) {
  return (
    <div className={cls === undefined ? 'b5-rr' : `b5-rr ${cls}`}>
      <span>{k}</span>
      {children ?? <span className="v">{v}</span>}
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: 'bill' | 'cash' | 'card' | 'clock' | 'wallet' | 'split'; children: ReactNode }) {
  return (
    <section className="b5-rc">
      <h3>
        <BIco name={icon} />
        {title}
      </h3>
      {children}
      <div className="b5-rc__end" />
    </section>
  );
}

/** One report (X or Z): the four KPIs and the cards in the frames' order (CHANGES.md D-12). */
function ReportBody({ report: r, names, offset, retry }: { report: ReportDocInput; names: Record<string, string>; offset: number; retry: { busy: boolean; run: () => void } | null }) {
  const code = r.currency_code;
  const amt = (m: number) => amountText(m, code);
  const neg = (m: number) => (m === 0 ? amt(0) : `−${amt(m)}`);
  const name = (id: string | null) => (id === null ? '—' : (names[id] ?? '—'));
  const discountLabel = useDiscountLabels(code);
  const day = (iso: string) => shortDayText(dateOf(iso), 0);
  const variance = (v: number) => (v === 0 ? t('billing.shift.exact') : fill(t(v < 0 ? 'billing.shift.short' : 'billing.shift.over'), { amount: amt(Math.abs(v)) }));
  const f = r.fiscal;
  const fiscalKpi = f.rejected > 0 ? fill(t('billing.report.kpi_rejected'), { count: String(f.rejected) }) : f.pending > 0 ? fill(t('billing.report.kpi_waiting'), { count: String(f.pending) }) : t('billing.report.kpi_all_sent');
  return (
    <>
      <div className="b5-kpis">
        <div className="b5-kpi hero">
          <span>{t('billing.report.net_after_credits')}</span>
          <b>{billMoney(r.net_after_credits_minor, code)}</b>
          <small>{r.kind === 'x' ? t('billing.report.so_far') : zNo(r.z_no ?? 0)}</small>
        </div>
        <div className="b5-kpi">
          <span>{t('billing.report.invoices')}</span>
          <b>{r.sales.invoice_count}</b>
          <small>{fill(t(r.credits.count === 1 ? 'billing.report.credit_notes_one' : 'billing.report.credit_notes'), { count: String(r.credits.count) })}</small>
        </div>
        <div className="b5-kpi">
          <span>{t('billing.report.average')}</span>
          <b>{billMoney(r.bills.average_minor, code)}</b>
          <small>{fill(t(r.bills.count === 1 ? 'billing.report.bills_one' : 'billing.report.bills'), { count: String(r.bills.count) })}</small>
        </div>
        <div className="b5-kpi">
          <span>{t('billing.report.fiscal')}</span>
          <b className="b5-kpi__s">{fiscalKpi}</b>
          <small>{fill(t('billing.report.kpi_fiscal_sub'), { acked: String(f.acked), rejected: String(f.rejected) })}</small>
        </div>
      </div>
      <div className="b5-rep-grid">
        <div className="col b5-stack">
          <Card title={t('billing.report.sales')} icon="bill">
            <Row k={t('billing.report.gross')} v={amt(r.sales.gross_minor)} />
            <Row k={fill(t('billing.report.discounts'), { count: String(r.sales.discounts.count) })} v={neg(r.sales.discounts.value_minor)} />
            {r.sales.discounts.by_reason.map((d) => (
              <Row key={d.reason_code} cls="ind" k={`${discountLabel.get(d.reason_code) ?? d.reason_code} · ${d.count}`} v={neg(d.value_minor)} />
            ))}
            {/* §6.26: who asked and who approved each discount (method from the audit fold, R-83 (3)) */}
            {r.sales.discounts.entries.map((d, i) => (
              <Row
                key={`d${i}`}
                cls="ind"
                k={d.approver_staff_id === null ? fill(t('billing.report.by_direct'), { name: name(d.requester_staff_id) }) : fill(t('billing.report.by_approved'), { name: name(d.requester_staff_id), approver: name(d.approver_staff_id) })}
                v={neg(d.value_minor)}
              />
            ))}
            <Row k={t('billing.report.service_charge')} v={amt(r.sales.service_charge_minor)} />
            <Row cls="b" k={t('billing.report.net_sales')} v={amt(r.sales.net_minor)} />
            {/* R-83 (2): one row per (key, rate, label), never merged */}
            {r.sales.taxes.map((x) => (
              <Row key={`${x.tax_code}|${x.tax_profile_id}|${x.payment_class}|${x.rate_bp}|${x.label}`} k={`${x.label} · ${rateText(x.rate_bp)} · ${t(x.payment_class === 'cash' ? 'billing.report.class_cash' : 'billing.report.class_digital')}`} v={amt(x.tax_minor)} />
            ))}
            <Row cls="rnd" k={t('billing.report.rounding')} v={signedAmountText(r.sales.rounding_minor, code)} />
            <Row cls="b" k={t('billing.report.total')} v={amt(r.sales.total_minor)} />
            <Row k={fill(t('billing.report.credits'), { count: String(r.credits.count) })} v={neg(r.credits.value_minor)} />
            {r.credits.by_reason.map((c) => (
              <Row key={c.reason_code} cls="ind" k={`${CREDIT_REASONS.has(c.reason_code) ? t(`billing.report.credit_reason.${c.reason_code}` as MessageKey) : c.reason_code} · ${c.count}`} v={neg(c.value_minor)} />
            ))}
            {r.full_refunds.count > 0 && <Row cls="ind" k={fill(t('billing.report.full_refunds'), { count: String(r.full_refunds.count) })} v={neg(r.full_refunds.value_minor)} />}
            <Row cls="b" k={t('billing.report.net_after_credits')} v={amt(r.net_after_credits_minor)} />
          </Card>
        </div>
        <div className="col b5-stack">
          <Card title={t('billing.report.payments')} icon="card">
            {r.payments_by_mode.map((p) =>
              p.out_minor === 0 && p.change_minor === 0 ? (
                <Row key={p.mode_name} k={p.mode_name} v={amt(p.in_minor)} />
              ) : (
                <Fragment key={p.mode_name}>
                  <Row k={fill(t('billing.report.mode_in'), { mode: p.mode_name })} v={amt(p.in_minor)} />
                  {p.out_minor > 0 && <Row cls="ind" k={fill(t('billing.report.mode_back'), { mode: p.mode_name })} v={neg(p.out_minor)} />}
                  {p.change_minor > 0 && <Row cls="ind" k={fill(t('billing.report.mode_change'), { mode: p.mode_name })} v={amt(p.change_minor)} />}
                </Fragment>
              ),
            )}
            {/* review m6: takings by taker under their own heading (Q10) */}
            {r.takings_by_taker.length > 0 && <Row k={t('billing.report.by_taker')} v="" />}
            {r.takings_by_taker.map((x) => (
              <Row key={x.staff_id} cls="ind" k={name(x.staff_id)} v={amt(x.amount_minor)} />
            ))}
            {/* §6.26, R-83 (5): rows by mode and staff only; no client total (D47) — none at all reads 0.00 */}
            <Row k={t('billing.report.brought_forward')} v={r.brought_forward.length === 0 ? amt(0) : ''} />
            {r.brought_forward.map((x, i) => (
              <Row key={`b${i}`} cls="ind" k={`${x.mode_name} · ${name(x.staff_id)}`} v={amt(x.amount_minor)} />
            ))}
            <Row k={t('billing.report.carried_forward')} v={r.carried_forward.length === 0 ? amt(0) : ''} />
            {r.carried_forward.map((x, i) => (
              <Row key={`c${i}`} cls="ind" k={`${x.mode_name} · ${name(x.staff_id)}`} v={amt(x.amount_minor)} />
            ))}
          </Card>
          <Card title={t('billing.report.shifts')} icon="cash">
            {r.shifts.map((s, i) => {
              const state: { key: MessageKey; tone: string } | { text: string; tone: string } = s.skipped
                ? { key: 'billing.report.skipped' as MessageKey, tone: 'c-mute' }
                : s.counted_minor === null
                  ? { key: 'billing.report.open' as MessageKey, tone: 'c-ok' }
                  : s.signoff_state === null
                    ? { key: 'billing.report.within' as MessageKey, tone: 'c-mute' }
                    : (SIGNOFF[s.signoff_state] ?? { text: s.signoff_state, tone: 'c-warn' });
              const what = s.skipped
                ? t('billing.report.skipped_count')
                : s.counted_minor === null
                  ? fill(t('billing.report.shift_open'), { float: amt(s.float_minor) })
                  : fill(t('billing.report.shift_counted'), { expected: s.expected_minor === null ? '—' : amt(s.expected_minor), counted: amt(s.counted_minor), variance: variance(s.variance_minor ?? 0) });
              return (
                <Row
                  key={`${s.staff_id}${i}`}
                  k={
                    <>
                      <b>{name(s.staff_id)}</b> · {what}
                    </>
                  }
                >
                  <span>
                    <span className={`st ${state.tone}`}>{'key' in state ? t(state.key) : state.text}</span>
                  </span>
                </Row>
              );
            })}
            {r.variance_signoffs.length > 0 && <Row k={t('billing.report.signoffs')} v="" />}
            {r.variance_signoffs.map((x, i) => (
              <Row
                key={`s${i}`}
                cls="ind"
                k={`${name(x.staff_id)} · ${day(x.shift_date)} · ${signedAmountText(x.amount_minor, code)}`}
                v={`${fill(t(x.outcome === 'approved' ? 'billing.report.signed_approved' : 'billing.report.signed_disputed'), { name: name(x.approver_staff_id) })} · ${timeText(x.at, offset)}`}
              />
            ))}
            <Row k={t('billing.report.pending_signoffs')} v={String(r.pending_signoffs.length)} />
            {r.pending_signoffs.map((x, i) => (
              <Row key={`p${i}`} cls="ind" k={`${name(x.staff_id)} · ${day(x.shift_date)}`} v={signedAmountText(x.amount_minor, code)} />
            ))}
          </Card>
        </div>
        <div className="col b5-stack">
          <Card title={t('billing.report.fiscal')} icon="clock">
            <Row k={t('billing.report.acked')} v={String(f.acked)} />
            <Row k={t('billing.report.pending')} v={String(f.pending)} />
            <Row k={t('billing.report.rejected')} v={String(f.rejected)} />
            <Row k={t('billing.report.not_required')} v={String(f.not_required)} />
            {((retry !== null && f.pending > 0) || f.rejected > 0) && (
              <div className="b5-rr b5-rep-act">
                {retry !== null && f.pending > 0 ? (
                  <button type="button" className="btn" disabled={retry.busy} aria-disabled={retry.busy} onClick={retry.run}>
                    <Ico name="sync" />
                    {t('billing.report.retry')}
                  </button>
                ) : (
                  <span />
                )}
                {f.rejected > 0 && <span className="b5-note">{t('billing.report.rejected_note')}</span>}
              </div>
            )}
          </Card>
          {r.kind === 'x' && (
            <Card title={t('billing.report.open_bills')} icon="split">
              <Row k={t('billing.report.open_now')} v={String(r.open_bills.length)} />
              {r.open_bills
                .filter((b) => b.flagged)
                .map((b) => (
                  <Row key={b.identifier} k={t('billing.report.open_too_long')} v={`${b.identifier} · ${durationText(b.open_minutes)}`} />
                ))}
              {r.carried_over.map((c, i) => (
                <Row key={`o${i}`} k={t(c.carried_in ? 'billing.report.carried_in' : 'billing.report.carried_over')} v={c.label} />
              ))}
            </Card>
          )}
          {r.kind === 'z' && r.carried_over.length > 0 && (
            <Card title={t('billing.report.carried')} icon="split">
              {r.carried_over.map((c, i) => (
                <Row key={`o${i}`} k={t(c.carried_in ? 'billing.report.carried_in' : 'billing.report.carried_over')} v={c.label} />
              ))}
            </Card>
          )}
          <Card title={t('billing.petty.title')} icon="wallet">
            {r.petty_cash.map((p, i) => (
              <Row key={`p${i}`} k={`${PETTY_KEYS[p.kind] === undefined ? p.kind : t(PETTY_KEYS[p.kind])} · ${p.category_name}`} v={amt(p.amount_minor)} />
            ))}
            {r.open_advances.map((a, i) => (
              <Row key={`a${i}`} k={t('billing.report.open_advances')} v={`${name(a.staff_id)} · ${amt(a.amount_minor)} · ${durationText(a.age_minutes)}`} />
            ))}
          </Card>
          <Card title={t('billing.report.cvr')} icon="bill">
            <Row k={t('billing.report.comps')} v={amt(r.comps.value_minor)} />
            {r.comps.voided_minor > 0 && <Row k={t('billing.report.comps_voided')} v={amt(r.comps.voided_minor)} />}
            <Row k={t('billing.report.comp_removals')} v={`${r.comps.removals.count} · ${amt(r.comps.removals.value_minor)}`} />
            {r.voids.map((x, i) => (
              <Row
                key={`v${i}`}
                k={fill(t('billing.report.voids'), { disposition: x.disposition === null ? t('billing.report.void_none') : VOID_KEYS[x.disposition] === undefined ? x.disposition : t(VOID_KEYS[x.disposition]!) })}
                v={`${x.count} · ${amt(x.value_minor)}`}
              />
            ))}
            <Row k={t('billing.report.reopens')} v={`${r.reopens.count} · ${amt(r.reopens.value_minor)}`} />
            {r.reopens.entries.map((x, i) => (
              <Row
                key={`r${i}`}
                cls="ind"
                k={x.approver_staff_id === null ? fill(t('billing.report.by_direct'), { name: name(x.requester_staff_id) }) : fill(t('billing.report.by_approved'), { name: name(x.requester_staff_id), approver: name(x.approver_staff_id) })}
                v=""
              />
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}
