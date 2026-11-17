import type { DirectoryInput } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { AUDIT_LOG_MAX_RANGE_MS, auditLogSql } from '../../src/audit/queries';
import { currentConfigEntry, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { seedDirectory, type TestHub } from '../helpers/test-hub';
import { statementCounter } from '../helpers/statement-counter';
import { append, answer, FX, openSeating, raiseVoid, signIn, STAFF, stagedOrder, startVoids, VX, type Who } from '../voids/fixtures';
import { auditDirectory, withTestApply } from './fixtures';

// 04 §6.5 `GET /queries/audit-log`, §6.5b `GET /queries/audit-staff` (a3) over the real `audit` projection (a2) and
// staff_names (00 row H-1, u6). Tests 51, 52, 60b (server half). Real events through the hub's writer and 01d's
// AnswerRequest / WithdrawRequest; the void `apply` is the audit tests' minimal one (v7 builds the real one).

let hub: TestHub | undefined;

afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined;
});

const NO_PIN = 'S_RUNNER';

/** auditDirectory() plus a no-PIN runner (u6 names them too); `without` drops a person (a leaver), version bumped. */
async function directory(o: { version?: number; without?: string } = {}): Promise<DirectoryInput> {
  const base = await auditDirectory();
  return {
    ...base,
    directory_version: o.version ?? base.directory_version,
    staff: base.staff.filter((s) => s.staff_id !== o.without),
    no_pin_staff: [...(base.no_pin_staff ?? []), { staff_id: NO_PIN, display_name: 'Runner Bilal', lead_staff_id: null }].filter((s) => s.staff_id !== o.without),
  };
}

interface Day {
  manager: Who;
  cashier: Who;
  order_id: string;
  approved: string;
  closed: string;
  from: number;
  to: number;
}

/** voidsMenu() table whose name differs from its id: 'Garden East 1'. */
const TABLE = VX.longTables[0];
const TABLE_NAME = 'Garden East 1';

/**
 * On a dine-in order at TABLE (named 'Garden East 1'): a void approved (Cashier asks, Manager answers), one rejected, one
 * withdrawn, one closed `obsolete` by its own requester (actor = approver); a station paused by the no-PIN runner.
 */
async function auditDay(): Promise<Day> {
  hub = await startVoids({ directory: await directory() });
  const from = hub.clock.branchNow();
  const cashier = signIn(hub, STAFF.cashier);
  const manager = signIn(hub, STAFF.manager);
  openSeating(hub, { table_id: TABLE, seating_id: 'SEAT_Q' });
  const s = stagedOrder(hub, { seating_id: 'SEAT_Q' });
  const approved = raiseVoid(hub, { requester: cashier, order_id: s.order_id, order_item_id: s.served, disposition: 'wastage' });
  const rejected = raiseVoid(hub, { requester: cashier, order_id: s.order_id, order_item_id: s.done, disposition: 'staff_meal' });
  await withTestApply(async () => {
    expect((await answer(hub!, manager, approved.alert_id, 'approve')).status).toBe(200);
    expect((await answer(hub!, manager, rejected.alert_id, 'reject')).status).toBe(200);
  });
  const withdrawn = raiseVoid(hub, { requester: cashier, order_id: s.order_id, order_item_id: s.done, disposition: 'wastage' });
  expect((await answer(hub, cashier, withdrawn.alert_id, 'withdraw')).status).toBe(200);
  const closed = raiseVoid(hub, { requester: cashier, order_id: s.order_id, order_item_id: s.cooking, disposition: 'wastage' });
  append(hub, [{ stream_type: 'order', stream_id: s.order_id, event_type: 'AlertClosed', payload: { alert_id: closed.alert_id, reason: 'obsolete', by_staff_id: STAFF.cashier, note: null } }], { actor: STAFF.cashier });
  append(hub, [{ stream_type: 'station', stream_id: FX.station, event_type: 'StationPauseSet', payload: { station_id: FX.station, paused: true } }], { actor: NO_PIN });
  hub.clock.advance(1_000);
  return { manager, cashier, order_id: s.order_id, approved: approved.alert_id, closed: closed.alert_id, from, to: hub.clock.branchNow() + 1 };
}

interface Entry {
  seq: number;
  recorded_at: number;
  action: string;
  actor_staff_id: string | null;
  approver_staff_id: string | null;
  actor_name: string | null;
  approver_name: string | null;
  method: string | null;
  order_id: string | null;
  table_id: string | null;
  table_code: string | null;
  table_name: string | null;
  outcome: string | null;
  detail_json: string;
}
interface Reply {
  status: number;
  entries: Entry[];
  next_cursor: string | null;
  error?: { code: string; details: Record<string, unknown> };
}

async function auditLog(who: Who, q: Record<string, string | number | undefined>): Promise<Reply> {
  const qs = new URLSearchParams(Object.entries(q).filter((e): e is [string, string | number] => e[1] !== undefined).map(([k, v]): [string, string] => [k, String(v)])).toString();
  const res = await hub!.app.inject({ method: 'GET', url: `/queries/audit-log?${qs}`, headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
  const body = res.json() as { data?: { entries: Entry[] }; meta?: { next_cursor: string | null }; error?: Reply['error'] };
  return { status: res.statusCode, entries: body.data?.entries ?? [], next_cursor: body.meta?.next_cursor ?? null, ...(body.error === undefined ? {} : { error: body.error }) };
}

async function auditStaff(who: Who): Promise<{ status: number; staff: Array<{ staff_id: string; display_name: string; in_directory: boolean }>; error?: { code: string } }> {
  const res = await hub!.app.inject({ method: 'GET', url: '/queries/audit-staff', headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
  const body = res.json() as { data?: { staff: Array<{ staff_id: string; display_name: string; in_directory: boolean }> }; error?: { code: string } };
  return { status: res.statusCode, staff: body.data?.staff ?? [], ...(body.error === undefined ? {} : { error: body.error }) };
}

const allRows = () =>
  hub!.deps.db.prepare('SELECT seq, recorded_at, action, actor_staff_id, approver_staff_id FROM audit_entries ORDER BY recorded_at DESC, seq DESC').all() as Array<{
    seq: number;
    recorded_at: number;
    action: string;
    actor_staff_id: string | null;
    approver_staff_id: string | null;
  }>;

describe('[04 §6.5] audit-log', () => {
  it('[04 #52] time range only: newest first, (recorded_at, seq) desc, every row in [from, to); 1 statement', async () => {
    const day = await auditDay();
    const counter = statementCounter(hub!.deps.readDb);
    const r = await auditLog(day.manager, { from: day.from, to: day.to });
    expect(counter.count).toBe(1);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const want = allRows().filter((x) => x.recorded_at >= day.from && x.recorded_at < day.to);
    expect(want.length).toBeGreaterThan(8);
    expect(r.entries.map((e) => e.seq)).toEqual(want.map((x) => x.seq));
    expect(r.next_cursor).toBeNull();
    // a narrower range cuts both ends
    const mid = want[Math.floor(want.length / 2)]!.recorded_at;
    const lower = await auditLog(day.manager, { from: day.from, to: mid });
    expect(lower.entries.map((e) => e.seq)).toEqual(want.filter((x) => x.recorded_at < mid).map((x) => x.seq));
  });

  it('[04 #52, H3-1, H6-4, H6-10] staff_id = actor or approver: the approved void once under the requester (actor) and once under the approver; rejected, withdrawn and closed-obsolete under the requester; actor = approver → one row', async () => {
    const day = await auditDay();
    const cashier = await auditLog(day.manager, { from: day.from, to: day.to, staff_id: STAFF.cashier });
    const manager = await auditLog(day.manager, { from: day.from, to: day.to, staff_id: STAFF.manager });
    expect(cashier.status).toBe(200);
    const of = (r: Reply, action: string) => r.entries.filter((e) => e.action === action);
    // the approved void: one item_voided row, actor Cashier, approver Manager — in both lists, once each
    const voided = of(cashier, 'item_voided');
    expect(voided).toHaveLength(1);
    expect(voided[0]).toMatchObject({ actor_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager, actor_name: 'Cashier', approver_name: 'Manager' });
    // §6.5: the row as stored — detail_json is the stored string, no parsed field added
    const stored = hub!.deps.db.prepare('SELECT * FROM audit_entries WHERE seq = ?').get(voided[0]!.seq) as Record<string, unknown>;
    expect(voided[0]).toStrictEqual({ ...stored, actor_name: 'Cashier', approver_name: 'Manager', table_name: TABLE_NAME });
    expect(JSON.parse(voided[0]!.detail_json)).toMatchObject({ alert_id: day.approved, envelope_actor_id: STAFF.manager });
    expect(of(manager, 'item_voided').map((e) => e.seq)).toEqual([voided[0]!.seq]);
    // under the requester: the answers (approved and rejected), the withdrawal, the obsolete close
    expect(of(cashier, 'void_answered').map((e) => e.outcome)).toEqual(['rejected', 'approved']);
    expect(of(cashier, 'request_withdrawn')).toHaveLength(1);
    // closed by its own requester: actor = approver = Cashier → listed once (the approver branch skips it)
    expect(of(cashier, 'request_closed')).toMatchObject([{ actor_staff_id: STAFF.cashier, approver_staff_id: STAFF.cashier, outcome: 'obsolete' }]);
    expect(of(cashier, 'void_requested')).toHaveLength(4);
    // exactly the rows where the person is actor or approver, each once, in order
    const mine = (id: string) => allRows().filter((x) => x.recorded_at >= day.from && (x.actor_staff_id === id || x.approver_staff_id === id)).map((x) => x.seq);
    expect(cashier.entries.map((e) => e.seq)).toEqual(mine(STAFF.cashier));
    expect(manager.entries.map((e) => e.seq)).toEqual(mine(STAFF.manager));
    expect(new Set(cashier.entries.map((e) => e.seq)).size).toBe(cashier.entries.length);
  });

  it('[04 #52] action list: one branch per action; with staff_id 2k branches; 1 statement', async () => {
    const day = await auditDay();
    const counter = statementCounter(hub!.deps.readDb);
    const r = await auditLog(day.manager, { from: day.from, to: day.to, action: 'item_voided,void_answered,request_closed' });
    expect(counter.count).toBe(1);
    expect(r.entries.map((e) => e.seq)).toEqual(allRows().filter((x) => x.recorded_at >= day.from && ['item_voided', 'void_answered', 'request_closed'].includes(x.action)).map((x) => x.seq));
    counter.reset();
    const both = await auditLog(day.manager, { from: day.from, to: day.to, staff_id: STAFF.manager, action: 'item_voided,void_answered,request_closed' });
    expect(counter.count).toBe(1);
    // newest first: the rejected answer, then the approve's ItemVoided (folded after its RequestAnswered), then that answer
    expect(both.entries.map((e) => [e.action, e.approver_staff_id, e.outcome])).toEqual([
      ['void_answered', STAFF.manager, 'rejected'],
      ['item_voided', STAFF.manager, 'wastage'],
      ['void_answered', STAFF.manager, 'approved'],
    ]);
  });

  it('[04 #52] cursor: limit pages chain to the full list, no row twice; default limit 50; 1 statement a page', async () => {
    const day = await auditDay();
    const full = (await auditLog(day.manager, { from: day.from, to: day.to })).entries.map((e) => e.seq);
    const counter = statementCounter(hub!.deps.readDb);
    const seen: number[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      counter.reset();
      const r = await auditLog(day.manager, { from: day.from, to: day.to, limit: 3, cursor });
      expect(counter.count).toBe(1);
      expect(r.entries.length).toBeLessThanOrEqual(3);
      seen.push(...r.entries.map((e) => e.seq));
      pages += 1;
      if (r.next_cursor === null) break;
      cursor = r.next_cursor;
    }
    expect(seen).toEqual(full);
    expect(pages).toBe(Math.ceil(full.length / 3) + (full.length % 3 === 0 ? 1 : 0) || 1);
    // staff filter pages the same way (the cursor is in every branch)
    const staffFull = (await auditLog(day.manager, { from: day.from, to: day.to, staff_id: STAFF.cashier })).entries.map((e) => e.seq);
    const p1 = await auditLog(day.manager, { from: day.from, to: day.to, staff_id: STAFF.cashier, limit: 4 });
    const p2 = await auditLog(day.manager, { from: day.from, to: day.to, staff_id: STAFF.cashier, limit: 200, cursor: p1.next_cursor! });
    expect([...p1.entries, ...p2.entries].map((e) => e.seq)).toEqual(staffFull);
    // default 50: 60 more mapped events → first page 50 with a cursor
    for (let n = 0; n < 60; n += 1) append(hub!, [{ stream_type: 'station', stream_id: FX.station, event_type: 'StationPauseSet', payload: { station_id: FX.station, paused: n % 2 === 0 } }], { actor: STAFF.manager });
    const first = await auditLog(day.manager, { from: day.from, to: hub!.clock.branchNow() + 1 });
    expect(first.entries).toHaveLength(50);
    expect(first.next_cursor).not.toBeNull();
  });

  it('[04 #51, OQ-E] names come from staff_names at read: a leaver and a no-PIN runner show their last known name', async () => {
    const day = await auditDay();
    // the Cashier leaves (directory v2 without them): u6 keeps their staff_names row
    await seedDirectory(hub!, await directory({ version: 2, without: STAFF.cashier }));
    const r = await auditLog(day.manager, { from: day.from, to: day.to });
    expect(r.entries.find((e) => e.action === 'item_voided')).toMatchObject({ actor_name: 'Cashier', approver_name: 'Manager' });
    expect(r.entries.find((e) => e.action === 'station_paused')).toMatchObject({ actor_staff_id: NO_PIN, actor_name: 'Runner Bilal' });
    // a person never in staff_names → null name, the id stays
    hub!.deps.db.prepare('DELETE FROM staff_names WHERE staff_id = ?').run(NO_PIN);
    const gone = await auditLog(day.manager, { from: day.from, to: day.to, action: 'station_paused' });
    expect(gone.entries[0]).toMatchObject({ actor_staff_id: NO_PIN, actor_name: null });
  });

  it('[04 #52] table_name from the branch config; an archived table falls back to the stored table_code, then the id', async () => {
    const day = await auditDay();
    const named = await auditLog(day.manager, { from: day.from, to: day.to, action: 'void_requested,item_voided' });
    expect(named.entries.length).toBeGreaterThan(0);
    for (const e of named.entries) expect(e).toMatchObject({ table_id: TABLE, table_name: TABLE_NAME });
    // the table archived: its config row gone
    const entry = currentConfigEntry()!;
    const floors = entry.config.floors.map((f) => ({ ...f, tables: f.tables.filter((t) => t.table_id !== TABLE) }));
    swapBranchConfig({ ...entry, config: { ...entry.config, floors } });
    const archived = await auditLog(day.manager, { from: day.from, to: day.to, action: 'void_requested,item_voided' });
    const requested = archived.entries.filter((e) => e.action === 'void_requested');
    expect(requested.length).toBeGreaterThan(0);
    for (const e of requested) expect(e).toMatchObject({ table_code: TABLE_NAME, table_name: TABLE_NAME }); // the code stored at raise
    // the approved item_voided carries its request's table_code (§3.6 via alert_id): the same fallback
    for (const e of archived.entries.filter((x) => x.action === 'item_voided')) expect(e).toMatchObject({ table_code: TABLE_NAME, table_name: TABLE_NAME });
    hub!.deps.db.prepare(`UPDATE audit_entries SET table_code = NULL WHERE action = 'void_requested'`).run();
    const bare = await auditLog(day.manager, { from: day.from, to: day.to, action: 'void_requested' });
    expect(bare.entries.length).toBeGreaterThan(0);
    for (const e of bare.entries) expect(e.table_name).toBe(TABLE);
  });

  it('[04 #52, H3-6] 400s: to − from > 31 d, from ≥ to, repeated or unknown action, bad cursor, limit > 200', async () => {
    const day = await auditDay();
    const bad = async (q: Record<string, string | number>) => {
      const r = await auditLog(day.manager, q);
      expect(r.status, JSON.stringify(q)).toBe(400);
      expect(r.error?.code).toBe('VALIDATION_FAILED');
    };
    await bad({ from: 0, to: AUDIT_LOG_MAX_RANGE_MS + 1 });
    expect((await auditLog(day.manager, { from: 0, to: AUDIT_LOG_MAX_RANGE_MS })).status).toBe(200);
    await bad({ from: day.to, to: day.to });
    await bad({ from: day.from, to: day.to, action: 'item_voided,item_voided' });
    await bad({ from: day.from, to: day.to, action: 'item_voided,session_started' });
    await bad({ from: day.from, to: day.to, cursor: 'not-a-cursor' });
    await bad({ from: day.from, to: day.to, cursor: Buffer.from(JSON.stringify({ r: 1 })).toString('base64url') });
    await bad({ from: day.from, to: day.to, limit: 201 });
    await bad({ to: day.to });
    await bad({ from: '', to: day.to });
    await bad({ from: day.from, to: '' });
    await bad({ from: -1, to: day.to });
  });

  it('[04 #52] no view-audit-log → 403 (Cashier), for audit-log and audit-staff', async () => {
    const day = await auditDay();
    const r = await auditLog(day.cashier, { from: day.from, to: day.to });
    expect(r.status).toBe(403);
    expect(r.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'view-audit-log' } });
    expect((await auditStaff(day.cashier)).status).toBe(403);
  });
});

describe('[04 #52] EXPLAIN QUERY PLAN: no temp sort in any shape', () => {
  const shapes = [
    { name: 'time only', shape: { staff: false, actions: 0 }, branches: 1 },
    { name: 'single staff', shape: { staff: true, actions: 0 }, branches: 2 },
    { name: 'single action', shape: { staff: false, actions: 1 }, branches: 1 },
    { name: 'staff + 3 actions', shape: { staff: true, actions: 3 }, branches: 6 },
    { name: '3 actions', shape: { staff: false, actions: 3 }, branches: 3 },
  ];
  it.each(shapes)('[04 #52, H4-4, H4-6] $name: $branches branch(es), the cursor in every branch, MERGE (UNION ALL) when > 1, no USE TEMP B-TREE', async ({ shape, branches }) => {
    await auditDay();
    const sql = auditLogSql(shape);
    expect(sql.split('UNION ALL')).toHaveLength(branches);
    expect(sql.match(/\(e\.recorded_at, e\.seq\) < \(@r, @s\)/g)).toHaveLength(branches);
    expect(sql.match(/ORDER BY/g)).toHaveLength(1);
    const params: Record<string, string | number> = { from: 0, to: 10, r: 10, s: 0, limit: 51 };
    if (shape.staff) params.staff = STAFF.cashier;
    for (let i = 0; i < shape.actions; i += 1) params[`a${i}`] = ['item_voided', 'void_answered', 'request_closed'][i]!;
    const plan = (hub!.deps.readDb.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(params) as Array<{ detail: string }>).map((p) => p.detail).join('\n');
    expect(plan).not.toMatch(/TEMP B-TREE/);
    if (branches > 1) expect(plan).toMatch(/MERGE \(UNION ALL\)/);
    expect(plan).not.toMatch(/SCAN e\b/);
    if (shape.staff) expect(plan).toMatch(/audit_entries_appr/);
    // actor branches: audit_entries_actor alone; with an action SQLite takes audit_entries_action (also ordered)
    if (shape.staff && shape.actions === 0) expect(plan).toMatch(/audit_entries_actor/);
    if (shape.actions > 0) expect(plan).toMatch(/audit_entries_action/);
    if (!shape.staff && shape.actions === 0) expect(plan).toMatch(/audit_entries_time/);
  });
});

describe('[04 §6.5b] audit-staff', () => {
  it('[04 #60b, H6-3] everyone in staff_names by name, a leaver marked in_directory false; 1 statement', async () => {
    const day = await auditDay();
    await seedDirectory(hub!, await directory({ version: 2, without: STAFF.cashier }));
    const counter = statementCounter(hub!.deps.readDb);
    const r = await auditStaff(day.manager);
    expect(counter.count).toBe(1);
    expect(r.status).toBe(200);
    const names = r.staff.map((s) => s.display_name);
    expect(names).toEqual([...names].sort());
    expect(r.staff.find((s) => s.staff_id === STAFF.cashier)).toEqual({ staff_id: STAFF.cashier, display_name: 'Cashier', in_directory: false });
    expect(r.staff.find((s) => s.staff_id === STAFF.manager)).toMatchObject({ in_directory: true });
    expect(r.staff.find((s) => s.staff_id === NO_PIN)).toEqual({ staff_id: NO_PIN, display_name: 'Runner Bilal', in_directory: true });
  });
});
