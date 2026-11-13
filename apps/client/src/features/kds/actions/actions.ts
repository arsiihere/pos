import { UNDO_DONE_MS } from '@pos/domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HubError, HubResult } from '../../../api/hub-admin';
import { newUlid } from '../../../app/ulid';
import { toKebab, type PageMeta } from '../../staff/api';
import type { KdsApi } from '../contracts';
import type { KdsRow } from '../store';

// 03b v1.0.8 §3.2, §6.1–§6.5, §8, #72 (K3): the station commands on the station session, and the rules that turn a
// row's stage and a command's error into what the cook sees. Station commands are never queued (03b P5): a tap with
// no reply shows nothing (the Reconnecting banner, B06, covers a socket that is down).

export interface StationApiOptions {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  meta: PageMeta;
  deviceId: string;
  deviceToken: string;
  sessionToken: string;
  /** hub clock (S47) for the envelope's occurred_at */
  nowMs: () => number;
  newCommandId?: () => string;
}

/**
 * 00 §6.3 envelope on the station session: actor_id null (commands/route.ts: a station session has no staff).
 * D32 / M47: a tap whose reply was lost (no answer, or a 2xx without a body) is sent again with the **same**
 * command_id, so the hub replays its stored answer instead of acting twice — GiveMeMore is not stage-guarded, a second
 * id would pull a second line. The id is kept per command type + payload until the hub answers (any 2xx with a
 * result, or any error code); the next tap after that gets a new id. (KdsApi in contracts.ts has no command_id
 * parameter, so the api holds it.)
 */
export function createKdsApi(o: StationApiOptions): KdsApi {
  const pending = new Map<string, string>();
  async function command<T>(commandType: string, payload: object): Promise<HubResult<T>> {
    const key = `${commandType} ${JSON.stringify(payload)}`;
    let commandId = pending.get(key);
    if (commandId === undefined) pending.set(key, (commandId = (o.newCommandId ?? newUlid)()));
    const answered = <R,>(r: HubResult<R>): HubResult<R> => {
      if (r.ok || r.error.kind !== 'network') pending.delete(key);
      return r;
    };
    let response: Response;
    try {
      response = await o.fetch(`/commands/${toKebab(commandType)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${o.deviceToken}`, 'X-Session-Token': o.sessionToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command_id: commandId,
          tenant_id: o.meta.tenantId,
          branch_id: o.meta.branchId,
          command_type: commandType,
          payload,
          occurred_at: Math.round(o.nowMs()),
          actor_id: null,
          device_id: o.deviceId,
        }),
      });
    } catch {
      return { ok: false, error: { kind: 'network' } };
    }
    const body: unknown = await response.json().catch(() => null);
    if (response.ok) {
      const data = (body as { data?: { result?: T } } | null)?.data;
      if (data === undefined || data === null || !('result' in data)) return { ok: false, error: { kind: 'network' } };
      return answered({ ok: true, data: data.result as T });
    }
    const err = (body as { error?: { code?: unknown; details?: unknown } } | null)?.error;
    const code = typeof err?.code === 'string' ? err.code : 'INTERNAL_ERROR';
    const details = (typeof err?.details === 'object' && err.details !== null ? err.details : {}) as Record<string, unknown>;
    return answered({ ok: false, error: { kind: 'api', status: response.status, code, details } });
  }
  return {
    startItem: (p) => command('StartItem', p),
    doneItem: (p) => command('DoneItem', p),
    undoDone: (p) => command('UndoDone', p),
    giveMeMore: (p) => command('GiveMeMore', p),
    setLaneState: (p) => command('SetLaneState', p),
  };
}

/** 03b §3.3 completion modes (01a station config); null = not known yet (K4 reads it): Start, then Done */
export type CompletionMode = 'two_tap' | 'single_tap' | 'auto_done' | null;

export type RowButton = 'start' | 'done' | 'undo' | null;

/**
 * The one action a card shows (handoff PROMPT: "Start, then Done, then Undo m:ss"). From-stock lines and single-tap /
 * auto-done stations have Done only; a two-tap station starts first. A Done row inside UNDO_DONE_MS (from its hub
 * done_at) shows Undo.
 */
export function buttonFor(row: KdsRow, mode: CompletionMode, nowMs: number): RowButton {
  if (row.stage === 'done') return row.done_at !== null && nowMs - row.done_at < UNDO_DONE_MS ? 'undo' : null;
  if (row.stage === 'cooking') return 'done';
  if (row.stage !== 'added') return null;
  if (row.detail?.from_stock === true) return 'done';
  return mode === 'single_tap' || mode === 'auto_done' ? 'done' : 'start';
}

/** what is left of the Undo window, ms (≥ 0) */
export function undoLeft(row: KdsRow, nowMs: number): number {
  return row.done_at === null ? 0 : Math.max(0, UNDO_DONE_MS - (nowMs - row.done_at));
}

export type RowMessage =
  | { kind: 'confirm'; elapsed_ms: number; cook_ms: number }
  | { kind: 'start_first' }
  | { kind: 'line'; key: 'kds.gone' | 'kds.handed_over' | 'kds.undo_closed' | 'kds.not_this_station'; tone: 'danger' | 'mute' }
  | { kind: 'changed'; stage: 'served' | 'removed' }
  | { kind: 'code'; code: string };

/**
 * 03b §3.2, brief §3.1.9 table: a refused tap → the row's inline line, or null for nothing. `409 ITEM_WRONG_STAGE
 * { stage: 'done' }` after this screen's own Done (the loser of two taps, #72) and `{ stage: 'cooking' }` on Start
 * (another screen started it; the event already moved the row) show nothing; so does a lost reply (B06).
 */
export function messageFor(action: 'start' | 'done' | 'undo', error: HubError): RowMessage | null {
  if (error.kind !== 'api') return null;
  const stage = typeof error.details['stage'] === 'string' ? error.details['stage'] : null;
  switch (error.code) {
    case 'ITEM_DONE_CONFIRM_REQUIRED': {
      const e = error.details['elapsed_ms'];
      const c = error.details['cook_ms'];
      return { kind: 'confirm', elapsed_ms: typeof e === 'number' ? e : 0, cook_ms: typeof c === 'number' ? c : 0 };
    }
    case 'ITEM_UNDO_WINDOW_CLOSED':
      return { kind: 'line', key: 'kds.undo_closed', tone: 'mute' };
    case 'ORDER_NOT_FOUND':
      return { kind: 'line', key: 'kds.gone', tone: 'danger' };
    case 'PERMISSION_DENIED':
      return { kind: 'line', key: 'kds.not_this_station', tone: 'danger' };
    case 'ITEM_WRONG_STAGE':
      if (stage === 'done' && action === 'done') return null;
      if (stage === 'cooking' && action === 'start') return null;
      if (stage === 'added' && action === 'done') return { kind: 'start_first' };
      if (stage === 'handed_over') return { kind: 'line', key: 'kds.handed_over', tone: 'mute' };
      if (stage === 'out_of_engine') return { kind: 'line', key: 'kds.gone', tone: 'danger' };
      if (stage === 'served') return { kind: 'changed', stage: 'served' };
      if (stage === 'removed' || stage === 'voided' || stage === 'returned') return { kind: 'changed', stage: 'removed' };
      return null;
    default:
      return { kind: 'code', code: error.code };
  }
}

// ------------------------------------------------------------------------------------------------ row state (React)

/** an inline line stays this long, then goes (brief §3.1.9: "gone after a few seconds"; B01 goes back after 5 s) */
export const MESSAGE_MS = 5_000;

export interface RowState {
  /** a tap was sent and has no reply yet: that button only shows busy, other rows still work */
  busy: 'start' | 'done' | 'undo' | null;
  msg: RowMessage | null;
}

const IDLE: RowState = { busy: null, msg: null };

export interface ActionTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** the result of a tap that acted on more than the tapped line (a batch load, §3.2) */
export type LoadResult = { kind: 'started' | 'done'; ids: string[] };

export function useKdsActions(api: KdsApi, timers: ActionTimers, onLoad: (r: LoadResult) => void) {
  const [rows, setRows] = useState<ReadonlyMap<string, RowState>>(() => new Map());
  const clears = useRef(new Map<string, unknown>());
  /** rows with a tap in flight: a second tap before the reply sends nothing (a ref, not render state) */
  const inFlight = useRef(new Set<string>());
  const loadRef = useRef(onLoad);
  loadRef.current = onLoad;
  useEffect(
    () => () => {
      for (const h of clears.current.values()) timers.clearTimeout(h);
      clears.current.clear();
    },
    [timers],
  );

  const set = useCallback(
    (id: string, next: Partial<RowState>) => {
      setRows((m) => new Map(m).set(id, { ...(m.get(id) ?? IDLE), ...next }));
      if (next.msg !== undefined && next.msg !== null) {
        const old = clears.current.get(id);
        if (old !== undefined) timers.clearTimeout(old);
        clears.current.set(
          id,
          timers.setTimeout(() => {
            clears.current.delete(id);
            setRows((m) => new Map(m).set(id, { ...(m.get(id) ?? IDLE), msg: null }));
          }, MESSAGE_MS),
        );
      }
    },
    [timers],
  );

  const run = useCallback(
    async (id: string, action: 'start' | 'done' | 'undo', confirm: boolean): Promise<void> => {
      set(id, { busy: action, msg: null });
      if (action === 'start') {
        const r = await api.startItem({ order_item_id: id });
        set(id, { busy: null, msg: r.ok ? null : messageFor('start', r.error) });
        if (r.ok && r.data.started.length > 1) loadRef.current({ kind: 'started', ids: r.data.started });
      } else if (action === 'done') {
        const r = await api.doneItem(confirm ? { order_item_id: id, confirm: true } : { order_item_id: id });
        set(id, { busy: null, msg: r.ok ? null : messageFor('done', r.error) });
        if (r.ok && r.data.done.length > 1) loadRef.current({ kind: 'done', ids: r.data.done });
      } else {
        const r = await api.undoDone({ order_item_id: id });
        set(id, { busy: null, msg: r.ok ? null : messageFor('undo', r.error) });
      }
    },
    [api, set],
  );

  /** one command per row at a time: a second tap before the reply sends nothing (a ref, independent of renders) */
  const tap = useCallback(
    async (row: KdsRow, action: 'start' | 'done' | 'undo', confirm = false) => {
      const id = row.order_item_id;
      if (inFlight.current.has(id)) return;
      inFlight.current.add(id);
      try {
        await run(id, action, confirm);
      } finally {
        inFlight.current.delete(id);
      }
    },
    [run],
  );

  return { stateOf: (id: string): RowState => rows.get(id) ?? IDLE, tap };
}
