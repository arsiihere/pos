import { useState, useSyncExternalStore } from 'react';
import { t } from '../../../../i18n';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import { MONEY_DIR, money } from '../money';
import { showOrderError } from '../view/LineActions';
import { unpaidRequestsOf, type AskState } from './requests';

// 02b-TK L-CLIENT-2 item 4 (02b v1.0.25 §3.7a Ask, §8 OR-7; 03b v1.0.16 §3.4; 01d v1.3.7 To 02b R3-M-3, R3-M-4): the
// "Ask a manager" control of a blocked hand-over, the same in every place (ready tile, token drawer, Mark served sheet,
// Pass card). It names the one order it asks about (the check's newest Due, unapproved order, D2) and its due.
// - no request: "Ask a manager" (greyed offline: the request is not queueable);
// - my pending request: "Waiting for a manager…" · "Waiting — find a manager" (01d R3-M-3) + Withdraw;
// - another person's pending request: "Already waiting for a manager" (no Withdraw); Ask stays (it answers the same id);
// - rejected: "Manager said no" (the card stays grey) + Ask a manager again.
// An approval arrives as the UnpaidHandoverApproved frame (requests.ts); the place's own check then enables Hand over.

export type AskVariant = 'drawer' | 'tile' | 'pass' | 'sheet';

export interface AskManagerProps {
  order_id: string;
  /** the due this place shows for the order (D2: the amount an `approved` answer covers); null = not known */
  due_minor: number | null;
  /** "#48" / "PARKING" when the token has more than one order (the named one), else omitted */
  ident?: string | undefined;
  variant: AskVariant;
  /** the place reads its order / bill facts again */
  onChanged?: (() => void) | undefined;
}

/** The card's text, one string per state (01d v1.3.7 To 02b R3-M-3; 02b §3.7a). Pure. */
export function statusOf(s: AskState | null): { text: string; sub: string | null } | null {
  if (s === null) return null;
  if (s.kind === 'rejected') return { text: t('pass.manager_rejected'), sub: null };
  // mine: "Waiting for a manager…", or only "Waiting — find a manager" once my-requests says ask_in_person (01d
  // request.find_approver, §6.8); another person's request: "Already waiting for a manager" (02b §3.7a)
  if (!s.mine) return { text: t('unpaid.already_waiting'), sub: null };
  return { text: t(s.ask_in_person ? 'request.find_approver' : 'pass.waiting_manager'), sub: null };
}

export function AskManager({ order_id, due_minor, ident, variant, onChanged }: AskManagerProps) {
  const shell = useShell();
  const store = unpaidRequestsOf(shell);
  useSyncExternalStore(store.subscribe, store.version);
  const [busy, setBusy] = useState(false);
  const state = store.stateOf(order_id);
  const status = statusOf(state);
  const changed = () => onChanged?.();
  const ask = async () => {
    if (busy) return;
    setBusy(true);
    const r = await store.ask(order_id, due_minor);
    setBusy(false);
    switch (r.kind) {
      case 'approved':
        shell.toasts.show({ text: t('unpaid.approved'), tone: 'ok' });
        return changed();
      case 'not_needed':
        shell.toasts.show({ text: t('unpaid.not_needed'), tone: 'info' });
        return changed();
      case 'offline':
        return shell.toasts.show({ text: t('unpaid.offline'), tone: 'warn' });
      case 'error':
        return showOrderError(shell, r.error, changed);
      case 'waiting':
        return;
    }
  };
  const withdraw = async () => {
    if (busy) return;
    setBusy(true);
    await store.withdraw(order_id);
    setBusy(false);
    changed();
  };
  const mineWaiting = state?.kind === 'waiting' && state.mine;
  const btn = variant === 'pass' || variant === 'sheet' ? 'btn' : 'tk-btn';
  const askButton = !mineWaiting && (
    <button type="button" className={btn} data-ask={order_id} disabled={busy || !shell.online} onClick={() => void ask()}>
      <Ico name="shield" />
      {t('pass.ask_manager')}
    </button>
  );
  const withdrawButton = mineWaiting && (
    <button type="button" className={btn} disabled={busy} onClick={() => void withdraw()}>
      <Ico name="undo" />
      {t('unpaid.withdraw')}
    </button>
  );
  const what = (ident !== undefined || due_minor !== null) && (
    <small>
      {ident !== undefined && <span dir="ltr">{ident}</span>}
      {ident !== undefined && due_minor !== null && ' · '}
      {due_minor !== null && <span dir={MONEY_DIR}>{money(due_minor)}</span>}
    </small>
  );
  if (variant === 'tile')
    return (
      <span className="tk-rt__ask" data-unpaid={order_id} role="status">
        {status === null ? askButton : <small>{status.text}</small>}
        {status !== null && askButton}
      </span>
    );
  const cls = variant === 'drawer' ? 'tk-msg tk-ask' : variant === 'pass' ? 'pc__msg c-warn pc__ask' : 'wcard c-warn';
  return (
    <div className={cls} data-unpaid={order_id} role="status">
      <Ico name={state?.kind === 'rejected' ? 'x' : state === null ? 'shield' : 'clock'} />
      <span className="col">
        {/* the drawer and the Pass card already say "Take payment first" */}
        {(status !== null || variant === 'sheet') && <b>{status?.text ?? t('v.pay_first')}</b>}
        {status?.sub != null && <small>{status.sub}</small>}
        {what}
      </span>
      {askButton}
      {withdrawButton}
    </div>
  );
}
