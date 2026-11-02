import type { AlertFamily } from '@pos/domain';
import type { AlertCard, AlertLock, AlertView, RequestOutcome, WsAlertClosed } from '@pos/events';
import { BASE_GAIN, STEP_UP_GAIN, soundFor, type AudioSink } from './sounds';

// 01d §8.1 / §8.3: the client's alert state: inbox rows, banners, the badge count and the sounds. Pure: the
// audio sink and the timers are injected. Fed by the `alert`, `alert_seen`, `alert_closed` frames, the
// `alerts` catch-up part / `alerts_open` (reconnect), and the inbox query.

/** §8.3: the urgent repeat until seen, and the reminder after seen or after the escalation step. */
export const URGENT_REPEAT_MS = 10_000;
export const REMINDER_MS = 120_000;
/** brief B01 (proposed): action and info banners hide into the badge by themselves. */
export const ACTION_BANNER_MS = 6_000;
export const INFO_BANNER_MS = 4_000;

type AlertCloseReason = WsAlertClosed['reason'];
type RequestDecision = NonNullable<WsAlertClosed['decision']>;

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AlertStoreDeps {
  sink: AudioSink;
  timers: Timers;
  /** G1-14d: kiosk, KDS and point tablets: one sound per step, then the badge only */
  alwaysOn: boolean;
}

/** Any row shape the hub sends: a frame view, a catch-up row, an `alerts_open` row (fewer fields), an inbox row. */
export interface IncomingRow {
  alert_id: string;
  kind: string;
  family: AlertFamily;
  step: number;
  escalation?: boolean | undefined;
  set?: AlertView['set'] | undefined;
  for_staff_id?: string | null | undefined;
  lock: AlertLock;
  card?: AlertCard | undefined;
  raised_at: number;
  outcome?: RequestOutcome | null | undefined;
  answers?: AlertView['answers'];
  needs_pin?: AlertView['needs_pin'];
  silent?: boolean | undefined;
  raised_device_id?: string | undefined;
  seen_by_me?: boolean | undefined;
  from_business_day?: string | null | undefined;
  moved_to_name?: string | null | undefined;
  for_staff_name?: string | null | undefined;
  state?: 'open' | 'closed' | undefined;
  close_reason?: AlertCloseReason | null | undefined;
}

export interface AlertRow extends AlertView {
  seen_by_me: boolean;
  /** BF-4: the business date of an alert from an earlier business day, listed without sound */
  from_business_day: string | null;
  moved_to_name: string | null;
  for_staff_name: string | null;
  state: 'open' | 'closed';
  close_reason: AlertCloseReason | null;
  /** from the `alert_closed` frame */
  decision: RequestDecision | null;
  by_name: string | null;
}

export interface AlertSnapshot {
  /** newest first */
  rows: readonly AlertRow[];
  /** newest on top; the UI shows two and collapses the rest (DQ3) */
  banners: readonly AlertRow[];
  /** C02: open rows not seen by me, silent receipts included */
  unseen: number;
}

export interface AlertStore {
  onAlert(view: AlertView): void;
  onSeen(alertId: string): void;
  onClosed(frame: WsAlertClosed): void;
  /** the `alerts` catch-up part or `alerts_open`: the complete open set for this socket */
  onCatchUp(rows: readonly IncomingRow[]): void;
  /** the inbox query (a page): listed without any sound */
  onInbox(rows: readonly IncomingRow[]): void;
  /** tapped: seen here (the caller sends MarkAlertsSeen) */
  open(alertId: string): void;
  snapshot(): AlertSnapshot;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

interface Live {
  repeat: unknown;
  banner: unknown;
  /** G1-14c: the escalation step was reached (one volume step-up, then the 2-min reminder) */
  escalated: boolean;
}

export function createAlertStore(deps: AlertStoreDeps): AlertStore {
  const rows = new Map<string, AlertRow>();
  const live = new Map<string, Live>();
  /** §8.1 m6: the in-memory shown set of `alert_id:step` */
  const shown = new Set<string>();
  let banners: string[] = [];
  const listeners = new Set<() => void>();
  let snap: AlertSnapshot | null = null;

  const liveOf = (id: string): Live => {
    let l = live.get(id);
    if (l === undefined) {
      l = { repeat: null, banner: null, escalated: false };
      live.set(id, l);
    }
    return l;
  };

  function changed(): void {
    snap = null;
    for (const fn of [...listeners]) fn();
  }

  function merge(row: IncomingRow): AlertRow {
    const old = rows.get(row.alert_id);
    const next: AlertRow = {
      alert_id: row.alert_id,
      kind: row.kind,
      family: row.family,
      step: row.step,
      escalation: row.escalation ?? old?.escalation ?? false,
      set: row.set ?? old?.set ?? 'recipient',
      for_staff_id: row.for_staff_id ?? old?.for_staff_id ?? null,
      lock: row.lock,
      raised_at: row.raised_at,
      seen_by_me: row.seen_by_me === true || old?.seen_by_me === true,
      from_business_day: row.from_business_day ?? old?.from_business_day ?? null,
      moved_to_name: row.moved_to_name ?? old?.moved_to_name ?? null,
      for_staff_name: row.for_staff_name ?? old?.for_staff_name ?? null,
      state: row.state ?? old?.state ?? 'open',
      close_reason: row.close_reason ?? old?.close_reason ?? null,
      decision: old?.decision ?? null,
      by_name: old?.by_name ?? null,
    };
    // AD-162/163: a lock-only row (alerts_open, a read-only viewer) never drops the card already held
    const card = row.card ?? old?.card;
    if (card !== undefined) next.card = card;
    const outcome = row.outcome !== undefined ? row.outcome : old?.outcome;
    if (outcome !== undefined) next.outcome = outcome;
    if (row.answers !== undefined) next.answers = row.answers;
    else if (old?.answers !== undefined) next.answers = old.answers;
    if (row.needs_pin !== undefined) next.needs_pin = row.needs_pin;
    else if (old?.needs_pin !== undefined) next.needs_pin = old.needs_pin;
    const silent = row.silent ?? old?.silent;
    if (silent !== undefined) next.silent = silent;
    const raisedDevice = row.raised_device_id ?? old?.raised_device_id;
    if (raisedDevice !== undefined) next.raised_device_id = raisedDevice;
    rows.set(row.alert_id, next);
    return next;
  }

  const isSilent = (row: AlertRow): boolean => row.silent === true;
  const gainOf = (id: string): number => (live.get(id)?.escalated === true ? STEP_UP_GAIN : BASE_GAIN);

  function stopRepeat(id: string): void {
    const l = live.get(id);
    if (l === undefined || l.repeat === null) return;
    deps.timers.clearTimeout(l.repeat);
    l.repeat = null;
  }

  function hideBanner(id: string): void {
    const l = live.get(id);
    if (l !== undefined && l.banner !== null) {
      deps.timers.clearTimeout(l.banner);
      l.banner = null;
    }
    banners = banners.filter((b) => b !== id);
  }

  /** §8.3 urgent: every 10 s until seen and before the escalation step; then every 2 min until closed. */
  function scheduleRepeat(id: string): void {
    stopRepeat(id);
    const row = rows.get(id);
    if (deps.alwaysOn || row === undefined || row.family !== 'urgent' || row.state !== 'open') return;
    if (isSilent(row) || row.from_business_day !== null) return;
    const l = liveOf(id);
    const ms = !row.seen_by_me && !l.escalated ? URGENT_REPEAT_MS : REMINDER_MS;
    l.repeat = deps.timers.setTimeout(() => {
      l.repeat = null;
      const now = rows.get(id);
      if (now === undefined || now.state !== 'open') return;
      deps.sink.play('urgent', gainOf(id));
      scheduleRepeat(id);
    }, ms);
  }

  /** A banner and the family's sound once (a new step, or a re-notify after a reconnect). */
  function notify(row: AlertRow): void {
    const sound = soundFor(row);
    if (sound !== null) deps.sink.play(sound, gainOf(row.alert_id));
    hideBanner(row.alert_id);
    banners = [row.alert_id, ...banners];
    const l = liveOf(row.alert_id);
    const hideAfter = deps.alwaysOn || row.family === 'action' ? ACTION_BANNER_MS : row.family === 'info' ? INFO_BANNER_MS : null;
    if (hideAfter !== null) {
      l.banner = deps.timers.setTimeout(() => {
        l.banner = null;
        banners = banners.filter((b) => b !== row.alert_id);
        changed();
      }, hideAfter);
    }
    scheduleRepeat(row.alert_id);
  }

  function markEscalated(row: IncomingRow): void {
    if (row.escalation === true) liveOf(row.alert_id).escalated = true;
  }

  function seen(id: string): void {
    const row = rows.get(id);
    if (row === undefined) return;
    if (!row.seen_by_me) rows.set(id, { ...row, seen_by_me: true });
    hideBanner(id);
    scheduleRepeat(id);
  }

  function close(id: string, patch: Partial<AlertRow>): void {
    const row = rows.get(id);
    if (row !== undefined) rows.set(id, { ...row, state: 'closed', ...patch });
    stopRepeat(id);
    hideBanner(id);
  }

  return {
    onAlert(view) {
      const old = rows.get(view.alert_id);
      if (old?.state === 'closed') return; // a late frame after the close
      const row = merge(view);
      markEscalated(view);
      const key = `${view.alert_id}:${view.step}`;
      if (!shown.has(key)) {
        shown.add(key);
        if (!isSilent(row)) notify(row); // §8.1: a silent kind is a row and a badge only
      }
      changed();
    },

    onSeen(alertId) {
      seen(alertId);
      changed();
    },

    onClosed(frame) {
      close(frame.alert_id, { close_reason: frame.reason, decision: frame.decision, by_name: frame.by_name });
      changed();
    },

    onCatchUp(incoming) {
      const ids = new Set(incoming.map((r) => r.alert_id));
      // an open alert absent from the complete open set was closed while this socket was away
      for (const row of rows.values()) {
        if (row.state === 'open' && !ids.has(row.alert_id) && row.from_business_day === null) close(row.alert_id, {});
      }
      for (const r of incoming) {
        const before = rows.get(r.alert_id);
        const row = merge({ ...r, state: 'open' });
        markEscalated(r);
        const key = `${r.alert_id}:${r.step}`;
        const fresh = !shown.has(key);
        shown.add(key);
        if (isSilent(row) || row.from_business_day !== null) {
          // §8.1 silent: never re-notified; BF-4: an earlier day's row is listed without sound
          stopRepeat(row.alert_id);
          continue;
        }
        // §8.1 m6: urgent / action, not shown before and not seen by me → re-notified once
        if (fresh && !row.seen_by_me && (row.family === 'urgent' || row.family === 'action')) notify(row);
        else if (row.seen_by_me && before?.seen_by_me !== true) seen(row.alert_id); // seen elsewhere meanwhile
        else if (row.family === 'urgent' && live.get(row.alert_id)?.repeat == null) scheduleRepeat(row.alert_id);
      }
      changed();
    },

    onInbox(incoming) {
      for (const r of incoming) {
        const row = merge(r);
        markEscalated(r);
        shown.add(`${r.alert_id}:${r.step}`);
        if (row.state === 'closed') close(row.alert_id, {});
        else if (row.seen_by_me) hideBanner(row.alert_id);
      }
      changed();
    },

    open(alertId) {
      seen(alertId);
      changed();
    },

    snapshot() {
      if (snap === null) {
        const all = [...rows.values()].sort((a, b) => b.raised_at - a.raised_at);
        snap = Object.freeze({
          rows: Object.freeze(all),
          banners: Object.freeze(banners.map((id) => rows.get(id)).filter((r): r is AlertRow => r !== undefined)),
          unseen: all.filter((r) => r.state === 'open' && !r.seen_by_me).length,
        });
      }
      return snap;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    dispose() {
      for (const id of live.keys()) {
        stopRepeat(id);
        hideBanner(id);
      }
      listeners.clear();
    },
  };
}
