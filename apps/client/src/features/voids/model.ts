import { VOID_REASON_CODES, type VoidDisposition, type VoidReasonCode } from '@pos/domain';
import { t, type MessageKey } from '../../i18n';
import type { SeatingLine } from '../staff/orders/contracts';
import type { VoidItemsPayload, VoidPreview, VoidPreviewTouched } from './contracts';

// 04 §8 Void sheet (handoff CHANGES §1 decisions 3–8): what the sheet shows and sends, as pure functions of the
// void-preview answer (§6.3) and the order's lines. The sheet draws; the hub decides.

/** §6.1: `note` and `disposition_note` ≤ 200. */
export const VOID_NOTE_MAX = 200;

export const REASON_KEY: Record<VoidReasonCode, MessageKey> = {
  customer_changed_mind: 'void.reason.customer_changed_mind',
  wrong_order_taken: 'void.reason.wrong_order_taken',
  too_late: 'void.reason.too_late',
  quality: 'void.reason.quality',
  other: 'void.reason.other',
  walk_out: 'void.reason.walk_out',
};

/** V12: the six reason chips, in the spec's order. */
export const REASON_CHIPS: readonly VoidReasonCode[] = VOID_REASON_CODES;

/** §8: `moved` pre-selected when enabled, else `wastage`. */
export function defaultDisposition(preview: Pick<VoidPreview, 'dispositions'>): VoidDisposition {
  return preview.dispositions.some((d) => d.disposition === 'moved' && d.enabled) ? 'moved' : 'wastage';
}

/** A disposition the sheet may send: listed and enabled. */
export function dispositionEnabled(preview: Pick<VoidPreview, 'dispositions'>, d: VoidDisposition): boolean {
  return preview.dispositions.some((x) => x.disposition === d && x.enabled);
}

/**
 * §3.1 header: a deal line, or an item with no engine line of its own whose touched children include an engine line
 * (the food is on the child). A header gets no disposition of its own ("Parts below").
 */
export function isHeader(id: string, touched: readonly VoidPreviewTouched[], lines: readonly SeatingLine[]): boolean {
  const line = lines.find((l) => l.order_item_id === id);
  if (line === undefined) return false;
  if (line.line_kind === 'deal') return true;
  if (line.line_kind !== 'item' || line.stage !== null) return false;
  const ids = new Set(touched.map((x) => x.order_item_id));
  return lines.some((l) => l.parent_order_item_id === id && ids.has(l.order_item_id) && l.stage !== null);
}

export type Outcome = VoidDisposition | 'released' | 'parts_below';

/** The outcome chip of one touched line under the chosen disposition (`line_dispositions`; null → Released / Parts below). */
export function outcomeOf(preview: VoidPreview, disposition: VoidDisposition, t: VoidPreviewTouched, lines: readonly SeatingLine[]): Outcome {
  const row = preview.dispositions.find((d) => d.disposition === disposition);
  const own = row?.line_dispositions[t.order_item_id] ?? null;
  if (own !== null) return own;
  return isHeader(t.order_item_id, preview.touched, lines) ? 'parts_below' : 'released';
}

/**
 * §8 "a partly movable deal shows 'Cooked parts to stock, the rest released'": the named line is a deal, `moved` is
 * enabled, and at least one of its non-header touched lines would not be moved (§3.5 `moved_partly`).
 */
export function movedPartly(preview: VoidPreview, lines: readonly SeatingLine[]): boolean {
  const named = lines.find((l) => l.order_item_id === preview.order_item_id);
  if (named?.line_kind !== 'deal') return false;
  const moved = preview.dispositions.find((d) => d.disposition === 'moved');
  if (moved === undefined || !moved.enabled) return false;
  return preview.touched.some((t) => !isHeader(t.order_item_id, preview.touched, lines) && moved.line_dispositions[t.order_item_id] !== 'moved');
}

export interface SheetChoice {
  reason: VoidReasonCode | null;
  note: string;
  disposition: VoidDisposition;
  dispositionNote: string;
}

/**
 * Handoff decision 5: the primary button names the missing step and ends as Ask for approval / Void. `blocked` =
 * nothing can be sent (offline, a void already pending, the preview not there).
 */
export type PrimaryStep = 'blocked' | 'comp_waiting' | 'pick_reason' | 'write_why' | 'ask' | 'void';

export function primaryStep(o: { online: boolean; preview: VoidPreview | null; choice: SheetChoice }): PrimaryStep {
  const { preview, choice } = o;
  if (!o.online || preview === null || preview.group !== 'void' || preview.pending !== null) return 'blocked';
  if (preview.needs_approval && preview.comp_pending !== null) return 'comp_waiting';
  if (choice.reason === null) return 'pick_reason';
  if (choice.reason === 'other' && choice.note.trim() === '') return 'write_why';
  if (choice.disposition === 'other' && choice.dispositionNote.trim() === '') return 'write_why';
  return preview.needs_approval ? 'ask' : 'void';
}

export const STEP_KEY: Record<Exclude<PrimaryStep, 'blocked'>, MessageKey> = {
  comp_waiting: 'void.comp_waiting',
  pick_reason: 'comp.pick_reason',
  write_why: 'void.write_why_first',
  ask: 'comp.ask',
  void: 'void.do',
};

/** §6.1 VoidItems payload for one line, or null while the sheet cannot send. */
export function voidPayload(o: { order_id: string; order_item_id: string; units: number | undefined; choice: SheetChoice; part_ids?: readonly string[] }): VoidItemsPayload | null {
  const c = o.choice;
  if (c.reason === null) return null;
  const note = c.note.trim().slice(0, VOID_NOTE_MAX);
  const dnote = c.dispositionNote.trim().slice(0, VOID_NOTE_MAX);
  if (c.reason === 'other' && note === '') return null;
  if (c.disposition === 'other' && dnote === '') return null;
  return {
    order_id: o.order_id,
    reason_code: c.reason,
    // a note typed for Other is not sent once another chip is picked (as 02b's comp)
    note: c.reason === 'other' ? note : null,
    disposition_note: c.disposition === 'other' ? dnote : null,
    // 02b v1.0.21 §8 (STAB-5): n of a grouped row = its first n parts, one unit each
    lines:
      o.part_ids === undefined
        ? [{ order_item_id: o.order_item_id, ...(o.units === undefined ? {} : { units: o.units }), disposition: c.disposition }]
        : o.part_ids.slice(0, o.units ?? o.part_ids.length).map((order_item_id) => ({ order_item_id, units: 1, disposition: c.disposition })),
  };
}

/** §8: g/ml items are voided whole (units fixed 1); piece lines and deal portions get the stepper. */
export function weighedWhole(line: Pick<SeatingLine, 'line_kind' | 'sale_unit'>): boolean {
  return line.line_kind !== 'deal' && line.sale_unit !== 'piece';
}

/** A list as words: "Round 2 and Round 3", "a, b and c" (ur: ، / اور), from keys, never a hardcoded join. */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return items.slice(0, -1).join(t('void_all.list_sep')) + t('void_all.list_and') + items[items.length - 1]!;
}
