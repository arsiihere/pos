// 05 §6.16 `GET /queries/shift?shift_id?` (task 15), B23 blind rule, §3.11, Q10 (takings by taker).
// Permission (C8): the `manage-own-shift` grant before any read (403); another person's shift additionally needs
// `close-shift-for-others` (403 `{ permission: 'close-shift-for-others' }`), checked once the shift is read.
// Blind rule: until the shift's `ShiftCounted` (`counted_at`) the view carries no `expected_minor`, no
// `variance_minor` and no cash sum — a cash-class takings row has `in_minor` / `out_minor` / `change_minor` and its
// takers' `in_minor` as null, and shows only `payments_count` (R-51, 05 v1.0.10: live payments, per row and per
// taker, read from `bill_payments` inside the takings statement); digital takings are shown (checked against the terminal, story 7 AC5); a handover row
// shows the expected of its own count only. After the count, expected = the count's (counted − variance).
// A removed payment leaves an all-zero takings row (task 8's fold): skipped.
// Statements: 4, fixed whatever the number of payments, petty rows or handovers — the shift (1), its takings (1), its
// petty rows with `bill_texts.paid_to` (1), its handovers (1). Names from the directory and the settings (in memory).
import { DomainError } from '@pos/domain';
import type { BranchConfig } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { StaffDirectory } from '../../auth/staff-directory.js';
import { defineQuery, queryRegistry, type QueryCtx } from '../../queries/registry.js';
import { hubBilling } from '../defaults.js';

export const ShiftQuery = z.object({ shift_id: z.string().min(1).optional() }).strict();

type PaymentClass = 'cash' | 'digital';

export interface ShiftTaking {
  mode_id: string;
  mode_name: string;
  payment_class: PaymentClass;
  /** null on a cash row before the count (B23) */
  in_minor: number | null;
  out_minor: number | null;
  change_minor: number | null;
  /** R-51 (05 v1.0.10): live payments (in and out) of this shift × mode; shown on every row, before the count too */
  payments_count: number;
  by: Array<{ taken_by_name: string | null; in_minor: number | null; payments_count: number }>;
}

export interface ShiftPetty {
  entry_id: string;
  kind: 'advance' | 'out' | 'in';
  amount_minor: number;
  category_name: string | null;
  /** from the hub-only bill_texts, never from an event (H3-5) */
  paid_to: string | null;
  advance_staff_name: string | null;
  settled: boolean;
}

export interface ShiftHandover {
  at: number;
  counted_minor: number;
  expected_minor: number;
  variance_minor: number;
  by_staff_name: string | null;
}

export interface ShiftView {
  shift_id: string;
  staff_name: string | null;
  state: 'open' | 'closed';
  is_drawer: boolean;
  opened_at: number;
  float_minor: number;
  takings: ShiftTaking[];
  petty: ShiftPetty[];
  open_advances_minor: number;
  handovers: ShiftHandover[];
  counted_minor: number | null;
  expected_minor: number | null;
  variance_minor: number | null;
}

interface ShiftRow {
  shift_id: string;
  staff_id: string;
  drawer_device_id: string | null;
  opened_at: number;
  float_minor: number;
  state: 'open' | 'closed';
  counted_minor: number | null;
  counted_at: number | null;
  variance_minor: number | null;
}

// `expected_cash_minor` is never selected: the view's expected after the count is the count's own.
const SHIFT = `SELECT shift_id, staff_id, drawer_device_id, opened_at, float_minor, state, counted_minor, counted_at, variance_minor
  FROM shifts WHERE (@shift_id IS NOT NULL AND shift_id = @shift_id) OR (@shift_id IS NULL AND staff_id = @staff_id AND state = 'open')`;

interface TakingRow {
  mode_id: string;
  taken_by_staff_id: string;
  in_minor: number;
  out_minor: number;
  change_minor: number;
  /** 1 when any payment of this shift × mode (removed ones included) was taken as cash (PaymentAdded.payment_class) */
  has_cash: number;
  /** 1 when any payment of this shift × mode was taken as digital; with has_cash 0 the row is digital */
  has_digital: number;
  /** R-51: live payments (removed_at NULL) of this shift × mode × taker */
  payments_count: number;
}

const TAKINGS = `SELECT t.mode_id, t.taken_by_staff_id, t.in_minor, t.out_minor, t.change_minor,
    EXISTS (SELECT 1 FROM bill_payments bp WHERE bp.shift_id = t.shift_id AND bp.mode_id = t.mode_id AND bp.payment_class = 'cash') AS has_cash,
    EXISTS (SELECT 1 FROM bill_payments bp WHERE bp.shift_id = t.shift_id AND bp.mode_id = t.mode_id AND bp.payment_class = 'digital') AS has_digital,
    (SELECT COUNT(*) FROM bill_payments bp WHERE bp.shift_id = t.shift_id AND bp.mode_id = t.mode_id
       AND bp.taken_by_staff_id = t.taken_by_staff_id AND bp.removed_at IS NULL) AS payments_count
  FROM shift_takings t
  WHERE t.shift_id = ? AND NOT (t.in_minor = 0 AND t.out_minor = 0 AND t.change_minor = 0)
  ORDER BY t.mode_id, t.taken_by_staff_id`;

interface PettyRow {
  entry_id: string;
  kind: 'advance' | 'out' | 'in';
  amount_minor: number;
  category_id: string | null;
  advance_staff_id: string | null;
  settled_at: number | null;
  paid_to: string | null;
}

const PETTY = `SELECT p.entry_id, p.kind, p.amount_minor, p.category_id, p.advance_staff_id, p.settled_at, bt.text AS paid_to
  FROM petty_cash p LEFT JOIN bill_texts bt ON bt.subject_id = p.entry_id AND bt.field = 'paid_to'
  WHERE p.shift_id = ? ORDER BY p.at, p.entry_id`;

const HANDOVERS = `SELECT at, counted_minor, expected_minor, variance_minor, by_staff_id FROM shift_handovers WHERE shift_id = ? ORDER BY at`;

export interface ShiftViewCtx {
  db: QueryCtx['db'];
  directory: StaffDirectory;
  config: BranchConfig | null;
  staffId: string | null;
}

/** §6.16: the shift view (`shift_id` absent → the caller's open shift). 4 statements. */
export function shiftView(c: ShiftViewCtx, shift_id: string | null): ShiftView {
  const { db, directory, staffId } = c;
  // C8: the grant before any read (manage-own-shift is allowed-only, 01b §3.3)
  const own = staffId === null ? ({ grant: 'not_granted' } as const) : directory.resolve(staffId, 'manage-own-shift');
  if (staffId === null || own.grant !== 'allowed') throw new DomainError('PERMISSION_DENIED', { permission: 'manage-own-shift', grant: own.grant });

  const shift = db.prepare(SHIFT).get({ shift_id, staff_id: staffId }) as ShiftRow | undefined; // 1
  if (shift === undefined) throw new DomainError('SHIFT_NOT_FOUND', { shift_id });
  if (shift.staff_id !== staffId && directory.resolve(staffId, 'close-shift-for-others').grant !== 'allowed') {
    throw new DomainError('PERMISSION_DENIED', { permission: 'close-shift-for-others' });
  }

  const takingRows = db.prepare(TAKINGS).all(shift.shift_id) as TakingRow[]; // 2
  const pettyRows = db.prepare(PETTY).all(shift.shift_id) as PettyRow[]; // 3
  const handoverRows = db.prepare(HANDOVERS).all(shift.shift_id) as Array<{ at: number; counted_minor: number; expected_minor: number; variance_minor: number; by_staff_id: string }>; // 4

  const counted = shift.counted_at !== null;
  const settings = c.config === null ? null : hubBilling(c.config).settings;
  const modes = new Map((settings?.payment_modes ?? []).map((m) => [m.mode_id, m]));
  const categories = new Map((settings?.petty_categories ?? []).map((p) => [p.category_id, p.name]));
  const nameOf = (id: string | null): string | null => (id === null ? null : (directory.get(id)?.display_name ?? null));

  const byMode = new Map<string, ShiftTaking>();
  const sums = new Map<string, { in: number; out: number; change: number }>();
  for (const row of takingRows) {
    const mode = modes.get(row.mode_id);
    // B23: a mode with ANY cash payment on this shift is a cash row (a class changed mid-shift never shows a cash
    // sum). With no payment row found the settings' class is used, and with no settings either the 'cash' fallback
    // hides the amounts on purpose: an unknown class is treated as cash, never shown before the count.
    const payment_class: PaymentClass = row.has_cash === 1 ? 'cash' : row.has_digital === 1 ? 'digital' : (mode?.payment_class ?? 'cash');
    const hidden = payment_class === 'cash' && !counted;
    let taking = byMode.get(row.mode_id);
    if (taking === undefined) {
      taking = { mode_id: row.mode_id, mode_name: mode?.name ?? row.mode_id, payment_class, in_minor: null, out_minor: null, change_minor: null, payments_count: 0, by: [] };
      byMode.set(row.mode_id, taking);
      sums.set(row.mode_id, { in: 0, out: 0, change: 0 });
    }
    const s = sums.get(row.mode_id)!;
    s.in += row.in_minor;
    s.out += row.out_minor;
    s.change += row.change_minor;
    taking.payments_count += row.payments_count;
    if (!hidden) {
      taking.in_minor = s.in;
      taking.out_minor = s.out;
      taking.change_minor = s.change;
    }
    taking.by.push({ taken_by_name: nameOf(row.taken_by_staff_id), in_minor: hidden ? null : row.in_minor, payments_count: row.payments_count });
  }
  const sortOf = (mode_id: string) => modes.get(mode_id)?.sort_order ?? Number.MAX_SAFE_INTEGER;
  const takings = [...byMode.values()].sort((a, b) => sortOf(a.mode_id) - sortOf(b.mode_id) || (a.mode_id < b.mode_id ? -1 : a.mode_id > b.mode_id ? 1 : 0));

  let open_advances_minor = 0;
  const petty = pettyRows.map((p): ShiftPetty => {
    if (p.kind === 'advance' && p.settled_at === null) open_advances_minor += p.amount_minor;
    return {
      entry_id: p.entry_id,
      kind: p.kind,
      amount_minor: p.amount_minor,
      category_name: p.category_id === null ? null : (categories.get(p.category_id) ?? null),
      paid_to: p.paid_to,
      advance_staff_name: nameOf(p.advance_staff_id),
      settled: p.settled_at !== null,
    };
  });

  return {
    shift_id: shift.shift_id,
    staff_name: nameOf(shift.staff_id),
    state: shift.state,
    is_drawer: shift.drawer_device_id !== null,
    opened_at: shift.opened_at,
    float_minor: shift.float_minor,
    takings,
    petty,
    open_advances_minor,
    handovers: handoverRows.map((h) => ({ at: h.at, counted_minor: h.counted_minor, expected_minor: h.expected_minor, variance_minor: h.variance_minor, by_staff_name: nameOf(h.by_staff_id) })),
    counted_minor: counted ? shift.counted_minor : null,
    expected_minor: counted && shift.counted_minor !== null && shift.variance_minor !== null ? shift.counted_minor - shift.variance_minor : null,
    variance_minor: counted ? shift.variance_minor : null,
  };
}

export function registerShiftQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'shift',
      sessionKind: 'device',
      session: 'required',
      querySchema: ShiftQuery,
      handle(ctx: QueryCtx, q) {
        const view = shiftView({ db: ctx.db, directory: ctx.directory, config: ctx.branchConfig, staffId: ctx.session?.staff_id ?? null }, q.shift_id ?? null);
        return { data: view };
      },
    }),
  );
}
