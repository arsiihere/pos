import { z } from 'zod';
import { PositiveMinor } from '../bill/parts.js';

// 05 §6.20, §6.29, H3-5: a petty-cash entry. `paid_to` and the note are in `bill_texts` under `entry_id`, so the
// event has `has_paid_to` / `has_note` and no `note_id`. Approvable (`petty_cash`): `alert_id` null on the direct path.
export const pettyShape = {
  entry_id: z.string(),
  shift_id: z.string(),
  amount_minor: PositiveMinor,
  category_id: z.string(),
  has_paid_to: z.boolean(),
  advance_staff_id: z.string().nullable(),
  has_note: z.boolean(),
  requester_staff_id: z.string(),
  approver_staff_id: z.string().nullable(),
  alert_id: z.string().nullable(),
};
