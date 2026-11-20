import { PAYMENT_CLASSES, type ReportDocInput } from '@pos/domain';
import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { BusinessDate, Minor, NonNegativeMinor, RateBp } from '../bill/parts.js';

// 05 §6.25, §6.26, §6.29 (stream hub, id branch_id), B26, H16-5, G-9: written by 05's day-close appender. `report` is
// `buildReport`'s §6.26 content as 4a's `ReportDocInput` (kind 'z'): staff by id only (names resolved at render from
// `staff_names`), `mode_name` per takings row and `category_name` per petty row embedded so a Z prints without a lookup.
// Reading: the report's shape is 4a's `ReportDocInput` (G-9: "ReportDocInput matches 6.26"), checked by `satisfies`.
const obj = <S extends z.ZodRawShape>(shape: S) => z.object(shape).strict();
const Count = z.number().int().nonnegative();
const ByReason = z.array(obj({ reason_code: z.string(), count: Count, value_minor: Minor }));

export const ZReportSchema = obj({
  kind: z.literal('z'),
  z_no: z.number().int().positive(),
  business_date: BusinessDate,
  issued_at: z.number().int(),
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  sales: obj({
    invoice_count: Count,
    gross_minor: Minor,
    discounts: obj({
      count: Count,
      value_minor: Minor,
      by_reason: ByReason,
      entries: z.array(
        obj({ requester_staff_id: z.string(), approver_staff_id: z.string().nullable(), method: z.string(), value_minor: Minor }),
      ),
    }),
    service_charge_minor: Minor,
    net_minor: Minor,
    taxes: z.array(
      obj({
        tax_code: z.string(),
        label: z.string(),
        tax_profile_id: z.string(),
        payment_class: z.enum(PAYMENT_CLASSES),
        rate_bp: RateBp,
        tax_minor: Minor,
      }),
    ),
    rounding_minor: Minor,
    total_minor: Minor,
  }),
  credits: obj({ count: Count, value_minor: Minor, by_reason: ByReason }),
  net_after_credits_minor: Minor,
  payments_by_mode: z.array(obj({ mode_name: z.string(), in_minor: Minor, out_minor: Minor, change_minor: Minor })),
  comps: obj({ value_minor: Minor, voided_minor: Minor, removals: obj({ count: Count, value_minor: Minor }) }),
  voids: z.array(obj({ disposition: z.string().nullable(), count: Count, value_minor: Minor })),
  reopens: obj({
    count: Count,
    value_minor: Minor,
    entries: z.array(obj({ requester_staff_id: z.string(), approver_staff_id: z.string().nullable() })),
  }),
  petty_cash: z.array(obj({ category_name: z.string(), kind: z.string(), amount_minor: Minor })),
  open_advances: z.array(obj({ staff_id: z.string(), amount_minor: Minor, age_minutes: Count })),
  shifts: z.array(
    obj({
      staff_id: z.string(),
      float_minor: NonNegativeMinor,
      expected_minor: Minor.nullable(),
      counted_minor: Minor.nullable(),
      variance_minor: Minor.nullable(),
      skipped: z.boolean(),
      signoff_state: z.string().nullable(),
    }),
  ),
  variance_signoffs: z.array(
    obj({
      shift_date: BusinessDate,
      staff_id: z.string(),
      amount_minor: Minor,
      outcome: z.string(),
      approver_staff_id: z.string().nullable(),
      at: z.number().int(),
    }),
  ),
  pending_signoffs: z.array(obj({ shift_date: BusinessDate, staff_id: z.string(), amount_minor: Minor })),
  takings_by_taker: z.array(obj({ staff_id: z.string(), amount_minor: Minor })),
  full_refunds: obj({ count: Count, value_minor: Minor }),
  fiscal: obj({ pending: Count, acked: Count, rejected: Count, not_required: Count }),
  bills: obj({ count: Count, average_minor: Minor }),
  /** §6.26: open bills are listed on the X only, so a Z carries none (the shape is ReportDocInput's). */
  open_bills: z.array(obj({ identifier: z.string(), open_minutes: Count, flagged: z.boolean() })).max(0),
  carried_over: z.array(obj({ label: z.string(), carried_in: z.boolean() })),
  brought_forward: z.array(obj({ mode_name: z.string(), staff_id: z.string(), amount_minor: Minor })),
  carried_forward: z.array(obj({ mode_name: z.string(), staff_id: z.string(), amount_minor: Minor })),
}) satisfies z.ZodType<ReportDocInput>;

export const ZReportIssuedPayload = z
  .object({ business_date: BusinessDate, z_no: z.number().int().positive(), report: ZReportSchema })
  .strict()
  .refine((p) => p.report.business_date === p.business_date && p.report.z_no === p.z_no, {
    message: 'report.business_date / z_no equal the event’s',
    path: ['report'],
  });
export type ZReportIssuedPayload = z.infer<typeof ZReportIssuedPayload>;

export const ZReportIssued = defineEvent({ eventType: 'ZReportIssued', version: 1, payload: ZReportIssuedPayload });
