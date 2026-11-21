import { CARRY_OVER_REASONS } from '@pos/domain';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { HubError } from '../../api/hub-admin';
import { t } from '../../i18n';
import { fill, type MessageKey } from '../../i18n/en';
import { timeText } from '../alerts/labels';
import { Ico, initial } from '../alerts/ui';
import { dayText } from '../audit/days';
import { useShell } from '../staff/shell/hooks';
import { billingApi } from './api';
import type { ZReportView } from './contracts';
import { billingErrorKey } from './errors';
import { BIco } from './icons';
import { billMoney, durationText } from './money';
import { Dlg } from './PettySheets';
import { dateOf, PrintReportButton, ReportBody, zLine, zNo, zPrintPending } from './ReportsScreen';
import './styles';

// 05 v1.0.25 §8 "Day close" (staff app, `close-business-day`: the blockers list — voids, open shifts, unbilled orders
// with Carry over — then Close; the Z shown), §3.13 (the guard order; ⚠️ R-76: a pending variance sign-off blocks, so
// it is a step of its own — the frames, drawn before v1.0.18, say it never blocks), §6.24, §6.25, §6.26 (R-85: the Z of
// the date read after the close, newest z_no) (plan §4.1 task 41, after hub task 25; frames DayClose, DayCloseVoids,
// DayCloseShifts, DayCloseUnbilled, CarryOver, DayCloseDone, DayCloseKiosk, DayCloseUrdu). A refusal's list is read
// as 01a's Message.items (admin/stock StockApp `dayCloseBlocked`): the count sentence, one row per listed entry,
// "and N more" past the list; an unknown reason or shape → the generic text, no list. The hub shows one blocker at a
// time; the steps before it are proven clear, the ones after it are "checked next".

const GUARDS = ['void_pending', 'shift_open', 'variance_pending', 'unbilled_orders'] as const;
type Guard = (typeof GUARDS)[number];
const GUARD_NAME: Record<Guard, MessageKey> = {
  void_pending: 'billing.dayclose.step_voids',
  shift_open: 'billing.dayclose.step_shifts',
  variance_pending: 'billing.dayclose.step_signoffs',
  unbilled_orders: 'billing.dayclose.step_orders',
};

interface ShiftRow {
  shift_id: string;
  staff_name: string;
  at: number | null;
  is_drawer: boolean;
}
interface OrderRow {
  order_id: string;
  identifier: string;
  total_minor: number;
  placed_at: number;
  open_minutes: number;
}
type Blocked =
  | { reason: 'void_pending'; count: number; rows: Array<{ identifier: string; item: string; requester_name: string }> }
  | { reason: 'shift_open'; count: number; rows: ShiftRow[] }
  | { reason: 'variance_pending'; count: number; rows: ShiftRow[] }
  | { reason: 'unbilled_orders'; count: number; rows: OrderRow[] }
  | { reason: null };

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const objs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : null);

/** A DAY_CLOSE_BLOCKED's details as one of the four lists; anything else → `{ reason: null }` (the generic text). */
export function blockedOf(details: Record<string, unknown>): Blocked {
  const count = details['count'];
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) return { reason: null };
  switch (details['reason']) {
    case 'void_pending': {
      const rows = objs(details['voids']);
      return rows === null || rows.length === 0 ? { reason: null } : { reason: 'void_pending', count, rows: rows.map((v) => ({ identifier: str(v['identifier']), item: str(v['item']), requester_name: str(v['requester_name']) })) };
    }
    case 'shift_open':
    case 'variance_pending': {
      const reason = details['reason'];
      const rows = objs(details['shifts']);
      if (rows === null || rows.length === 0) return { reason: null };
      const at = reason === 'shift_open' ? 'opened_at' : 'closed_at';
      return { reason, count, rows: rows.map((s) => ({ shift_id: str(s['shift_id']), staff_name: str(s['staff_name']), at: num(s[at]), is_drawer: s['is_drawer'] === true })) };
    }
    case 'unbilled_orders': {
      const rows = objs(details['orders']);
      if (rows === null || rows.length === 0) return { reason: null };
      return {
        reason: 'unbilled_orders',
        count,
        rows: rows.map((o) => ({ order_id: str(o['order_id']), identifier: str(o['identifier']), total_minor: num(o['total_minor']) ?? 0, placed_at: num(o['placed_at']) ?? 0, open_minutes: num(o['open_minutes']) ?? 0 })),
      };
    }
    default:
      return { reason: null };
  }
}

type State =
  | { name: 'idle'; note: string | null }
  | { name: 'blocked'; b: Blocked }
  /** z: the Z of the date; 'none' = the hub issued none (no branch settings, R-85 (2)); 'unread' = the read failed or was refused */
  | { name: 'done'; business_date: string; z: ZReportView | 'none' | 'unread' };

function errText(e: HubError): string {
  if (e.kind === 'signed_out') return t('billing.shift.signed_out');
  if (e.kind !== 'api') return t('tables.toast.needs_hub');
  return t(billingErrorKey(e.code, e.details));
}

/** R-93 (§8 Day close): a Z still printing (or failed: 03c retries) is read again every Z_WATCH_MS, Z_WATCH_TRIES times. */
export const Z_WATCH_MS = 3_000;
export const Z_WATCH_TRIES = 10;

/** What the person may open from a blocker row (R5: each exit is offered only where its own gate lets them through). */
export interface DayCloseExits {
  /** `#/shift` of another person (close-shift-for-others) */
  closeShift: boolean;
  /** their own shift (manage-own-shift) */
  ownShift: boolean;
  /** `#/bill` (take-payment) */
  bill: boolean;
  /** `#/requests` (the hub lists requests they answer) */
  requests: boolean;
  /** `#/reports` (view-reports) */
  reports: boolean;
}

export function DayCloseScreen({ onNavigate, exits }: { onNavigate: (path: string) => void; exits: DayCloseExits }) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const code = (shell.config.snapshot() as { currency_code?: string } | null)?.currency_code ?? 'PKR';
  const offset = shell.clock.utcOffsetMs;
  const [state, setState] = useState<State>({ name: 'idle', note: null });
  const [busy, setBusy] = useState(false);
  const shellRef = useRef(shell);
  shellRef.current = shell;
  // R-93: the closed date's Z is read again while its print may still move; after the last try (or offline) the last
  // state stays with Refresh. A refused re-read keeps the shown Z.
  const zWatch = useRef<{ left: number; timer: ReturnType<typeof setTimeout> | null; live: boolean }>({ left: 0, timer: null, live: true });
  const [zStale, setZStale] = useState(false);
  const watchZ = useCallback(
    (date: string, shown: ZReportView | 'none' | 'unread') => {
      const w = zWatch.current;
      if (w.timer !== null) clearTimeout(w.timer);
      w.timer = null;
      w.left = Z_WATCH_TRIES;
      setZStale(false);
      const next = (z: ZReportView | 'none' | 'unread') => {
        if (typeof z === 'string' || !zPrintPending(z.print)) return;
        if (w.left <= 0 || !shellRef.current.online) {
          setZStale(true);
          return;
        }
        w.timer = setTimeout(() => {
          w.timer = null;
          if (!shellRef.current.online) {
            setZStale(true);
            return;
          }
          w.left -= 1;
          void api.zReportOf(date).then((r) => {
            if (!w.live) return;
            const fresh = r.ok ? (r.data.data.reports[0] ?? 'none') : z;
            if (r.ok) setState((st) => (st.name === 'done' && st.business_date === date ? { ...st, z: fresh } : st));
            next(fresh);
          });
        }, Z_WATCH_MS);
      };
      next(shown);
    },
    [api],
  );
  useEffect(() => {
    const w = zWatch.current;
    w.live = true;
    return () => {
      w.live = false;
      if (w.timer !== null) clearTimeout(w.timer);
      w.timer = null;
    };
  }, []);
  /** Refresh / after Print again: read the Z now, then watch it again */
  const rereadZ = async (date: string) => {
    if (!shell.online) return;
    const r = await api.zReportOf(date);
    if (!r.ok || !zWatch.current.live) return;
    const fresh = r.data.data.reports[0] ?? 'none';
    setState((st) => (st.name === 'done' && st.business_date === date ? { ...st, z: fresh } : st));
    watchZ(date, fresh);
  };
  const [msg, setMsg] = useState<string | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [carry, setCarry] = useState<OrderRow[] | null>(null);

  const closeDay = async () => {
    if (busy || !shell.online) return;
    setBusy(true);
    setMsg(null);
    const answer = await api.closeBusinessDay();
    if (!answer.ok) {
      setBusy(false);
      if (answer.error.kind === 'api' && answer.error.code === 'DAY_CLOSE_BLOCKED') {
        setTicked(new Set());
        setState({ name: 'blocked', b: blockedOf(answer.error.details) });
      } else setMsg(errText(answer.error));
      return;
    }
    const r = answer.data;
    if (!r.changed || r.business_date === null) {
      setBusy(false);
      setState({ name: 'idle', note: t(r.reason === 'opened_recently' ? 'billing.dayclose.opened_recently' : 'billing.dayclose.not_open') });
      return;
    }
    // CHANGES.md D-17 / R-85: the Z number and content from the Z list of that date (newest z_no), never the close result
    const z = await api.zReportOf(r.business_date);
    setBusy(false);
    const shown = !z.ok ? 'unread' : (z.data.data.reports[0] ?? 'none');
    setState({ name: 'done', business_date: r.business_date, z: shown });
    watchZ(r.business_date, shown);
  };

  const at = state.name === 'blocked' && state.b.reason !== null ? GUARDS.indexOf(state.b.reason) : state.name === 'done' ? GUARDS.length : -1;
  const step = (i: number): { cls: string; key: MessageKey } =>
    at === -1 || i > at ? { cls: 'b5-gs', key: 'billing.dayclose.next' } : i < at ? { cls: 'b5-gs ok', key: 'billing.dayclose.clear' } : { cls: 'b5-gs now', key: 'billing.dayclose.fix' };
  const when = state.name === 'done' ? `${shell.meta.branchName} · ${dayText(dateOf(state.business_date), 0)}` : shell.meta.branchName;

  return (
    <main className="b5-dc">
      <div className="b5-dcard">
        <div>
          <h1>{t('billing.dayclose.title')}</h1>
          <div className="when">{when}</div>
        </div>
        <div className="b5-what">
          <Ico name="info" />
          <span>{t('billing.dayclose.what')}</span>
        </div>
        <div className="b5-guard">
          {GUARDS.map((g, i) => {
            const s = step(i);
            return (
              <div key={g} className={s.cls}>
                <Ico name={s.cls.endsWith('ok') ? 'checkc' : s.cls.endsWith('now') ? 'warn' : 'clock'} />
                {t(GUARD_NAME[g])}
                <span className="r">{t(s.key)}</span>
              </div>
            );
          })}
        </div>
        <div className="b5-note">{t('billing.dayclose.order_hint')}</div>
        {msg !== null && (
          <div className="msg c-warn" role="alert">
            <Ico name="warn" />
            <span>{msg}</span>
          </div>
        )}
        {!shell.online && msg === null && (
          <div className="msg c-warn" role="alert">
            <Ico name="warn" />
            <span>{t('tables.toast.needs_hub')}</span>
          </div>
        )}
        <span className="b5-dc__fill" />
        {state.name !== 'done' && (
          <button type="button" className="btn btn--primary b5-add btn--block" aria-disabled={busy || !shell.online} onClick={() => void closeDay()}>
            <BIco name="check" />
            {t('billing.dayclose.close')}
          </button>
        )}
      </div>
      <section className="b5-blk">
        {state.name === 'idle' && (
          <div className="b5-blk__b b5-dc__ready">
            <b>{t('billing.dayclose.ready')}</b>
            <span className="b5-note">{state.note ?? t('billing.dayclose.ready_note')}</span>
          </div>
        )}
        {state.name === 'blocked' && (
          <BlockedList
            b={state.b}
            exits={exits}
            me={shell.me?.name ?? null}
            code={code}
            offset={offset}
            ticked={ticked}
            onTick={(id) => setTicked((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])))}
            onCarry={(rows) => setCarry(rows)}
            onNavigate={onNavigate}
          />
        )}
        {state.name === 'done' && (
          <>
            <div className="b5-blk__h b5-blk__h--ok">
              <Ico name="checkc" />
              <div>
                <b>{typeof state.z === 'string' ? t('billing.dayclose.done') : fill(t('billing.dayclose.done_z'), { z: zNo(state.z.z_no) })}</b>
                <span>
                  {state.z === 'none'
                    ? t('billing.dayclose.no_z')
                    : state.z === 'unread'
                      ? t('billing.dayclose.z_unread')
                      : fill(t('billing.dayclose.done_sub'), { date: dayText(dateOf(state.z.business_date), 0), time: timeText(state.z.report.issued_at, offset) })}
                </span>
                {/* R-93: whether the Z printed, from the Z row's print (never "prints by itself") */}
                {typeof state.z !== 'string' && zLine(state.z)}
              </div>
              {typeof state.z !== 'string' && zStale && zPrintPending(state.z.print) && (
                <button type="button" className="btn" aria-disabled={!shell.online} onClick={() => void rereadZ(state.business_date)}>
                  {t('billing.zprint.refresh')}
                </button>
              )}
              {/* §6.22, R-87: the date's latest Z again (view-reports); R-93: then its print state is read again */}
              {typeof state.z !== 'string' && exits.reports && (
                <PrintReportButton payload={{ doc: 'z_report', ref_id: state.z.business_date }} label="billing.report.print_again" onPrinted={() => void rereadZ(state.business_date)} />
              )}
              {state.z === 'unread' && exits.reports && (
                <button type="button" className="btn" onClick={() => onNavigate('/reports')}>
                  <Ico name="eye" />
                  {t('billing.report.nav')}
                </button>
              )}
            </div>
            {typeof state.z !== 'string' && (
              <div className="b5-blk__b b5-scroll">
                <div className="col b5-stack">
                  <ReportBody report={state.z.report} names={state.z.staff_names} offset={offset} retry={null} />
                </div>
              </div>
            )}
          </>
        )}
      </section>
      {carry !== null && state.name === 'blocked' && state.b.reason === 'unbilled_orders' && (
        <CarrySheet
          rows={carry}
          code={code}
          offset={offset}
          onClose={() => setCarry(null)}
          onDone={(ids) => {
            setCarry(null);
            setTicked(new Set());
            shell.toasts.show({ text: fill(t(ids.length === 1 ? 'billing.dayclose.carried_one' : 'billing.dayclose.carried'), { count: String(ids.length) }), tone: 'ok' });
            // the carried orders leave the list; Close day again asks the hub afresh
            const b = state.b;
            if (b.reason === 'unbilled_orders') setState({ name: 'blocked', b: { ...b, rows: b.rows.filter((o) => !ids.includes(o.order_id)), count: Math.max(0, b.count - ids.length) } });
          }}
        />
      )}
    </main>
  );
}

function Head({ text, sub, action }: { text: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="b5-blk__h">
      <Ico name="warn" />
      <div>
        <b>{text}</b>
        {sub !== undefined && <span>{sub}</span>}
      </div>
      {action}
    </div>
  );
}

function BlockedList(p: {
  b: Blocked;
  exits: DayCloseExits;
  /** the signed-in person's name: their own open shift opens as "My shift" */
  me: string | null;
  code: string;
  offset: number;
  ticked: ReadonlySet<string>;
  onTick: (order_id: string) => void;
  onCarry: (rows: OrderRow[]) => void;
  onNavigate: (path: string) => void;
}) {
  const { b } = p;
  if (b.reason === null) return <Head text={t('billing.dayclose.blocked_generic')} />;
  const sentence = (one: MessageKey, many: MessageKey) => (b.count === 1 ? t(one) : fill(t(many), { count: String(b.count) }));
  const more = b.count > b.rows.length ? <div className="b5-more">{fill(t('admin_stock.errors.DAY_CLOSE_BLOCKED_more'), { n: String(b.count - b.rows.length) })}</div> : null;
  const requests = p.exits.requests ? (
    <button type="button" className="btn btn--tone c-warn" onClick={() => p.onNavigate('/requests')}>
      <Ico name="shield" />
      {t('billing.dayclose.open_requests')}
    </button>
  ) : undefined;
  if (b.reason === 'void_pending')
    return (
      <>
        <Head text={sentence('admin_stock.errors.DAY_CLOSE_BLOCKED_one', 'admin_stock.errors.DAY_CLOSE_BLOCKED')} sub={t(p.exits.requests ? 'billing.dayclose.voids_sub' : 'billing.dayclose.ask_manager')} {...(requests === undefined ? {} : { action: requests })} />
        <div className="b5-blk__b b5-scroll">
          {b.rows.map((v, i) => (
            <div key={i} className="b5-br">
              <span className="tcode">{v.identifier}</span>
              <div>{fill(t('billing.dayclose.void_row'), { item: v.item, name: v.requester_name })}</div>
              <div className="end" />
            </div>
          ))}
          {more}
        </div>
      </>
    );
  if (b.reason === 'shift_open' || b.reason === 'variance_pending') {
    const open = b.reason === 'shift_open';
    return (
      <>
        <Head
          text={open ? sentence('errors.DAY_CLOSE_BLOCKED.shift_open_one', 'errors.DAY_CLOSE_BLOCKED.shift_open') : sentence('billing.dayclose.signoffs_one', 'billing.dayclose.signoffs')}
          sub={t(open ? 'billing.dayclose.shifts_sub' : p.exits.requests ? 'billing.dayclose.signoffs_sub' : 'billing.dayclose.ask_manager')}
          {...(open || requests === undefined ? {} : { action: requests })}
        />
        <div className="b5-blk__b b5-scroll">
          {b.rows.map((s) => (
            <div key={s.shift_id} className="b5-br">
              <span className="av b5-br__av">{initial(s.staff_name)}</span>
              <div>
                <b>{s.staff_name}</b>
                <span>
                  {s.at === null
                    ? ''
                    : open
                      ? fill(t(s.is_drawer ? 'billing.dayclose.open_since_drawer' : 'billing.dayclose.open_since'), { time: timeText(s.at, p.offset) })
                      : fill(t('billing.dayclose.closed_at'), { time: timeText(s.at, p.offset) })}
                </span>
              </div>
              <div className="end">
                {/* own shift → My shift (manage-own-shift); another's → that shift (close-shift-for-others) */}
                {open && (p.me !== null && s.staff_name === p.me ? p.exits.ownShift : p.exits.closeShift) && (
                  <button type="button" className="btn" onClick={() => p.onNavigate(p.me !== null && s.staff_name === p.me ? '/shift' : `/shift?shift_id=${encodeURIComponent(s.shift_id)}`)}>
                    <BIco name="cash" />
                    {t('billing.dayclose.close_shift')}
                  </button>
                )}
              </div>
            </div>
          ))}
          {more}
        </div>
      </>
    );
  }
  const picked = b.rows.filter((o) => p.ticked.has(o.order_id));
  return (
    <>
      <Head
        text={b.count === 0 ? t('billing.dayclose.all_carried') : b.rows.length === 0 ? t('billing.dayclose.load_next') : sentence('errors.DAY_CLOSE_BLOCKED.unbilled_orders_one', 'errors.DAY_CLOSE_BLOCKED.unbilled_orders')}
        {...(picked.length === 0 ? {} : { sub: fill(t('billing.dayclose.ticked'), { count: String(picked.length) }) })}
        {...(picked.length === 0
          ? {}
          : {
              action: (
                <button type="button" className="btn btn--primary" onClick={() => p.onCarry(picked)}>
                  <BIco name="clock" />
                  {fill(t('billing.dayclose.carry_n'), { count: String(picked.length) })}
                </button>
              ),
            })}
      />
      <div className="b5-blk__b b5-scroll">
        {b.rows.map((o) => {
          const on = p.ticked.has(o.order_id);
          return (
            <div key={o.order_id} className={on ? 'b5-br b5-br--tick sel' : 'b5-br b5-br--tick'}>
              <button type="button" className={on ? 'b5-tick on' : 'b5-tick'} aria-pressed={on} aria-label={fill(t('billing.dayclose.tick'), { identifier: o.identifier })} onClick={() => p.onTick(o.order_id)}>
                <BIco name="check" />
              </button>
              <span className={o.identifier.startsWith('#') ? 'tcode q' : 'tcode'}>{o.identifier}</span>
              <div>
                <b className="amt">{billMoney(o.total_minor, p.code)}</b>
                <span>{fill(t('billing.dayclose.placed'), { time: timeText(o.placed_at, p.offset), open: durationText(o.open_minutes) })}</span>
              </div>
              <div className="end">
                {p.exits.bill && (
                  <button type="button" className="btn" onClick={() => p.onNavigate(`/bill?order_id=${encodeURIComponent(o.order_id)}`)}>
                    <BIco name="bill" />
                    {t('billing.dayclose.open_bill')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {more}
      </div>
    </>
  );
}

const REASON_KEYS: Record<(typeof CARRY_OVER_REASONS)[number], MessageKey> = {
  table_still_seated: 'billing.dayclose.reason.table_still_seated',
  customer_will_pay_later: 'billing.dayclose.reason.customer_will_pay_later',
  other: 'billing.dayclose.reason.other',
};

function CarrySheet({ rows, code, offset, onClose, onDone }: { rows: OrderRow[]; code: string; offset: number; onClose: () => void; onDone: (ids: string[]) => void }) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const step: MessageKey | null = reason === null ? 'billing.sheet.pick_reason' : reason === 'other' && note.trim() === '' ? 'billing.sheet.write_why' : null;
  const send = async () => {
    if (step !== null || reason === null || busy || !shell.online) return;
    setBusy(true);
    setMsg(null);
    const ids = rows.map((o) => o.order_id);
    const answer = await api.carryOverOrders({ order_ids: ids, reason_code: reason, ...(note.trim() === '' ? {} : { note: note.trim() }) });
    setBusy(false);
    if (!answer.ok) {
      const e = answer.error;
      // an order billed meanwhile, or the day closed elsewhere: the list is stale — Close day again reads it afresh
      const stale = e.kind === 'api' && (e.code === 'ORDER_BILLED' || e.code === 'BUSINESS_DAY_NOT_OPEN');
      setMsg(stale ? `${errText(e)} ${t('billing.dayclose.refresh')}` : errText(e));
      return;
    }
    onDone(ids);
  };
  return (
    <Dlg title={t('billing.dayclose.carry_title')} sub={fill(t(rows.length === 1 ? 'billing.dayclose.orders_one' : 'billing.dayclose.orders'), { count: String(rows.length) })} onClose={onClose}>
      <div className="col b5-stack">
        <div className="b5-kv">
          {rows.map((o) => (
            <div key={o.order_id}>
              <span>
                <span className="tcode tcode--sm">{o.identifier}</span> {fill(t('billing.dayclose.placed_short'), { time: timeText(o.placed_at, offset) })}
              </span>
              <b className="num">{billMoney(o.total_minor, code)}</b>
            </div>
          ))}
        </div>
        <div className="b5-sec">
          <h3>{t('billing.dayclose.why')}</h3>
          <div className="b5-chips c3">
            {CARRY_OVER_REASONS.map((r) => (
              <button key={r} type="button" className="b5-chip" aria-pressed={reason === r} onClick={() => setReason(r)}>
                {t(REASON_KEYS[r])}
              </button>
            ))}
          </div>
        </div>
        <div className="b5-sec">
          <h3>{t('billing.sheet.note')}</h3>
          <textarea className="b5-in text b5-note-in" maxLength={200} rows={2} placeholder={t('billing.petty.note_ph')} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
          <span className="b5-count num">{note.length} / 200</span>
        </div>
        {msg !== null && (
          <div className="msg c-warn" role="alert">
            <Ico name="warn" />
            <span>{msg}</span>
          </div>
        )}
        <p className="b5-note">{t('billing.dayclose.carry_note')}</p>
      </div>
      <div className="acts">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--primary" aria-disabled={step !== null || busy || !shell.online} onClick={() => void send()}>
          {step !== null ? t(step) : fill(t(rows.length === 1 ? 'billing.dayclose.carry_send_one' : 'billing.dayclose.carry_send'), { count: String(rows.length) })}
        </button>
      </div>
    </Dlg>
  );
}
