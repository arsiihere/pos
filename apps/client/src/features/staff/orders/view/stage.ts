import { t, type MessageKey } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { timeText } from '../../../alerts/labels';
import type { IconName } from '../../../alerts/ui';
import type { LineView, SeatingLine } from '../contracts';

// 02b v1.0.11 §8 Table view (frame Stages, handoff Q4): a line's stage as an icon + a word + a colour, from the hub's
// `stage` / `fired` (seating-orders, order-view) and the line's own counters. Pure; the screens draw it.

export type StageTone = 'mute' | 'info' | 'warn' | 'ok' | 'danger' | 'brand';

export interface Stage {
  key: MessageKey;
  tone: StageTone;
  icon: IconName;
  /** hub-clock ms for "Served · {time}" */
  at?: number;
}

export interface Badge {
  text: string;
  tone: StageTone;
  icon: IconName;
}

export const isServed = (line: LineView & { stage?: SeatingLine['stage'] }): boolean => line.served_at !== null || line.stage === 'served';
export const isWeightPending = (line: LineView): boolean => line.quantity === null;
export const isReady = (line: SeatingLine): boolean => line.stage === 'done';
const isReturned = (line: SeatingLine): boolean => line.stage === 'returned' || line.returned_units > 0;

/** The stage word of a line, or null where the frame shows none (a deal header, a no-station child, a removed line). */
export function lineStage(line: SeatingLine): Stage | null {
  if (line.line_kind === 'deal') return null;
  if (line.live_units === 0 || line.stage === 'removed' || line.stage === 'voided') return null;
  if (isWeightPending(line)) return { key: 'stage.weight_pending', tone: 'warn', icon: 'warn' };
  if (isReturned(line)) return { key: 'stage.sent_back', tone: 'danger', icon: 'undo' };
  if (line.zone_served) return { key: 'stage.counter_served', tone: 'ok', icon: 'tray' };
  if (isServed(line)) {
    if (line.stage === 'out_of_engine') return { key: 'stage.served_closed', tone: 'mute', icon: 'lock' };
    return { key: 'stage.served', tone: 'mute', icon: 'check', ...(line.served_at === null ? {} : { at: line.served_at }) };
  }
  switch (line.stage) {
    case 'added':
      return line.fired ? { key: 'stage.sent', tone: 'info', icon: 'send' } : { key: 'stage.later', tone: 'mute', icon: 'clock' };
    case 'cooking':
      return { key: 'stage.cooking', tone: 'warn', icon: 'pulse' };
    case 'done':
      return { key: 'stage.ready', tone: 'ok', icon: 'checkc' };
    case 'out_of_engine':
      return { key: 'stage.not_tracked', tone: 'mute', icon: 'info' };
    default:
      // never in the engine: a no-station line; an option child with no station follows its parent
      return line.line_kind === 'option_child' ? null : { key: 'stage.no_kitchen', tone: 'mute', icon: 'info' };
  }
}

export function stageText(stage: Stage, utcOffsetMs: number): string {
  if (stage.key !== 'stage.served') return t(stage.key);
  // "Served" alone when the hub has no time for it
  return stage.at === undefined ? t('orders.served') : fill(t('stage.served'), { time: timeText(stage.at, utcOffsetMs) });
}

/** The line's badges (frame Stages "Line badges"). */
export function lineBadges(line: LineView): Badge[] {
  const out: Badge[] = [];
  if (line.comped_units > 0) out.push({ text: fill(t('stage.badge.comped'), { n: String(line.comped_units) }), tone: 'brand', icon: 'checkc' });
  if (line.live_units === 0 && (line.removed_units > 0 || line.voided_units > 0)) out.push({ text: t('stage.badge.removed'), tone: 'mute', icon: 'x' });
  if (line.return_of !== null) out.push({ text: t('stage.badge.replacement'), tone: 'info', icon: 'repeat' });
  return out;
}

/**
 * 02b §3.7: Mark served takes a fired line, a line of an order out of the engine (O16) or a no-station line; never a
 * deal header (AD-29), a served, removed or returned line. A no-station option child goes with its parent.
 */
export function servable(line: SeatingLine): boolean {
  if (line.line_kind === 'deal' || line.live_units === 0 || isServed(line) || isReturned(line)) return false;
  if (line.stage === 'removed' || line.stage === 'voided') return false;
  if (line.stage === null) return line.line_kind !== 'option_child';
  return line.fired || line.stage === 'out_of_engine';
}

/**
 * 02b §3.5 stage 1, as the hub's RemoveItems checks it (remove-items.ts stageCheck): a line of an order still in the
 * engine whose engine stage is `added` (fired or not), or a line the engine never held (a no-station line: stage
 * null) that is not served yet. A deal header, or an item with option children, only when every live line the
 * remove cascades to passes the same check (§3.4 deal actions). A zone-served line is undone from the table view
 * (zone undo, 27a3), not here.
 */
function lineAtStageOne(line: SeatingLine): boolean {
  if (line.live_units === 0 || line.zone_served) return false;
  if (line.stage === null) return line.served_at === null;
  return line.stage === 'added';
}

export function atStageOne(line: SeatingLine, orderLines: readonly SeatingLine[]): boolean {
  if (line.live_units === 0 || line.zone_served) return false;
  const childKind = line.line_kind === 'deal' ? 'deal_part' : line.line_kind === 'item' ? 'option_child' : null;
  const children = childKind === null ? [] : orderLines.filter((l) => l.parent_order_item_id === line.order_item_id && l.line_kind === childKind && l.live_units > 0);
  if (line.line_kind === 'deal') return children.length > 0 && children.every(lineAtStageOne);
  return lineAtStageOne(line) && children.every(lineAtStageOne);
}

/** 02b §6.16 (AD-39 R3) ready n / m over the order's lines: deal headers left out, ready = served or done. */
export function readyCount(lines: readonly (LineView & { stage?: SeatingLine['stage'] })[]): { n: number; m: number } {
  const counted = lines.filter((l) => l.line_kind !== 'deal' && l.live_units > 0);
  return { n: counted.filter((l) => isServed(l) || l.stage === 'done').length, m: counted.length };
}

/** Q-7: the plain options as one muted line, or null when the hub sends none (H2 not there yet, or no options). */
export function optionsText(line: LineView): string | null {
  const options = line.options ?? [];
  if (options.length === 0) return null;
  return `+ ${options.map((o) => (o.quantity > 1 ? `${o.name} ×${o.quantity}` : o.name)).join(' · ')}`;
}
