import type { EventDraft, PosEvent } from '@pos/events';
import {
  aBillOpened,
  aBillReopened,
  aDrawerOpened,
  aHandoverCounted,
  aPaymentAdded,
  aPaymentRemoved,
  aPettyCashAdvanced,
  aPettyCashIn,
  aPettyCashOut,
  aPettyCashSettled,
  aShiftClosed,
  aShiftCounted,
  aShiftCountSkipped,
  aShiftOpened,
  aShiftVarianceSignedOff,
} from '@pos/events/testing';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHIFTS_EVENT_TYPES, SHIFTS_TABLES, shiftsProjection } from '../../src/billing/projections/shifts';
import { registerHubProjections } from '../../src/lib/boot';
import { createProjectionRegistry, type Projection, type ProjectionRegistry } from '../../src/projections/registry';
import { createTestHub, type TestHub } from '../helpers/test-hub';

// 05 §5 (task 8): the `shifts` projection, events only (R-44 / G-39), fed real events through the hub writer (the
// task-5 builders, ids overridden). Rebuild from seq 0 = live (#88 shifts half), events-only reversal of removals and
// sign-off dates (#47b fold half), variance_state from ShiftCounted alone (#50d fold half), expected cash = the §3.7
// formula over seeded random streams (#47, fold half), fixed statement counts.

let hub: TestHub;
let db: Database.Database;

beforeEach(async () => {
  hub = await createTestHub();
  db = hub.deps.db;
});

afterEach(async () => {
  await hub.close();
});

type Draft = Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id'>;

/** A builder's event as a draft, its payload merged with `payload`; stream id = the bill or the shift. */
function d(built: PosEvent, payload: Record<string, unknown> = {}): Draft {
  const merged = { ...(built.payload as Record<string, unknown>), ...payload };
  const stream_id = built.stream_type === 'bill' ? (merged['bill_id'] as string) : ((merged['shift_id'] as string | undefined) ?? built.stream_id);
  return { stream_type: built.stream_type, stream_id, event_type: built.event_type, schema_version: built.schema_version, payload: merged };
}

/** Every appended event, in order (for the direct re-fold). */
let stream: PosEvent[] = [];

/** One writer transaction of `drafts`, clock +1 s first; returns the appended events. */
function append(...drafts: Draft[]): PosEvent[] {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  const out = hub.deps.writer.run((tx) => tx.append(drafts.map((x) => ({ ...x, occurred_at: now, actor_id: 'S_CASH', device_id: 'D_FIXTURE' })))).appended;
  stream.push(...out);
  return out;
}

beforeEach(() => {
  stream = [];
});

const branch = () => hub.deps.config.provisioned!.branch_id;
const rows = (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as Array<Record<string, unknown>>;
const shift = (shift_id: string) => db.prepare('SELECT * FROM shifts WHERE shift_id = ?').get(shift_id) as Record<string, unknown> | undefined;
const expected = (shift_id: string) => shift(shift_id)!['expected_cash_minor'];

/** Every `shifts` table (§5), ordered. */
function dump(): Record<string, unknown[]> {
  const all = (sql: string) => db.prepare(sql).all();
  return {
    shifts: all('SELECT * FROM shifts ORDER BY shift_id'),
    shift_signoffs: all('SELECT * FROM shift_signoffs ORDER BY shift_id'),
    shift_handovers: all('SELECT * FROM shift_handovers ORDER BY shift_id, at'),
    shift_takings: all('SELECT * FROM shift_takings ORDER BY shift_id, mode_id, taken_by_staff_id'),
    petty_cash: all('SELECT * FROM petty_cash ORDER BY entry_id'),
  };
}

/** Deletes the `shifts` checkpoint and replays it alone from seq 0 (reset first; `billing` stays at the head). */
function rebuildShiftsAlone(): number {
  db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'shifts'`).run();
  const registry = createProjectionRegistry();
  registry.register(shiftsProjection());
  return registry.catchUp(db, branch()).replayed['shifts'] ?? 0;
}

/** Every hub projection replayed from seq 0 (all checkpoints deleted). */
function rebuildAll(): void {
  db.prepare('DELETE FROM projection_checkpoints').run();
  const registry = createProjectionRegistry();
  registerHubProjections(registry);
  registry.catchUp(db, branch());
}

/** Runs `f` with every statement `db` prepares counted and its SQL kept. */
function capture<T>(f: () => T): { result: T; count: number; sql: string[] } {
  let count = 0;
  const sql: string[] = [];
  const prepare = db.prepare.bind(db);
  db.prepare = ((text: string) => {
    sql.push(text);
    const st = prepare(text);
    const wrap = <A extends unknown[], R>(g: (...a: A) => R) => (...a: A): R => {
      count += 1;
      return g(...a);
    };
    st.run = wrap(st.run.bind(st));
    st.get = wrap(st.get.bind(st));
    st.all = wrap(st.all.bind(st));
    return st;
  }) as typeof db.prepare;
  try {
    return { result: f(), count, sql };
  } finally {
    db.prepare = prepare as typeof db.prepare;
  }
}

/** The appended stream re-folded straight through `shiftsProjection().apply` after a reset; returns the SQL it ran. */
function refoldDirect(): string[] {
  const p = shiftsProjection();
  return db.transaction(() => {
    p.reset!(db);
    return capture(() => {
      for (const e of stream) if (p.eventTypes.includes(e.event_type)) p.apply(db, e, 'catchup');
    }).sql;
  })();
}

/** Every hub table that is not one of the five `shifts` tables. */
function foreignTables(): string[] {
  const own = new Set<string>(SHIFTS_TABLES);
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>)
    .map((r) => r.name)
    .filter((n) => !own.has(n));
}

function touchesOnlyOwnTables(sql: string[]): void {
  const foreign = foreignTables();
  expect(foreign).toEqual(expect.arrayContaining(['bill_payments', 'billing_day', 'bills', 'invoices', 'config_snapshots', 'branch_config']));
  for (const text of sql) for (const t of foreign) expect(new RegExp(`\\b${t}\\b`).test(text), `${t} in: ${text}`).toBe(false);
}

// ---------------------------------------------------------------------------------------------------- builders

const DAY1 = '2025-10-20';
const DAY2 = '2025-10-21';
const DAY3 = '2025-10-22';

const opened = (shift_id: string, staff_id: string, float_minor: number, o: Record<string, unknown> = {}) =>
  d(aShiftOpened(), { shift_id, staff_id, float_minor, drawer_device_id: null, business_date: DAY1, ...o });

type Pay = {
  payment_id: string;
  bill_id: string;
  shift_id: string;
  mode_id: string;
  payment_class: 'cash' | 'digital';
  direction: 'in' | 'out';
  amount_minor: number;
  tendered_minor: number | null;
  change_minor: number | null;
  taken_by_staff_id: string;
};

function pay(o: Partial<Pay> & Pick<Pay, 'payment_id' | 'shift_id' | 'amount_minor'>): { draft: Draft; p: Pay } {
  const p: Pay = {
    bill_id: 'B1',
    mode_id: 'cash',
    payment_class: 'cash',
    direction: 'in',
    tendered_minor: null,
    change_minor: null,
    taken_by_staff_id: 'S_CASH',
    ...o,
  };
  return { draft: d(aPaymentAdded(), { ...p, split_no: 1, has_reference: false }), p };
}

/** §6.10 (R-44): the removal copies the removed payment's facts. */
const removal = (p: Pay) =>
  d(aPaymentRemoved(), {
    payment_id: p.payment_id,
    bill_id: p.bill_id,
    split_no: 1,
    reason_code: 'wrong_amount',
    has_note: false,
    shift_id: p.shift_id,
    mode_id: p.mode_id,
    payment_class: p.payment_class,
    direction: p.direction,
    amount_minor: p.amount_minor,
    change_minor: p.change_minor ?? 0,
    taken_by_staff_id: p.taken_by_staff_id,
  });

const advance = (entry_id: string, shift_id: string, amount_minor: number) =>
  d(aPettyCashAdvanced(), { entry_id, shift_id, amount_minor, advance_staff_id: 'S_WAIT' });
const cashOut = (entry_id: string, shift_id: string, amount_minor: number) => d(aPettyCashOut(), { entry_id, shift_id, amount_minor });
const cashIn = (entry_id: string, shift_id: string, amount_minor: number) => d(aPettyCashIn(), { entry_id, shift_id, amount_minor });
const settle = (entry_id: string, shift_id: string, spent_minor: number, returned_minor: number) =>
  d(aPettyCashSettled(), { entry_id, shift_id, spent_minor, returned_minor });
const counted = (shift_id: string, counted_minor: number, expected_minor: number, variance_alert_id: string | null) =>
  d(aShiftCounted(), { shift_id, counted_minor, expected_minor, variance_minor: counted_minor - expected_minor, by_staff_id: 'S_CASH', variance_alert_id });
const closed = (shift_id: string, closed_by = 'S_CASH') => d(aShiftClosed(), { shift_id, closed_by });
const signedOff = (shift_id: string, outcome: 'approved' | 'disputed', alert_id: string, business_date: string) =>
  d(aShiftVarianceSignedOff(), { shift_id, outcome, alert_id, approver_staff_id: 'S_MGR', business_date });

/**
 * The #88 / #47b day: SH1 a drawer shift (two takers), SH2 a manager's own shift, SH3 opened on day 2, SH4 counted
 * within the threshold. Cash and card in, tendered cash with change, a cash out on a reopened bill, removals of each,
 * an advance settled on another shift, a cash-out, a cash-in, a handover, a drawer open, a count with a sign-off
 * answered on day 2 (approve) and another answered on day 3 (reject), a skipped count.
 */
function scriptedDay(): { P1: Pay; P2: Pay; P3: Pay; P4: Pay; P5: Pay } {
  append(d(aBillOpened(), { bill_id: 'B1', seating_id: 'SEAT1' }), d(aBillOpened(), { bill_id: 'B2', seating_id: 'SEAT2' }));
  append(opened('SH1', 'S_CASH', 5_000, { drawer_device_id: 'D_DRAWER' }), opened('SH2', 'S_MGR', 0));
  const P1 = pay({ payment_id: 'P1', shift_id: 'SH1', amount_minor: 1_000, tendered_minor: 1_500, change_minor: 500 });
  const P2 = pay({ payment_id: 'P2', shift_id: 'SH1', amount_minor: 2_000, mode_id: 'card', payment_class: 'digital' });
  const P3 = pay({ payment_id: 'P3', shift_id: 'SH1', amount_minor: 700, taken_by_staff_id: 'S_WAIT' });
  const P4 = pay({ payment_id: 'P4', shift_id: 'SH1', amount_minor: 300, tendered_minor: 500, change_minor: 200, taken_by_staff_id: 'S_WAIT' });
  append(P1.draft, P2.draft);
  append(P3.draft, P4.draft);
  // B2 reopened: its payments are carried (the shifts fold reads nothing of it); a cash out pays money back
  append(d(aBillReopened(), { bill_id: 'B2', mode: 'full', order_ids: ['O9'] }));
  const P5 = pay({ payment_id: 'P5', bill_id: 'B2', shift_id: 'SH1', amount_minor: 400, direction: 'out' });
  append(P5.draft);
  append(removal(P2.p)); // card in removed
  append(removal(P4.p)); // S_WAIT's tendered cash removed: only S_WAIT's row moves
  append(removal(P5.p)); // cash out removed
  append(advance('A1', 'SH1', 1_000), cashOut('E1', 'SH1', 250), cashIn('E2', 'SH1', 100));
  append(settle('A1', 'SH2', 600, 400)); // settled on another shift: the returned cash lands on SH2
  append(d(aHandoverCounted(), { shift_id: 'SH1', counted_minor: 5_500, expected_minor: 5_550, variance_minor: -50, by_staff_id: 'S_CASH' }));
  append(d(aDrawerOpened(), { shift_id: 'SH1', device_id: 'D_DRAWER' }));
  append(counted('SH1', 5_000, 5_550, 'AL_V1'), closed('SH1'));
  append(d(aShiftCountSkipped(), { shift_id: 'SH2' }), closed('SH2', 'S_MGR'));
  append(opened('SH3', 'S_CASH', 1_000, { business_date: DAY2 }), opened('SH4', 'S_WAIT', 200, { business_date: DAY2 }));
  append(signedOff('SH1', 'approved', 'AL_V1', DAY2));
  append(counted('SH3', 0, 1_000, 'AL_V3'), closed('SH3'));
  append(counted('SH4', 190, 200, null), closed('SH4', 'S_WAIT'));
  append(signedOff('SH3', 'disputed', 'AL_V3', DAY3));
  return { P1: P1.p, P2: P2.p, P3: P3.p, P4: P4.p, P5: P5.p };
}

// ---------------------------------------------------------------------------------------------------- tests

describe('[05 §5] shifts projection', () => {
  it('[05 §5] eventTypes = the §5 shifts list (+ PaymentAdded / PaymentRemoved); no billing-only event; reset clears the five tables', () => {
    expect([...SHIFTS_EVENT_TYPES].sort()).toEqual(
      [
        'ShiftOpened',
        'ShiftCounted',
        'ShiftCountSkipped',
        'HandoverCounted',
        'ShiftClosed',
        'ShiftVarianceSignedOff',
        'PettyCashAdvanced',
        'PettyCashSettled',
        'PettyCashOut',
        'PettyCashIn',
        'DrawerOpened',
        'PaymentAdded',
        'PaymentRemoved',
      ].sort(),
    );
    for (const t of ['BillOpened', 'BillReopened', 'InvoiceIssued', 'BusinessDayOpened']) expect(SHIFTS_EVENT_TYPES).not.toContain(t);
    const p = shiftsProjection();
    expect(p.name).toBe('shifts');
    scriptedDay();
    db.prepare(`INSERT INTO bill_texts (subject_id, field, text) VALUES ('E1', 'paid_to', 'x')`).run();
    p.reset!(db);
    for (const [table, list] of Object.entries(dump())) expect(list, table).toEqual([]);
    expect(rows('SELECT * FROM bill_texts')).toHaveLength(1); // hub state, not this projection's
    expect(rows('SELECT * FROM bill_payments')).toHaveLength(5); // billing untouched
  });

  it('[05 #88 shifts half] a scripted stream of every shift event, payments, petty cash and a handover: rebuild from seq 0 equals live (alone and with every projection)', () => {
    scriptedDay();
    const live = dump();

    // the folds landed (spot checks; the equalities below cover every column)
    expect(shift('SH1')).toMatchObject({
      staff_id: 'S_CASH',
      drawer_device_id: 'D_DRAWER',
      business_date: DAY1,
      float_minor: 5_000,
      state: 'closed',
      closed_by: 'S_CASH',
      closed_at: expect.any(Number),
      opened_at: expect.any(Number),
      // 5 000 + 1 000 + 700 (+300 −300) (−400 +400) − 1 000 advance − 250 out + 100 in
      expected_cash_minor: 5_550,
      counted_minor: 5_000,
      counted_at: expect.any(Number),
      variance_minor: -550,
      variance_alert_id: 'AL_V1',
      variance_state: 'approved',
      count_skipped: 0,
    });
    expect(shift('SH2')).toMatchObject({ drawer_device_id: null, state: 'closed', closed_by: 'S_MGR', count_skipped: 1, expected_cash_minor: 400, counted_minor: null, variance_state: null });
    expect(shift('SH3')).toMatchObject({ business_date: DAY2, variance_state: 'disputed', variance_alert_id: 'AL_V3' });
    expect(shift('SH4')).toMatchObject({ variance_state: null, variance_alert_id: null, variance_minor: -10 });
    expect(live.shift_takings).toEqual([
      { shift_id: 'SH1', mode_id: 'card', taken_by_staff_id: 'S_CASH', in_minor: 0, out_minor: 0, change_minor: 0 },
      { shift_id: 'SH1', mode_id: 'cash', taken_by_staff_id: 'S_CASH', in_minor: 1_000, out_minor: 0, change_minor: 500 },
      { shift_id: 'SH1', mode_id: 'cash', taken_by_staff_id: 'S_WAIT', in_minor: 700, out_minor: 0, change_minor: 0 },
    ]);
    expect(live.petty_cash).toEqual([
      expect.objectContaining({ entry_id: 'A1', shift_id: 'SH1', kind: 'advance', amount_minor: 1_000, advance_staff_id: 'S_WAIT', settled_shift_id: 'SH2', spent_minor: 600, returned_minor: 400, settled_at: expect.any(Number) }),
      expect.objectContaining({ entry_id: 'E1', kind: 'out', amount_minor: 250, advance_staff_id: null, settled_at: null }),
      expect.objectContaining({ entry_id: 'E2', kind: 'in', amount_minor: 100, advance_staff_id: null, settled_at: null }),
    ]);
    expect(live.shift_handovers).toEqual([
      { shift_id: 'SH1', at: expect.any(Number), counted_minor: 5_500, expected_minor: 5_550, variance_minor: -50, by_staff_id: 'S_CASH' },
    ]);
    expect(live.shift_signoffs).toEqual([
      { shift_id: 'SH1', outcome: 'approved', approver_staff_id: 'S_MGR', signed_at: expect.any(Number), business_date: DAY2 },
      { shift_id: 'SH3', outcome: 'disputed', approver_staff_id: 'S_MGR', signed_at: expect.any(Number), business_date: DAY3 },
    ]);

    expect(rebuildShiftsAlone()).toBe(stream.filter((e) => SHIFTS_EVENT_TYPES.includes(e.event_type)).length);
    expect(dump()).toEqual(live);
    rebuildAll();
    expect(dump()).toEqual(live);
  });
});

describe('[05 #47b fold half] shifts is events-only (R-44 / G-39)', () => {
  it('[05 #47b fold half] rebuild of shifts alone (billing at the head) = live for expected cash, takings (taker key) and sign-off dates; the fold touches no billing table', () => {
    scriptedDay();
    const live = dump();
    // billing is at the head and its rows are gone: shifts cannot be reading them
    db.prepare('DELETE FROM bill_payments').run();
    db.prepare('DELETE FROM bills').run();
    db.prepare('DELETE FROM billing_day').run();
    expect(rebuildShiftsAlone()).toBeGreaterThan(20);
    expect(dump()).toEqual(live);
    // straight through apply: every statement names only the five shifts tables (no billing, settings or 02a/02b table)
    const sql = refoldDirect();
    expect(sql.length).toBeGreaterThan(20);
    touchesOnlyOwnTables(sql);
    expect(dump()).toEqual(live);
    // the sign-off dates are each answer's open day (day 2 / day 3), not the shift's day 1 nor today
    expect(rows('SELECT shift_id, business_date FROM shift_signoffs ORDER BY shift_id')).toEqual([
      { shift_id: 'SH1', business_date: DAY2 },
      { shift_id: 'SH3', business_date: DAY3 },
    ]);
  });

  it("[05 #47b fold half] removing one taker's payment on a two-taker drawer moves only that taker's shift_takings row, reversing amount and change", () => {
    append(opened('SH1', 'S_CASH', 0, { drawer_device_id: 'D_DRAWER' }));
    const a = pay({ payment_id: 'P1', shift_id: 'SH1', amount_minor: 1_000, tendered_minor: 1_500, change_minor: 500 });
    const b = pay({ payment_id: 'P2', shift_id: 'SH1', amount_minor: 800, tendered_minor: 1_000, change_minor: 200, taken_by_staff_id: 'S_WAIT' });
    append(a.draft, b.draft);
    const before = rows(`SELECT * FROM shift_takings WHERE taken_by_staff_id = 'S_CASH'`);
    append(removal(b.p));
    expect(rows(`SELECT * FROM shift_takings WHERE taken_by_staff_id = 'S_CASH'`)).toEqual(before);
    expect(rows(`SELECT in_minor, out_minor, change_minor FROM shift_takings WHERE taken_by_staff_id = 'S_WAIT'`)).toEqual([{ in_minor: 0, out_minor: 0, change_minor: 0 }]);
    expect(expected('SH1')).toBe(1_000);
    // a digital removal never moves expected cash; a cash out's removal puts it back
    const c = pay({ payment_id: 'P3', shift_id: 'SH1', amount_minor: 300, mode_id: 'online', payment_class: 'digital' });
    const o = pay({ payment_id: 'P4', shift_id: 'SH1', amount_minor: 250, direction: 'out' });
    append(c.draft, o.draft);
    expect(expected('SH1')).toBe(750);
    append(removal(c.p));
    expect(expected('SH1')).toBe(750);
    append(removal(o.p));
    expect(expected('SH1')).toBe(1_000);
    expect(rows(`SELECT in_minor, out_minor FROM shift_takings WHERE mode_id = 'cash' AND taken_by_staff_id = 'S_CASH'`)).toEqual([{ in_minor: 1_000, out_minor: 0 }]);
  });
});

describe('[05 #50d fold half] variance_state / variance_alert_id from ShiftCounted alone (R-42 / G-39)', () => {
  it('[05 #50d fold half] non-null id → pending + the id; null → NULL; a variance far under the threshold with an id is still pending; handover sets neither; rebuild = live; no settings read', () => {
    append(opened('SH1', 'S_CASH', 1_000), opened('SH2', 'S_MGR', 1_000), opened('SH3', 'S_WAIT', 1_000, { drawer_device_id: 'D_DRAWER' }));
    // −1 against the default threshold (10 000): the fold still follows the event's id, never the threshold
    append(counted('SH1', 999, 1_000, 'AL_X'), closed('SH1'));
    // −900 000 with no id (e.g. counted under a larger threshold then): the fold still writes NULL
    append(counted('SH2', 0, 900_000, null), closed('SH2', 'S_MGR'));
    // a handover far off expected: no variance_state, no id
    append(d(aHandoverCounted(), { shift_id: 'SH3', counted_minor: 0, expected_minor: 1_000, variance_minor: -1_000, by_staff_id: 'S_WAIT' }));
    expect(shift('SH1')).toMatchObject({ variance_state: 'pending', variance_alert_id: 'AL_X', variance_minor: -1 });
    expect(shift('SH2')).toMatchObject({ variance_state: null, variance_alert_id: null, variance_minor: -900_000 });
    expect(shift('SH3')).toMatchObject({ state: 'open', variance_state: null, variance_alert_id: null, counted_minor: null });
    const live = dump();
    // a "threshold change" cannot move a rebuilt shift: the fold reads no settings table at all
    touchesOnlyOwnTables(refoldDirect());
    expect(dump()).toEqual(live);
    rebuildShiftsAlone();
    expect(dump()).toEqual(live);
  });
});

// ---------------------------------------------------------------------------------------------------- #47 property

/** mulberry32 (packages/engine/test/sim/generate.ts pattern): small and seedable. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('[05 #47 fold half] expected cash = the §3.7 formula over random streams (G1-8, Q10)', () => {
  for (const seed of [7, 4242, 90210]) {
    it(`[05 #47 fold half] seed ${seed}: random payments (two takers on one drawer), change, outs, removals, advances settled on other shifts, cash-outs, cash-ins`, () => {
      const r = prng(seed);
      const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
      const SHIFTS = [
        { shift_id: 'SH1', staff_id: 'S_CASH', float: int(0, 50_000), drawer: 'D_DRAWER' },
        { shift_id: 'SH2', staff_id: 'S_MGR', float: int(0, 50_000), drawer: null },
        { shift_id: 'SH3', staff_id: 'S_OWN', float: int(0, 50_000), drawer: null },
      ];
      const TAKERS: Record<string, readonly string[]> = { SH1: ['S_CASH', 'S_WAIT'], SH2: ['S_MGR'], SH3: ['S_OWN'] };
      const MODES = [
        { mode_id: 'cash', payment_class: 'cash' as const },
        { mode_id: 'card', payment_class: 'digital' as const },
        { mode_id: 'online', payment_class: 'digital' as const },
      ];
      append(...SHIFTS.map((s) => opened(s.shift_id, s.staff_id, s.float, { drawer_device_id: s.drawer })));

      const payments: Array<Pay & { removed: boolean }> = [];
      const petty: Array<{ entry_id: string; shift_id: string; kind: 'advance' | 'out' | 'in'; amount: number; settled?: { shift_id: string; returned: number } }> = [];
      for (let i = 0; i < 160; i += 1) {
        const roll = r();
        const s = pick(SHIFTS).shift_id;
        if (roll < 0.55) {
          const m = pick(MODES);
          const direction = r() < 0.8 ? 'in' : 'out';
          const amount_minor = int(1, 20_000);
          const tendered = m.payment_class === 'cash' && direction === 'in' && r() < 0.5 ? amount_minor + int(0, 5_000) : null;
          const x = pay({
            payment_id: `P${i}`,
            shift_id: s,
            amount_minor,
            ...m,
            direction,
            tendered_minor: tendered,
            change_minor: tendered === null ? null : tendered - amount_minor,
            taken_by_staff_id: pick(TAKERS[s]!),
          });
          append(x.draft);
          payments.push({ ...x.p, removed: false });
        } else if (roll < 0.7) {
          const live = payments.filter((p) => !p.removed);
          if (live.length === 0) continue;
          const p = pick(live);
          append(removal(p));
          p.removed = true;
        } else if (roll < 0.95) {
          const kind = pick(['advance', 'out', 'in'] as const);
          const amount = int(1, 10_000);
          const entry_id = `E${i}`;
          append(kind === 'advance' ? advance(entry_id, s, amount) : kind === 'out' ? cashOut(entry_id, s, amount) : cashIn(entry_id, s, amount));
          petty.push({ entry_id, shift_id: s, kind, amount });
        } else {
          const open = petty.filter((e) => e.kind === 'advance' && e.settled === undefined);
          if (open.length === 0) continue;
          const e = pick(open);
          const returned = int(0, e.amount);
          append(settle(e.entry_id, s, e.amount - returned, returned)); // s may be another shift
          e.settled = { shift_id: s, returned };
        }
      }

      const msg = `seed ${seed}`;
      for (const s of SHIFTS) {
        // §3.7: float + Σ cash in − Σ cash out + Σ settled-advance cash returned − Σ advances − Σ cash-outs + Σ cash-ins
        const cash = payments.filter((p) => !p.removed && p.shift_id === s.shift_id && p.payment_class === 'cash');
        const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
        const formula =
          s.float +
          sum(cash.filter((p) => p.direction === 'in').map((p) => p.amount_minor)) -
          sum(cash.filter((p) => p.direction === 'out').map((p) => p.amount_minor)) +
          sum(petty.filter((e) => e.settled?.shift_id === s.shift_id).map((e) => e.settled!.returned)) -
          sum(petty.filter((e) => e.shift_id === s.shift_id && e.kind === 'advance').map((e) => e.amount)) -
          sum(petty.filter((e) => e.shift_id === s.shift_id && e.kind === 'out').map((e) => e.amount)) +
          sum(petty.filter((e) => e.shift_id === s.shift_id && e.kind === 'in').map((e) => e.amount));
        expect(expected(s.shift_id), `${msg} ${s.shift_id}`).toBe(formula);
      }
      // takings by (shift, mode, taker) = Σ live payments, in / out / change
      const model = new Map<string, { in_minor: number; out_minor: number; change_minor: number }>();
      for (const p of payments) {
        const k = `${p.shift_id}|${p.mode_id}|${p.taken_by_staff_id}`;
        const t = model.get(k) ?? { in_minor: 0, out_minor: 0, change_minor: 0 };
        if (!p.removed) {
          if (p.direction === 'in') t.in_minor += p.amount_minor;
          else t.out_minor += p.amount_minor;
          t.change_minor += p.change_minor ?? 0;
        }
        model.set(k, t);
      }
      const takings = rows('SELECT * FROM shift_takings');
      expect(takings.length, msg).toBe(model.size);
      for (const t of takings) {
        expect(model.get(`${String(t['shift_id'])}|${String(t['mode_id'])}|${String(t['taken_by_staff_id'])}`), msg).toEqual({
          in_minor: t['in_minor'],
          out_minor: t['out_minor'],
          change_minor: t['change_minor'],
        });
      }
      const live = dump();
      rebuildShiftsAlone();
      expect(dump(), msg).toEqual(live);
    });
  }
});

// ---------------------------------------------------------------------------------------------------- statements

describe('[05 §5] shifts fold statements are fixed (no per-payment or per-petty statement)', () => {
  const projection: Projection = shiftsProjection();
  const statementsOf = (event: PosEvent): number => capture(() => db.transaction(() => projection.apply(db, event, 'live'))()).count;
  const ev = (built: PosEvent, payload: Record<string, unknown>) => ({ ...built, payload: { ...(built.payload as Record<string, unknown>), ...payload } }) as PosEvent;

  it('[05 §5] each shifts event costs the same statements on a shift with 1 and with 40 payments / petty rows', () => {
    append(opened('S_FEW', 'S_A', 0), opened('S_MANY', 'S_B', 0));
    const seed = (shift_id: string, n: number) => {
      for (let i = 0; i < n; i += 1) {
        append(pay({ payment_id: `${shift_id}-P${i}`, shift_id, amount_minor: 100, tendered_minor: 150, change_minor: 50 }).draft, advance(`${shift_id}-A${i}`, shift_id, 10));
      }
    };
    seed('S_FEW', 1);
    seed('S_MANY', 40);
    const forShift = (shift_id: string, k: string): PosEvent[] => {
      const p = pay({ payment_id: `${shift_id}-X${k}`, shift_id, amount_minor: 100, tendered_minor: 150, change_minor: 50 }).p;
      return [
        ev(aPaymentAdded(), { ...p, split_no: 1, has_reference: false }),
        ev(aPaymentRemoved(), removal(p).payload as Record<string, unknown>),
        ev(aPettyCashOut(), { entry_id: `${shift_id}-O${k}`, shift_id }),
        ev(aPettyCashIn(), { entry_id: `${shift_id}-I${k}`, shift_id }),
        ev(aPettyCashAdvanced(), { entry_id: `${shift_id}-AD${k}`, shift_id }),
        ev(aPettyCashSettled(), { entry_id: `${shift_id}-A0`, shift_id, spent_minor: 5, returned_minor: 5 }),
        ev(aHandoverCounted(), { shift_id, counted_minor: 0, expected_minor: 0, variance_minor: 0 }),
        ev(aDrawerOpened(), { shift_id }),
        ev(aShiftCounted(), { shift_id, counted_minor: 0, expected_minor: 0, variance_minor: 0, variance_alert_id: 'AL' }),
        ev(aShiftCountSkipped(), { shift_id }),
        ev(aShiftClosed(), { shift_id }),
        ev(aShiftVarianceSignedOff(), { shift_id }),
      ];
    };
    const few = forShift('S_FEW', 'f').map((e) => [e.event_type, statementsOf(e)]);
    const many = forShift('S_MANY', 'm').map((e) => [e.event_type, statementsOf(e)]);
    expect(many).toEqual(few);
    // the pinned counts (one statement per row written, never a scan)
    expect(Object.fromEntries(few)).toEqual({
      PaymentAdded: 2,
      PaymentRemoved: 2,
      PettyCashOut: 2,
      PettyCashIn: 2,
      PettyCashAdvanced: 2,
      PettyCashSettled: 2,
      HandoverCounted: 1,
      DrawerOpened: 0,
      ShiftCounted: 1,
      ShiftCountSkipped: 1,
      ShiftClosed: 1,
      ShiftVarianceSignedOff: 2,
    });
    expect(statementsOf(ev(aShiftOpened(), { shift_id: 'S_NEW', staff_id: 'S_C' }))).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------- registration

describe('[05 §5, §6.30] registerHubProjections', () => {
  it('[05 §6.30] registers `shifts` once, with reset, after orders, tables, audit and billing', () => {
    const seen: Projection[] = [];
    registerHubProjections({ register: (p: Projection) => seen.push(p), afterCatchUp: () => undefined } as unknown as ProjectionRegistry);
    const names = seen.map((p) => p.name);
    expect(names.filter((n) => n === 'shifts')).toHaveLength(1);
    for (const before of ['orders', 'tables', 'audit', 'billing']) expect(names.indexOf('shifts')).toBeGreaterThan(names.indexOf(before));
    expect(seen.find((p) => p.name === 'shifts')!.reset).toBeTypeOf('function');
  });

  it('[05 §5, H-2] the test hub writes the shifts checkpoint row and folds live appends', () => {
    expect(db.prepare(`SELECT last_seq FROM projection_checkpoints WHERE projection = 'shifts'`).get()).toEqual({ last_seq: 0 });
    append(opened('SH1', 'S_CASH', 1_234));
    expect(expected('SH1')).toBe(1_234);
  });
});
