import { useState, type ReactNode } from 'react';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import { timeText } from '../../alerts/labels';
import { lineActions, lineTags, runSlotAction } from '../slots';
import type { KdsRow } from '../store';
import { Identifier } from './Identifier';
import { LineTimer, timerOf } from './LineTimer';
import { isReturn, MarkTag, ON_TOP, returnWhy } from './MarkTag';
import { Placeholder } from './Placeholder';

// 03b v1.0.8 §3.3, #70, #71, Q-50 (K2; frames 03b-C01–C05, 03b-B04): one Now card = one line, never merged.
// Content: identifier, mark tag (+ the return reason), the slot tags (03c `printed`), "Ready-made" for a from-stock
// line, the timer ring, units x item, "for …" / "(deal)", options, kitchen note, order note, then the actions: the
// stage buttons the caller passes (K3) and the slot line actions with surface 'kds' (03c Reprint, only when the
// station has a printer — the slot decides). A Done row whose Done was undone at an auto_done station carries the
// "Tap Done" cue band (B2-3). While the socket is down every button is disabled (#72).

export interface LineRowProps {
  row: KdsRow;
  nowMs: number;
  utcOffsetMs: number;
  up: boolean;
  compact: boolean;
  stationId: string;
  hasPrinter: boolean;
  /** the stage actions (Start / Done / Undo, K3); rendered before the slot actions */
  actions?: ReactNode;
  /** an inline line under the card (K3 row errors) */
  message?: ReactNode;
  /** K3: changed by a batch tap (`s-hl`) */
  highlight?: boolean;
}

const TICK_ICON = 'M7 9V3.5h10V9';

export function LineRow({ row, nowMs, utcOffsetMs, up, compact, stationId, hasPrinter, actions, message, highlight }: LineRowProps) {
  const [toast, setToast] = useState<{ text: string; tone: 'mute' | 'danger' } | null>(null);
  const d = row.detail;
  if (d === null) return <Placeholder off={!up} compact={compact} />;

  const timer = timerOf(row, d, nowMs);
  const ret = isReturn(row.mark, d);
  const mark = ret ? 'return' : row.mark;
  const classes = ['kl'];
  if (row.stage === 'done') classes.push('s-done');
  else if (timer.kind === 'late') classes.push('s-late');
  else if (row.stage === 'cooking') classes.push('s-cook');
  if (mark !== null && (ON_TOP.has(mark) || mark === 'moved')) classes.push('s-mark');
  const cue = row.done_undone && row.stage !== 'done';
  if (cue) classes.push('s-cue');
  if (!up) classes.push('s-off');
  if (compact) classes.push('kl--c');
  if (highlight === true) classes.push('s-hl');

  const tags = lineTags(d);
  const slotActions = lineActions(d, { station_id: stationId, has_printer: hasPrinter, surface: 'kds' });
  const why = ret ? returnWhy(d) : null;
  const sub = d.for_parent !== null ? fill(t('kds.for_parent'), { item: d.for_parent }) : d.deal_name !== null ? fill(t('kds.deal'), { deal: d.deal_name }) : null;

  return (
    <article className={classes.join(' ')} data-id={row.order_item_id}>
      {cue && (
        <div className="kl__band c-warn" role="status">
          {t('kds.tap_done')}
        </div>
      )}
      <div className="kl__top">
        <div className="kl__id">
          <Identifier id={d.identifier} />
          <div className="kl__tags">
            {mark !== null && <MarkTag mark={mark} {...(mark === 'moved' && row.fired_at !== null ? { extra: fill(t('kds.mark.moved_time'), { time: timeText(row.fired_at, utcOffsetMs) }) } : {})} />}
            {tags.map((tag) => (
              <span key={tag.key} className="ptag">
                <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                  <path d={TICK_ICON} />
                  <rect x="3.5" y="9" width="17" height="8" rx="2" />
                  <path d="M7 14.5h10V21H7z" />
                </svg>
                {tag.label}
              </span>
            ))}
            {d.from_stock && <span className="rmd">{t('kds.ready_made')}</span>}
          </div>
          {why !== null && <span className="kl__why">{why}</span>}
        </div>
        <LineTimer row={row} detail={d} nowMs={nowMs} compact={compact} />
      </div>
      <div className="kl__it">
        <span className="q">{d.units} x</span>
        <bdi>{d.item_name}</bdi>
      </div>
      {sub !== null && <div className="kl__sub">{sub}</div>}
      {d.options.length > 0 && (
        <ul className="kl__opts">
          {d.options.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      )}
      {d.kitchen_note !== null && (
        <div className="kl__note">
          <span>{d.kitchen_note}</span>
        </div>
      )}
      {d.order_note !== null && (
        <div className="kl__on">
          <span>{fill(t('kds.order_note'), { note: d.order_note })}</span>
        </div>
      )}
      {message}
      {toast !== null && <div className={`kl__msg c-${toast.tone}`}>{toast.text}</div>}
      {(actions !== undefined || slotActions.length > 0) && (
        <div className="kl__acts">
          {actions}
          {slotActions.map((a) => (
            <button
              key={a.key}
              type="button"
              className="btn"
              disabled={!up}
              onClick={() =>
                runSlotAction(a).then(
                  (r) => setToast(r.toast === undefined ? null : { text: r.toast, tone: 'mute' }),
                  () => setToast({ text: t('errors.UNKNOWN'), tone: 'danger' }),
                )
              }
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
