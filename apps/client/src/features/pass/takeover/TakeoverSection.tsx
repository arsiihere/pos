import { useEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { KdsApi } from '../../kds/contracts';
import { RowActions } from '../../kds/actions/DoneEarly';
import { GiveMeMore } from '../../kds/actions/GiveMeMore';
import { InlineError } from '../../kds/actions/InlineError';
import { useKdsActions, type ActionTimers } from '../../kds/actions/actions';
import { LaneControl } from '../../kds/header/LaneControl';
import { lineActions, onSlotsChanged, runSlotAction, type SlotAction } from '../../kds/slots';
import { LineRow } from '../../kds/station/LineRow';
import { NextColumn } from '../../kds/station/NextColumn';
import { nowOrder } from '../../kds/station/StationView';
import type { KdsStoreImpl } from '../../kds/store';

// 03b v1.0.8 §3.6, §8 (Q-50; P4; frames 03b-S03 PassTakeover, PassTakeoverUrdu): "{Station} screen offline" above the
// Pass cards — that station's Now rows (K2's LineRow, compact, read only) and its Next column, from the section's KDS
// store (takeover.ts). Its words stay the KDS's English (P1, PROMPT). Under `run-pass`: each row's Start / Done / Undo
// (K3's RowActions / useKdsActions on the staff session), Give me more and the lane control in the header; without it
// the rows only. The row's slot actions (03c Reprint) are asked with surface 'takeover' and the takeover body's
// `has_printer` (kept by `station_notice { kind: 'output' }`); K2's LineRow asks its own with surface 'kds', so it is
// given `hasPrinter={false}` here and this section renders the takeover actions itself. A slot run is one at a time
// per row (ref guard); its toast goes to the page's toast bus. Re-renders on notifySlots.

export interface TakeoverSectionProps {
  store: KdsStoreImpl;
  name: string;
  api: KdsApi;
  canRun: boolean;
  up: boolean;
  nowMs: number;
  utcOffsetMs: number;
  timers: ActionTimers;
  onToast(text: string, tone?: 'ok' | 'warn'): void;
}

export function TakeoverSection({ store, name, api, canRun, up, nowMs, utcOffsetMs, timers, onToast }: TakeoverSectionProps) {
  const view = useSyncExternalStore(store.subscribe, store.snapshot);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onSlotsChanged(rerender), []);
  const actions = useKdsActions(api, timers, () => undefined);
  const running = useRef(new Set<string>());
  const station = view.station;
  if (station === null) return null;
  const title = fill(t('pass.takeover'), { station: name });

  const runSlot = (rowId: string, a: SlotAction) => {
    const key = `${rowId}:${a.key}`;
    if (running.current.has(key)) return;
    running.current.add(key);
    runSlotAction(a).then(
      (r) => {
        running.current.delete(key);
        if (r.toast !== undefined) onToast(r.toast);
      },
      () => {
        running.current.delete(key);
        onToast(t('errors.UNKNOWN'), 'warn');
      },
    );
  };

  return (
    <section className="tko" aria-label={title}>
      <div className="tko__h">
        <span className="ic">
          <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8" />
            <path d="M12 16v4" />
            <path d="M3 3l18 18" />
          </svg>
        </span>
        <div>
          <b>{title}</b>
          <small>{t('pass.takeover_sub')}</small>
        </div>
        {canRun && station.lanes.lane_count > 1 && <LaneControl lanes={station.lanes} stationId={station.station_id} api={api} up={up} />}
        {canRun && <GiveMeMore api={api} stationId={station.station_id} up={up} timers={timers} />}
      </div>
      <div className="tko__b">
        <div className="kcards">
          {nowOrder(view.rows).map((row) => {
            const state = actions.stateOf(row.order_item_id);
            const slot = row.detail === null ? [] : lineActions(row.detail, { station_id: station.station_id, has_printer: station.has_printer, surface: 'takeover' });
            return (
              <LineRow
                key={row.order_item_id}
                row={row}
                nowMs={nowMs}
                utcOffsetMs={utcOffsetMs}
                up={up}
                compact
                stationId={station.station_id}
                hasPrinter={false}
                message={<InlineError msg={state.msg} />}
                actions={
                  canRun || slot.length > 0 ? (
                    <>
                      {canRun && <RowActions row={row} mode={null} nowMs={nowMs} up={up} state={state} onTap={(action, confirm) => void actions.tap(row, action, confirm)} />}
                      {slot.map((a) => (
                        <button key={a.key} type="button" className="btn" disabled={!up} onClick={() => runSlot(row.order_item_id, a)}>
                          {a.label}
                        </button>
                      ))}
                    </>
                  ) : undefined
                }
              />
            );
          })}
        </div>
        <NextColumn plan={view.plan} details={view.details} nowMs={nowMs} />
      </div>
    </section>
  );
}
