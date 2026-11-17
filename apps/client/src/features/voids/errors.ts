import type { HubError } from '../../api/hub-admin';
import type { MessageKey } from '../../i18n';
import { orderErrorKey } from '../staff/orders/view/LineActions';
import { BLOCK_KEY } from './ui';

// 04 §8 Errors, §9 (handoff 04 decision 11): every void refusal is an inline message in the sheet, its text keyed by
// `code` (and `reason`), never the hub's message. `reload` = read void-preview again; `remove` = offer 02b's Remove.

export interface VoidErrorText {
  key: MessageKey;
  hint?: MessageKey;
  tone: 'danger' | 'warn';
  reload: boolean;
  remove: boolean;
}

export function voidErrorText(error: HubError): VoidErrorText {
  if (error.kind !== 'api') return { key: error.kind === 'network' ? 'answer.error.offline' : orderErrorKey(error), tone: 'danger', reload: false, remove: false };
  const d = error.details;
  switch (error.code) {
    case 'VOID_PENDING':
      return { key: 'void.err.VOID_PENDING', tone: 'warn', reload: true, remove: false };
    case 'COMP_PENDING':
      return { key: 'void.err.COMP_PENDING', hint: 'void.err.COMP_PENDING.hint', tone: 'warn', reload: true, remove: false };
    case 'ITEM_WRONG_STAGE':
      return d['stage'] === 'added'
        ? { key: 'void.err.ITEM_WRONG_STAGE', hint: 'void.err.ITEM_WRONG_STAGE.hint', tone: 'danger', reload: false, remove: true }
        : { key: 'line.err.stage', tone: 'danger', reload: true, remove: false };
    case 'ORDER_BILLED':
      return { key: 'void.err.ORDER_BILLED', tone: 'danger', reload: false, remove: false };
    case 'VOID_NOT_ALLOWED': {
      const reason = d['reason'];
      if (reason === 'not_movable_stage' || reason === 'stock_not_tracked' || reason === 'day_closed') return { key: BLOCK_KEY[reason], hint: 'void.err.not_allowed.again', tone: 'danger', reload: true, remove: false };
      break;
    }
    // §3.2 rules 1, 5, 6 (a): units out of range, gml_deal_part_partial, overlaps_entry — the line changed under the sheet
    case 'VALIDATION_FAILED':
      return { key: 'void.err.VALIDATION_FAILED', tone: 'warn', reload: true, remove: false };
    case 'PERMISSION_DENIED':
      if (d['reason'] === 'move_not_granted') return { key: 'void.block.move_not_granted', hint: 'void.err.not_allowed.again', tone: 'danger', reload: true, remove: false };
      break;
  }
  return { key: orderErrorKey(error), tone: 'danger', reload: false, remove: false };
}
