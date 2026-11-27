import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { KdsApi } from '../../kds/contracts';
import { RowActions } from '../../kds/actions/DoneEarly';
import { GiveMeMore } from '../../kds/actions/GiveMeMore';
import { InlineError } from '../../kds/actions/InlineError';
import { messageFor, useKdsActions, type ActionTimers, type CompletionMode } from '../../kds/actions/actions';
import type { HubResult } from '../../../api/hub-admin';
import { LaneControl } from '../../kds/header/LaneControl';
import { lineActions, onSlotsChanged, runSlotAction, type SlotAction } from '../../kds/slots';
import { LineRow } from '../../kds/station/LineRow';
import { NextColumn } from '../../kds/station/NextColumn';
import { groupNow, partsOf, roundsOf } from '../../kds/station/parts';
import { nowOrder } from '../../kds/station/StationView';
import type { KdsStoreImpl } from '../../kds/store';

// 03b v1.0.8 §3.6, §8 (Q-50; P4; frames 03b-S03 PassTakeover, PassTakeoverUrdu): "{Station} screen offline" above the
// Pass cards — that station's Now rows (K2's LineRow, compact, read only) and its Next column, from the section's KDS
// store (takeover.ts). Its words stay the KDS's English (P1, PROMPT). Under `run-pass`: each row's Start / Done / Undo
// (K3's RowActions / useKdsActions on the staff session), Give me more and the lane control in the header; without it
// the rows only. The row's slot actions (03c Reprint) are asked with surface 'takeover' and the takeover body's
// `has_printer` (kept by `station_notice { kind: 'output' }`); K2's LineRow asks its own with surface 'kds', so it is
// given `hasPrinter={false}` here and this section renders the takeover actions itself. A slot run is one at a time
// per row (ref guard); its toast goes to the page's toast bus. Re-renders on notifySlots. 03b v1.0.11 §3.6 (STAB-5):
// the rows group a split line's parts as the KDS (§3.3); a grouped row's tap sends one command per part.
// QA BUG-17 (03b §3.6, §3.2): a tap never fails silently. The row's buttons follow the station's completion mode from
// the branch config (a single-tap station shows Done, never a Start the hub refuses); a refusal the KDS row message
// leaves blank (no answer from the hub, a line not fired yet: "earlier rounds first") gets its own line on the row.

export interface TakeoverSectionProps {
  store: KdsStoreImpl;
  name: string;
  api: KdsApi;
  canRun: boolean;
  /** §3.10 (#208 P-7): the point (404 POINT_NOT_FOUND) or this station is archived: the rows stay, the slot actions (Reprint) go */
  archived?: boolean;
  up: boolean;
  nowMs: number;
  utcOffsetMs: number;
  timers: ActionTimers;
  onToast(text: string, tone?: 'ok' | 'warn'): void;
  /** the station's completion mode (branch config); null = not known (Start, then Done) */
  mode?: CompletionMode;
}

type Action = 'start' | 'done' | 'undo';

/** QA BUG-17: the reason of a refusal that the KDS row message (messageFor) leaves blank; null = nothing to say */
export function silentReason(action: Action, r: HubResult<unknown>): 'pass.takeover_no_answer' | 'pass.takeover_not_fired' | null {
  if (r.ok) return null;
  if (r.error.kind === 'network') return 'pass.takeover_no_answer';
  if (r.error.kind !== 'api' || messageFor(action, r.error) !== null) return null;
  // a line the kitchen has not been sent yet (a later round, a held course) cannot start
  if (r.error.code === 'ITEM_WRONG_STAGE' && r.error.details['stage'] === 'added' && action === 'start') return 'pass.takeover_not_fired';
  return null;
}

export function TakeoverSection({ store, name, api, canRun, archived = false, up, nowMs, utcOffsetMs, timers, onToast, mode = null }: TakeoverSectionProps) {
  const view = useSyncExternalStore(store.subscribe, store.snapshot);
  const rounds = roundsOf(view); // ⚠️ 03b v1.0.13 §3.3 (STAB-6): the takeover station's round tags
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onSlotsChanged(rerender), []);
  // QA BUG-17: the reasons messageFor leaves blank, per line id (cleared on the line's next tap, gone after 5 s)
  const [why, setWhy] = useState<ReadonlyMap<string, string>>(new Map());
  const whyRef = useRef({ setWhy, timers });
  whyRef.current = { setWhy, timers };
  const told = useMemo<KdsApi>(() => {
    const note = (action: Action, id: string, r: HubResult<unknown>) => {
      const key = silentReason(action, r);
      const { setWhy: set, timers: tm } = whyRef.current;
      set((m) => {
        const next = new Map(m);
        if (key === null) next.delete(id);
        else next.set(id, t(key));
        return next;
      });
      if (key !== null) tm.setTimeout(() => whyRef.current.setWhy((m) => (m.get(id) === t(key) ? new Map([...m].filter(([k]) => k !== id)) : m)), 5_000);
    };
    return {
      ...api,
      startItem: async (p) => {
        const r = await api.startItem(p);
        note('start', p.order_item_id, r);
        return r;
      },
      doneItem: async (p) => {
        const r = await api.doneItem(p);
        note('done', p.order_item_id, r);
        return r;
      },
      undoDone: async (p) => {
        const r = await api.undoDone(p);
        note('undo', p.order_item_id, r);
        return r;
      },
    };
  }, [api]);
  const actions = useKdsActions(told, timers, () => undefined);
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
          {nowOrder(groupNow(view.rows)).map((row) => {
            const state = actions.stateOf(row.order_item_id);
            const slot = row.detail === null || archived ? [] : lineActions(row.detail, { station_id: station.station_id, has_printer: station.has_printer, surface: 'takeover' });
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
                {...(row.load_id != null && row.stage !== 'done' && rounds.has(row.load_id) ? { round: rounds.get(row.load_id)! } : {})}
                message={
                  <>
                    <InlineError msg={state.msg} />
                    {state.msg === null &&
                      partsOf(row)
                        .map((p) => why.get(p.order_item_id))
                        .filter((w): w is string => w !== undefined)
                        .slice(0, 1)
                        .map((w) => (
                          <div key="why" className="kl__msg c-warn" role="status">
                            {w}
                          </div>
                        ))}
                  </>
                }
                actions={
                  canRun || slot.length > 0 ? (
                    <>
                      {canRun && <RowActions row={row} mode={mode} nowMs={nowMs} up={up} state={state} onTap={(action, confirm) => void actions.tap(row, action, confirm)} />}
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
        <NextColumn plan={view.plan} details={view.details} nowMs={nowMs} rounds={rounds} {...(view.flagged === undefined ? {} : { flagged: view.flagged })} />
      </div>
    </section>
  );
}
