import { useState, useSyncExternalStore } from 'react';
import { t } from '../../../i18n';
import { Ico } from '../../alerts/ui';
import { useShell } from '../../staff/shell/hooks';
import { MONEY_DIR, money } from '../../staff/orders/money';
import { showOrderError } from '../../staff/orders/view/LineActions';
import { statusOf } from '../../staff/orders/unpaid/AskManager';
import { unpaidRequestsOf } from '../../staff/orders/unpaid/requests';

// ⚠️ 03b v1.0.17 §3.4 (owner ruling 2026-11-28 "Pass bag = token"; Approval ruling A; QA BUG-9): "Ask a manager" on a
// token's bag with more than one unpaid order. One tap sends one `RequestUnpaidHandover { order_id }` per unpaid,
// unapproved order (02b §6.4a), so each request names ONE order and its own due — never the token's total. The card
// lists each order on its own row ("#14 · Rs 40 (addition)") with its request state (the same words as AskManager:
// "Waiting for a manager…", "Waiting — find a manager", "Already waiting for a manager", "Manager said no"); Withdraw
// withdraws this person's waiting requests. A bag with one unpaid order uses AskManager unchanged.

export interface BagAskItem {
  order_id: string;
  due_minor: number;
  /** "#14" */
  ident: string;
  /** an addition (not the token's first order) */
  addition: boolean;
}

export function BagAsk({ items, onChanged }: { items: readonly BagAskItem[]; onChanged?: () => void }) {
  const shell = useShell();
  const store = unpaidRequestsOf(shell);
  useSyncExternalStore(store.subscribe, store.version);
  const [busy, setBusy] = useState(false);
  const states = items.map((it) => ({ it, state: store.stateOf(it.order_id) }));
  // asked again: no request, or a "no"; another person's waiting request is answered by the same id (02b §3.7a)
  const askable = states.filter((s) => s.state === null || s.state.kind === 'rejected' || (s.state.kind === 'waiting' && !s.state.mine));
  const mine = states.filter((s) => s.state?.kind === 'waiting' && s.state.mine);
  const ask = async () => {
    if (busy) return;
    setBusy(true);
    let approved = false;
    let notNeeded = false;
    for (const { it } of askable) {
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
    <div className="pc__msg c-warn pc__ask pc__ask--bag" role="status">
      <Ico name={mine.length > 0 ? 'clock' : 'shield'} />
      <span className="col">
        {states.map(({ it, state }) => {
          const status = statusOf(state);
          return (
            <small key={it.order_id} data-unpaid={it.order_id}>
              <span dir="ltr">{it.ident}</span>
              {' · '}
              <span dir={MONEY_DIR}>{money(it.due_minor)}</span>
              {it.addition && ` ${t('pass.addition_tag')}`}
              {status !== null && <b>{` — ${status.text}`}</b>}
            </small>
          );
        })}
      </span>
      {askable.length > 0 && (
        <button type="button" className="btn" data-ask={askable.map((s) => s.it.order_id).join(' ')} disabled={busy || !shell.online} onClick={() => void ask()}>
          <Ico name="shield" />
          {t('pass.ask_manager')}
        </button>
      )}
      {mine.length > 0 && (
        <button type="button" className="btn" disabled={busy} onClick={() => void withdraw()}>
          <Ico name="undo" />
          {t('unpaid.withdraw')}
        </button>
      )}
    </div>
  );
}
