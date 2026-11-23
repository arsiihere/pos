import { useState } from 'react';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import { identifierText } from '../../kds/station/Identifier';
import { stageOf } from '../cards/LineRow';
import { groupLines, type PassRow } from '../cards/parts';
import type { PointLine, PointOrder } from '../contracts';

// 03b v1.0.10 §3.4 (STAB-2): "What is ready?" — the card's pending lines (not handed over, not in the open Ready) with
// their state; done lines start ticked, the others unticked. Ticking an uncooked line shows one warning in the sheet
// (never a second dialog): marking it ready also marks it Done on the KDS. "Ready to serve (n)" sends the ticked ids;
// none ticked → off. Cancel closes and sends nothing.
// 03b v1.0.11 §3.4 (STAB-5): a split line's parts in one stage are one row with a count stepper ("2 of 4", 0…n)
// instead of the tick: a done row starts at n, any other at 0; confirm sends that many of the row's part ids (the
// first ones); the confirm button counts units; the warning names a row with a count above 0 that is not done.

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

/** the − / + count of a grouped row (the kit's `.step`), "n of total" in its output */
function Count({ n, total, onChange }: { n: number; total: number; onChange: (n: number) => void }) {
  return (
    <span className="step">
      <button type="button" aria-label={t('cart.less')} disabled={n <= 0} onClick={() => onChange(n - 1)}>
        −
      </button>
      <output className="num">{fill(t('pass.ready_pick_of'), { n: String(n), total: String(total) })}</output>
      <button type="button" aria-label={t('cart.more')} disabled={n >= total} onClick={() => onChange(n + 1)}>
        +
      </button>
    </span>
  );
}

export function ReadySheet({ order, up, onConfirm, onClose }: ReadySheetProps) {
  const rows = groupLines(pendingLines(order));
  const keyOf = (r: PassRow) => r.parts[0]!.order_item_id;
  /** per row (its first part's id): how many of its parts are picked */
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(() => new Map(rows.map((r) => [keyOf(r), r.line.stage === 'done' ? r.parts.length : 0])));
  const countOf = (r: PassRow) => Math.min(counts.get(keyOf(r)) ?? 0, r.parts.length);
  const setCount = (r: PassRow, n: number) => setCounts((m) => new Map(m).set(keyOf(r), n));
  const pickedRows = rows.filter((r) => countOf(r) > 0);
  const picked = pickedRows.flatMap((r) => r.parts.slice(0, countOf(r)));
  const units = picked.reduce((n, l) => n + l.units, 0);
  const uncooked = pickedRows.filter((r) => r.line.stage !== 'done').map((r) => r.line);
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
          {rows.map((r) => {
            const l = r.line;
            const grouped = r.parts.length > 1;
            const Tag = grouped ? 'div' : 'label';
            return (
              <Tag key={l.order_item_id} className="rdpick__row">
                {!grouped && <input type="checkbox" name={l.order_item_id} checked={countOf(r) > 0} onChange={() => setCount(r, countOf(r) > 0 ? 0 : 1)} />}
                <span className="rdpick__t">
                  <span className="q">{l.units} x</span>
                  {l.item_name}
                </span>
                {grouped && <Count n={countOf(r)} total={r.parts.length} onChange={(n) => setCount(r, n)} />}
                <span className={l.stage === 'done' ? 'stg c-ok' : l.stage === 'cooking' ? 'stg c-warn' : 'stg c-mute'}>{t(`pass.stage.${stageOf(l)}`)}</span>
              </Tag>
            );
          })}
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
            {fill(t('pass.ready_pick_confirm'), { n: String(units) })}
          </button>
        </div>
      </div>
    </div>
  );
}
