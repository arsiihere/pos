import { CHARGE_REMOVE_REASONS } from '@pos/domain';
import { defaultBillingSettings } from '@pos/events';
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { HubError } from '../../api/hub-admin';
import { t } from '../../i18n';
import { fill, type MessageKey } from '../../i18n/en';
import { Ico } from '../alerts/ui';
import { useShell } from '../staff/shell/hooks';
import { billingApi } from './api';
import type { BillRef, BillView, SheetResult } from './contracts';
import { billingErrorKey } from './errors';
import { amountText, billMoney, currencySymbol, MONEY_DIR, parseMinor, parsePercentBp, rateText } from './money';
import './styles';

// 05 v1.0.14 §8 (discount sheet, service charge row with Remove / Add back), §6.6–§6.8, B7, B8 (plan §3.1 task 37;
// brief §3.5, §3.5.1, §3.5.2; frames Discount, DiscountWaiting, ServiceChargeRemove, ServiceChargeWaiting). One
// primary that names the missing step (value → reason → note for Other → the action); an approvable action held as
// `requires_approval` ends in "Ask for approval" + Needs approval, `allowed` in the action word. A `{ pending }`
// answer (or an open request on the bill, `open_requests[]`) puts the waiting card in the sheet's place, with
// Withdraw (01d `WithdrawRequest`). No amount is computed here: totals come from the hub after the answer (§7 Q-8,
// R-60). The buyer sheet is task 18's.

const NOTE_MAX = 200;

/** §8, B7: the discount is on the whole bill only, before the first close (hidden once a split is closed). */
export function canDiscount(bill: BillView): boolean {
  return (bill.state === 'open' || bill.state === 'projected') && !bill.splits.some((s) => s.state === 'closed');
}

function errorText(e: HubError, currency: string): string {
  if (e.kind !== 'api') return t('tables.toast.needs_hub');
  const d = e.details;
  if (e.code === 'DISCOUNT_TOO_LARGE' && Number.isSafeInteger(d['max_minor'])) return fill(t('errors.DISCOUNT_TOO_LARGE'), { amount: billMoney(d['max_minor'] as number, currency) });
  return t(billingErrorKey(e.code, d));
}

interface Reason {
  code: string;
  label: string;
}

function Chips({ reasons, picked, onPick, cols, title }: { reasons: readonly Reason[]; picked: string | null; onPick: (code: string) => void; cols: 'c2' | 'c3'; title?: string }) {
  const shell = useShell();
  if (shell.phone) cols = 'c2';
  return (
    <div className="b5-sec">
      <h3>{title ?? t('billing.sheet.reason')}</h3>
      <div className={`b5-chips ${cols}`}>
        {reasons.map((r) => (
          <button key={r.code} type="button" className="b5-chip" aria-pressed={picked === r.code} onClick={() => onPick(r.code)}>
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Note({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="b5-sec">
      <h3>{t('billing.sheet.note')}</h3>
      <textarea
        className="b5-in text b5-note-in"
        maxLength={NOTE_MAX}
        placeholder={t('billing.sheet.note_ph')}
        aria-label={t('billing.sheet.note')}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
      <div className="b5-count num">{fill(t('billing.sheet.count'), { n: String(value.length) })}</div>
    </div>
  );
}

function Frame({ bill, title, sub, wide, onClose, children }: { bill: BillView; title: string; sub?: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  const shell = useShell();
  return (
    <div className={shell.portrait || shell.phone ? 'scrim scrim--sheet' : 'scrim'}>
      <div className={wide === true ? 'dlg b5-dlg w9' : 'dlg b5-dlg'} role="dialog" aria-modal="true" aria-label={title}>
        {(shell.portrait || shell.phone) && <span className="dlg__grip" aria-hidden="true" />}
        <div className="dlg__h">
          <span className="tcode">{bill.identifier}</span>
          <div className="dlg__t">
            <h2>{title}</h2>
            {sub !== undefined && <div className="ac__who">{sub}</div>}
          </div>
          <button type="button" className="btn btn--icon dlg__x" aria-label={t('common.close')} onClick={onClose}>
            <Ico name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Waiting({ line, what, busy, onWithdraw, onBack }: { line: string; what: string | null; busy: boolean; onWithdraw: () => void; onBack: () => void }) {
  return (
    <>
      <div className="b5-wait">
        <Ico name="clock" />
        <div>
          <b>{t('billing.sheet.waiting')}</b>
          {line !== '' && <span>{line}</span>}
        </div>
        <button type="button" className="btn btn--tone c-info" aria-disabled={busy} onClick={onWithdraw}>
          <Ico name="undo" />
          {t('billing.sheet.withdraw')}
        </button>
      </div>
      {what !== null && (
        <div className="b5-what">
          <Ico name="info" />
          <span>{what}</span>
        </div>
      )}
      <div className="acts one">
        <button type="button" className="btn btn--primary" onClick={onBack}>
          {t('billing.sheet.back')}
        </button>
      </div>
    </>
  );
}

/** The primary button: the missing step's words (aria-disabled), else the action (+ the Needs approval tag). */
function Primary({ step, action, ask, busy, onClick }: { step: MessageKey | null; action: string; ask: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn btn--primary" aria-disabled={step !== null || busy} onClick={onClick}>
      {step !== null ? (
        t(step)
      ) : ask ? (
        <>
          {t('billing.sheet.ask')}
          <span className="ntag">{t('billing.sheet.needs')}</span>
        </>
      ) : (
        action
      )}
    </button>
  );
}

function noteStep(reason: string | null, note: string): MessageKey | null {
  if (reason === null) return 'billing.sheet.pick_reason';
  if (reason === 'other' && note.trim() === '') return 'billing.sheet.write_why';
  return null;
}

/** A request this sheet raised (or withdrew), with the bill version it was seen at. */
interface Pending {
  alert_id: string;
  line: string;
  seq: number;
  done: boolean;
}

/**
 * The waiting card's request: the bill's open request of that kind (`open_requests[]`), else the one this sheet just
 * raised while the bill shown is still the one it was raised on. Once the bill no longer lists it (answered,
 * withdrawn, expired), or after a withdraw here, the card goes.
 */
function waitingOf(bill: BillView, kind: string, local: Pending | null): { alert_id: string; line: string } | null {
  const listed = bill.open_requests.find((r) => r.kind === kind)?.alert_id ?? null;
  if (local !== null && local.done && (listed === null || listed === local.alert_id)) return null;
  if (listed !== null) return { alert_id: listed, line: local !== null && local.alert_id === listed ? local.line : '' };
  if (local !== null && !local.done && local.seq === bill.as_of_seq) return { alert_id: local.alert_id, line: local.line };
  return null;
}

export type DiscountOutcome = 'applied' | 'pending' | 'withdrawn' | 'removed' | 'unchanged';

/**
 * 05-D02 Discount (`apply-discount`): give one (amount / percent, a reason from the branch settings, note for Other)
 * or, when the bill has one, remove it (`RemoveDiscount`; both grants may remove, §6.7). Open only while
 * `canDiscount(bill)`; the caller re-reads the bill on `onDone`.
 */
export function DiscountSheet({
  bill,
  billRef,
  mode,
  onDone,
  onClose,
}: {
  bill: BillView;
  billRef: BillRef;
  /** the entry point: the menu's Discount gives or changes one (B7, `replaces`); the row's Remove discount removes. Default: remove when the bill has one. */
  mode?: 'apply' | 'remove';
  onDone: (r: DiscountOutcome) => void;
  onClose: () => void;
}) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const currency = bill.currency.code;
  const reasons = useSyncExternalStore(shell.config.subscribe, () => discountReasons(shell.config.snapshot()));
  const labelOf = (code: string) => reasons.find((r) => r.code === code)?.label ?? code;
  const ask = shell.permissions.requiresApproval('apply-discount');

  const [kind, setKind] = useState<'amount' | 'percent'>('amount');
  const [text, setText] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<Pending | null>(null);
  const waiting = waitingOf(bill, 'discount', local);

  const removing = (mode ?? (bill.discount !== null ? 'remove' : 'apply')) === 'remove' && bill.discount !== null;
  const value = kind === 'percent' ? parsePercentBp(text) : parseMinor(text, bill.currency.exponent);
  const step: MessageKey | null = !removing && value === null ? 'billing.discount.enter' : noteStep(reason, note);

  const withNote = <P extends object>(p: P): P & { note?: string } => (note.trim() === '' ? p : { ...p, note: note.trim() });
  const send = async () => {
    if (step !== null || busy || reason === null || (removing && bill.bill_id === null)) return;
    setBusy(true);
    setError(null);
    const answer = removing
      ? await api.removeDiscount(withNote({ bill_id: bill.bill_id as string, reason_code: reason }))
      : await api.applyDiscount(withNote({ bill_ref: billRef, kind, value: value as number, reason_code: reason }));
    setBusy(false);
    if (!answer.ok) {
      setError(errorText(answer.error, currency));
      return;
    }
    const r: SheetResult = answer.data;
    if ('pending' in r) {
      const shown = kind === 'percent' ? rateText(value as number) : billMoney(value as number, currency);
      setLocal({ alert_id: r.pending.alert_id, line: `${shown} · ${labelOf(reason)}`, seq: bill.as_of_seq, done: false });
      onDone('pending');
      return;
    }
    if ('changed' in r && !r.changed) {
      onDone('unchanged');
      return;
    }
    shell.toasts.show({ text: t(removing ? 'billing.discount.removed' : 'billing.discount.applied'), tone: 'ok' });
    onDone(removing ? 'removed' : 'applied');
  };
  const withdraw = async () => {
    if (waiting === null || busy) return;
    setBusy(true);
    const answer = await api.withdrawRequest(waiting.alert_id);
    setBusy(false);
    // answered or closed meanwhile (REQUEST_NOT_PENDING): the bill is read again either way
    if (!answer.ok && !(answer.error.kind === 'api' && answer.error.code === 'REQUEST_NOT_PENDING')) {
      setError(errorText(answer.error, currency));
      return;
    }
    setLocal({ ...waiting, seq: bill.as_of_seq, done: true });
    onDone('withdrawn');
  };

  if (waiting !== null)
    return (
      <Frame bill={bill} title={t('billing.discount.title')} onClose={onClose}>
        <Waiting line={waiting.line} what={t('billing.discount.close_waits')} busy={busy} onWithdraw={() => void withdraw()} onBack={onClose} />
        {error !== null && <Msg text={error} />}
      </Frame>
    );

  if (removing) {
    const d = bill.discount!;
    const shown = d.kind === 'percent' ? `${rateText(d.value)} · ${billMoney(d.discount_minor, currency)}` : billMoney(d.discount_minor, currency);
    return (
      <Frame bill={bill} title={t('billing.discount.remove_title')} sub={shown} onClose={onClose}>
        <Chips reasons={reasons} picked={reason} onPick={setReason} cols="c3" />
        <Note value={note} onChange={setNote} />
        {error !== null && <Msg text={error} />}
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <Primary step={step} action={t('billing.discount.remove')} ask={false} busy={busy} onClick={() => void send()} />
        </div>
      </Frame>
    );
  }

  return (
    <Frame bill={bill} title={t('billing.discount.title')} sub={t('billing.discount.sub')} wide onClose={onClose}>
      <div className="col b5-stack">
        <div className="b5-seg">
          {(['amount', 'percent'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {t(k === 'amount' ? 'billing.discount.amount' : 'billing.discount.percent')}
            </button>
          ))}
        </div>
        <label className="b5-fld">
          <span>{t('billing.discount.field')}</span>
          <div className={text !== '' && value === null ? 'b5-in err' : 'b5-in'}>
            {kind === 'amount' && <small>{currencySymbol(currency)}</small>}
            <input inputMode="decimal" dir={MONEY_DIR} aria-label={t('billing.discount.field')} value={text} onChange={(e) => setText(e.currentTarget.value)} />
            {kind === 'percent' && <small>%</small>}
          </div>
        </label>
        <div className="b5-note">{t('billing.discount.hint')}</div>
        <Chips reasons={reasons} picked={reason} onPick={setReason} cols="c3" />
        <Note value={note} onChange={setNote} />
      </div>
      {error !== null && <Msg text={error} />}
      <div className="acts">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <Primary step={step} action={t('billing.discount.apply')} ask={ask} busy={busy} onClick={() => void send()} />
      </div>
    </Frame>
  );
}

function Msg({ text }: { text: string }) {
  return (
    <div className="msg c-warn" role="alert">
      <Ico name="warn" />
      <span>{text}</span>
    </div>
  );
}

/** §4.4 / B7: the branch's discount reasons (owner labels); with no `billing` key, the hub's built-in defaults. */
const DEFAULT_REASONS: readonly Reason[] = defaultBillingSettings({ currency_code: 'PKR', currency_exponent: 2 }).discount_reasons;
let lastSnapshot: unknown = undefined;
let lastReasons: readonly Reason[] = DEFAULT_REASONS;
function discountReasons(snapshot: unknown): readonly Reason[] {
  if (snapshot === lastSnapshot) return lastReasons;
  lastSnapshot = snapshot;
  const list = (snapshot as { billing?: { discount_reasons?: Reason[] } } | null)?.billing?.discount_reasons;
  lastReasons = Array.isArray(list) ? list : DEFAULT_REASONS;
  return lastReasons;
}

const SC_REASON: Record<(typeof CHARGE_REMOVE_REASONS)[number], MessageKey> = {
  customer_request: 'billing.sc.reason.customer_request',
  service_complaint: 'billing.sc.reason.service_complaint',
  staff_meal: 'billing.sc.reason.staff_meal',
  other: 'billing.sc.reason.other',
};

export type ServiceChargeOutcome = 'removed' | 'unchanged' | 'pending' | 'withdrawn';

/** 05-D03 Remove service charge (`remove-service-charge`, approvable; CHARGE_REMOVE_REASONS, note for Other). */
export function ServiceChargeSheet({ bill, billRef, onDone, onClose }: { bill: BillView; billRef: BillRef; onDone: (r: ServiceChargeOutcome) => void; onClose: () => void }) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const currency = bill.currency.code;
  const ask = shell.permissions.requiresApproval('remove-service-charge');
  const reasons = CHARGE_REMOVE_REASONS.map((code) => ({ code, label: t(SC_REASON[code]) }));
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<Pending | null>(null);
  const waiting = waitingOf(bill, 'remove_service_charge', local);
  const step = noteStep(reason, note);

  const send = async () => {
    if (step !== null || busy || reason === null) return;
    setBusy(true);
    setError(null);
    const answer = await api.removeServiceCharge({ bill_ref: billRef, reason_code: reason, ...(note.trim() === '' ? {} : { note: note.trim() }) });
    setBusy(false);
    if (!answer.ok) {
      setError(errorText(answer.error, currency));
      return;
    }
    const r: SheetResult = answer.data;
    if ('pending' in r) {
      setLocal({ alert_id: r.pending.alert_id, line: `${t('billing.sc.title')} · ${reasons.find((x) => x.code === reason)?.label ?? ''}`, seq: bill.as_of_seq, done: false });
      onDone('pending');
      return;
    }
    if ('changed' in r && !r.changed) {
      onDone('unchanged');
      return;
    }
    shell.toasts.show({ text: t('billing.sc.removed'), tone: 'ok' });
    onDone('removed');
  };
  const withdraw = async () => {
    if (waiting === null || busy) return;
    setBusy(true);
    const answer = await api.withdrawRequest(waiting.alert_id);
    setBusy(false);
    if (!answer.ok && !(answer.error.kind === 'api' && answer.error.code === 'REQUEST_NOT_PENDING')) {
      setError(errorText(answer.error, currency));
      return;
    }
    setLocal({ ...waiting, seq: bill.as_of_seq, done: true });
    onDone('withdrawn');
  };

  return (
    <Frame bill={bill} title={t('billing.sc.title')} onClose={onClose}>
      {waiting !== null ? (
        <>
          <Waiting line={waiting.line} what={null} busy={busy} onWithdraw={() => void withdraw()} onBack={onClose} />
          {error !== null && <Msg text={error} />}
        </>
      ) : (
        <>
          <div className="facts">
            <div className="fact">
              <span>{t('billing.sc.label_plain')}</span>
              <b>
                {rateText(bill.service_charge.rate_bp)} · <span className="num">{billMoney(bill.totals_default.service_charge_minor, currency)}</span>
              </b>
            </div>
            <div className="fact">
              <span>{t('billing.sc.totals_after')}</span>
              <b>{t('billing.sc.from_hub')}</b>
            </div>
          </div>
          <Chips reasons={reasons} picked={reason} onPick={setReason} cols="c2" />
          <Note value={note} onChange={setNote} />
          <div className="b5-what">
            <Ico name="info" />
            <span>{t('billing.sc.stays')}</span>
          </div>
          {error !== null && <Msg text={error} />}
          <div className="acts">
            <button type="button" className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <Primary step={step} action={t('billing.sc.title')} ask={ask} busy={busy} onClick={() => void send()} />
          </div>
        </>
      )}
    </Frame>
  );
}

/**
 * The service charge row of the totals (B8): "Service charge 5 %" + Remove (allowed or requires_approval: the sheet
 * asks), or "Service charge removed" + Add back (`allowed` only, §6.8) with an inline confirm → `ApplyServiceCharge`.
 * No row while the bill has no charge (rate 0, R-61). Never re-added by anything else.
 */
export function ServiceChargeRow({
  bill,
  billRef,
  onRemove,
  onChanged,
  amountMinor,
  readOnly,
}: {
  bill: BillView;
  billRef: BillRef;
  onRemove: () => void;
  onChanged: () => void;
  /** the amount shown (E-1: the bill screen's split column passes its split's own); default the whole bill's */
  amountMinor?: number;
  /** E-1 review: no Remove / Add back (offline — "Needs the hub", §8 — or a closed split, frozen, B15) */
  readOnly?: boolean;
}) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const { rate_bp, removed } = bill.service_charge;
  if (rate_bp === 0) return null;
  // B8 / §6.8: OPEN or PARTLY_PAID (a projected bill is opened by the command); a closed bill is read-only
  const editable = bill.state !== 'closed' && readOnly !== true;
  const canRemove = editable && (shell.permissions.allowed('remove-service-charge') || shell.permissions.requiresApproval('remove-service-charge'));
  const canAdd = editable && shell.permissions.allowed('remove-service-charge');
  const rate = rateText(rate_bp);
  const shownRemoved = removed && !(readOnly === true && (amountMinor ?? 0) > 0);
  const addBack = async () => {
    if (busy) return;
    setBusy(true);
    const answer = await api.applyServiceCharge({ bill_ref: billRef });
    setBusy(false);
    setConfirm(false);
    if (!answer.ok) {
      shell.toasts.show({ text: errorText(answer.error, bill.currency.code), tone: 'warn' });
      return;
    }
    onChanged();
  };
  return (
    <>
      {/* a closed split keeps the charge it closed with (B15): its own figure, whatever the open remainder's state */}
      <div className={shownRemoved ? 'b5-tr gone' : 'b5-tr'}>
        <span>
          {shownRemoved ? t('billing.sc.removed') : fill(t('billing.sc.label'), { rate })}
          {!removed && canRemove && (
            <button type="button" className="btn" onClick={onRemove}>
              {t('billing.sc.remove')}
            </button>
          )}
          {removed && canAdd && !confirm && (
            <button type="button" className="btn" onClick={() => setConfirm(true)}>
              {t('billing.sc.add_back')}
            </button>
          )}
        </span>
        <span className="v sp" dir={MONEY_DIR}>
          {amountText(amountMinor ?? bill.totals_default.service_charge_minor, bill.currency.code)}
        </span>
      </div>
      {confirm && (
        <div className="b5-confirm" role="group">
          <span>{fill(t('billing.sc.confirm'), { rate })}</span>
          <button type="button" className="btn" onClick={() => setConfirm(false)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" aria-disabled={busy} onClick={() => void addBack()}>
            {t('billing.sc.add_back')}
          </button>
        </div>
      )}
    </>
  );
}

/** A buyer ID type of the jurisdiction (snapshot `billing.jurisdiction.rules[].buyer_id.accepted_types`, J-4). */
export interface BuyerIdType {
  type: string;
  label: string;
  pattern: string;
  strip: string;
}

/** What the buyer sheet hands the close (§6.12 `buyer`). Held in memory for that one close only (B19). */
export interface BuyerEntry {
  name: string;
  tax_id: { type: string; value: string };
}

/**
 * The accepted buyer ID types. The hub checks the rule in force on the **bill's business date** (`ruleInForce`), which
 * the client does not hold, so `hub` — the type codes the hub itself lists (the `buyer_id_required` block's or the
 * `BUYER_ID_REQUIRED` refusal's `details.accepted_types`) — picks them, in the hub's order, each with its definition
 * from the latest rule that has it (on or before `date`, else any). Without `hub`: the rule in force on `date` (the
 * latest `effective_from` ≤ date). None with no `billing` key (the hub's built-in defaults have no buyer rule).
 */
export function acceptedBuyerTypes(snapshot: unknown, date: string, hub: readonly string[] | null = null): BuyerIdType[] {
  const rules = (snapshot as { billing?: { jurisdiction?: { rules?: Array<{ effective_from: string; buyer_id?: { accepted_types?: BuyerIdType[] } }> } } } | null)?.billing?.jurisdiction?.rules ?? [];
  const latestFirst = [...rules].sort((a, b) => (a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1 : 0));
  if (hub !== null) {
    const ordered = [...latestFirst.filter((r) => r.effective_from <= date), ...latestFirst.filter((r) => r.effective_from > date)];
    return hub.flatMap((code) => {
      for (const r of ordered) {
        const t = r.buyer_id?.accepted_types?.find((x) => x.type === code);
        if (t !== undefined) return [t];
      }
      return [];
    });
  }
  return latestFirst.find((r) => r.effective_from <= date)?.buyer_id?.accepted_types ?? [];
}

/** The hub's accepted type codes for this bill (the `buyer_id_required` block's `details.accepted_types`), or null. */
function hubBuyerTypes(bill: BillView): string[] | null {
  const list = bill.blocks.find((b) => b.reason === 'buyer_id_required')?.details['accepted_types'];
  return Array.isArray(list) && list.every((x) => typeof x === 'string') ? (list as string[]) : null;
}

/** The typed value checked as the hub will (strip that type's characters, then its pattern); a bad pattern fails, as the hub's. */
function buyerValueOk(t: BuyerIdType, value: string): boolean {
  const stripped = [...t.strip].reduce((v, ch) => v.split(ch).join(''), value.trim());
  if (stripped.length < 1 || stripped.length > 40) return false;
  try {
    return new RegExp(t.pattern).test(stripped);
  } catch {
    return false;
  }
}

export type BuyerOutcome = 'waived' | 'not_required' | 'pending' | 'withdrawn';

/**
 * 05-D04 Buyer details (§8, §6.12, B19; frames Buyer, BuyerWaiveWaiting, BuyerUrdu): name, an ID type from the
 * jurisdiction, the ID number. **Use for this close** hands it to the close (`onUse`) and clears the field — the ID is
 * never stored (no storage, no log, the browser told not to remember it) and never shown again. **Customer refuses**
 * (`close-without-buyer-id`, approvable) sends `WaiveBuyerId`. `error` reopens it after a close refused the buyer.
 */
export function BuyerSheet({
  bill,
  error,
  accepted = null,
  onUse,
  onWaived,
  onClose,
}: {
  bill: BillView;
  /** the close's refusal on the buyer: `payload.buyer.tax_id.value` → 'value', `.type` → 'type', `.name` → 'name' */
  error: BuyerIssue | null;
  /** the type codes of a `BUYER_ID_REQUIRED` refusal's `details.accepted_types` (else the bill's block's) */
  accepted?: readonly string[] | null;
  onUse: (buyer: BuyerEntry) => void;
  onWaived: (r: BuyerOutcome) => void;
  onClose: () => void;
}) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const today = new Date(shell.clock.nowMs() + shell.clock.utcOffsetMs).toISOString().slice(0, 10);
  const hub = accepted ?? hubBuyerTypes(bill);
  const types = useSyncExternalStore(shell.config.subscribe, () => buyerTypesOf(shell.config.snapshot(), today, hub));
  const canWaive = shell.permissions.allowed('close-without-buyer-id') || shell.permissions.requiresApproval('close-without-buyer-id');
  const askWaive = shell.permissions.requiresApproval('close-without-buyer-id');
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState<string | null>(error === null ? null : t(ISSUE_TEXT[error]));
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<Pending | null>(null);
  const waiting = waitingOf(bill, 'close_without_buyer_id', local);
  // a waiver approved while the sheet is open: nothing left to ask
  const done = bill.buyer.waived;
  useEffect(() => {
    if (done) onClose();
  }, [done, onClose]);
  const type = types.find((x) => x.type === picked) ?? null;
  const step: MessageKey | null =
    name.trim() === '' || name.trim().length > 60
      ? 'billing.buyer.enter_name'
      : type === null
        ? 'billing.buyer.pick_type'
        : value.trim() === ''
          ? 'billing.buyer.enter_number'
          : !buyerValueOk(type, value)
            ? 'billing.buyer.check_number'
            : null;
  const use = () => {
    if (step !== null || type === null) return;
    const entry: BuyerEntry = { name: name.trim(), tax_id: { type: type.type, value: value.trim() } };
    // B19: the field is cleared at once; the value lives on only in the close that sends it
    setValue('');
    onUse(entry);
  };
  const waive = async () => {
    if (busy || bill.bill_id === null || done) return;
    setBusy(true);
    setMsg(null);
    const answer = await api.waiveBuyerId({ bill_id: bill.bill_id });
    setBusy(false);
    if (!answer.ok) {
      setMsg(errorText(answer.error, bill.currency.code));
      return;
    }
    const r = answer.data;
    if ('pending' in r) {
      setLocal({ alert_id: r.pending.alert_id, line: t('billing.buyer.waiting_line'), seq: bill.as_of_seq, done: false });
      onWaived('pending');
      return;
    }
    onWaived('reason' in r && r.reason === 'not_required' ? 'not_required' : 'waived');
  };
  const withdraw = async () => {
    if (waiting === null || busy) return;
    setBusy(true);
    const answer = await api.withdrawRequest(waiting.alert_id);
    setBusy(false);
    if (!answer.ok && !(answer.error.kind === 'api' && answer.error.code === 'REQUEST_NOT_PENDING')) {
      setMsg(errorText(answer.error, bill.currency.code));
      return;
    }
    setLocal({ ...waiting, seq: bill.as_of_seq, done: true });
    onWaived('withdrawn');
  };
  const sub = bill.buyer.threshold_minor === null ? undefined : fill(t('billing.buyer.sub'), { threshold: billMoney(bill.buyer.threshold_minor, bill.currency.code) });
  if (waiting !== null)
    return (
      <Frame bill={bill} title={t('billing.buyer.title')} onClose={onClose}>
        <Waiting line={waiting.line === '' ? t('billing.buyer.waiting_line') : waiting.line} what={null} busy={busy} onWithdraw={() => void withdraw()} onBack={onClose} />
        {msg !== null && <Msg text={msg} />}
      </Frame>
    );
  return (
    <Frame bill={bill} title={t('billing.buyer.title')} {...(sub === undefined ? {} : { sub })} onClose={onClose}>
      <label className="b5-fld">
        <span>{t('billing.buyer.name')}</span>
        <div className="b5-in text">
          <input autoComplete="off" maxLength={60} value={name} onChange={(e) => setName(e.currentTarget.value)} />
        </div>
      </label>
      <Chips reasons={types.map((x) => ({ code: x.type, label: x.label }))} picked={picked} onPick={setPicked} cols="c2" title={t('billing.buyer.type')} />
      <label className="b5-fld">
        <span>{t('billing.buyer.number')}</span>
        <div className="b5-in text">
          <input autoComplete="off" spellCheck={false} maxLength={40} dir="ltr" value={value} onChange={(e) => setValue(e.currentTarget.value)} />
        </div>
      </label>
      <div className="b5-what">
        <Ico name="lock" />
        <span>{t('billing.buyer.privacy')}</span>
      </div>
      {msg !== null && <Msg text={msg} />}
      <div className="acts">
        {/* §6.11 takes a bill_id and never opens a bill: a bill not opened yet has no refusal to record */}
        {canWaive && bill.bill_id !== null ? (
          <button type="button" className="btn btn--tone c-warn" aria-disabled={busy} onClick={() => void waive()}>
            {t('billing.buyer.refuses')}
            {askWaive && <span className="ntag">{t('billing.sheet.needs')}</span>}
          </button>
        ) : (
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
        )}
        <Primary step={step} action={t('billing.buyer.use')} ask={false} busy={busy} onClick={use} />
      </div>
    </Frame>
  );
}

export type BuyerIssue = 'value' | 'type' | 'name';
const ISSUE_TEXT: Record<BuyerIssue, MessageKey> = { value: 'billing.buyer.check_number', type: 'billing.buyer.pick_type', name: 'billing.buyer.enter_name' };

// the types list, cached by content so the store read is stable between renders
let lastTypesKey = '';
let lastTypes: BuyerIdType[] = [];
function buyerTypesOf(snapshot: unknown, date: string, hub: readonly string[] | null): BuyerIdType[] {
  const list = acceptedBuyerTypes(snapshot, date, hub);
  const key = JSON.stringify(list);
  if (key !== lastTypesKey) {
    lastTypesKey = key;
    lastTypes = list;
  }
  return lastTypes;
}
