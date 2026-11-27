import { ErrorCatalogue } from '@pos/domain';
import type { DirectoryInput } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { printTakeawaySlipCommand } from '../../src/print/commands/print-takeaway-slip';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { append as kdsAppend } from '../kds/fixtures';
import { FX, appendOrder, openDay, openSeating } from '../orders/fixtures';

// 03c v1.0.16 §3.9, §3.10, §3.11, §6.7, §6.14 (task 31; 02b-TK R6; hostile runs 1–2): PrintTakeawaySlip; tests 59, 60,
// 62, 63, 64 (command part), 66 (catalogue). L-ORDERS-1 S-3.

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;

const CASH = 'S_CASH1'; // take-order own_tables
const CASH2 = 'S_CASH2'; // take-order own_tables, the placer of the tokens
const ASK = 'S_ASK'; // take-order requires_approval
const NONE = 'S_NONE'; // no take-order

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const grant = (permission: string, grant_type: 'allowed' | 'requires_approval', scope: 'branch' | 'own_tables') => ({
    permission,
    grant_type,
    approver_role_id: grant_type === 'requires_approval' ? 'R_MGR' : null,
    approver_role_ids: grant_type === 'requires_approval' ? ['R_MGR'] : [],
    scope,
  });
  const role = (role_id: string, permissions: ReturnType<typeof grant>[]) => ({ role_id, name: role_id, session_idle_ttl_ms: 3_600_000, permissions });
  const person = (staff_id: string, role_id: string) => ({ staff_id, display_name: staff_id, pin_hash: pin, role_ids: [role_id], denied_permissions: [], lead_staff_id: null, floor_ids: [] });
  return {
    ...base,
    roles: [
      ...base.roles,
      role('R_SLIP_CASH', [grant('take-order', 'allowed', 'own_tables')]),
      role('R_SLIP_ASK', [grant('take-order', 'requires_approval', 'branch')]),
      role('R_SLIP_NONE', []),
    ],
    staff: [...base.staff, person(CASH, 'R_SLIP_CASH'), person(CASH2, 'R_SLIP_CASH'), person(ASK, 'R_SLIP_ASK'), person(NONE, 'R_SLIP_NONE')],
  };
}

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  await seedDirectory(hub, await directory());
  openDay(hub);
  counter = statementCounter(hub.deps.db);
  const def = printTakeawaySlipCommand(hub.app.log);
  commandRegistry(hub.app).register(
    defineCommand({
      ...def,
      commandType: 'TestPrintTakeawaySlipCounted',
      handle(ctx, payload, cmd) {
        const before = counter.count;
        try {
          return def.handle(ctx, payload, cmd);
        } finally {
          lastStatements = counter.count - before;
        }
      },
    }),
  );
});
afterEach(async () => {
  activity.drain();
  swapBranchConfig(null);
  await hub.close();
});

const branch = (): string => hub.deps.config.provisioned!.branch_id;
const hubEvent = (event_type: string, payload: Record<string, unknown>) => kdsAppend(hub, [{ stream_type: 'hub', stream_id: branch(), event_type, payload }], { actor: null });
const printer = (printer_id: string, o: { archived?: boolean; paper_width_mm?: number } = {}) =>
  hubEvent('PrinterSaved', { printer_id, name: printer_id, connection: 'lan', address: '192.168.1.60:9100', paper_width_mm: o.paper_width_mm ?? 80, archived: o.archived ?? false });
const route = (scope: 'device' | 'default', ref_id: string, printer_id: string | null) => hubEvent('BillRouteSet', { scope, ref_id, printer_id });
const onOrder = (order_id: string, event_type: string, payload: Record<string, unknown>) => kdsAppend(hub, [{ stream_type: 'order', stream_id: order_id, event_type, payload }]);
const billed = (...order_ids: string[]) => onOrder(order_ids[0]!, 'OrdersBilled', { order_ids, bill_id: `BL-${order_ids[0]}` });
const takeaway = (o: { order_id?: string; adds_to_order_id?: string; placed_by?: string } = {}) =>
  appendOrder(hub, { order_type: 'takeaway', placed_by: o.placed_by ?? CASH2, ...(o.order_id === undefined ? {} : { order_id: o.order_id }), ...(o.adds_to_order_id === undefined ? {} : { adds_to_order_id: o.adds_to_order_id }), lines: [{ order_item_id: `${o.order_id ?? 'X'}-1`, item_id: FX.naan }] }).order_id;
const jobs = () =>
  hub.deps.db.prepare("SELECT job_id, kind, printer_id, order_id, json_extract(payload, '$.kind_label') AS kind_label, payload FROM print_jobs WHERE kind = 'document' ORDER BY rowid").all() as Array<{
    job_id: string;
    kind: string;
    printer_id: string;
    order_id: string | null;
    kind_label: string | null;
    payload: string;
  }>;

interface Who {
  staffId: string;
  deviceId: string;
  token: string;
  sessionToken: string;
}
function signIn(staffId: string): Who {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, token: device.token, sessionToken: session.token };
}
let seq = 0;
async function slip(who: Who, payload: Record<string, unknown>, o: { command_id?: string; counted?: boolean } = {}) {
  seq += 1;
  const type = o.counted === true ? 'TestPrintTakeawaySlipCounted' : 'PrintTakeawaySlip';
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${o.counted === true ? 'test-print-takeaway-slip-counted' : 'print-takeaway-slip'}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: { command_id: o.command_id ?? `slip-${seq}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type: type, payload, occurred_at: hub.clock.branchNow(), actor_id: who.staffId, device_id: who.deviceId },
  });
  const body = res.json() as { data?: { result: { printed: boolean; job_id: string | null; skipped: string | null } }; error?: { code: string; details: Record<string, unknown> } };
  return { status: res.statusCode, result: body.data?.result, error: body.error };
}

describe('[03c #59] PrintTakeawaySlip happy path (§6.14)', () => {
  it('[03c #59] reprint on an unbilled root → one Token slip job with order_id = root, on the device route else default; printer_id wins; archived → 404; no route → no_printer; retransmit → same result', async () => {
    const root = takeaway({ order_id: 'T1' });
    const who = signIn(CASH);
    // no route at all
    const none = await slip(who, { order_id: root, reason: 'reprint' });
    expect(none).toMatchObject({ status: 200, result: { printed: false, job_id: null, skipped: 'no_printer' } });
    expect(jobs()).toEqual([]);
    printer('PR_DEF');
    printer('PR_DEV', { paper_width_mm: 58 });
    printer('PR_GIVEN');
    printer('PR_OLD', { archived: true });
    route('default', '', 'PR_DEF');
    const viaDefault = await slip(who, { order_id: root, reason: 'reprint' });
    expect(viaDefault.result).toMatchObject({ printed: true, skipped: null });
    route('device', who.deviceId, 'PR_DEV');
    const viaDevice = await slip(who, { order_id: root, reason: 'reprint' });
    const given = await slip(who, { order_id: root, reason: 'reprint', printer_id: 'PR_GIVEN' });
    expect(jobs().map((j) => [j.printer_id, j.order_id, j.kind_label])).toEqual([
      ['PR_DEF', root, 'Token slip'],
      ['PR_DEV', root, 'Token slip'],
      ['PR_GIVEN', root, 'Token slip'],
    ]);
    expect(jobs().map((j) => j.job_id)).toEqual([viaDefault.result!.job_id, viaDevice.result!.job_id, given.result!.job_id]);
    // 58 mm → 32 columns; the slip carries REPRINT, the token and no item, price or name
    const doc = JSON.parse(jobs()[1]!.payload) as { doc: { width_cols: number; blocks: Array<{ text?: string }> } };
    expect(doc.doc.width_cols).toBe(32);
    expect(doc.doc.blocks[0]).toMatchObject({ text: 'REPRINT' });
    expect(doc.doc.blocks.map((b) => b.text).join('|')).not.toMatch(/Naan|Rs|CASH/);
    expect((await slip(who, { order_id: root, reason: 'reprint', printer_id: 'PR_OLD' })).error).toMatchObject({ code: 'PRINTER_NOT_FOUND', details: { printer_id: 'PR_OLD' } });
    // retransmit: the stored result, no second job
    const first = await slip(who, { order_id: root, reason: 'reprint' }, { command_id: 'same' });
    const again = await slip(who, { order_id: root, reason: 'reprint' }, { command_id: 'same' });
    expect(again.result).toEqual(first.result);
    expect(jobs()).toHaveLength(4);
  });

  it('[03c #59 §6.7] print-queue lists the slip with kind_label Token slip and its order_id', async () => {
    const root = takeaway({ order_id: 'T1' });
    printer('PR_DEF');
    route('default', '', 'PR_DEF');
    const r = await slip(signIn(CASH), { order_id: root, reason: 'reprint' });
    const device = pairDevice(hub, { type: 'tablet' });
    const admin = openSession(hub, { kind: 'admin', staffId: 'S_MGR', deviceId: device.deviceId });
    const res = await hub.app.inject({ method: 'GET', url: '/admin/queries/print-queue', headers: { authorization: `Bearer ${device.token}`, 'x-admin-session': admin.token } });
    expect(res.statusCode, res.body).toBe(200);
    const job = (res.json() as { data: { jobs: Array<{ job_id: string; kind_label: string | null; order_id: string | null }> } }).data.jobs.find((j) => j.job_id === r.result!.job_id);
    expect(job).toMatchObject({ kind_label: 'Token slip', order_id: root });
  });
});

describe('[03c #60] refusals and skips (§6.14 steps 4–6)', () => {
  beforeEach(() => {
    printer('PR_DEF');
    route('default', '', 'PR_DEF');
  });

  it('[03c #60] unknown → 404; dine-in / parking → not_takeaway; cancelled → cancelled; billed → billed; unbilled again → prints; VALIDATION_FAILED shapes', async () => {
    const who = signIn(CASH);
    expect((await slip(who, { order_id: 'NOPE', reason: 'reprint' })).error).toMatchObject({ code: 'ORDER_NOT_FOUND', details: { order_id: 'NOPE' } });
    const park = appendOrder(hub, { order_type: 'parking', car_number: 'LEB-1', lines: [{ order_item_id: 'P-1', item_id: FX.naan }] }).order_id;
    expect((await slip(who, { order_id: park, reason: 'reprint' }))).toMatchObject({ status: 409, error: { code: 'TAKEAWAY_SLIP_NOT_ALLOWED', details: { reason: 'not_takeaway' } } });
    const gone = takeaway({ order_id: 'TC' });
    onOrder(gone, 'OrderCancelled', { order_id: gone });
    expect((await slip(who, { order_id: gone, reason: 'reprint' })).error).toMatchObject({ details: { reason: 'cancelled' } });
    const paid = takeaway({ order_id: 'TP' });
    billed(paid);
    expect((await slip(who, { order_id: paid, reason: 'reprint' })).error).toMatchObject({ code: 'TAKEAWAY_SLIP_NOT_ALLOWED', details: { order_id: paid, reason: 'billed' } });
    onOrder(paid, 'OrdersUnbilled', { order_ids: [paid], bill_id: `BL-${paid}` });
    expect((await slip(who, { order_id: paid, reason: 'reprint' })).result).toMatchObject({ printed: true });
    for (const bad of [{ order_id: paid, reason: 'send' }, { order_id: 'x'.repeat(65), reason: 'reprint' }, { reason: 'reprint' }]) {
      expect((await slip(who, bad)).error?.code, JSON.stringify(bad)).toBe('VALIDATION_FAILED');
    }
  });

  it('[03c #60] pay_later: setting off → setting_off (reprint prints); an addition with an unbilled root → slip_held; with the root billed → prints on the root\'s order_id', async () => {
    const who = signIn(CASH);
    const root = takeaway({ order_id: 'R1' });
    hub.clock.advance(1_000);
    const add = takeaway({ order_id: 'R2', adds_to_order_id: root });
    const config = branchConfig()!;
    swapBranchConfig({ config: { ...config, engine_settings: { ...config.engine_settings, takeaway_slip_on_send: false } }, snapshotHash: 'o'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 4, appliedAt: 0 });
    expect((await slip(who, { order_id: root, reason: 'pay_later' })).result).toEqual({ printed: false, job_id: null, skipped: 'setting_off' });
    expect((await slip(who, { order_id: root, reason: 'reprint' })).result).toMatchObject({ printed: true });
    hub.deps.db.prepare('UPDATE print_jobs SET cancelled_at = 1').run(); // that reprint is a slip of the root (duplicates, #62)
    swapBranchConfig({ config, snapshotHash: 'p'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 4, appliedAt: 0 });
    expect((await slip(who, { order_id: add, reason: 'pay_later' })).result).toMatchObject({ printed: false, skipped: 'slip_held' });
    billed(root);
    const printed = await slip(who, { order_id: add, reason: 'pay_later' });
    expect(printed.result).toMatchObject({ printed: true });
    expect(jobs().at(-1)).toMatchObject({ order_id: root, kind_label: 'Token slip' });
    // the Ready line over the token's live (non-cancelled, engine) lines: here the addition's planned naan
    const { takeawaySlipReadyAt } = await import('../../src/print/render/ready-at');
    const { clock12 } = await import('../../src/print/render/jobs');
    const { hubTime } = await import('../../src/lib/hub-time');
    const ready = takeawaySlipReadyAt(hub.deps.state.get() as never, [root, add], null);
    const texts = (JSON.parse(jobs().at(-1)!.payload) as { doc: { blocks: Array<{ text?: string }> } }).doc.blocks.map((b) => b.text);
    expect(ready).not.toBeNull(); // planned lines have a time (fire_ms)
    expect(texts).toContain(`Ready around ${clock12(ready!, hubTime(hub.clock).utc_offset_ms)}`);
  });

  it('[03c #60] a cancelled root stays the root; an addition with the other orders billed prints; equal placed_at → the smaller order_id is the root', async () => {
    const who = signIn(CASH);
    const root = takeaway({ order_id: 'A1' });
    hub.clock.advance(1_000);
    const second = takeaway({ order_id: 'A2', adds_to_order_id: root });
    hub.clock.advance(1_000);
    const third = takeaway({ order_id: 'A3', adds_to_order_id: root });
    onOrder(root, 'OrderCancelled', { order_id: root });
    billed(second);
    expect((await slip(who, { order_id: third, reason: 'pay_later' })).result).toMatchObject({ printed: true });
    expect(jobs().at(-1)!.order_id).toBe(root);
    // equal placed_at: both placed in one writer turn
    const { rootOf } = await import('../../src/print/commands/print-takeaway-slip');
    expect(rootOf([{ order_id: 'Z9', placed_at: 5, billed_at: null, cancelled_at: null, pickup_at_ms: null }, { order_id: 'Z1', placed_at: 5, billed_at: null, cancelled_at: null, pickup_at_ms: null }]).order_id).toBe('Z1');
  });
});

describe('[03c #62] duplicates (§3.11 Duplicates, §6.14 step 7)', () => {
  it('[03c #62] two pay_later → one job, then already_printed; a cancelled slip job does not count; two reprints → two jobs, both with REPRINT', async () => {
    printer('PR_DEF');
    route('default', '', 'PR_DEF');
    const who = signIn(CASH);
    const root = takeaway({ order_id: 'D1' });
    expect((await slip(who, { order_id: root, reason: 'pay_later' })).result).toMatchObject({ printed: true });
    expect((await slip(who, { order_id: root, reason: 'pay_later' })).result).toEqual({ printed: false, job_id: null, skipped: 'already_printed' });
    hub.deps.db.prepare('UPDATE print_jobs SET cancelled_at = 1').run();
    expect((await slip(who, { order_id: root, reason: 'pay_later' })).result).toMatchObject({ printed: true });
    const before = jobs().length;
    await slip(who, { order_id: root, reason: 'reprint' });
    await slip(who, { order_id: root, reason: 'reprint' });
    const reprints = jobs().slice(before);
    expect(reprints).toHaveLength(2);
    for (const j of reprints) expect((JSON.parse(j.payload) as { doc: { blocks: Array<{ text?: string }> } }).doc.blocks[0]!.text).toBe('REPRINT');
    // the pay_later slip has no REPRINT line
    expect((JSON.parse(jobs()[0]!.payload) as { doc: { blocks: Array<{ text?: string }> } }).doc.blocks[0]!.text).not.toBe('REPRINT');
  });
});

describe('[03c #63] permission (§3.10, D-3)', () => {
  it('[03c #63] own_tables take-order reprints another cashier\'s token; requires_approval prints; not granted → 403', async () => {
    printer('PR_DEF');
    route('default', '', 'PR_DEF');
    const root = takeaway({ order_id: 'P1', placed_by: CASH2 });
    expect((await slip(signIn(CASH), { order_id: root, reason: 'reprint' })).result).toMatchObject({ printed: true });
    expect((await slip(signIn(ASK), { order_id: root, reason: 'reprint' })).result).toMatchObject({ printed: true });
    expect(await slip(signIn(NONE), { order_id: root, reason: 'reprint' })).toMatchObject({ status: 403, error: { code: 'PERMISSION_DENIED' } });
  });
});

describe('[03c #64] statements (§6.14)', () => {
  it('[03c #64] reprint 4 (routed or printer_id); pay_later 5; setting_off / slip_held 1; already_printed 2; no_printer 2 / 3; a refusal 1', async () => {
    const who = signIn(CASH);
    const root = takeaway({ order_id: 'S1' });
    hub.clock.advance(1_000);
    const add = takeaway({ order_id: 'S2', adds_to_order_id: root });
    const count = async (payload: Record<string, unknown>) => {
      const r = await slip(who, payload, { counted: true });
      expect(r.status, JSON.stringify(r.error)).toBeLessThan(500);
      return lastStatements;
    };
    expect(await count({ order_id: root, reason: 'reprint' })).toBe(2); // no_printer (reprint)
    expect(await count({ order_id: root, reason: 'pay_later' })).toBe(3); // no_printer (pay_later)
    printer('PR_DEF');
    route('default', '', 'PR_DEF');
    expect(await count({ order_id: root, reason: 'pay_later' })).toBe(5);
    expect(await count({ order_id: root, reason: 'pay_later' })).toBe(2); // already_printed
    expect(await count({ order_id: root, reason: 'reprint' })).toBe(4);
    expect(await count({ order_id: root, reason: 'reprint', printer_id: 'PR_DEF' })).toBe(4);
    expect(await count({ order_id: add, reason: 'pay_later' })).toBe(1); // slip_held
    const config = branchConfig()!;
    swapBranchConfig({ config: { ...config, engine_settings: { ...config.engine_settings, takeaway_slip_on_send: false } }, snapshotHash: 'q'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 4, appliedAt: 0 });
    expect(await count({ order_id: root, reason: 'pay_later' })).toBe(1); // setting_off
    expect(await count({ order_id: 'NOPE', reason: 'reprint' })).toBe(1); // a refusal
  });
});

describe('[03c #66] catalogue', () => {
  it('[03c #66] TAKEAWAY_SLIP_NOT_ALLOWED is a 409 in the error catalogue', () => {
    expect(ErrorCatalogue).toHaveProperty('TAKEAWAY_SLIP_NOT_ALLOWED', { status: 409 });
  });
});

// ---- 02b-tk L-CLOSE-2: 03c clause gaps (tests 57, 59, 60) ---------------------------------------------------------

describe('[03c #57 #59 #60] slip logs and the dine-in refusal', () => {
  it('[03c #59] no route → no_printer, logged print.slip.no_printer with ids (order, root, device)', async () => {
    const info = vi.spyOn(hub.app.log, 'info');
    const root = takeaway({ order_id: 'N1' });
    const who = signIn(CASH);
    expect((await slip(who, { order_id: root, reason: 'reprint' })).result).toMatchObject({ skipped: 'no_printer' });
    const call = info.mock.calls.find((c) => c[1] === 'print.slip.no_printer');
    expect(call?.[0]).toMatchObject({ order_id: root, root_order_id: root, device_id: who.deviceId });
  });

  it('[03c #57] an Urdu-script branch name is left out of the slip and logged print.slip.name_unprintable with ids only', async () => {
    printer('PR_DEF');
    route('default', '', 'PR_DEF');
    const info = vi.spyOn(hub.app.log, 'info');
    hub.deps.config.provisioned!.branch_name = 'لاہور برانچ';
    const root = takeaway({ order_id: 'U1' });
    expect((await slip(signIn(CASH), { order_id: root, reason: 'reprint' })).result).toMatchObject({ printed: true });
    const call = info.mock.calls.find((c) => c[1] === 'print.slip.name_unprintable');
    expect(call?.[0]).toEqual({ root_order_id: root, token: expect.any(Number) });
    const text = jobs().at(-1)!.payload;
    expect(text).not.toContain('?????');
  });

  it('[03c #60] a dine-in order → 409 TAKEAWAY_SLIP_NOT_ALLOWED not_takeaway', async () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    const di = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'D-1', item_id: FX.naan }] }).order_id;
    expect(await slip(signIn(CASH), { order_id: di, reason: 'reprint' })).toMatchObject({ status: 409, error: { code: 'TAKEAWAY_SLIP_NOT_ALLOWED', details: { reason: 'not_takeaway' } } });
  });
});

describe('[03c #58] the Ready line ignores show_part_times_to_customers', () => {
  it('with the receipt switch off, the slip still prints its Ready line', async () => {
    printer('PR_DEF');
    route('default', '', 'PR_DEF');
    const config = branchConfig()!;
    swapBranchConfig({ config: { ...config, engine_settings: { ...config.engine_settings, show_part_times_to_customers: false } }, snapshotHash: 's'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 4, appliedAt: 0 });
    const root = takeaway({ order_id: 'T58' });
    expect((await slip(signIn(CASH), { order_id: root, reason: 'reprint' })).result).toMatchObject({ printed: true });
    const texts = (JSON.parse(jobs().at(-1)!.payload) as { doc: { blocks: Array<{ text?: string }> } }).doc.blocks.map((b) => b.text);
    expect(texts.some((t) => t?.startsWith('Ready around '))).toBe(true);
  });
});
