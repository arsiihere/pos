import { z } from 'zod';

// 05 §6.29: pieces shared by the 05 event schemas (bill, shift, hub streams). No free text: every text a 05
// command takes lives in the hub-only `bill_texts` (H2-22, H3-5); events carry `has_note` / `note_id` only.

/** `YYYY-MM-DD` (01a business date). */
export const BusinessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** A money amount in minor units (05 §3.5: integers; H16-13 bounds stay at the command). */
export const Minor = z.number().int();
export const NonNegativeMinor = z.number().int().nonnegative();
export const PositiveMinor = z.number().int().positive();
/** Basis points 0–10 000 (§5 `invoice_taxes.rate_bp`). */
export const RateBp = z.number().int().min(0).max(10_000);
/** §5 `bill_splits.split_no` 1–20. */
export const SplitNo = z.number().int().min(1).max(20);
/** 03a §4.2 order types (as `OrderPlaced`). */
export const OrderType = z.enum(['dine_in', 'takeaway', 'delivery', 'parking']);
/** A ULID the command mints for its note (§6.29), or null when there is no note. */
export const NoteId = z.string().nullable();
