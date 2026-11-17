import type { LineDetail } from '@pos/domain';
import type { WsServerMessage } from '@pos/events';

// 03b D12, §8 (phase 0 P0.11): the slots through which 03c (and later modules) add to 03b's screens from their
// own folders. A slot holds data, not markup: 03b's KDS rows / Pass lines render the tags, its KDS rows and Pass
// takeover rows the line actions, its Pass card the card actions, and render nothing when a slot is empty.
// ⚠️ 03b v1.0.8 §8 (owner 2026-11-13, Q-50, W0.5): plus registerLineAction, async run() with an optional toast,
// subscribeFrames (fed by 03b's KDS and Pass live buses through publishFrame) and notifySlots (03b's screens
// re-render through onSlotsChanged). The slot functions stay synchronous and pull-only.

export interface LineTag {
  key: string;
  label: string;
}

/** Every slot action (Pass card and line row). 03b shows the returned toast, e.g. "Reprinting 2 tickets". */
export interface SlotAction {
  key: string;
  label: string;
  run(): Promise<{ toast?: string } | void>;
}

/** The Pass card action keeps its name (D12); its run() is async since v1.0.8. */
export type PassCardAction = SlotAction;

export interface PassCardOrder {
  order_id: string;
  point_id: string;
}

/**
 * Where a line action is asked for: the row's station, whether that station has a printer now
 * (`kds_station.has_printer` on the KDS, the takeover body's on the Pass, kept current by
 * `station_notice { kind: 'output' }`, 03b §3.10), and which surface draws the row.
 */
export interface LineActionCtx {
  station_id: string;
  has_printer: boolean;
  surface: 'kds' | 'takeover';
}

type LineTagFn = (line: LineDetail) => LineTag | null;
type PassCardActionFn = (order: PassCardOrder) => PassCardAction | null;
type LineActionFn = (line: LineDetail, ctx: LineActionCtx) => SlotAction | null;

const tagFns: LineTagFn[] = [];
const actionFns: PassCardActionFn[] = [];
const lineActionFns: LineActionFn[] = [];
const frameListeners: Array<(frame: WsServerMessage) => void> = [];
const changeListeners: Array<() => void> = [];

function add<T>(list: T[], fn: T): () => void {
  list.push(fn);
  return () => {
    const at = list.indexOf(fn);
    if (at >= 0) list.splice(at, 1);
  };
}

/** Calls each slot function in registration order; null and a function that throws are skipped (never a crash). */
function collect<A extends unknown[], R>(fns: ReadonlyArray<(...args: A) => R | null>, ...args: A): R[] {
  const out: R[] = [];
  for (const fn of [...fns]) {
    try {
      const r = fn(...args);
      if (r !== null) out.push(r);
    } catch {
      // a broken slot of another module never breaks 03b's screen; it just shows nothing
    }
  }
  return out;
}

/** KDS rows and Pass lines (03c: the `printed` tag). Returns the unregister function. */
export function registerLineTag(fn: LineTagFn): () => void {
  return add(tagFns, fn);
}

/** Pass card (03c: Reprint where a station has a printer). Returns the unregister function. */
export function registerPassCardAction(fn: PassCardActionFn): () => void {
  return add(actionFns, fn);
}

/** KDS rows and Pass takeover rows (03c: Reprint when `ctx.has_printer`). Returns the unregister function. */
export function registerLineAction(fn: LineActionFn): () => void {
  return add(lineActionFns, fn);
}

/** What a line shows, in registration order; [] when nothing is registered or every slot answers null. */
export function lineTags(line: LineDetail): LineTag[] {
  return collect(tagFns, line);
}

/** What a Pass card offers, in registration order; [] when empty. */
export function passCardActions(order: PassCardOrder): PassCardAction[] {
  return collect(actionFns, order);
}

/** What a KDS row or a Pass takeover row offers, in registration order; [] when empty. */
export function lineActions(line: LineDetail, ctx: LineActionCtx): SlotAction[] {
  return collect(lineActionFns, line, ctx);
}

/**
 * 03b's caller of an action's run(): awaits it and hands back its toast ({} when none). A run() that throws, at
 * once or later, gives a rejected promise; the caller shows its own error.
 */
export async function runSlotAction(action: SlotAction): Promise<{ toast?: string }> {
  const result = await action.run();
  return result ?? {};
}

/** 03c reads catch-up parts and frames (`kds_printed`, `printed_lines`, `station_notice`) here, without a socket. */
export function subscribeFrames(fn: (frame: WsServerMessage) => void): () => void {
  return add(frameListeners, fn);
}

/** 03b plumbing (not called by 03c): the KDS and Pass live buses hand every frame here, in arrival order. */
export function publishFrame(frame: WsServerMessage): void {
  for (const fn of [...frameListeners]) {
    try {
      fn(frame);
    } catch {
      // one subscriber's error never stops the others or the live bus
    }
  }
}

/** A slot's output changed (03c: after a `printed` set or a ticket cache change): 03b's screens re-render. */
export function notifySlots(): void {
  for (const fn of [...changeListeners]) {
    try {
      fn();
    } catch {
      // one screen's error never stops the others or reaches 03c's caller
    }
  }
}

/** 03b plumbing (not called by 03c): a screen re-renders its slot output on each notifySlots(). */
export function onSlotsChanged(fn: () => void): () => void {
  return add(changeListeners, fn);
}
