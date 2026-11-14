import { UNDO_DONE_MS } from '@pos/domain';
import type { HubResult } from '../../../api/hub-admin';
import { newUlid } from '../../../app/ulid';
import { t } from '../../../i18n';
import { errorKey, fill } from '../../../i18n/en';
import { timeText } from '../../alerts/labels';
import type { ShellPerson } from '../../staff/shell/hooks';
import type { HandoverResult, PassApi, PassReceiver, PointOrder } from '../contracts';
import type { PassNames } from '../names';
import type { PassStoreImpl } from '../store';

// 03b v1.0.8 §3.5, §6.6–§6.8, §6.11 (P3): the Pass's commands on the staff session (`run-pass`).
// - `retrying(command)`: one command_id per (command, payload) until the hub answers; a lost reply (network, or a 2xx
//   whose body was lost, or `signed_out`) keeps the id, so the next tap of the same thing is replayed by the hub (00 M19) — a Ready, a
//   Handover or a Start / Done never happens twice. Any hub answer for a command on the same target (the line, the
//   order at the point, the station) drops the target's open ids, so Done (lost) → Undo → Done is a new command.
// - `createPassApi`: the contract's PassApi on that.
// - Ready to serve: one in flight per order (a ref-like set, not render state). `{ alert_id }` → this tablet's person
//   is the Ready's name (`claimReady`, Q-55); `already: true` → the existing state shows, nothing claimed. Refusals
//   map to the card's line (brief B13). Undo ready: `409 PASS_UNDO_WINDOW_CLOSED` → toast "Too late to undo".
// - `readyBand`: "Ready · {time} · {name}" (the name part dropped when unknown), the count-up since the Ready, and the
//   Undo time left while `now − at ≤ UNDO_DONE_MS` (display only; the hub decides).

type Command = <T>(type: string, payload: unknown, opts: { commandId?: string }) => Promise<HubResult<T>>;
type Query = <T>(path: string) => Promise<HubResult<T>>;

/** what a command acts on: its line, else its order at a point, else its station (null: no target) */
function targetOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p['order_item_id'] === 'string') return `line:${p['order_item_id']}`;
  if (typeof p['order_id'] === 'string') return `order:${p['order_id']}:${String(p['point_id'] ?? '')}`;
  if (typeof p['station_id'] === 'string') return `station:${p['station_id']}`;
  return null;
}

export function retrying(command: Command, newId: () => string = newUlid): <T>(type: string, payload: unknown) => Promise<HubResult<T>> {
  /** key → [command_id, target] */
  const open = new Map<string, [string, string | null]>();
  return async <T>(type: string, payload: unknown) => {
    const key = `${type} ${JSON.stringify(payload)}`;
    const target = targetOf(payload);
    const commandId = open.get(key)?.[0] ?? newId();
    open.set(key, [commandId, target]);
    const answer = await command<T>(type, payload, { commandId });
    // only a hub answer settles the id: a lost reply or a session that ended (`signed_out`, the next person retaps)
    // keeps it (as 03c reprint.ts, IR-19)
    if (answer.ok || answer.error.kind === 'api') {
      open.delete(key);
      // the hub answered a command on this target: an earlier unanswered one on it is settled or superseded (a Done
      // then an Undo), so its id must not be replayed for a later, deliberate tap (it would return the stored answer)
      if (target !== null) for (const [k, [, tg]] of [...open]) if (tg === target) open.delete(k);
    }
    return answer;
  };
}

export function createPassApi(api: { command: Command; query: Query }, newId?: () => string): PassApi {
  const send = retrying(api.command, newId);
  const q = (path: string, order_id: string) => `/queries/${path}?order_id=${encodeURIComponent(order_id)}`;
  return {
    markReadyToServe: (p) => send('MarkReadyToServe', p),
    undoReadyToServe: (p) => send('UndoReadyToServe', p),
    handover: (p) => send<HandoverResult>('Handover', p),
    passReceivers: (order_id) => api.query<{ receivers: PassReceiver[] }>(q('pass-receivers', order_id)),
    orderTickets: (order_id) => api.query(q('order-tickets', order_id)),
  };
}

export interface CardMessage {
  text: string;
  tone: 'danger' | 'warn' | 'info' | 'mute';
}

/** A refused Pass command → the card's line (brief B13); a lost reply → "No connection to the hub — try again." */
export function passError(answer: Exclude<HubResult<unknown>, { ok: true }>): CardMessage {
  if (answer.error.kind !== 'api') return { text: t('answer.error.offline'), tone: 'danger' };
  switch (answer.error.code) {
    case 'ORDER_NOT_IN_ENGINE':
      return { text: t('pass.gone'), tone: 'danger' };
    case 'ITEM_WRONG_STAGE':
      return { text: t(answer.error.details['stage'] === 'served' ? 'pass.nothing_left' : 'pass.nothing_done'), tone: 'danger' };
    case 'PERMISSION_DENIED':
      // run-pass taken away while the screen is open (03b §3.9, B14)
      return { text: t('pass.read_only'), tone: 'danger' };
    default:
      return { text: t(errorKey(answer.error.code)), tone: 'danger' };
  }
}

export interface ReadyActions {
  markReady(order_id: string, point_id: string): Promise<{ busy?: true; message?: CardMessage }>;
  undoReady(order_id: string, point_id: string): Promise<{ busy?: true; toast?: string; message?: CardMessage }>;
  busy(order_id: string): boolean;
}

export function createReadyActions(deps: { api: PassApi; store: PassStoreImpl; names: PassNames; me: () => ShellPerson | null }): ReadyActions {
  const inFlight = new Set<string>();
  const guarded = async <R>(order_id: string, run: () => Promise<R>): Promise<R | { busy: true }> => {
    if (inFlight.has(order_id)) return { busy: true };
    inFlight.add(order_id);
    try {
      return await run();
    } finally {
      inFlight.delete(order_id);
    }
  };
  return {
    busy: (order_id) => inFlight.has(order_id),
    markReady: (order_id, point_id) =>
      guarded(order_id, async () => {
        const me = deps.me();
        const answer = await deps.api.markReadyToServe({ order_id, point_id });
        if (!answer.ok) return { message: passError(answer) };
        if (answer.data.already !== true && me !== null) {
          deps.names.remember(me.staff_id, me.name);
          deps.store.claimReady(answer.data.alert_id, me.staff_id);
        }
        return {};
      }),
    undoReady: (order_id, point_id) =>
      guarded(order_id, async () => {
        const answer = await deps.api.undoReadyToServe({ order_id, point_id });
        if (answer.ok) return {};
        if (answer.error.kind === 'api' && answer.error.code === 'PASS_UNDO_WINDOW_CLOSED') return { toast: t('pass.undo_closed') };
        return { message: passError(answer) };
      }),
  };
}

/** m:ss of a non-negative duration */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function readyBand(ready: NonNullable<PointOrder['ready']>, nowMs: number, utcOffsetMs: number, names: Pick<PassNames, 'name'>): { text: string; since: string; undoLeft: string | null } {
  const name = names.name(ready.by);
  const time = timeText(ready.at, utcOffsetMs);
  const template = t('pass.ready_at');
  const text = name === null ? fill(template.split(' · {name}')[0]!, { time }) : fill(template, { time, name });
  const age = nowMs - ready.at;
  return { text, since: clockText(age), undoLeft: age <= UNDO_DONE_MS ? clockText(UNDO_DONE_MS - age) : null };
}
