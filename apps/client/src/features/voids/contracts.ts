import type { VoidBlock, VoidDisposition, VoidReasonCode } from '@pos/domain';

// 04 §6.1, §6.3, §6.4 (client side): the shapes of VoidItems, void-preview and pending-voids as the hub sends them
// (apps/hub/src/voids/queries/void-preview.ts `VoidPreview`, voids/contracts.ts `PendingVoid`). The enums come from
// @pos/domain (§4.4); the client never imports hub code.

/** §3.5 `lines[].state` / §6.3 `stage`: the stage word of a touched line. */
export type VoidLineState = 'not_started' | 'cooking' | 'cooked' | 'served';

export interface VoidPreviewDisposition {
  disposition: VoidDisposition;
  enabled: boolean;
  block: VoidBlock | null;
  /** per touched line: what this disposition does to it (null = released / a header) */
  line_dispositions: Record<string, VoidDisposition | null>;
}

export interface VoidPreviewTouched {
  order_item_id: string;
  name: string;
  units: number;
  stage: VoidLineState;
  refund_minor: number;
  comp_voided_minor: number;
}

/** §6.3: one preview per id. `group: 'remove'` = still at stage 1 (V1); then the other fields are empty. */
export interface VoidPreview {
  order_item_id: string;
  group: 'remove' | 'void';
  refund_minor: number;
  comp_voided_minor: number;
  touched: VoidPreviewTouched[];
  stage: VoidLineState;
  dispositions: VoidPreviewDisposition[];
  needs_approval: boolean;
  pending: { alert_id: string } | null;
  comp_pending: { alert_id: string } | null;
}

export interface VoidPreviewBody {
  previews: VoidPreview[];
}

/** §6.1 one entry. */
export interface VoidEntryPayload {
  order_item_id: string;
  units?: number;
  disposition: VoidDisposition;
}

/** §6.1 VoidItems payload (not queueable, V15). */
export interface VoidItemsPayload {
  order_id: string;
  reason_code: VoidReasonCode;
  note: string | null;
  disposition_note: string | null;
  lines: VoidEntryPayload[];
}

/** §6.1 result: the direct path (`allowed`) or the approval path (`requires_approval`). */
export type VoidItemsResult =
  | { voided: Array<{ order_item_id: string; units: number; refund_minor: number; comp_voided_minor: number; disposition: VoidDisposition | null }>; cancelled: boolean }
  | { pending: Array<{ order_item_id: string; alert_id: string }> };

/** §6.4 one open void request. */
export interface PendingVoid {
  alert_id: string;
  order_item_id: string;
  units: number;
  touched_ids: string[];
  refund_minor: number;
  comp_voided_minor: number;
  requester_staff_id: string;
  raised_at: number;
  /** a stored `moved` line is no longer cooking / done (OQ-D): an approve would be refused */
  blocked: 'not_movable_stage' | null;
}

export interface PendingVoidsBody {
  orders: Array<{ order_id: string; voids: PendingVoid[] }>;
}
