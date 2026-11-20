import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { PositiveMinor, SplitNo } from './parts.js';

// 05 §6.5, §6.29 (stream bill), §3.8: the plan of the open splits. Reading (spec gives `{ bill_id, mode, splits }`
// only): `mode` as the command's; each split as the command's entry, with `order_id` on each item line because
// §5 `bill_split_lines` (order_id NOT NULL) is "foldable from events alone" (H2-15); `lines` only for `items`,
// `share_minor` only for `amount`; `equal` / `none` list the open split numbers alone (n = their count).
const SplitLine = z
  .object({ order_item_id: z.string(), order_id: z.string(), units: z.number().int().positive() })
  .strict();

const Split = z
  .object({
    split_no: SplitNo,
    lines: z.array(SplitLine).min(1).nullable(),
    share_minor: PositiveMinor.nullable(),
  })
  .strict();

export const BillSplitsSetPayload = z
  .object({
    bill_id: z.string(),
    mode: z.enum(['items', 'amount', 'equal', 'none']),
    splits: z.array(Split).min(1).max(20),
  })
  .strict()
  .refine(
    (p) =>
      new Set(p.splits.map((s) => s.split_no)).size === p.splits.length &&
      p.splits.every((s) => (s.lines !== null) === (p.mode === 'items') && (s.share_minor !== null) === (p.mode === 'amount')) &&
      (p.mode === 'none' ? p.splits.length === 1 : p.splits.length >= 2),
    { message: 'split numbers distinct; lines for items, share_minor for amount; none = one split, else 2–20' },
  );
export type BillSplitsSetPayload = z.infer<typeof BillSplitsSetPayload>;

export const BillSplitsSet = defineEvent({ eventType: 'BillSplitsSet', version: 1, payload: BillSplitsSetPayload });
