import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { PassApi, PassReceiver, PointLine, PointOrder } from '../contracts';
import { passError, type CardMessage } from './ready';

// 03b v1.0.8 §3.5 Handover, §6.8, §6.11 (P3; frames 03b-D01, 03b-B11). One tap hands over every done line of the order
// at this point that is not handed over yet (no `order_item_ids`: the hub takes at most 40, B4-2, and answers
// `remaining`). The receivers come from `pass-receivers` (table team first). `422 PASS_RECEIVER_INVALID` → the list is
// read again and "{name} can't take this order now — pick someone else".

/** the hub's cap per Handover without a list (AD-12, B4-2) */
export const HANDOVER_MAX = 40;

export function doneToHand(order: PointOrder): PointLine[] {
  return order.lines.filter((l) => l.stage === 'done' && !l.handed_over);
}

/** table team first, then the hub's order */
export function sortReceivers(list: readonly PassReceiver[]): PassReceiver[] {
  return [...list.filter((r) => r.table_team), ...list.filter((r) => !r.table_team)];
}

export interface Handed {
  handover_id: string;
  /** the receiver */
  name: string;
  /** lines this hand-over took (the done lines here, at most 40) */
  n: number;
  /** done lines here still not handed over (the hub's `remaining`) */
  left: number;
}

export type HandOutcome =
  | { kind: 'handed'; handed: Handed }
  | { kind: 'invalid'; message: CardMessage }
  /** `gone`: 409 ORDER_NOT_IN_ENGINE — the sheet closes, the card goes (brief D01) */
  | { kind: 'refused'; message: CardMessage; gone: boolean };

export async function handOver(api: PassApi, order: PointOrder, point_id: string, receiver: PassReceiver): Promise<HandOutcome> {
  const answer = await api.handover({ order_id: order.order_id, point_id, receiver_staff_id: receiver.staff_id });
  // the hub took at most 40 (B4-2): with lines left it took exactly 40, else every done line it had
  const n = answer.ok && answer.data.remaining > 0 ? HANDOVER_MAX : Math.min(doneToHand(order).length, HANDOVER_MAX);
  if (answer.ok) return { kind: 'handed', handed: { handover_id: answer.data.handover_id, name: receiver.name, n, left: answer.data.remaining } };
  if (answer.error.kind === 'api' && answer.error.code === 'PASS_RECEIVER_INVALID')
    return { kind: 'invalid', message: { text: fill(t('pass.receiver_invalid'), { name: receiver.name }), tone: 'danger' } };
  return { kind: 'refused', message: passError(answer), gone: answer.error.kind === 'api' && answer.error.code === 'ORDER_NOT_IN_ENGINE' };
}

/**
 * The card's line after an own hand-over (the caller drops `h` when a newer Handover frame of another tablet or a
 * catch-up came, IR-6): "{n} handed to {name} · {k} left — …" with k = the done lines here not handed over now (live),
 * or, once all is handed, "Handed to {name} · waiting for Served".
 */
export function handedLine(h: Handed, order: PointOrder): CardMessage | null {
  const left = doneToHand(order).length;
  if (h.left > 0 && left > 0) return { text: fill(t('pass.handed_left'), { n: String(h.n), name: h.name, k: String(left) }), tone: 'info' };
  if (order.lines.length > 0 && order.lines.every((l) => l.handed_over)) return { text: fill(t('pass.handed_waiting'), { name: h.name }), tone: 'info' };
  return null;
}
