import { currencyExponent } from '@pos/domain';
import { defaultBillingSettings } from '@pos/events';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { HubError } from '../../api/hub-admin';
import { t } from '../../i18n';
import { navigate } from '../../app/router';
import { fill, type MessageKey } from '../../i18n/en';
import { timeText } from '../alerts/labels';
import { Ico } from '../alerts/ui';
import { useShell } from '../staff/shell/hooks';
import { billingApi } from './api';
import type { CountShiftResult, HandoverCountResult, ShiftPetty, ShiftView } from './contracts';
import { billingErrorKey } from './errors';
import { BIco } from './icons';
import { billMoney, MONEY_DIR, parseCount } from './money';
import { PettySheet, SettleSheet, type Raised } from './PettySheets';
import { useLiveRefetch } from '../staff/orders/lists/OpenOrders';
import { SHIFT_FRAMES } from './frames';
import './styles';

// 05 v1.0.21 §8 "Shift", §3.11, §6.15–§6.19, B23 (plan §4.1 task 39, after hub task 21; frames ShiftOpen,
// ShiftOpenErrors, ShiftOpenPhone, ShiftClose, ShiftCountResult, ShiftVariancePending, ShiftSkip, ShiftHandover,
// ShiftHandoverResult, ShiftPhone, ShiftUrdu). No open shift → the open form (float, this device's drawer on a kiosk or
// tablet). An open shift → in the spec's order: card / online with who took them, cash as a count only (B23: the hub
// sends no cash sum and no expected before the count), petty and open advances, then the blind count. Count and close
// (§6.17) reveals expected and variance; Close without counting (§6.18, `skip-blind-count`); Count at handover (§6.19,
// drawer shifts; the shift stays open). Task 40: Petty cash (record) and Settle on an open advance (PettySheets).


type Step = { name: 'count' } | { name: 'handover' } | { name: 'skip' } | { name: 'skipped'; cancelled: number } | { name: 'counted'; r: CountShiftResult } | { name: 'handed'; r: HandoverCountResult };

const QUICK_MAJOR = [0, 5_000, 10_000] as const;

/** ⚠️ 02b v1.0.28 QK-9: `back` — the screen whose prompt opened this one (e.g. `/takeaway`); after Open shift it returns there */
export function ShiftScreen({ shiftId, back }: { shiftId?: string; back?: string }) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  // primitives only: the store read must be stable between renders
  const code = useSyncExternalStore(shell.config.subscribe, () => (shell.config.snapshot() as { currency_code?: string } | null)?.currency_code ?? 'PKR');
  const setThreshold = useSyncExternalStore(shell.config.subscribe, () => thresholdOf(shell.config.snapshot()));
  const exponent = currencyExponent(code) ?? 2;
  const threshold = setThreshold ?? defaultBillingSettings({ currency_code: code, currency_exponent: exponent }).variance_threshold_minor;
  const money = (minor: number) => billMoney(minor, code);
  // the shift this screen shows: the route's, else the one opened or found here (a closed shift is read by its id)
  const known = useRef<string | null>(shiftId ?? null);
  const [shift, setShift] = useState<ShiftView | null>(null);
  const [none, setNone] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ name: 'count' });

  const load = useCallback(async () => {
    const answer = await api.shift(known.current ?? undefined);
    if (answer.ok) {
      setShift(answer.data);
      setNone(false);
      setLoadErr(null);
      known.current = answer.data.shift_id;
      return;
    }
    if (answer.error.kind === 'api' && answer.error.code === 'SHIFT_NOT_FOUND' && known.current === null) {
      setShift(null);
      setNone(true);
      setLoadErr(null);
      return;
    }
    setLoadErr(errText(answer.error));
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  // a petty entry approved elsewhere, a settle on another device, a reconnect: read again (the hub's own view)
  useLiveRefetch(shell.live, () => void load(), SHIFT_FRAMES);
  const [petty, setPetty] = useState<{ name: 'record' } | { name: 'settle'; advance: ShiftPetty } | null>(null);
  const [raised, setRaised] = useState<Raised | null>(null);

  if (none)
    return (
      <OpenForm
        exponent={exponent}
        code={code}
        onOpened={(shift_id) => {
          if (back !== undefined) return navigate(back);
          setStep({ name: 'count' });
          known.current = shift_id;
          setNone(false);
          void load();
        }}
        onAlreadyOpen={() => {
          setNone(false);
          void load();
        }}
      />
    );
  if (shift === null)
    return (
      <main className="b5-page">
        {loadErr !== null && <Msg text={loadErr} />}
        {loadErr !== null && (
          <button type="button" className="btn" onClick={() => void load()}>
            {t('billing.shift.retry')}
          </button>
        )}
      </main>
    );

  const open = shift.state === 'open';
  const mine = shiftId === undefined;
  // §6.20: Record (approvable) lands on the caller's own money shift, so it is offered on my open shift; Settle is
  // `allowed` only (the returned cash lands on the caller's money shift, the hub checks it)
  const canRecord = open && mine && (shell.permissions.allowed('record-petty-cash') || shell.permissions.requiresApproval('record-petty-cash'));
  const canSettle = shell.permissions.allowed('record-petty-cash');
  /** the refusal's text; a shift closed or gone meanwhile (another device, a manager) is read again, so its real state shows */
  const refused = (e: HubError): string => {
    if (e.kind === 'api' && (e.code === 'SHIFT_NOT_OPEN' || e.code === 'SHIFT_NOT_FOUND')) {
      setStep({ name: 'count' });
      void load();
    }
    return errText(e);
  };
  const side = (() => {
    if (step.name === 'counted') return <CountResult shift={shift} r={step.r} threshold={threshold} money={money} />;
    if (step.name === 'handed') return <HandoverResult shift={shift} r={step.r} threshold={threshold} money={money} onBack={() => setStep({ name: 'count' })} />;
    if (!open) return <ClosedCard shift={shift} money={money} cancelled={step.name === 'skipped' ? step.cancelled : 0} />;
    if (step.name === 'skip')
      return (
        <SkipConfirm
          onBack={() => setStep({ name: 'count' })}
          onSkip={async (note) => {
            const answer = await api.closeShift({ shift_id: shift.shift_id, skip_count: true, ...(note === '' ? {} : { note }) });
            if (!answer.ok) return refused(answer.error);
            shell.toasts.show({ text: t('billing.shift.skipped'), tone: 'ok' });
            setStep({ name: 'skipped', cancelled: answer.data.closed_requests.length });
            await load();
            return null;
          }}
        />
      );
    return (
      <CountBox
        handover={step.name === 'handover'}
        exponent={exponent}
        code={code}
        isDrawer={shift.is_drawer}
        canSkip={shell.permissions.allowed('skip-blind-count')}
        onHandover={() => setStep({ name: 'handover' })}
        onSkip={() => setStep({ name: 'skip' })}
        onCancel={() => setStep({ name: 'count' })}
        onCount={async (counted_minor) => {
          if (step.name === 'handover') {
            const answer = await api.handoverCount({ shift_id: shift.shift_id, counted_minor });
            if (!answer.ok) return refused(answer.error);
            setStep({ name: 'handed', r: answer.data });
          } else {
            const answer = await api.countShift({ shift_id: shift.shift_id, counted_minor });
            if (!answer.ok) return refused(answer.error);
            setStep({ name: 'counted', r: answer.data });
          }
          await load();
          return null;
        }}
      />
    );
  })();

  return (
    <main className={shiftPage(shell)}>
      <div className="col b5-stack">
        <Head shift={shift} mine={mine} money={money} />
        {canRecord && (
          <div className="b5-acts">
            <button type="button" className="btn" onClick={() => setPetty({ name: 'record' })}>
              <BIco name="wallet" />
              {t('billing.petty.title')}
            </button>
          </div>
        )}
        {raised !== null && !shift.petty.some((p) => p.entry_id === raised.entry_id) && (
          <p className="b5-note">{fill(t('billing.petty.waiting_screen'), { line: raised.line })}</p>
        )}
        <Takings shift={shift} money={money} handovers={step.name !== 'handed'} {...(canSettle ? { onSettle: (advance: ShiftPetty) => setPetty({ name: 'settle', advance }) } : {})} />
      </div>
      <div className="col b5-stack">{side}</div>
      {petty?.name === 'record' && (
        <PettySheet
          shift={shift}
          raised={raised}
          onRaised={setRaised}
          onDone={(r) => {
            if (r !== 'pending') setPetty(null);
            if (r === 'closed') shell.toasts.show({ text: t('billing.petty.not_pending'), tone: 'info' });
            void load();
          }}
          onClose={() => {
            // an approved request, seen once, is done; a waiting one stays (its card reopens on the next tap)
            if (raised !== null && shift.petty.some((p) => p.entry_id === raised.entry_id)) setRaised(null);
            setPetty(null);
          }}
        />
      )}
      {petty?.name === 'settle' && (
        <SettleSheet
          advance={petty.advance}
          onDone={() => {
            setPetty(null);
            void load();
          }}
          onClose={() => setPetty(null)}
        />
      )}
    </main>
  );
}

/** The page: two columns (frame ShiftClose) on a kiosk / landscape tablet, one on a phone or portrait (ShiftPhone). */
function shiftPage(shell: { phone: boolean; portrait: boolean }): string {
  return shell.phone || shell.portrait ? 'b5-page b5-shift b5-shift--one' : 'b5-page b5-shift';
}

/** The branch's `variance_threshold_minor` (§3.11), or null for the defaults. */
function thresholdOf(snapshot: unknown): number | null {
  const v = (snapshot as { billing?: { variance_threshold_minor?: unknown } } | null)?.billing?.variance_threshold_minor;
  return typeof v === 'number' ? v : null;
}

function errText(e: HubError): string {
  if (e.kind === 'signed_out') return t('billing.shift.signed_out');
  if (e.kind !== 'api') return t('tables.toast.needs_hub');
  if (e.code === 'DRAWER_IN_USE') return fill(t('errors.DRAWER_IN_USE'), { name: typeof e.details['staff_name'] === 'string' ? e.details['staff_name'] : t('billing.shift.someone') });
  if (e.code === 'BUSINESS_DAY_NOT_OPEN') return t('billing.shift.day_not_open');
  if (e.code === 'PERMISSION_DENIED' && e.details['reason'] === 'skip_not_granted') return t('errors.PERMISSION_DENIED.skip_not_granted');
  return t(billingErrorKey(e.code, e.details));
}

function Msg({ text, tone = 'c-warn', children }: { text: string; tone?: 'c-warn' | 'c-info'; children?: ReactNode }) {
  return (
    <div className={`msg ${tone}`} role="alert">
      <Ico name={tone === 'c-info' ? 'info' : 'warn'} />
      <span>{text}</span>
      {children}
    </div>
  );
}

/** Typed amount with the frames' keypad (digits, 00, Delete). */
function AmountField({ label, value, onChange, code }: { label: string; value: string; onChange: (v: string) => void; code: string }) {
  const sym = code === 'PKR' ? 'Rs' : code;
  const key = (k: string) => onChange(k === 'del' ? value.slice(0, -1) : value + k);
  return (
    <>
      <label className="b5-fld">
        <span>{label}</span>
        <div className="b5-in">
          <small>{sym}</small>
          <input inputMode="decimal" dir={MONEY_DIR} autoComplete="off" value={value} onChange={(e) => onChange(e.currentTarget.value)} />
        </div>
      </label>
      <div className="b5-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className="btn" onClick={() => key(d)}>
            {d}
          </button>
        ))}
        <button type="button" className="btn fn" onClick={() => key('00')}>
          00
        </button>
        <button type="button" className="btn" onClick={() => key('0')}>
          0
        </button>
        <button type="button" className="btn fn" onClick={() => key('del')}>
          {t('billing.shift.delete')}
        </button>
      </div>
    </>
  );
}

function OpenForm({ exponent, code, onOpened, onAlreadyOpen }: { exponent: number; code: string; onOpened: (shift_id: string) => void; onAlreadyOpen: () => void }) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  // §6.15: a drawer is a cashier kiosk's or a tablet's with a printer route; a phone never holds one (frame ShiftOpenPhone)
  const canDrawer = shell.device.type === 'cashier_kiosk' || shell.device.type === 'tablet';
  const [text, setText] = useState('');
  const [drawer, setDrawer] = useState(shell.device.type === 'cashier_kiosk');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; already: boolean } | null>(null);
  const float = parseCount(text, exponent);
  const ready = float !== null && shell.online && !busy;
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setErr(null);
    const as_drawer = canDrawer && drawer;
    const answer = await api.openShift({ float_minor: float, as_drawer });
    setBusy(false);
    if (!answer.ok) {
      setErr({ text: errText(answer.error), already: answer.error.kind === 'api' && answer.error.code === 'SHIFT_ALREADY_OPEN' });
      return;
    }
    shell.toasts.show({ text: t(as_drawer && float > 0 ? 'billing.shift.opened_drawer' : 'billing.shift.opened'), tone: 'ok' });
    onOpened(answer.data.shift_id);
  };
  return (
    <main className={shiftPage(shell)}>
      <div className="col b5-stack">
        <div className="b5-card">
          <div className="b5-step">{t('billing.shift.open_title')}</div>
          <p className="b5-note">{t(canDrawer ? 'billing.shift.open_note' : 'billing.shift.open_note_phone')}</p>
          <AmountField label={t('billing.shift.float')} value={text} onChange={setText} code={code} />
          {!shell.phone && (
            <div className="b5-quick">
              {QUICK_MAJOR.map((q) => (
                <button key={q} type="button" className="btn" onClick={() => setText(q === 0 ? '0' : String(q))}>
                  {q.toLocaleString('en-US')}
                </button>
              ))}
            </div>
          )}
          {canDrawer && (
            <button type="button" className="b5-chip b5-switch" aria-pressed={drawer} onClick={() => setDrawer(!drawer)}>
              <BIco name="drawer" />
              <span>
                {t('billing.shift.use_drawer')}
                <small>{t('billing.shift.use_drawer_sub')}</small>
              </span>
              <span className="sw">
                <i />
              </span>
            </button>
          )}
          {err !== null && (
            <Msg text={err.text} tone={err.already ? 'c-info' : 'c-warn'}>
              {err.already && (
                <button type="button" className="btn" onClick={onAlreadyOpen}>
                  {t('billing.shift.go_to_mine')}
                </button>
              )}
            </Msg>
          )}
          {!shell.online && err === null && <Msg text={t('tables.toast.needs_hub')} />}
          <button type="button" className="btn btn--primary b5-add btn--block" aria-disabled={!ready} onClick={() => void submit()}>
            <BIco name="check" />
            {t('billing.shift.open')}
          </button>
        </div>
      </div>
      {!shell.phone && (
        <div className="col b5-stack">
          <div className="b5-card">
            <div className="b5-step">{t('billing.shift.why_title')}</div>
            <p className="b5-note">{t('billing.shift.why')}</p>
          </div>
        </div>
      )}
    </main>
  );
}

function Head({ shift, mine, money }: { shift: ShiftView; mine: boolean; money: (m: number) => string }) {
  const shell = useShell();
  const name = shift.staff_name ?? '';
  return (
    <div className="b5-bh">
      <span className="av av--me b5-bh__av">{name.slice(0, 1).toUpperCase()}</span>
      <div className="b5-bh__t">
        <h1>{mine ? t('billing.shift.mine') : fill(t('billing.shift.other'), { name })}</h1>
        <div className="b5-bh__m">
          <span className={`st st--lg ${shift.state === 'open' ? 'c-ok' : 'c-mute'}`}>{t(shift.state === 'open' ? 'billing.shift.state_open' : 'billing.shift.state_closed')}</span>
          {shift.is_drawer && (
            <span className="i">
              <BIco name="drawer" />
              {t('billing.shift.drawer')}
            </span>
          )}
          <span className="i">
            <BIco name="clock" />
            {fill(t('billing.shift.since'), { time: timeText(shift.opened_at, shell.clock.utcOffsetMs) })}
          </span>
          <span className="i">
            <BIco name="cash" />
            {t('billing.shift.float_short')}{' '}
            <b className="num" dir={MONEY_DIR}>
              {money(shift.float_minor)}
            </b>
          </span>
        </div>
      </div>
    </div>
  );
}

const net = (x: { in_minor: number | null; out_minor: number | null }) => (x.in_minor ?? 0) - (x.out_minor ?? 0);

function Takings({ shift, money, handovers, onSettle }: { shift: ShiftView; money: (m: number) => string; handovers: boolean; onSettle?: (advance: ShiftPetty) => void }) {
  const digital = shift.takings.filter((x) => x.payment_class === 'digital');
  const cash = shift.takings.filter((x) => x.payment_class === 'cash');
  const petty = shift.petty.filter((p) => p.kind !== 'advance' || p.settled);
  const advances = shift.petty.filter((p) => p.kind === 'advance' && !p.settled);
  let n = 0;
  const count = (c: number) => fill(t(c === 1 ? 'billing.shift.payments_one' : 'billing.shift.payments'), { count: String(c) });
  return (
    <div className="b5-card b5-stack">
      {digital.length > 0 && (
        <>
          <Step n={++n} text={t('billing.shift.digital')} small={t('billing.shift.digital_sub')} />
          {digital.map((x) => (
            <div key={x.mode_id} className="b5-tk">
              <span className="b5-pay__i">
                <BIco name={x.mode_id === 'card' || /card/i.test(x.mode_name) ? 'card' : 'wallet'} />
              </span>
              <span>
                <b>{x.mode_name}</b>
                <span>{count(x.payments_count)}</span>
              </span>
              <span className="a">{money(net(x))}</span>
              {x.by.length > 1 && (
                <div className="b5-by">
                  {x.by.map((b, i) => (
                    <span key={i}>
                      {fill(t(b.taken_by_name !== null && b.taken_by_name !== shift.staff_name ? 'billing.shift.by_takeover' : 'billing.shift.by'), { name: b.taken_by_name ?? '—' })}
                      {' · '}
                      <span className="num">{b.in_minor === null ? '—' : money(b.in_minor)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}
      {cash.length > 0 && (
        <>
          <Step n={++n} text={t('billing.shift.cash')} small={t('billing.shift.cash_sub')} />
          {cash.map((x) => (
            <div key={x.mode_id} className={x.in_minor === null ? 'b5-tk blind' : 'b5-tk'}>
              <span className="b5-pay__i">
                <BIco name="cash" />
              </span>
              <span>
                <b>{x.mode_name}</b>
                <span>{count(x.payments_count)}</span>
              </span>
              {/* B23: no cash sum before the count; the hub sends null. E2E E-5: in_minor is already the applied amount
                  (tendered and change cancel out, hub projections/shifts.ts), so the line is in − out, never − change again */}
              <span className="a">{x.in_minor === null ? t(shift.state === 'open' ? 'billing.shift.after_count' : 'billing.shift.not_counted_cash') : money(net(x))}</span>
            </div>
          ))}
        </>
      )}
      {(petty.length > 0 || advances.length > 0) && (
        <>
          <Step n={n + 1} text={t('billing.shift.petty')} />
          {petty.map((p) => (
            <div key={p.entry_id} className="b5-tk">
              <span className="b5-pay__i">
                <BIco name="wallet" />
              </span>
              <span>
                <b>{pettyTitle(p)}</b>
                {p.paid_to !== null && <span>{p.paid_to}</span>}
              </span>
              <span className="a">{money(p.amount_minor)}</span>
            </div>
          ))}
          {advances.map((p) => (
            <div key={p.entry_id} className="b5-adv">
              <span className="av">{(p.advance_staff_name ?? '?').slice(0, 1).toUpperCase()}</span>
              <span>
                <b>{fill(t('billing.shift.advance'), { name: p.advance_staff_name ?? '—' })}</b>
                <span>{t('billing.shift.advance_open')}</span>
              </span>
              <span className="a">{money(p.amount_minor)}</span>
              {onSettle !== undefined && (
                <button type="button" className="btn" onClick={() => onSettle(p)}>
                  <BIco name="check" />
                  {t('billing.petty.settle')}
                </button>
              )}
            </div>
          ))}
        </>
      )}
      {handovers && shift.handovers.length > 0 && (
        <>
          <Step text={t('billing.shift.handovers')} />
          <HandoverRows shift={shift} money={money} />
        </>
      )}
    </div>
  );
}

function pettyTitle(p: { kind: 'advance' | 'out' | 'in'; category_name: string | null; advance_staff_name: string | null }): string {
  const cat = p.category_name ?? '';
  if (p.kind === 'advance') return fill(t('billing.shift.advance_settled'), { name: p.advance_staff_name ?? '—' });
  return fill(t(p.kind === 'out' ? 'billing.shift.petty_out' : 'billing.shift.petty_in'), { category: cat });
}

function HandoverRows({ shift, money }: { shift: ShiftView; money: (m: number) => string }) {
  const shell = useShell();
  return (
    <>
      {shift.handovers.map((h) => (
        <div key={h.at} className="b5-tk">
          <span className="b5-pay__i">
            <BIco name="handover" />
          </span>
          <span>
            <b>{t('billing.shift.handover_row')}</b>
            <span>
              <span className="num">{timeText(h.at, shell.clock.utcOffsetMs)}</span> · {fill(t('billing.shift.expected_was'), { amount: money(h.expected_minor) })}
            </span>
          </span>
          <span className="a">{money(h.counted_minor)}</span>
        </div>
      ))}
    </>
  );
}

function Step({ n, text, small, done }: { n?: number; text: string; small?: string; done?: boolean }) {
  return (
    <div className={done === true ? 'b5-step done' : 'b5-step'}>
      {n !== undefined && <i>{n}</i>}
      {done === true && (
        <i>
          <BIco name="check" />
        </i>
      )}
      {text}
      {small !== undefined && <small>{small}</small>}
    </div>
  );
}

function CountBox(p: {
  handover: boolean;
  exponent: number;
  code: string;
  isDrawer: boolean;
  canSkip: boolean;
  onHandover: () => void;
  onSkip: () => void;
  onCancel: () => void;
  onCount: (counted_minor: number) => Promise<string | null>;
}) {
  const shell = useShell();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setText('');
    setErr(null);
  }, [p.handover]);
  const counted = parseCount(text, p.exponent);
  const ready = counted !== null && shell.online && !busy;
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setErr(null);
    const e = await p.onCount(counted);
    setBusy(false);
    setErr(e);
  };
  const primary = (label: MessageKey, block: boolean) => (
    <button type="button" className={block ? 'btn btn--primary b5-add btn--block' : 'btn btn--primary'} aria-disabled={!ready} onClick={() => void submit()}>
      {block && <BIco name="check" />}
      {t(label)}
    </button>
  );
  return (
    <div className="b5-countbox">
      <Step text={t(p.handover ? 'billing.shift.handover_title' : 'billing.shift.count_title')} />
      <div className="b5-blind">
        <BIco name={p.handover ? 'handover' : 'eyeoff'} />
        <span>{t(p.handover ? 'billing.shift.handover_note' : 'billing.shift.blind')}</span>
      </div>
      <AmountField label={t(p.handover ? 'billing.shift.counted_now' : 'billing.shift.counted')} value={text} onChange={setText} code={p.code} />
      {err !== null && <Msg text={err} />}
      {!shell.online && err === null && <Msg text={t('tables.toast.needs_hub')} />}
      {p.handover ? (
        <div className="b5-acts">
          <button type="button" className="btn" onClick={p.onCancel}>
            {t('common.cancel')}
          </button>
          {primary('billing.shift.count', false)}
        </div>
      ) : (
        <>
          {primary('billing.shift.count_close', true)}
          {(p.isDrawer || p.canSkip) && (
            <div className="b5-acts">
              {p.isDrawer && (
                <button type="button" className="btn" onClick={p.onHandover}>
                  <BIco name="handover" />
                  {t('billing.shift.handover')}
                </button>
              )}
              {p.canSkip && (
                <button type="button" className="btn" onClick={p.onSkip}>
                  <BIco name="ban" />
                  {t('billing.shift.skip')}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SkipConfirm({ onBack, onSkip }: { onBack: () => void; onSkip: (note: string) => Promise<string | null> }) {
  const shell = useShell();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = shell.online && !busy;
  return (
    <div className="b5-card b5-stack">
      <Step text={t('billing.shift.skip_title')} />
      <div className="b5-what">
        <Ico name="info" />
        <span>{t('billing.shift.skip_what')}</span>
      </div>
      <div className="b5-sec">
        <h3>{t('billing.sheet.note')}</h3>
        <textarea className="b5-in text b5-note-in" maxLength={200} rows={2} placeholder={t('billing.shift.note_ph')} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <span className="b5-count num">{note.length} / 200</span>
      </div>
      {err !== null && <Msg text={err} />}
      <div className="b5-acts">
        <button type="button" className="btn" onClick={onBack}>
          {t('billing.shift.skip_back')}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          aria-disabled={!ready}
          onClick={() => {
            if (!ready) return;
            setBusy(true);
            setErr(null);
            void onSkip(note.trim()).then((e) => {
              setBusy(false);
              setErr(e);
            });
          }}
        >
          {t('billing.shift.skip')}
        </button>
      </div>
    </div>
  );
}

/** Short / Over / Exact, and its tone: over the threshold warn, within it ok, exact neutral (frame ShiftVariancePending). */
function variance(v: number, threshold: number, money: (m: number) => string): { text: string; tone: string; over: boolean } {
  if (v === 0) return { text: t('billing.shift.exact'), tone: 'c-mute', over: false };
  const over = Math.abs(v) > threshold;
  return { text: fill(t(v < 0 ? 'billing.shift.short' : 'billing.shift.over'), { amount: money(Math.abs(v)) }), tone: over ? 'c-warn' : 'c-ok', over };
}

function Result({ expected, counted, v, threshold, money, signOff }: { expected: number; counted: number; v: number; threshold: number; money: (m: number) => string; signOff?: boolean }) {
  const base = variance(v, threshold, money);
  // the hub decides the sign-off (§6.17); its answer sets the tone, never a possibly stale client threshold
  const r = signOff === undefined || v === 0 ? base : { ...base, tone: signOff ? 'c-warn' : 'c-ok' };
  return (
    <div className="b5-res">
      <div>
        <span>{t('billing.shift.expected')}</span>
        <b>{money(expected)}</b>
      </div>
      <div>
        <span>{t('billing.shift.counted_k')}</span>
        <b>{money(counted)}</b>
      </div>
      <div className={`var ${r.tone}`}>
        <span>{t('billing.shift.variance')}</span>
        <b>{r.text}</b>
      </div>
    </div>
  );
}

function CountResult({ shift, r, threshold, money }: { shift: ShiftView; r: CountShiftResult; threshold: number; money: (m: number) => string }) {
  const counted = r.expected_minor + r.variance_minor;
  const v = variance(r.variance_minor, threshold, money);
  const cancelled = r.closed_requests.length;
  return (
    <div className="b5-card b5-stack">
      <Step done text={t(shift.is_drawer ? 'billing.shift.closed_drawer' : 'billing.shift.closed')} />
      <Result expected={r.expected_minor} counted={counted} v={r.variance_minor} threshold={threshold} money={money} signOff={r.sign_off !== null} />
      {r.sign_off !== null ? (
        // frame ShiftVariancePending: the waiting card, info tone; the shift does not wait
        <div className="b5-wait c-info" role="status">
          <BIco name="clock" />
          <div>
            <b>{t('billing.shift.signoff')}</b>
            <span>{v.text}</span>
          </div>
        </div>
      ) : (
        r.variance_minor !== 0 && <p className="b5-note">{Math.abs(r.variance_minor) <= threshold ? fill(t('billing.shift.within'), { threshold: money(threshold) }) : t('billing.shift.nothing_sent')}</p>
      )}
      {cancelled > 0 && <p className="b5-note">{fill(t(cancelled === 1 ? 'billing.shift.petty_cancelled_one' : 'billing.shift.petty_cancelled'), { count: String(cancelled) })}</p>}
    </div>
  );
}

function HandoverResult({ shift, r, threshold, money, onBack }: { shift: ShiftView; r: HandoverCountResult; threshold: number; money: (m: number) => string; onBack: () => void }) {
  const v = variance(r.variance_minor, threshold, money);
  return (
    <div className="b5-card b5-stack">
      <Step done text={t('billing.shift.handed')} />
      <Result expected={r.expected_minor} counted={r.counted_minor} v={r.variance_minor} threshold={threshold} money={money} />
      {/* §6.19: a handover never raises a sign-off */}
      {r.variance_minor !== 0 && <p className="b5-note">{v.over ? t('billing.shift.nothing_sent') : fill(t('billing.shift.within'), { threshold: money(threshold) })}</p>}
      {shift.handovers.length > 0 && (
        <>
          <h3>{t('billing.shift.handovers')}</h3>
          <HandoverRows shift={shift} money={money} />
        </>
      )}
      <button type="button" className="btn btn--primary b5-add btn--block" onClick={onBack}>
        {t('billing.shift.back')}
      </button>
    </div>
  );
}

/** A closed shift read later (another person's, or after a reload): the hub's own count, no recount (§3.11). */
function ClosedCard({ shift, money, cancelled }: { shift: ShiftView; money: (m: number) => string; cancelled: number }) {
  return (
    <div className="b5-card b5-stack">
      <Step done text={t('billing.shift.closed')} />
      {shift.counted_minor !== null && shift.expected_minor !== null && shift.variance_minor !== null ? (
        <div className="b5-res">
          <div>
            <span>{t('billing.shift.expected')}</span>
            <b>{money(shift.expected_minor)}</b>
          </div>
          <div>
            <span>{t('billing.shift.counted_k')}</span>
            <b>{money(shift.counted_minor)}</b>
          </div>
          <div className="var c-mute">
            <span>{t('billing.shift.variance')}</span>
            <b>{shift.variance_minor === 0 ? t('billing.shift.exact') : fill(t(shift.variance_minor < 0 ? 'billing.shift.short' : 'billing.shift.over'), { amount: money(Math.abs(shift.variance_minor)) })}</b>
          </div>
        </div>
      ) : (
        <p className="b5-note">{t('billing.shift.not_counted')}</p>
      )}
      {cancelled > 0 && <p className="b5-note">{fill(t(cancelled === 1 ? 'billing.shift.petty_cancelled_one' : 'billing.shift.petty_cancelled'), { count: String(cancelled) })}</p>}
    </div>
  );
}

