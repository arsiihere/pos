import { useRef, useState } from 'react';
import type { BranchConfig } from '@pos/events';
import { navigate } from '../../../../app/router';
import { newUlid } from '../../../../app/ulid';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { timeText } from '../../../alerts/labels';
import { Ico } from '../../../alerts/ui';
import { useShell, type Shell } from '../../shell/hooks';
import { orderHref } from '../../shell/routes';
import type { DraftStore, LineOption, SeatingLine } from '../contracts';
import { definitiveRefusal } from '../../tables/errors';
import { showOrderError, Sheet, type LineOrder } from '../view/LineActions';

// 02b v1.0.11 §3.8, §6.7, §8 Table view E-7 (frames 02b-D32 SendBack, SendBackClosed): send a served dish back —
// Fix or Remake, one tap, no reason (ReturnToKitchen with a device-minted return_order_item_id). After the 30 min
// engine window the hub answers 409 ORDER_NOT_IN_ENGINE: the sheet says the order is closed and offers "Send it as a
// new item" (a new round with the same item, then "Comp it?"); a line already shown "Served · closed" opens there.

/** 26d `startCompItCart` (send/send.ts): the seating's draft gets the item as a comp-it line. */
export type StartCompItCart = (o: {
  drafts: DraftStore;
  config: BranchConfig;
  device_id: string;
  staff_id: string;
  table_id: string;
  seating_id: string;
  item_id: string;
  options?: LineOption[];
  newKey: () => string;
  nowMs: number;
}) => Promise<void>;

/**
 * E-7 "Send it as a new item": the dine-in seating's ordering screen with the item (options by name, Q-7) in the cart.
 * False when it cannot (not dine-in, no item, no config, nobody signed in).
 */
export async function sendAsNewItem(o: {
  shell: Shell;
  start: StartCompItCart;
  drafts: DraftStore;
  order: LineOrder;
  line: SeatingLine;
}): Promise<boolean> {
  const { shell, order, line } = o;
  const config = shell.config.snapshot();
  if (order.order_type !== 'dine_in' || order.seating_id === undefined || order.table_id === undefined) return false;
  if (line.item_id === null || config === null || shell.me === null) return false;
  await o.start({
    drafts: o.drafts,
    config,
    device_id: shell.device.id,
    staff_id: shell.me.staff_id,
    table_id: order.table_id,
    seating_id: order.seating_id,
    item_id: line.item_id,
    ...(line.options === undefined ? {} : { options: line.options }),
    newKey: newUlid,
    nowMs: shell.clock.nowMs(),
  });
  navigate(orderHref('dine_in', order.seating_id));
  return true;
}

export interface SendBackSheetProps {
  line: SeatingLine;
  order: LineOrder;
  /** E-7; absent → no "Send it as a new item" (takeaway / parking, or the caller has no ordering screen) */
  onSendAsNew?: (line: SeatingLine) => void;
  onClose(): void;
  onDone(): void;
  onChanged(): void;
}

export function SendBackSheet({ line, order, onSendAsNew, onClose, onDone, onChanged }: SendBackSheetProps) {
  const shell = useShell();
  const [closed, setClosed] = useState(line.stage === 'out_of_engine');
  const [busy, setBusy] = useState(false);
  /**
   * One submission = one command_id and one return_order_item_id until a 2xx or a definitive refusal: after a lost
   * reply the same command is sent again, so a return the hub already made answers from its stored response (M19).
   */
  const attempt = useRef<{ commandId: string; payload: { order_item_id: string; return_order_item_id: string; mode: 'fix' | 'remake' } } | null>(null);
  const send = async (mode: 'fix' | 'remake') => {
    if (busy) return;
    const a = attempt.current ?? { commandId: newUlid(), payload: { order_item_id: line.order_item_id, return_order_item_id: newUlid(), mode } };
    attempt.current = a;
    setBusy(true);
    const answer = await shell.api.command<{ eta_ms: number; promise_ms: number }>('ReturnToKitchen', a.payload, { commandId: a.commandId });
    setBusy(false);
    if (answer.ok) {
      attempt.current = null;
      shell.toasts.show({ text: fill(t('order.toast.sent_back'), { time: timeText(answer.data.eta_ms, shell.clock.utcOffsetMs) }) });
      onDone();
      return;
    }
    if (definitiveRefusal(answer.error) === null && answer.error.kind !== 'signed_out') {
      shell.toasts.show({ text: t('line.err.lost'), tone: 'warn' });
      return;
    }
    attempt.current = null;
    // E-7: served more than 30 min ago — nothing was appended (03a G4-1 #7)
    if (answer.error.kind === 'api' && answer.error.code === 'ORDER_NOT_IN_ENGINE') {
      setClosed(true);
      return;
    }
    showOrderError(shell, answer.error, onChanged);
  };

  if (closed) {
    return (
      <Sheet
        title={t('return.closed')}
        sub={t('return.closed_sub')}
        ident={order.ident}
        onClose={onClose}
        actions={
          onSendAsNew === undefined ? (
            <button type="button" className="btn" onClick={onClose}>
              {t('common.close')}
            </button>
          ) : (
            <>
              <button type="button" className="btn" onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn btn--primary" onClick={() => onSendAsNew(line)}>
                <Ico name="repeat" />
                {t('return.new_item')}
              </button>
            </>
          )
        }
      >
        {onSendAsNew !== undefined && <p className="dlg__line">{fill(t('return.closed_line'), { item: line.name })}</p>}
      </Sheet>
    );
  }
  return (
    <Sheet
      title={fill(t('return.title'), { item: line.name })}
      sub={t('return.sub')}
      ident={order.ident}
      onClose={onClose}
      actions={
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
      }
    >
      <div className="bchips">
        <button type="button" className="bchip" disabled={busy || (attempt.current !== null && attempt.current.payload.mode !== 'fix')} onClick={() => void send('fix')}>
          <Ico name="undo" />
          <span>{t('return.fix')}</span>
          <small>{t('return.fix_sub')}</small>
        </button>
        <button type="button" className="bchip" disabled={busy || (attempt.current !== null && attempt.current.payload.mode !== 'remake')} onClick={() => void send('remake')}>
          <Ico name="repeat" />
          <span>{t('return.remake')}</span>
          <small>{t('return.remake_sub')}</small>
        </button>
      </div>
    </Sheet>
  );
}
