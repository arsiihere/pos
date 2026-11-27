import { useState, useSyncExternalStore } from 'react';
import { t } from '../../../i18n';
import { Ico } from '../../alerts/ui';
import { useShell } from '../../staff/shell/hooks';
import { MONEY_DIR, money } from '../../staff/orders/money';
import { showOrderError } from '../../staff/orders/view/LineActions';
import { statusOf } from '../../staff/orders/unpaid/AskManager';
import { unpaidRequestsOf, type AskState } from '../../staff/orders/unpaid/requests';

// ⚠️ 03b v1.0.17 §3.4, §8 (owner ruling 2026-11-28 "Pass bag = token"; Approval ruling A; QA BUG-9 and design review):
// the card shows ONE Due pill and, beside it, a small "Ask a manager" button (or the requests' state in a word). The
// per-order breakdown lives in this sheet: each unpaid, unapproved order of the token on its own row ("#14 · Rs 40
// (addition)") with its request state (the AskManager words). "Ask a manager" sends one `RequestUnpaidHandover
// { order_id }` per order that has no live request of its own (02b §6.4a), so each request names ONE order and its
// own due — never the token's total. Withdraw withdraws this person's waiting requests.

export interface AskItem {
  order_id: string;
  due_minor: number;
  /** "#14" */
  ident: string;
  /** an addition (not the token's first order) */
  addition: boolean;
}

/** asked (again): no request, a "no", or another person's waiting request (answered by the same id, 02b §3.7a) */
const askable = (s: AskState | null) => s === null || s.kind === 'rejected' || (s.kind === 'waiting' && !s.mine);

/** The card's one word for the bag's requests: the most pressing state of its orders, or null (none asked yet). */
export function askSummary(states: ReadonlyArray<AskState | null>): string | null {
  const mine = states.filter((s): s is Extract<AskState, { kind: 'waiting' }> => s?.kind === 'waiting' && s.mine);
  if (states.some((s) => s?.kind === 'rejected')) return statusOf({ kind: 'rejected', alert_id: '' })!.text;
  if (mine.length > 0) return statusOf(mine.find((s) => s.ask_in_person) ?? mine[0]!)!.text;
  const other = states.find((s) => s?.kind === 'waiting');
  return other == null ? null : statusOf(other)!.text;
}

/** The card's small button: "Ask a manager", or the requests' state; opens the sheet. */
export function AskChip({ items, onOpen }: { items: readonly AskItem[]; onOpen(): void }) {
  const shell = useShell();
  const store = unpaidRequestsOf(shell);
  useSyncExternalStore(store.subscribe, store.version);
  const summary = askSummary(items.map((it) => store.stateOf(it.order_id)));
  return (
    <button type="button" className={summary === null ? 'btn pc__askb' : 'btn pc__askb pc__askb--on'} data-ask={items.map((i) => i.order_id).join(' ')} disabled={summary === null && !shell.online} onClick={onOpen}>
      <Ico name={summary === null ? 'shield' : 'clock'} />
      {summary ?? t('pass.ask_manager')}
    </button>
  );
}

export function AskSheet({ ident, items, onClose, onChanged }: { ident: string; items: readonly AskItem[]; onClose(): void; onChanged?: () => void }) {
  const shell = useShell();
  const store = unpaidRequestsOf(shell);
  useSyncExternalStore(store.subscribe, store.version);
  const [busy, setBusy] = useState(false);
  const states = items.map((it) => ({ it, state: store.stateOf(it.order_id) }));
  const toAsk = states.filter((s) => askable(s.state));
  const mine = states.filter((s) => s.state?.kind === 'waiting' && s.state.mine);
  const ask = async () => {
    if (busy) return;
    setBusy(true);
    let approved = false;
    let notNeeded = false;
    for (const { it } of toAsk) {
      const r = await store.ask(it.order_id, it.due_minor);
      if (r.kind === 'approved') approved = true;
      else if (r.kind === 'not_needed') notNeeded = true;
      else if (r.kind === 'offline') {
        shell.toasts.show({ text: t('unpaid.offline'), tone: 'warn' });
        break;
      } else if (r.kind === 'error') {
        showOrderError(shell, r.error, () => onChanged?.());
        break;
      }
    }
    setBusy(false);
    if (approved) shell.toasts.show({ text: t('unpaid.approved'), tone: 'ok' });
    else if (notNeeded) shell.toasts.show({ text: t('unpaid.not_needed'), tone: 'info' });
    if (approved || notNeeded) onChanged?.();
  };
  const withdraw = async () => {
    if (busy) return;
    setBusy(true);
    for (const { it } of mine) await store.withdraw(it.order_id);
    setBusy(false);
    onChanged?.();
  };
  return (
    <div className="scrim">
      <div className="dlg dlg--w pass-ask" role="dialog" aria-modal="true" aria-labelledby="pass-ask-t">
        <div className="dlg__h">
          <span className="tcode j" dir="ltr">
            {ident}
          </span>
          <div className="dlg__t">
            <h2 id="pass-ask-t">{t('pass.ask_manager')}</h2>
            <div className="ac__who">{t('pass.take_payment_first')}</div>
          </div>
          <button type="button" className="btn btn--icon dlg__x" aria-label={t('common.close')} onClick={onClose}>
            <Ico name="x" />
          </button>
        </div>
        <div className="rdpick">
          {states.map(({ it, state }) => {
            const status = statusOf(state);
            return (
              <div key={it.order_id} className="rdpick__row" data-unpaid={it.order_id}>
                <span className="rdpick__t">
                  <span dir="ltr">{it.ident}</span>
                  {' · '}
                  <span dir={MONEY_DIR}>{money(it.due_minor)}</span>
                  {it.addition && ` ${t('pass.addition_tag')}`}
                </span>
                {status !== null && <span className={state?.kind === 'rejected' ? 'stg c-danger' : 'stg c-warn'}>{status.text}</span>}
              </div>
            );
          })}
        </div>
        <div className="acts">
          {mine.length > 0 ? (
            <button type="button" className="btn" disabled={busy} onClick={() => void withdraw()}>
              <Ico name="undo" />
              {t('unpaid.withdraw')}
            </button>
          ) : (
            <button type="button" className="btn" onClick={onClose}>
              {t('common.close')}
            </button>
          )}
          {toAsk.length > 0 && (
            <button type="button" className="btn btn--primary" data-ask-send disabled={busy || !shell.online} onClick={() => void ask()}>
              <Ico name="shield" />
              {t('pass.ask_manager')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
