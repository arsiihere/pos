// 05 §6.21 `OpenCashDrawer` (task 23; 05-plan §3 row 23), §3.16 No-sale row, R-57, B30, H3-5, row H-4. A no-sale
// drawer open with a reason on a drawer shift's device: `DrawerOpened` on the shift stream and a drawer kick job on
// the device's own route only (the OpenShift kick, R-57). Real commands over HTTP through the hub's writer; shifts
// are opened by the real OpenShift (task 15), closed by an in-test `ShiftClosed` (CountShift / CloseShift are task 21).
// The `drawer_opened` audit row is task 32b's map (05-2's events; audit-map.int.test.ts asserts it is not mapped yet).
// Owner ruling for task 23 (2026-11-20, 05 v1.0.18): no `bill_print_jobs` row; statements ≤ 4; result `{ shift_id, printed }`.
import type { EventDraft, PosEvent } from '@pos/events';
import { aPaymentAdded, aShiftClosed } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandCtx, CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { statementCounter } from '../helpers/statement-counter';
import { type TestHub } from '../helpers/test-hub';
import { drawerDevice, post, signIn, signInOn, STAFF, startBilling, type Reply, type Who } from './fixtures';

let hub: TestHub;

afterEach(async () => {
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

const OWNER = 'S_OWNER';

// ------------------------------------------------------------------------------------------------ helpers

function openDrawer(who: Who, payload: Record<string, unknown>, commandId?: string): Promise<Reply> {
  return post(hub, who, 'open-cash-drawer', 'OpenCashDrawer', payload, commandId);
}

async function openShift(who: Who, as_drawer: boolean, float_minor = 0): Promise<string> {
  const r = await post(hub, who, 'open-shift', 'OpenShift', { float_minor, as_drawer });
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  return r.result!['shift_id'] as string;
}

type Draft = Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id'>;

function d(built: PosEvent, payload: Record<string, unknown>): Draft {
  const merged = { ...(built.payload as Record<string, unknown>), ...payload };
  const stream_id = built.stream_type === 'bill' ? (merged['bill_id'] as string) : (merged['shift_id'] as string);
  return { stream_type: built.stream_type, stream_id, event_type: built.event_type, schema_version: built.schema_version, payload: merged };
}

function append(...drafts: Draft[]): void {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  hub.deps.writer.run((tx) => tx.append(drafts.map((x) => ({ ...x, occurred_at: now, actor_id: STAFF.cashier, device_id: 'D_FIXTURE' }))));
}

function printer(printer_id: string, o: { archived?: boolean } = {}): void {
  hub.deps.db
    .prepare(`INSERT INTO printers (printer_id, name, connection, address, paper_width_mm, archived_at, updated_at) VALUES (?, ?, 'lan', '192.168.1.50:9100', 80, ?, 1)`)
    .run(printer_id, printer_id, o.archived === true ? 5 : null);
}
function route(scope: 'device' | 'default', ref_id: string, printer_id: string): void {
  hub.deps.db.prepare('INSERT INTO bill_routes (scope, ref_id, printer_id) VALUES (?, ?, ?)').run(scope, ref_id, printer_id);
}

const jobs = () =>
  (hub.deps.db.prepare(`SELECT job_id, printer_id, payload FROM print_jobs WHERE kind = 'document' ORDER BY created_at, job_id`).all() as Array<{ job_id: string; printer_id: string; payload: string }>).map((j) => ({
    job_id: j.job_id,
    printer_id: j.printer_id,
    payload: JSON.parse(j.payload) as unknown,
  }));
const drawerEvents = () => hub.deps.db.prepare(`SELECT stream_id, payload FROM events WHERE event_type = 'DrawerOpened' ORDER BY seq`).all() as Array<{ stream_id: string; payload: string }>;
const texts = () => hub.deps.db.prepare('SELECT subject_id, field, text FROM bill_texts ORDER BY text').all() as Array<{ subject_id: string; field: string; text: string }>;

/** Every table of the hub database except `bill_texts`, and the hub log, that contains `needle` (privacy, H3-5 / H-4). */
function leaksOf(needle: string): string[] {
  const tables = (hub.deps.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'bill_texts'`).all() as Array<{ name: string }>).map((t) => t.name);
  const hits = tables.filter((name) => JSON.stringify(hub.deps.db.prepare(`SELECT * FROM "${name}"`).all()).includes(needle));
  if (hub.logs().includes(needle)) hits.push('hub.logs()');
  return hits;
}

/** A cashier kiosk with an active printer on its own bill route, `staffId` signed in, a drawer shift open. */
async function drawerWithPrinter(staffId: string = STAFF.cashier, printerId = 'PR_COUNTER'): Promise<{ who: Who; shift_id: string }> {
  const who = signInOn(hub, staffId, drawerDevice(hub, `Kiosk ${staffId}`));
  if (hub.deps.db.prepare('SELECT 1 FROM printers WHERE printer_id = ?').get(printerId) === undefined) printer(printerId);
  route('device', who.deviceId, printerId);
  const shift_id = await openShift(who, true);
  return { who, shift_id };
}

/** OpenCashDrawer's handler statements (this server's definition), the in-handler append (00's) left out. */
async function commandStatements(run: () => Promise<Reply>): Promise<{ reply: Reply; statements: number; ran: boolean }> {
  const counter = statementCounter(hub.deps.db);
  const def = commandRegistry(hub.app).byPath('open-cash-drawer') as CommandDef;
  const original = def.handle;
  let statements = -1;
  def.handle = (ctx: CommandCtx, payload, cmd) => {
    let inAppend = 0;
    const tx = {
      ...ctx.tx,
      append: (drafts: EventDraft[]) => {
        const at = counter.count;
        try {
          return ctx.tx.append(drafts);
        } finally {
          inAppend += counter.count - at;
        }
      },
    };
    const before = counter.count;
    try {
      return original.call(def, { ...ctx, tx }, payload, cmd);
    } finally {
      statements = counter.count - before - inAppend;
    }
  };
  try {
    const reply = await run();
    return { reply, statements, ran: statements >= 0 };
  } finally {
    def.handle = original;
  }
}

// ------------------------------------------------------------------------------------------------ #55

describe('[05 §6.21] OpenCashDrawer', () => {
  it('[05 #55] on a drawer: DrawerOpened { shift_id, device_id, reason_code, has_note, note_id } on the shift stream; the kick on the device\'s own route', async () => {
    hub = await startBilling();
    const { who, shift_id } = await drawerWithPrinter();
    expect(jobs()).toHaveLength(0); // OpenShift with float 0: no kick
    const r = await openDrawer(who, { reason_code: 'change_for_customer' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toEqual({ shift_id, printed: true }); // printed = a kick job queued
    expect(r.events.map((e) => e.event_type)).toEqual(['DrawerOpened']);
    expect(r.events[0]).toMatchObject({ stream_type: 'shift', stream_id: shift_id, actor_id: STAFF.cashier, device_id: who.deviceId });
    expect(r.events[0]!.payload).toEqual({ shift_id, device_id: who.deviceId, reason_code: 'change_for_customer', has_note: false, note_id: null });
    // P0.16 / §3.16: a standalone kick Doc, exactly OpenShift's job (no receipt around it, no kind label)
    expect(jobs().map(({ printer_id, payload }) => ({ printer_id, payload }))).toEqual([{ printer_id: 'PR_COUNTER', payload: { doc: { blocks: [{ drawer: true }] } } }]);
    // owner ruling (v1.0.18): not a bill document, no bill_print_jobs row
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM bill_print_jobs').pluck().get()).toBe(0);
    // the shifts fold writes no row for it (§5) and expected cash does not move
    expect(hub.deps.db.prepare('SELECT expected_cash_minor FROM shifts WHERE shift_id = ?').pluck().get(shift_id)).toBe(0);
  });

  it('[05 #55] reason other with a note: the note in bill_texts under the event\'s note_id, has_note true; check_cash without a note', async () => {
    hub = await startBilling();
    const { who, shift_id } = await drawerWithPrinter();
    const other = await openDrawer(who, { reason_code: 'other', note: 'Coins for the till' });
    expect(other.status, JSON.stringify(other.error)).toBe(200);
    const p = other.events[0]!.payload;
    expect(p).toMatchObject({ shift_id, reason_code: 'other', has_note: true });
    expect(typeof p['note_id']).toBe('string');
    expect(texts()).toEqual([{ subject_id: p['note_id'], field: 'note', text: 'Coins for the till' }]);
    const check = await openDrawer(who, { reason_code: 'check_cash', note: '   ' });
    expect(check.status, JSON.stringify(check.error)).toBe(200);
    expect(check.events[0]!.payload).toMatchObject({ reason_code: 'check_cash', has_note: false, note_id: null });
    expect(texts()).toHaveLength(1);
    expect(jobs()).toHaveLength(2);
  });

  it('[05 #55, B11] the device is the drawer: whoever is signed in on it (a takeover) opens that shift\'s drawer', async () => {
    hub = await startBilling();
    const { who, shift_id } = await drawerWithPrinter();
    hub.deps.db.prepare(`UPDATE staff_sessions SET ended_at = ?, end_reason = 'logout' WHERE session_id = ?`).run(hub.clock.branchNow(), who.sessionId);
    const manager = signInOn(hub, STAFF.manager, { deviceId: who.deviceId, token: who.token });
    const r = await openDrawer(manager, { reason_code: 'check_cash' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toEqual({ shift_id, printed: true });
    expect(r.events[0]).toMatchObject({ stream_id: shift_id, actor_id: STAFF.manager });
  });

  it('[05 #55] off a drawer → 409 SHIFT_NOT_OPEN { reason: no_drawer_shift }: no shift, the caller\'s own shift that is not a drawer, a drawer shift that is closed; nothing written', async () => {
    hub = await startBilling();
    printer('PR_TAB');
    // a tablet with its own route and no shift at all
    const tablet = signIn(hub, STAFF.cashier);
    route('device', tablet.deviceId, 'PR_TAB');
    // the caller's own open shift, not a drawer (on a kiosk with its own route)
    const own = signInOn(hub, STAFF.manager, drawerDevice(hub, 'Own'));
    route('device', own.deviceId, 'PR_TAB');
    await openShift(own, false);
    // a drawer shift on this kiosk, closed
    const { who: closed, shift_id } = await drawerWithPrinter(OWNER, 'PR_TAB');
    append(d(aShiftClosed(), { shift_id }));
    for (const who of [tablet, own, closed]) {
      const r = await openDrawer(who, { reason_code: 'change_for_customer' });
      expect(r.status).toBe(409);
      expect(r.error).toEqual({ code: 'SHIFT_NOT_OPEN', details: { reason: 'no_drawer_shift' } });
    }
    expect(drawerEvents()).toEqual([]);
    expect(jobs()).toEqual([]);
    expect(texts()).toEqual([]);
  });

  it('[05 §3.16, R-57, R8] the kick goes only on the device\'s own route: none (a default printer exists) or an archived one → DrawerOpened, no job, printed false, logged with ids', async () => {
    hub = await startBilling();
    printer('PR_DEFAULT');
    route('default', '', 'PR_DEFAULT');
    printer('PR_OLD', { archived: true });
    const bare = signInOn(hub, STAFF.cashier, drawerDevice(hub, 'Bare'));
    const bareShift = await openShift(bare, true);
    const stale = signInOn(hub, STAFF.manager, drawerDevice(hub, 'Stale'));
    route('device', stale.deviceId, 'PR_OLD');
    const staleShift = await openShift(stale, true);
    for (const [who, shift_id] of [[bare, bareShift], [stale, staleShift]] as const) {
      const r = await openDrawer(who, { reason_code: 'change_for_customer' });
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      expect(r.result).toEqual({ shift_id, printed: false });
      expect(r.events.map((e) => e.event_type)).toEqual(['DrawerOpened']);
      expect(hub.logs()).toContain(shift_id);
    }
    expect(jobs()).toEqual([]);
  });

  it('[05 §6.21, §4.4] Zod .strict(): reason_code in the three codes, note ≤ 200 and required for other, no other key → 400 VALIDATION_FAILED, before the drawer check', async () => {
    hub = await startBilling();
    const tablet = signIn(hub, STAFF.cashier); // no drawer: a 400 here proves Zod ran first
    for (const payload of [
      {},
      { reason_code: 'no_sale' },
      { reason_code: 'other' },
      { reason_code: 'other', note: '  ' },
      { reason_code: 'check_cash', note: 'x'.repeat(201) },
      { reason_code: 'check_cash', note: 5 },
      { reason_code: 'check_cash', device_id: 'D_OTHER' },
      { reason_code: 'check_cash', shift_id: 'SH_X' },
    ]) {
      const r = await openDrawer(tablet, payload);
      expect(r.status, JSON.stringify(payload)).toBe(400);
      expect(r.error?.code).toBe('VALIDATION_FAILED');
    }
    const { who } = await drawerWithPrinter(STAFF.manager);
    const max = await openDrawer(who, { reason_code: 'other', note: 'x'.repeat(200) });
    expect(max.status, JSON.stringify(max.error)).toBe(200);
  });

  it('[05 §6.21] without open-cash-drawer → 403 PERMISSION_DENIED after Zod, before the drawer check; the handler never runs', async () => {
    hub = await startBilling();
    printer('PR_COUNTER');
    // the Order taker holds manage-own-shift but not open-cash-drawer (default roles); a drawer shift of their own
    const taker = signInOn(hub, STAFF.orderTaker, drawerDevice(hub, 'Taker kiosk'));
    route('device', taker.deviceId, 'PR_COUNTER');
    await openShift(taker, true);
    const bad = await openDrawer(taker, { reason_code: 'nope' });
    expect(bad.status).toBe(400);
    const { reply, ran } = await commandStatements(() => openDrawer(taker, { reason_code: 'check_cash' }));
    expect(reply.status).toBe(403);
    expect(reply.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'open-cash-drawer' } });
    expect(ran).toBe(false);
    expect(drawerEvents()).toEqual([]);
    expect(jobs()).toEqual([]);
  });

  it('[05 §6.21, 00 §3.7] a retransmit with the same command_id replays the first answer: one DrawerOpened, one kick (also at once)', async () => {
    hub = await startBilling();
    const { who } = await drawerWithPrinter();
    const [a, b] = await Promise.all([
      openDrawer(who, { reason_code: 'change_for_customer' }, 'nosale-1'),
      openDrawer(who, { reason_code: 'change_for_customer' }, 'nosale-1'),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.result).toEqual(a.result);
    const again = await openDrawer(who, { reason_code: 'change_for_customer' }, 'nosale-1');
    expect(again.result).toEqual(a.result);
    expect(drawerEvents()).toHaveLength(1);
    expect(jobs()).toHaveLength(1);
    // a new command_id is a new no-sale
    const next = await openDrawer(who, { reason_code: 'change_for_customer' }, 'nosale-2');
    expect(next.status).toBe(200);
    expect(drawerEvents()).toHaveLength(2);
    expect(jobs()).toHaveLength(2);
  });

  it('[05 row H-4] the same command_id with only the note changed replays the stored reply (not a mismatch); another reason is a mismatch', async () => {
    hub = await startBilling();
    const { who } = await drawerWithPrinter();
    const first = await openDrawer(who, { reason_code: 'other', note: 'first note' }, 'nosale-hash');
    expect(first.status).toBe(200);
    const second = await openDrawer(who, { reason_code: 'other', note: 'second note' }, 'nosale-hash');
    expect(second.status).toBe(200);
    expect(second.result).toEqual(first.result);
    expect(drawerEvents()).toHaveLength(1);
    expect(texts().map((t) => t.text)).toEqual(['first note']);
    const other = await openDrawer(who, { reason_code: 'check_cash' }, 'nosale-hash');
    expect(other.status).not.toBe(200);
    expect(drawerEvents()).toHaveLength(1);
  });

  it('[05 §6.21 Statements] ≤ 4: 4 with a note, 3 without, 1 off a drawer or with no own route, the same with 1 and with 40 shifts and payments in the store', async () => {
    hub = await startBilling();
    printer('PR_COUNTER');
    const business_date = hub.deps.state.get().business_day!.business_date;
    const counts: number[][] = [];
    for (const n of [1, 40]) {
      for (let i = 0; i < n; i += 1) {
        const shift_id = `PAST_${n}_${i}`;
        append({ stream_type: 'shift', stream_id: shift_id, event_type: 'ShiftOpened', schema_version: 1, payload: { shift_id, staff_id: `S_PAST_${n}_${i}`, drawer_device_id: null, float_minor: 0, business_date } });
        append(d(aPaymentAdded(), { payment_id: `PAY_${n}_${i}`, bill_id: `BILL_${n}_${i}`, shift_id, amount_minor: 1_000, tendered_minor: null, change_minor: null }));
        append(d(aShiftClosed(), { shift_id }));
      }
      const staff = n === 1 ? STAFF.cashier : STAFF.manager;
      const { who } = await drawerWithPrinter(staff);
      const withNote = await commandStatements(() => openDrawer(who, { reason_code: 'other', note: 'float top-up' }));
      expect(withNote.reply.status, JSON.stringify(withNote.reply.error)).toBe(200);
      const without = await commandStatements(() => openDrawer(who, { reason_code: 'check_cash' }));
      expect(without.reply.status).toBe(200);
      counts.push([withNote.statements, without.statements]);
    }
    expect(counts).toEqual([
      [4, 3],
      [4, 3],
    ]);
    // no own route: the read only
    const bare = signInOn(hub, OWNER, drawerDevice(hub, 'Bare'));
    await openShift(bare, true);
    const unrouted = await commandStatements(() => openDrawer(bare, { reason_code: 'check_cash' }));
    expect(unrouted.reply.status).toBe(200);
    expect(unrouted.statements).toBe(1);
    // off a drawer: the read only
    const tablet = signIn(hub, STAFF.cashier);
    const off = await commandStatements(() => openDrawer(tablet, { reason_code: 'check_cash' }));
    expect(off.reply.status).toBe(409);
    expect(off.statements).toBe(1);
  });

  it('[05 B30, H3-5, row H-4] privacy scan: after no-sales with notes (kicked, unrouted, replayed with another note), no note text is in any table but bill_texts, nor in the log', async () => {
    hub = await startBilling();
    const { who } = await drawerWithPrinter();
    const bare = signInOn(hub, STAFF.manager, drawerDevice(hub, 'Bare'));
    await openShift(bare, true);
    const NOTES = ['PRIVNOTE-kick-1A', 'PRIVNOTE-bare-2B', 'PRIVNOTE-replay-3C'];
    expect((await openDrawer(who, { reason_code: 'other', note: NOTES[0] }, 'pv-1')).status).toBe(200);
    expect((await openDrawer(bare, { reason_code: 'other', note: NOTES[1] })).status).toBe(200);
    expect((await openDrawer(who, { reason_code: 'other', note: NOTES[2] }, 'pv-1')).status).toBe(200);
    expect(texts().map((t) => t.text)).toEqual([NOTES[1], NOTES[0]]); // ordered by text
    for (const note of NOTES) expect(leaksOf(note), note).toEqual([]);
    // the scan itself sees a table: the shared marker is in bill_texts only
    expect(JSON.stringify(hub.deps.db.prepare('SELECT * FROM bill_texts').all())).toContain('PRIVNOTE');
  });
});
