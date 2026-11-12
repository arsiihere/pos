import type { LineDetail } from '@pos/domain';

// 03b D12, §8 (phase 0 P0.11): the two slots through which 03c (and later modules) add to 03b's screens from their
// own folders. A slot holds data, not markup: 03b's KDS rows / Pass lines render the tags, its Pass card the actions,
// and render nothing when a slot is empty.

export interface LineTag {
  key: string;
  label: string;
}

export interface PassCardAction {
  key: string;
  label: string;
  run(): void;
}

export interface PassCardOrder {
  order_id: string;
  point_id: string;
}

type LineTagFn = (line: LineDetail) => LineTag | null;
type PassCardActionFn = (order: PassCardOrder) => PassCardAction | null;

const tagFns: LineTagFn[] = [];
const actionFns: PassCardActionFn[] = [];

function add<T>(list: T[], fn: T): () => void {
  list.push(fn);
  return () => {
    const at = list.indexOf(fn);
    if (at >= 0) list.splice(at, 1);
  };
}

/** KDS rows and Pass lines (03c: the `printed` tag). Returns the unregister function. */
export function registerLineTag(fn: LineTagFn): () => void {
  return add(tagFns, fn);
}

/** Pass card (03c: Reprint where a station has a printer). Returns the unregister function. */
export function registerPassCardAction(fn: PassCardActionFn): () => void {
  return add(actionFns, fn);
}

/** What a line shows, in registration order; [] when nothing is registered or every slot answers null. */
export function lineTags(line: LineDetail): LineTag[] {
  return tagFns.map((fn) => fn(line)).filter((tag): tag is LineTag => tag !== null);
}

/** What a Pass card offers, in registration order; [] when empty. */
export function passCardActions(order: PassCardOrder): PassCardAction[] {
  return actionFns.map((fn) => fn(order)).filter((action): action is PassCardAction => action !== null);
}
