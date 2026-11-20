import { currencyExponent } from '@pos/domain';
import { defaultBillingSettings } from '@pos/events';
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { HubError } from '../../api/hub-admin';
import { t } from '../../i18n';
import { fill, type MessageKey } from '../../i18n/en';
import { timeText } from '../alerts/labels';
import { Ico, initial } from '../alerts/ui';
import type { RosterPerson } from '../staff/api';
import { useShell } from '../staff/shell/hooks';
import { billingApi } from './api';
import type { ShiftPetty, ShiftView } from './contracts';
import { billingErrorKey } from './errors';
import { billMoney, currencySymbol, MONEY_DIR, parseCount, parseMinor } from './money';
import './styles';

// 05 v1.0.23 §8 "Petty cash" (advance / out / in sheet with categories; open advances with Settle), §3.12, §6.20, B24
// (plan §4.1 task 40, after hub task 22; frames Petty, PettyAdvance, PettyWaiting, PettyAdvances, PettySettle,
// PettyUrdu). Record is approvable: grant `requires_approval`, or `allowed` with the amount over
// `petty_cash_limit_minor`, raises a `petty_cash` request (the waiting card; an approval does not open the drawer by
// itself). Settle is `allowed` only; the hub checks spent + returned = amount (D-17: no client running sum).
// Privacy (B30, H-4): `paid_to` and `note` are free text, kept out of the retry key as the hub's `hashOmit`.

type Kind = 'advance' | 'out' | 'in';
const KINDS: ReadonlyArray<{ kind: Kind; key: MessageKey }> = [
  { kind: 'advance', key: 'billing.petty.kind_advance' },
  { kind: 'out', key: 'billing.petty.kind_out' },
  { kind: 'in', key: 'billing.petty.kind_in' },
];

interface Category {
  category_id: string;
  name: string;
}

function useCurrency() {
  const shell = useShell();
  const code = useSyncExternalStore(shell.config.subscribe, () => (shell.config.snapshot() as { currency_code?: string } | null)?.currency_code ?? 'PKR');
  const exponent = currencyExponent(code) ?? 2;
  return { code, exponent, money: (minor: number) => billMoney(minor, code) };
}

/** The branch's active petty categories (settings), else the built-in defaults; read as one string so the store read is stable. */
function useCategories(code: string, exponent: number): Category[] {
  const shell = useShell();
  const json = useSyncExternalStore(shell.config.subscribe, () => JSON.stringify((shell.config.snapshot() as { billing?: { petty_categories?: unknown } } | null)?.billing?.petty_categories ?? null));
  return useMemo(() => {
    const list = JSON.parse(json) as Array<Category & { is_active: boolean }> | null;
    const source = Array.isArray(list) ? list : defaultBillingSettings({ currency_code: code, currency_exponent: exponent }).petty_categories;
    return source.filter((c) => c.is_active).map((c) => ({ category_id: c.category_id, name: c.name }));
  }, [json, code, exponent]);
}

function useLimit(code: string, exponent: number): number {
  const shell = useShell();
  const v = useSyncExternalStore(shell.config.subscribe, () => {
    const x = (shell.config.snapshot() as { billing?: { petty_cash_limit_minor?: unknown } } | null)?.billing?.petty_cash_limit_minor;
    return typeof x === 'number' ? x : null;
  });
  return v ?? defaultBillingSettings({ currency_code: code, currency_exponent: exponent }).petty_cash_limit_minor;
}

function errText(e: HubError, money: (m: number) => string): string {
  if (e.kind === 'signed_out') return t('billing.shift.signed_out');
  if (e.kind !== 'api') return t('tables.toast.needs_hub');
  if (e.code === 'PETTY_SETTLE_MISMATCH' && typeof e.details['amount_minor'] === 'number') return fill(t('errors.PETTY_SETTLE_MISMATCH'), { amount: money(e.details['amount_minor']) });
  return t(billingErrorKey(e.code, e.details));
}

export function Dlg({ title, sub, wide, onClose, children }: { title: string; sub?: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  const shell = useShell();
  const sheet = shell.portrait || shell.phone;
  return (
    <div className={sheet ? 'scrim scrim--sheet' : 'scrim'}>
      <div className={wide === true ? 'dlg b5-dlg w9' : 'dlg b5-dlg w6'} role="dialog" aria-modal="true" aria-label={title}>
        {sheet && <span className="dlg__grip" aria-hidden="true" />}
        <div className="dlg__h">
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

function Msg({ text, tone = 'c-warn' }: { text: string; tone?: 'c-warn' | 'c-danger' }) {
  return (
    <div className={`msg ${tone}`} role="alert">
      <Ico name="warn" />
      <span>{text}</span>
    </div>
  );
}

function Money({ label, value, onChange, code }: { label: ReactNode; value: string; onChange: (v: string) => void; code: string }) {
  return (
    <label className="b5-fld">
      <span>{label}</span>
      <div className="b5-in">
        <small>{currencySymbol(code)}</small>
        <input inputMode="decimal" dir={MONEY_DIR} autoComplete="off" value={value} onChange={(e) => onChange(e.currentTarget.value)} />
      </div>
    </label>
  );
}

export type PettyOutcome = 'recorded' | 'pending' | 'withdrawn' | 'closed';

/**
 * A request raised here: its entry (the approval's event carries the same entry_id) and the waiting line. Held by the
 * shift screen, not the sheet, so Back never loses it and a second tap reopens the waiting card instead of a new form
 * (a new form would raise a second request a manager could approve too).
 */
export interface Raised {
  entry_id: string;
  alert_id: string;
  line: string;
}

export function PettySheet({
  shift,
  raised,
  onRaised,
  onDone,
  onClose,
}: {
  shift: ShiftView;
  /** the screen's open request of this sheet, if any */
  raised: Raised | null;
  onRaised: (r: Raised | null) => void;
  onDone: (r: PettyOutcome) => void;
  onClose: () => void;
}) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const { code, exponent, money } = useCurrency();
  const categories = useCategories(code, exponent);
  const limit = useLimit(code, exponent);
  const [kind, setKind] = useState<Kind>('out');
  const [text, setText] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [paidTo, setPaidTo] = useState('');
  const [note, setNote] = useState('');
  const [person, setPerson] = useState<string | null>(null);
  const [people, setPeople] = useState<RosterPerson[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Q-12: who takes an advance comes from the sign-in roster, read when Advance is picked
  useEffect(() => {
    if (kind !== 'advance' || people !== null) return;
    void shell.api.roster().then((r) => setPeople(r.ok ? r.data.staff : []));
  }, [kind, people, shell.api]);
  const amount = parseMinor(text, exponent);
  const ask = shell.permissions.requiresApproval('record-petty-cash') || (amount !== null && amount > limit);
  const step: MessageKey | null =
    amount === null
      ? 'billing.petty.enter_amount'
      : category === null
        ? 'billing.petty.pick_category'
        : kind === 'advance' && person === null
          ? 'billing.petty.pick_person'
          : category === 'other' && note.trim() === ''
            ? 'billing.sheet.write_why'
            : null;
  const record = async () => {
    if (step !== null || amount === null || category === null || busy || !shell.online) return;
    setBusy(true);
    setMsg(null);
    const payload = {
      kind,
      amount_minor: amount,
      category_id: category,
      ...(kind === 'out' && paidTo.trim() !== '' ? { paid_to: paidTo.trim() } : {}),
      ...(kind === 'advance' && person !== null ? { advance_staff_id: person } : {}),
      ...(note.trim() === '' ? {} : { note: note.trim() }),
    };
    const answer = await api.recordPettyCash(payload);
    setBusy(false);
    if (!answer.ok) {
      setMsg(errText(answer.error, money));
      return;
    }
    if (answer.data.pending !== undefined) {
      const cat = categories.find((c) => c.category_id === category)?.name ?? '';
      const what = t(KINDS.find((k) => k.kind === kind)!.key);
      onRaised({
        entry_id: answer.data.entry_id,
        alert_id: answer.data.pending.alert_id,
        line: fill(t('billing.petty.waiting_line'), { kind: what, amount: money(amount), category: cat, time: timeText(shell.clock.nowMs(), shell.clock.utcOffsetMs) }),
      });
      onDone('pending');
      return;
    }
    shell.toasts.show({ text: t(shift.is_drawer ? 'billing.petty.recorded_drawer' : 'billing.petty.recorded'), tone: 'ok' });
    onDone('recorded');
  };
  const sub = fill(t(shift.is_drawer ? 'billing.petty.from_drawer' : 'billing.petty.from_shift'), { name: shift.staff_name ?? '' });

  if (raised !== null) {
    // the approval's apply writes the entry on the shift (same entry_id): the screen's next read shows it
    const approved = shift.petty.some((p) => p.entry_id === raised.entry_id);
    return (
      <Dlg title={t('billing.petty.title')} sub={sub} onClose={onClose}>
        {approved ? (
          <div className="b5-what">
            <Ico name="checkc" />
            <span>{t('billing.petty.approved')}</span>
          </div>
        ) : (
          <>
            <div className="b5-wait">
              <Ico name="clock" />
              <div>
                <b>{t('billing.petty.waiting')}</b>
                <span>{raised.line}</span>
              </div>
              <button
                type="button"
                className="btn btn--tone c-info"
                aria-disabled={busy}
                onClick={() => {
                  if (busy) return;
                  setBusy(true);
                  void api.withdrawRequest(raised.alert_id).then((answer) => {
                    setBusy(false);
                    // REQUEST_NOT_PENDING: answered (rejected, approved) or closed obsolete meanwhile — never "withdrawn"
                    const gone = !answer.ok && answer.error.kind === 'api' && answer.error.code === 'REQUEST_NOT_PENDING';
                    if (!answer.ok && !gone) {
                      setMsg(errText(answer.error, money));
                      return;
                    }
                    onRaised(null);
                    onDone(gone ? 'closed' : 'withdrawn');
                  });
                }}
              >
                <Ico name="undo" />
                {t('billing.sheet.withdraw')}
              </button>
            </div>
            <div className="b5-what">
              <Ico name="info" />
              <span>{t('billing.petty.when_approved')}</span>
            </div>
          </>
        )}
        {msg !== null && <Msg text={msg} />}
        <div className="acts one">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {t('billing.petty.back')}
          </button>
        </div>
      </Dlg>
    );
  }

  return (
    <Dlg title={t('billing.petty.title')} sub={sub} wide onClose={onClose}>
      <div className="col b5-stack">
        <div className="b5-seg" role="group" aria-label={t('billing.petty.title')}>
          {KINDS.map((k) => (
            <button key={k.kind} type="button" aria-pressed={kind === k.kind} onClick={() => setKind(k.kind)}>
              {t(k.key)}
            </button>
          ))}
        </div>
        <Money label={t('billing.petty.amount')} value={text} onChange={setText} code={code} />
        {/* the limit only matters to an allowed grant (CHANGES.md petty.limit_ok / limit_over); requires_approval always asks */}
        {!shell.permissions.requiresApproval('record-petty-cash') && (
          <div className={`b5-limit ${amount !== null && amount > limit ? 'c-warn' : 'c-ok'}`}>
            <span>{fill(t(amount !== null && amount > limit ? 'billing.petty.limit_over' : 'billing.petty.limit'), { limit: money(limit) })}</span>
          </div>
        )}
        {kind === 'advance' && (
          <div className="b5-sec">
            <h3>{t('billing.petty.who')}</h3>
            <div className="b5-chips c4">
              {(people ?? []).map((p) => (
                <button key={p.staff_id} type="button" className="b5-chip" aria-pressed={person === p.staff_id} onClick={() => setPerson(p.staff_id)}>
                  <span className="av av--sm">{initial(p.display_name)}</span>
                  {p.display_name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="b5-sec">
          <h3>{t('billing.petty.category')}</h3>
          <div className="b5-chips c4">
            {categories.map((c) => (
              <button key={c.category_id} type="button" className="b5-chip" aria-pressed={category === c.category_id} onClick={() => setCategory(c.category_id)}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
        {kind === 'out' && (
          <label className="b5-fld">
            <span>
              {t('billing.petty.paid_to')}
              <small>{t('billing.petty.paid_to_sub')}</small>
            </span>
            <div className="b5-in text">
              <input autoComplete="off" maxLength={200} value={paidTo} onChange={(e) => setPaidTo(e.currentTarget.value)} />
            </div>
          </label>
        )}
        <div className="b5-sec">
          <h3>{t('billing.sheet.note')}</h3>
          <textarea className="b5-in text b5-note-in" maxLength={200} rows={2} placeholder={t('billing.petty.note_ph')} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
          <span className="b5-count num">{note.length} / 200</span>
        </div>
        {msg !== null && <Msg text={msg} />}
        {!shell.online && msg === null && <Msg text={t('tables.toast.needs_hub')} />}
      </div>
      <div className="acts">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--primary" aria-disabled={step !== null || busy || !shell.online} onClick={() => void record()}>
          {step !== null ? (
            t(step)
          ) : ask ? (
            <>
              {t('billing.sheet.ask')}
              <span className="ntag">{t('billing.sheet.needs')}</span>
            </>
          ) : (
            t('billing.petty.record')
          )}
        </button>
      </div>
    </Dlg>
  );
}

export function SettleSheet({ advance, onDone, onClose }: { advance: ShiftPetty; onDone: () => void; onClose: () => void }) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const { code, exponent, money } = useCurrency();
  const [spent, setSpent] = useState('');
  const [returned, setReturned] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const s = parseCount(spent, exponent);
  const r = parseCount(returned, exponent);
  const step: MessageKey | null = s === null ? 'billing.petty.enter_spent' : r === null ? 'billing.petty.enter_returned' : null;
  const settle = async () => {
    if (step !== null || s === null || r === null || busy || !shell.online) return;
    setBusy(true);
    setMsg(null);
    const answer = await api.settlePettyAdvance({ entry_id: advance.entry_id, spent_minor: s, returned_minor: r });
    setBusy(false);
    if (!answer.ok) {
      setMsg(errText(answer.error, money));
      return;
    }
    shell.toasts.show({ text: t('billing.petty.settled'), tone: 'ok' });
    onDone();
  };
  return (
    <Dlg title={t('billing.petty.settle_title')} onClose={onClose}>
      <div className="col b5-stack">
        <div className="b5-adv">
          <span className="av">{initial(advance.advance_staff_name ?? '?')}</span>
          <span>
            <b>{fill(t('billing.shift.advance'), { name: advance.advance_staff_name ?? '—' })}</b>
            {advance.category_name !== null && <span>{advance.category_name}</span>}
          </span>
          <span className="a">{money(advance.amount_minor)}</span>
        </div>
        <Money label={t('billing.petty.spent')} value={spent} onChange={setSpent} code={code} />
        <Money label={t('billing.petty.returned')} value={returned} onChange={setReturned} code={code} />
        {msg !== null && <Msg text={msg} tone="c-danger" />}
        {!shell.online && msg === null && <Msg text={t('tables.toast.needs_hub')} />}
        <p className="b5-note">{t('billing.petty.returned_note')}</p>
      </div>
      <div className="acts">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--primary" aria-disabled={step !== null || busy || !shell.online} onClick={() => void settle()}>
          {step !== null ? t(step) : t('billing.petty.settle')}
        </button>
      </div>
    </Dlg>
  );
}
