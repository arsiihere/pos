import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { t } from '../../../i18n';
import { onSlotsChanged } from '../slots';
import type { KdsRow, KdsView } from '../store';
import { LineRow } from './LineRow';
import { isReturn, ON_TOP } from './MarkTag';
import { nextOf, NextColumn } from './NextColumn';

// 03b v1.0.8 §3.3, §8, #70, Q-50 (K2; frames 03b-S01 Kds, Kds1280, KdsRush, KdsRush1280, KdsEmpty): the station
// view. Now = the store's rows in append order (new lines join at the end, Done leaves after its undo window, nothing
// visible reorders), with mark / return lines (RETURN, BOOST, EXPEDITE) on top in red; a moved line keeps its row.
// Next / Later on the right. 1920: 3 columns, Next 440 px; the 1280 wall tablet: 2 columns of compact cards, Next
// 340 px (`kgrid--1280`, kds-03-additions.css, IR-14). Re-renders on onSlotsChanged (03c's printed tag, Reprint).

/** the 1280 × 800 wall tablet (frames Kds1280, KdsRush1280) */
export const COMPACT_QUERY = '(max-width: 1400px)';

function useCompact(): boolean {
  return useSyncExternalStore(
    (fn) => {
      const list = typeof window.matchMedia === 'function' ? window.matchMedia(COMPACT_QUERY) : null;
      list?.addEventListener('change', fn);
      return () => list?.removeEventListener('change', fn);
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(COMPACT_QUERY).matches : false),
  );
}

/** §3.3: mark / return rows first, each group in append order (a stable partition, no re-sort by time) */
export function nowOrder(rows: readonly KdsRow[]): KdsRow[] {
  const top = (r: KdsRow) => isReturn(r.mark, r.detail) || (r.mark !== null && ON_TOP.has(r.mark));
  return [...rows.filter(top), ...rows.filter((r) => !top(r))];
}

export interface StationViewProps {
  view: KdsView;
  nowMs: number;
  utcOffsetMs: number;
  up: boolean;
  /** the banner row above the grid (Reconnecting, archived) */
  banner?: ReactNode;
  /** K3: Start / Done / Undo of a row */
  actionsFor?: (row: KdsRow) => ReactNode;
  /** K3: an inline row error */
  messageFor?: (row: KdsRow) => ReactNode;
  /** K3: Give me more under Later */
  nextFooter?: ReactNode;
}

export function StationView({ view, nowMs, utcOffsetMs, up, banner, actionsFor, messageFor, nextFooter }: StationViewProps) {
  const compact = useCompact();
  const [, rerender] = useState(0);
  useEffect(() => onSlotsChanged(() => rerender((n) => n + 1)), []);
  const station = view.station;
  const rows = nowOrder(view.rows);
  const empty = rows.length === 0 && nextOf(view.plan).next.length === 0;
  const classes = ['kgrid'];
  if (banner !== undefined && banner !== null && banner !== false) classes.push('kgrid--bar');
  if (compact) classes.push('kgrid--1280');
  return (
    <main className={classes.join(' ')}>
      {banner}
      {empty ? (
        <div className="kfull kfull--panel">
          <span className="ring ring--120 c-ok" aria-hidden="true">
            <svg viewBox="0 0 120 120">
              <circle className="trk" cx={60} cy={60} r={56} strokeWidth={8} />
            </svg>
            <span className="ring__in">
              <svg className="ico" viewBox="0 0 24 24">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
          </span>
          <b>{t('kds.empty')}</b>
          <span>{t('kds.empty_sub')}</span>
        </div>
      ) : (
        <section className="ksec">
          <div className="ksec__h">
            {t('kds.now')}
            <span className="n">{rows.length}</span>
            <span className="end">{t('kds.append_hint')}</span>
          </div>
          <div className="kcards">
            {rows.map((row) => (
              <LineRow
                key={row.order_item_id}
                row={row}
                nowMs={nowMs}
                utcOffsetMs={utcOffsetMs}
                up={up}
                compact={compact}
                stationId={station?.station_id ?? ''}
                hasPrinter={station?.has_printer ?? false}
                {...(actionsFor === undefined ? {} : { actions: actionsFor(row) })}
                {...(messageFor === undefined ? {} : { message: messageFor(row) })}
              />
            ))}
          </div>
        </section>
      )}
      <NextColumn plan={view.plan} details={view.details} nowMs={nowMs} {...(nextFooter === undefined ? {} : { footer: nextFooter })} />
    </main>
  );
}
