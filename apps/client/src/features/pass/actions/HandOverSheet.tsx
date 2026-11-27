import { useEffect, useRef, useState } from 'react';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import { identifierText } from '../../kds/station/Identifier';
import type { PassApi, PassReceiver, PointOrder } from '../contracts';
import { groupLines } from '../cards/parts';
import { doneToHand, handOver, sortReceivers, type Handed } from './handover';
import { passError, type CardMessage } from './ready';

// 03b v1.0.8 §3.5, §6.11 (P3; frames 03b-D01 PassHandOver, PassHandOverInvalid, PassHandOverNobody, PassHandOverUrdu):
// "Who is taking it?" — the identifier, what goes (the done lines here), the receiver tiles (96 px, table team first
// with "{table} team"), no line picker, Cancel. The list is read when the sheet opens and again after
// PASS_RECEIVER_INVALID (Q-54: no timer). One tap = Handover; one at a time (ref guard). Handed → `onHanded` and the
// sheet closes (the result is handed to the page even when the sheet was closed first); ORDER_NOT_IN_ENGINE closes it
// with the card's line; another refusal or a lost reply stays in the sheet as a line (a retap re-sends the same id).

export interface HandOverSheetProps {
  order: PointOrder;
  /** ⚠️ 03b v1.0.17 §3.4 ("Pass bag = token"): every order of the token's card, root first; one Handover per order
   * with done lines, one tap. Default: the order alone. */
  orders?: readonly PointOrder[];
  pointId: string;
  api: PassApi;
  up: boolean;
  onClose(): void;
  /** each order's hand-over result, also when the sheet was closed before the reply (Q-55 claim, toast, card line) */
  onHanded(handed: Handed, order_id: string): void;
  /** a refusal that closes the sheet (the order left the kitchen): the card's line */
  onGone(message: CardMessage): void;
}

export function HandOverSheet({ order, orders = [order], pointId, api, up, onClose, onHanded, onGone }: HandOverSheetProps) {
  const [receivers, setReceivers] = useState<PassReceiver[] | null>(null);
  const [msg, setMsg] = useState<CardMessage | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const asked = useRef(0);

  const load = async (keep: CardMessage | null) => {
    const mine = (asked.current += 1);
    const answer = await api.passReceivers(order.order_id);
    if (!alive.current || mine !== asked.current) return;
    if (answer.ok) {
      setReceivers(sortReceivers(answer.data.receivers));
      setMsg(keep);
    } else setMsg(passError(answer));
  };

  useEffect(() => {
    alive.current = true;
    void load(null);
    return () => {
      alive.current = false;
    };
    // the list is read once when the sheet opens
  }, [order.order_id]);

  const tap = async (r: PassReceiver) => {
    if (busy.current) return;
    busy.current = true;
    try {
      // ⚠️ v1.0.17: one Handover per order of the bag with done lines; the first refusal stops the rest
      const todo = orders.filter((o) => doneToHand(o).length > 0);
      let last: Awaited<ReturnType<typeof handOver>> | null = null;
      for (const o of todo) {
        const out = await handOver(api, o, pointId, r);
        last = out;
        // the result belongs to the page, not to this sheet: it runs even when the sheet was closed meanwhile
        if (out.kind === 'handed') onHanded(out.handed, o.order_id);
        else break;
      }
      if (last === null) return;
      if (last.kind === 'refused' && last.gone) onGone(last.message);
      if (!alive.current) return;
      if (last.kind === 'handed' || (last.kind === 'refused' && last.gone)) {
        onClose();
      } else if (last.kind === 'invalid') {
        setMsg(last.message);
        await load(last.message);
      } else setMsg(last.message);
    } finally {
      busy.current = false;
    }
  };

  const team = order.identifier.kind === 'table' ? order.identifier.label : identifierText(order.identifier);
  const nobody = receivers !== null && receivers.length === 0;
  return (
    <div className="scrim">
      <div className="dlg dlg--w" role="dialog" aria-modal="true" aria-labelledby="pass-ho-t">
        <div className="dlg__h">
          <span className="tcode j">{identifierText(order.identifier)}</span>
          <div className="dlg__t">
            <h2 id="pass-ho-t">{t('pass.who_takes')}</h2>
            <div className="ac__who">{t('pass.hand_over_sub')}</div>
          </div>
          <button type="button" className="btn btn--icon dlg__x" aria-label={t('common.close')} onClick={onClose}>
            <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="hosum">
          {/* 03b v1.0.11 §3.4 (STAB-5): a split line's done parts as one entry */}
          {groupLines(orders.flatMap((o) => doneToHand(o))).map(({ line: l }) => (
            <span key={l.order_item_id}>
              <span className="q">{l.units} x</span>
              {l.item_name}
            </span>
          ))}
        </div>
        {nobody && msg === null && (
          <div className="msg c-warn" role="alert">
            <span>{t('pass.no_receivers')}</span>
          </div>
        )}
        {msg !== null && (
          <div className={`msg c-${msg.tone}`} role="alert">
            <span>{msg.text}</span>
          </div>
        )}
        {receivers !== null && receivers.length > 0 && (
          <div className="rcvs">
            {receivers.map((r) => (
              <button key={r.staff_id} type="button" className={r.table_team ? 'rcv team' : 'rcv'} disabled={!up} onClick={() => void tap(r)}>
                <span className="av">{r.name.slice(0, 1)}</span>
                <span>
                  <b>{r.name}</b>
                  {r.table_team && <small>{fill(t('pass.table_team'), { table: team })}</small>}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="acts acts--1">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
