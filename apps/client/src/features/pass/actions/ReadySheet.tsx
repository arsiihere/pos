import { useState } from 'react';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import { identifierText } from '../../kds/station/Identifier';
import { stageOf } from '../cards/LineRow';
import type { PointLine, PointOrder } from '../contracts';

// 03b v1.0.10 §3.4 (STAB-2): "What is ready?" — the card's pending lines (not handed over, not in the open Ready) with
// their state; done lines start ticked, the others unticked. Ticking an uncooked line shows one warning in the sheet
// (never a second dialog): marking it ready also marks it Done on the KDS. "Ready to serve (n)" sends the ticked ids;
// none ticked → off. Cancel closes and sends nothing.

/** The lines a Ready to serve can still take: not handed over and not already in the open Ready. */
export function pendingLines(order: PointOrder): PointLine[] {
  // an older hub sends no `ready.lines`: then the open Ready holds every line (the v1.0.9 rule)
  if (order.ready !== null && order.ready.lines === undefined) return [];
  const inReady = new Set(order.ready?.lines ?? []);
  return order.lines.filter((l) => !l.handed_over && !inReady.has(l.order_item_id));
}

export interface ReadySheetProps {
  order: PointOrder;
  up: boolean;
  onConfirm(order_item_ids: string[]): void;
  onClose(): void;
}

export function ReadySheet({ order, up, onConfirm, onClose }: ReadySheetProps) {
  const lines = pendingLines(order);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(lines.filter((l) => l.stage === 'done').map((l) => l.order_item_id)));
  const toggle = (id: string) =>
    setTicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const picked = lines.filter((l) => ticked.has(l.order_item_id));
  const uncooked = picked.filter((l) => l.stage !== 'done');
  return (
    <div className="scrim">
      <div className="dlg dlg--w" role="dialog" aria-modal="true" aria-labelledby="pass-rd-t">
        <div className="dlg__h">
          <span className="tcode j">{identifierText(order.identifier)}</span>
          <div className="dlg__t">
            <h2 id="pass-rd-t">{t('pass.ready_pick_title')}</h2>
            <div className="ac__who">{t('pass.ready_pick_sub')}</div>
          </div>
          <button type="button" className="btn btn--icon dlg__x" aria-label={t('common.close')} onClick={onClose}>
            <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="rdpick">
          {lines.map((l) => (
            <label key={l.order_item_id} className="rdpick__row">
              <input type="checkbox" name={l.order_item_id} checked={ticked.has(l.order_item_id)} onChange={() => toggle(l.order_item_id)} />
              <span className="rdpick__t">
                <span className="q">{l.units} x</span>
                {l.item_name}
              </span>
              <span className={l.stage === 'done' ? 'stg c-ok' : l.stage === 'cooking' ? 'stg c-warn' : 'stg c-mute'}>{t(`pass.stage.${stageOf(l)}`)}</span>
            </label>
          ))}
        </div>
        {uncooked.length > 0 && (
          <div className="msg c-warn" role="alert">
            <span>{fill(t('pass.ready_pick_warn'), { items: uncooked.map((l) => l.item_name).join(', ') })}</span>
          </div>
        )}
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--ready" disabled={!up || picked.length === 0} onClick={() => onConfirm(picked.map((l) => l.order_item_id))}>
            {fill(t('pass.ready_pick_confirm'), { n: String(picked.length) })}
          </button>
        </div>
      </div>
    </div>
  );
}
