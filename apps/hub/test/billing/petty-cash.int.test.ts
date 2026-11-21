// 05 §6.20 `RecordPettyCash` (approvable) and `SettlePettyAdvance`, B24, §3.12, §3.14 kind `petty_cash` (holders of
// `close-shift-for-others`, H1-1), R-48 (no `note_id` in the values or the petty events) — task 22; 05-plan §3 row 22.
// Tests #53 (the petty half; the CountShift half is task 21's), #54 (the shift-view half; the close / X / Z halves are
// tasks 21 and 26), #53b (extended: the petty_cash approver matrix). Real commands over HTTP through the hub's writer
// and the real `shifts` fold. The permanent afterEach scan holds every paid_to and note a test sends to `bill_texts`
// only, and no PIN or token in a log line. PKR amounts (exponent 2) are pinned: the built-in petty limit is
// Rs 5,000 (500 000 minor).
import { afterEach, describe, expect, it } from 'vitest';
import type { PosEvent } from '@pos/events';
import { aShiftClosed } from '@pos/events/testing';
import { kindOf, type AlertApplyCtx } from '../../src/alerts/kinds';
import { alerts } from '../../src/alerts/raise';
import { currentDirectory } from '../../src/auth/guards';
import type { CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { readOnlyTx } from '../../src/engine-host/read-only-tx';
import { payloadHash } from '../../src/lib/hash';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { PIN } from '../helpers/fixtures';
import { seedDirectory, type TestHub } from '../helpers/test-hub';
import {
  answer,
  billingDirectory,
  drawerDevice,
  post,
  signIn,
  signInOn,
  STAFF,
  startBilling,
  type Reply,
  type Who,
} from './fixtures';

let hub: TestHub;
let cashier: Who;
let manager: Who;
let owner: Who;
let waiter: Who;
let drawerShift: string;
let counter: ReturnType<typeof statementCounter>;

const OWNER = 'S_OWNER';
const PRINTER = 'PR_COUNTER';
/** Rs 5,000: the built-in `petty_cash_limit_minor` (A-1 (3), R-14) */
const LIMIT = 500_000;

// ------------------------------------------------------------------------------------------------ the privacy scan

const SECRETS = new Set<string>();
const text = (s: string): string => (SECRETS.add(s), s);

function leaksOf(s: string): string[] {
  const places: string[] = [];
  if (hub.logs().includes(s)) places.push('hub.logs()');
  const tables = hub.deps.db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    )
    .pluck()
    .all() as string[];
  for (const t of tables) {
    if (t === 'bill_texts') continue;
    const dump = JSON.stringify(
      hub.deps.db.prepare(`SELECT * FROM "${t}"`).all(),
      (_k, v: unknown) => (Buffer.isBuffer(v) ? v.toString('latin1') : v),
    );
    if (dump.includes(s)) places.push(`table ${t}`);
  }
  return places;
}

function secretsInLogs(): string[] {
  const logs = hub.logs();
  const found: string[] = [];
  for (const pin of Object.values(PIN))
    if (logs.includes(`"pin":"${pin}"`)) found.push(`pin ${pin}`);
  for (const who of [cashier, manager, owner, waiter]) {
    if (who === undefined) continue;
    if (logs.includes(who.token)) found.push(`device token of ${who.staffId}`);
    if (logs.includes(who.sessionToken))
      found.push(`session token of ${who.staffId}`);
  }
  return found;
}

afterEach(async () => {
  const found =
    hub === undefined
      ? []
      : [
          ...[...SECRETS].flatMap((s) => leaksOf(s).map((p) => `${s} in ${p}`)),
          ...secretsInLogs(),
        ];
  SECRETS.clear();
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
  expect(found).toEqual([]);
});

// ------------------------------------------------------------------------------------------------ set-up

const handled: Record<string, number | undefined> = {};

function countHandler(path: string): void {
  const def = commandRegistry(hub.app).byPath(path) as CommandDef | undefined;
  if (def === undefined) return;
  const original = def.handle;
  def.handle = (ctx, payload, cmd) => {
    counter.reset();
    try {
      return original.call(def, ctx, payload, cmd);
    } finally {
      handled[path] = counter.count;
    }
  };
}

/** The Cashier's drawer shift on a counter kiosk with its own route printer; the Manager's own (tablet) shift. */
async function start(
  o: { cashierGrant?: 'requires_approval'; scope?: 'my_floors' } = {},
): Promise<void> {
  hub = await startBilling();
  if (o.cashierGrant !== undefined || o.scope !== undefined) {
    const dir = await billingDirectory({ directory_version: 2 });
    await seedDirectory(hub, {
      ...dir,
      roles: dir.roles.map((role) =>
        role.role_id !== 'R_CASH'
          ? role
          : {
              ...role,
              permissions: role.permissions.map((g) =>
                g.permission !== 'record-petty-cash'
                  ? g
                  : o.cashierGrant === 'requires_approval'
                    ? {
                        ...g,
                        grant_type: 'requires_approval' as const,
                        approver_role_id: 'R_MGR',
                        approver_role_ids: ['R_MGR'],
                      }
                    : { ...g, scope: o.scope! },
              ),
            },
      ),
    });
  }
  const kiosk = drawerDevice(hub, 'Counter kiosk');
  cashier = signInOn(hub, STAFF.cashier, kiosk);
  manager = signIn(hub, STAFF.manager);
  owner = signIn(hub, OWNER);
  waiter = signIn(hub, STAFF.orderTaker);
  const shift = await post(hub, cashier, 'open-shift', 'OpenShift', {
    float_minor: 0,
    as_drawer: true,
  });
  expect(shift.status, JSON.stringify(shift.error)).toBe(200);
  drawerShift = shift.result!.shift_id as string;
  hub.clock.advance(1_000);
  const branch = hub.deps.config.provisioned!.branch_id;
  const now = hub.clock.branchNow();
  hub.deps.writer.run((tx) =>
    tx.append(
      [
        {
          event_type: 'PrinterSaved',
          payload: {
            printer_id: PRINTER,
            name: 'Counter',
            connection: 'lan',
            address: '192.168.1.20:9100',
            paper_width_mm: 80,
            archived: false,
          },
        },
        {
          event_type: 'BillRouteSet',
          payload: {
            scope: 'device',
            ref_id: kiosk.deviceId,
            printer_id: PRINTER,
          },
        },
      ].map((d) => ({
        ...d,
        stream_type: 'hub' as const,
        stream_id: branch,
        schema_version: 1,
        payload: d.payload as PosEvent['payload'],
        occurred_at: now,
        actor_id: STAFF.manager,
        device_id: 'D_FIXTURE',
      })),
    ),
  );
  counter = statementCounter(hub.deps.db);
  for (const k of Object.keys(handled)) delete handled[k];
  countHandler('record-petty-cash');
  countHandler('settle-petty-advance');
}

const db = () => hub.deps.db;
const record = (
  who: Who,
  payload: Record<string, unknown>,
  commandId?: string,
): Promise<Reply> =>
  post(hub, who, 'record-petty-cash', 'RecordPettyCash', payload, commandId);
const settle = (
  who: Who,
  payload: Record<string, unknown>,
  commandId?: string,
): Promise<Reply> =>
  post(
    hub,
    who,
    'settle-petty-advance',
    'SettlePettyAdvance',
    payload,
    commandId,
  );
const expectedOf = (shift_id: string) =>
  db()
    .prepare('SELECT expected_cash_minor FROM shifts WHERE shift_id = ?')
    .pluck()
    .get(shift_id);
const textsOf = (subject_id: string) =>
  db()
    .prepare(
      'SELECT field, text FROM bill_texts WHERE subject_id = ? ORDER BY field',
    )
    .all(subject_id);
const kicks = () =>
  db()
    .prepare(
      `SELECT printer_id, payload FROM print_jobs WHERE kind = 'document' ORDER BY created_at`,
    )
    .all() as Array<{ printer_id: string; payload: string }>;
const pettyEvents = () =>
  (
    db()
      .prepare(
        `SELECT event_type, payload FROM events WHERE event_type LIKE 'PettyCash%' ORDER BY seq`,
      )
      .all() as Array<{ event_type: string; payload: string }>
  ).map((e) => ({
    type: e.event_type,
    payload: JSON.parse(e.payload) as Record<string, unknown>,
  }));
const pendingOf = (r: Reply): string =>
  (r.result!.pending as { alert_id: string }).alert_id;

function raisedOf(
  alert_id: string,
): Record<string, unknown> & { values: Record<string, unknown> } {
  const row = db()
    .prepare(
      `SELECT payload FROM events WHERE event_type = 'AlertRaised' AND json_extract(payload, '$.alert_id') = ?`,
    )
    .pluck()
    .get(alert_id) as string;
  return JSON.parse(row) as Record<string, unknown> & {
    values: Record<string, unknown>;
  };
}

async function managerShift(): Promise<string> {
  const r = await post(hub, manager, 'open-shift', 'OpenShift', {
    float_minor: 0,
    as_drawer: false,
  });
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  return r.result!.shift_id as string;
}

// ================================================================================================= direct

describe('[05 §6.20, B24, #53] RecordPettyCash — direct (grant allowed, amount ≤ the limit)', () => {
  it('[05 #53] a Rs 1,200 cash-out on the drawer: PettyCashOut on the shift stream (no text, no note_id), texts under entry_id, the drawer kick, expected −', async () => {
    await start();
    const paid_to = text('Akbar Traders 7c1e');
    const note = text('gas cylinder refill 31d0');
    const r = await record(cashier, {
      kind: 'out',
      amount_minor: 120_000,
      category_id: 'supplies',
      paid_to,
      note,
    });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const entry_id = r.result!.entry_id as string;
    expect(r.result).toEqual({ entry_id });
    expect(
      r.events.map((e) => [
        e.event_type,
        e.stream_type,
        e.stream_id,
        e.actor_id,
      ]),
    ).toEqual([['PettyCashOut', 'shift', drawerShift, STAFF.cashier]]);
    expect(r.events[0]!.payload).toEqual({
      entry_id,
      shift_id: drawerShift,
      amount_minor: 120_000,
      category_id: 'supplies',
      has_paid_to: true,
      advance_staff_id: null,
      has_note: true,
      requester_staff_id: STAFF.cashier,
      approver_staff_id: null,
      alert_id: null,
    });
    expect(textsOf(entry_id)).toEqual([
      { field: 'note', text: note },
      { field: 'paid_to', text: paid_to },
    ]);
    expect(kicks()).toEqual([
      {
        printer_id: PRINTER,
        payload: JSON.stringify({ doc: { blocks: [{ drawer: true }] } }),
      },
    ]);
    expect(expectedOf(drawerShift)).toBe(-120_000);
  });

  it('[05 #53] a Rs 800 cash-in: PettyCashIn, expected +; no text → no bill_texts row, has_paid_to / has_note false', async () => {
    await start();
    const r = await record(cashier, {
      kind: 'in',
      amount_minor: 80_000,
      category_id: 'other',
    });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['PettyCashIn']);
    expect(r.events[0]!.payload).toMatchObject({
      amount_minor: 80_000,
      has_paid_to: false,
      has_note: false,
      advance_staff_id: null,
    });
    expect(db().prepare('SELECT COUNT(*) FROM bill_texts').pluck().get()).toBe(
      0,
    );
    expect(expectedOf(drawerShift)).toBe(80_000);
  });

  it('[05 §6.20] exactly at the limit (Rs 5,000) is direct; one minor unit above raises the request', async () => {
    await start();
    expect(
      (
        await record(cashier, {
          kind: 'out',
          amount_minor: LIMIT,
          category_id: 'supplies',
        })
      ).events.map((e) => e.event_type),
    ).toEqual(['PettyCashOut']);
    const over = await record(cashier, {
      kind: 'out',
      amount_minor: LIMIT + 1,
      category_id: 'supplies',
    });
    expect(over.result).toMatchObject({
      pending: { alert_id: expect.any(String) },
    });
    expect(pettyEvents()).toHaveLength(1);
  });

  it("[05 B11] on a tablet with no drawer the Manager's own shift takes it, with no drawer kick; no money shift → 409 SHIFT_NOT_OPEN { no_shift }", async () => {
    await start();
    const none = await record(manager, {
      kind: 'out',
      amount_minor: 10_000,
      category_id: 'supplies',
    });
    expect(none.status).toBe(409);
    expect(none.error).toEqual({
      code: 'SHIFT_NOT_OPEN',
      details: { reason: 'no_shift' },
    });
    const own = await managerShift();
    const r = await record(manager, {
      kind: 'out',
      amount_minor: 10_000,
      category_id: 'supplies',
    });
    expect(r.events[0]).toMatchObject({
      stream_id: own,
      payload: { shift_id: own },
    });
    expect(kicks()).toEqual([]);
  });

  it('[05 §6.20] refusals in order: shift first, then the category (unknown / inactive), then advance_staff_id; Zod refuses advance_staff_id on an out and a 0 amount', async () => {
    await start();
    expect(
      (
        await record(manager, {
          kind: 'advance',
          amount_minor: 10_000,
          category_id: 'nope',
        })
      ).error?.code,
    ).toBe('SHIFT_NOT_OPEN');
    const unknown = await record(cashier, {
      kind: 'out',
      amount_minor: 10_000,
      category_id: 'nope',
    });
    expect(unknown.status).toBe(422);
    expect(unknown.error).toEqual({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'category_id', reason: 'not_found' },
    });
    const noStaff = await record(cashier, {
      kind: 'advance',
      amount_minor: 10_000,
      category_id: 'nope',
    });
    expect(noStaff.error?.details).toMatchObject({ field: 'category_id' });
    const missing = await record(cashier, {
      kind: 'advance',
      amount_minor: 10_000,
      category_id: 'staff_advance',
    });
    expect(missing.status).toBe(422);
    expect(missing.error).toEqual({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'advance_staff_id', reason: 'not_found' },
    });
    expect(
      (
        await record(cashier, {
          kind: 'advance',
          amount_minor: 10_000,
          category_id: 'staff_advance',
          advance_staff_id: 'S_GHOST',
        })
      ).error?.details,
    ).toMatchObject({ field: 'advance_staff_id' });
    expect(
      (
        await record(cashier, {
          kind: 'out',
          amount_minor: 10_000,
          category_id: 'supplies',
          advance_staff_id: STAFF.orderTaker,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await record(cashier, {
          kind: 'out',
          amount_minor: 0,
          category_id: 'supplies',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await record(cashier, {
          kind: 'loan',
          amount_minor: 10_000,
          category_id: 'supplies',
        })
      ).status,
    ).toBe(400);
    expect(pettyEvents()).toEqual([]);
  });

  it('[05 §6.20, C8] grant first: the Order taker (no record-petty-cash) → 403 before the handler reads anything; scope last (test-only my_floors) → 403 outside_scope after the state checks', async () => {
    await start({ scope: 'my_floors' });
    const r = await record(waiter, {
      kind: 'out',
      amount_minor: 10_000,
      category_id: 'supplies',
    });
    expect(r.status).toBe(403);
    expect(handled['record-petty-cash']).toBeUndefined();
    expect(
      (
        await record(cashier, {
          kind: 'out',
          amount_minor: 10_000,
          category_id: 'nope',
        })
      ).error?.code,
    ).toBe('CONFIG_REFERENCE_INVALID');
    const scoped = await record(cashier, {
      kind: 'out',
      amount_minor: 10_000,
      category_id: 'supplies',
    });
    expect(scoped.status).toBe(403);
    expect(scoped.error?.details).toMatchObject({ reason: 'outside_scope' });
    expect(pettyEvents()).toEqual([]);
  });

  it('[05 §6.20, D32, H-4] a retransmit with the same command_id replays the stored reply, also when only paid_to / note changed (not hashed)', async () => {
    await start();
    const payload = {
      kind: 'out',
      amount_minor: 20_000,
      category_id: 'transport',
    };
    const first = await record(
      cashier,
      {
        ...payload,
        paid_to: text('Rickshaw 1 9a0b'),
        note: text('first note 55e1'),
      },
      'petty-replay',
    );
    const again = await record(
      cashier,
      {
        ...payload,
        paid_to: text('Rickshaw 2 0c3d'),
        note: text('resent note 4f72'),
      },
      'petty-replay',
    );
    expect(again.status).toBe(200);
    expect(again.result).toEqual(first.result);
    expect(pettyEvents()).toHaveLength(1);
    expect(kicks()).toHaveLength(1);
    expect(
      db()
        .prepare(
          `SELECT payload_hash FROM processed_commands WHERE command_id = 'petty-replay'`,
        )
        .pluck()
        .get(),
    ).toBe(payloadHash(payload));
  });
});

// ================================================================================================= advance + settle

describe('[05 §6.20, §3.12, #53, #54] advance and SettlePettyAdvance', () => {
  async function advance(amount_minor = 300_000): Promise<string> {
    const r = await record(cashier, {
      kind: 'advance',
      amount_minor,
      category_id: 'staff_advance',
      advance_staff_id: STAFF.orderTaker,
      note: text('advance for market 6b0d'),
    });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['PettyCashAdvanced']);
    expect(r.events[0]!.payload).toMatchObject({
      advance_staff_id: STAFF.orderTaker,
      amount_minor,
    });
    return r.result!.entry_id as string;
  }

  async function shiftView(who: Who, shift_id: string) {
    const res = await hub.app.inject({
      method: 'GET',
      url: `/queries/shift?shift_id=${shift_id}`,
      headers: {
        authorization: `Bearer ${who.token}`,
        'x-session-token': who.sessionToken,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (
      res.json() as {
        data: {
          open_advances_minor: number;
          petty: Array<{
            entry_id: string;
            kind: string;
            settled: boolean;
            advance_staff_name: string | null;
          }>;
        };
      }
    ).data;
  }

  it('[05 #53, #54] a Rs 3,000 advance, settled on the same shift (spent Rs 2,500 + returned Rs 500): open in the shift view until settled; expected −3 000 then +500', async () => {
    await start();
    const entry_id = await advance();
    expect(expectedOf(drawerShift)).toBe(-300_000);
    const before = await shiftView(cashier, drawerShift);
    expect(before.open_advances_minor).toBe(300_000);
    expect(before.petty).toMatchObject([
      { entry_id, kind: 'advance', settled: false },
    ]);
    const s = await settle(cashier, {
      entry_id,
      spent_minor: 250_000,
      returned_minor: 50_000,
    });
    expect(s.status, JSON.stringify(s.error)).toBe(200);
    expect(s.result).toEqual({ entry_id, shift_id: drawerShift });
    expect(
      s.events.map((e) => [e.event_type, e.stream_type, e.stream_id]),
    ).toEqual([['PettyCashSettled', 'shift', drawerShift]]);
    expect(s.events[0]!.payload).toEqual({
      entry_id,
      shift_id: drawerShift,
      spent_minor: 250_000,
      returned_minor: 50_000,
      has_note: false,
      note_id: null,
    });
    expect(expectedOf(drawerShift)).toBe(-250_000);
    const after = await shiftView(cashier, drawerShift);
    expect(after.open_advances_minor).toBe(0);
    expect(after.petty).toMatchObject([{ entry_id, settled: true }]);
  });

  it("[05 §3.12] settled on another shift: the returned Rs 1,000 lands on the Manager's shift; the settle note gets its own note_id (H4-4)", async () => {
    await start();
    const entry_id = await advance(200_000);
    const other = await managerShift();
    const note = text('returned change 2e8a');
    const s = await settle(manager, {
      entry_id,
      spent_minor: 100_000,
      returned_minor: 100_000,
      note,
    });
    expect(s.status, JSON.stringify(s.error)).toBe(200);
    const p = s.events[0]!.payload as {
      note_id: string;
      shift_id: string;
      has_note: boolean;
    };
    expect(p).toMatchObject({ shift_id: other, has_note: true });
    expect(p.note_id).not.toBe(entry_id);
    expect(textsOf(p.note_id)).toEqual([{ field: 'note', text: note }]);
    expect(expectedOf(drawerShift)).toBe(-200_000);
    expect(expectedOf(other)).toBe(100_000);
    expect(
      db()
        .prepare('SELECT settled_shift_id FROM petty_cash WHERE entry_id = ?')
        .pluck()
        .get(entry_id),
    ).toBe(other);
  });

  it('[05 §6.20, §9] settle refusals: unknown or not an advance → 404 PETTY_CASH_NOT_FOUND; mismatch → 422 { amount_minor }; settled → 409 PETTY_ADVANCE_SETTLED; no money shift → 409 SHIFT_NOT_OPEN', async () => {
    await start();
    const entry_id = await advance();
    const out = (
      await record(cashier, {
        kind: 'out',
        amount_minor: 10_000,
        category_id: 'supplies',
      })
    ).result!.entry_id as string;
    expect(
      (
        await settle(cashier, {
          entry_id: 'E_NOPE',
          spent_minor: 0,
          returned_minor: 0,
        })
      ).error,
    ).toEqual({
      code: 'PETTY_CASH_NOT_FOUND',
      details: { entry_id: 'E_NOPE' },
    });
    expect(
      (
        await settle(cashier, {
          entry_id: out,
          spent_minor: 10_000,
          returned_minor: 0,
        })
      ).error?.code,
    ).toBe('PETTY_CASH_NOT_FOUND');
    const mismatch = await settle(cashier, {
      entry_id,
      spent_minor: 250_000,
      returned_minor: 40_000,
    });
    expect(mismatch.status).toBe(422);
    expect(mismatch.error).toEqual({
      code: 'PETTY_SETTLE_MISMATCH',
      details: { amount_minor: 300_000 },
    });
    const noShift = await settle(manager, {
      entry_id,
      spent_minor: 300_000,
      returned_minor: 0,
    });
    expect(noShift.error).toEqual({
      code: 'SHIFT_NOT_OPEN',
      details: { reason: 'no_shift' },
    });
    expect(
      (
        await settle(cashier, {
          entry_id,
          spent_minor: 300_000,
          returned_minor: 0,
        })
      ).status,
    ).toBe(200);
    const twice = await settle(cashier, {
      entry_id,
      spent_minor: 300_000,
      returned_minor: 0,
    });
    expect(twice.status).toBe(409);
    expect(twice.error).toEqual({
      code: 'PETTY_ADVANCE_SETTLED',
      details: { entry_id },
    });
    expect(
      pettyEvents().filter((e) => e.type === 'PettyCashSettled'),
    ).toHaveLength(1);
  });

  it('[05 §6.20] settle needs record-petty-cash allowed: a requires_approval grant → 403 (Settle is not approvable)', async () => {
    await start({ cashierGrant: 'requires_approval' });
    const r = await settle(cashier, {
      entry_id: 'E_ANY',
      spent_minor: 0,
      returned_minor: 0,
    });
    expect(r.status).toBe(403);
    expect(handled['settle-petty-advance']).toBeUndefined();
  });
});

// ================================================================================================= approval path

describe('[05 §3.14, §6.20, #53, #53b] petty_cash requests', () => {
  it('[05 §3.14, R-48] over the limit: one petty_cash request (values: the entry without text, no note_id; details { amount, reason: category }; dedupe petty:<command_id>); texts at raise; no event, no kick', async () => {
    await start();
    const paid_to = text('Plumber Rashid 81fa');
    const r = await record(
      cashier,
      { kind: 'out', amount_minor: 600_000, category_id: 'utilities', paid_to },
      'petty-over-1',
    );
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const alert_id = pendingOf(r);
    const entry_id = r.result!.entry_id as string;
    expect(r.result).toEqual({ entry_id, pending: { alert_id } });
    const p = raisedOf(alert_id);
    expect(p).toMatchObject({
      kind: 'petty_cash',
      subject_stream_type: 'shift',
      subject_stream_id: drawerShift,
      dedupe_key: 'petty:petty-over-1',
      requester_staff_id: STAFF.cashier,
    });
    expect(p.values).toEqual({
      entry_id,
      kind: 'out',
      shift_id: drawerShift,
      amount_minor: 600_000,
      category_id: 'utilities',
      has_paid_to: true,
      advance_staff_id: null,
      has_note: false,
    });
    expect(p.details).toEqual({ amount: 600_000, reason: 'utilities' });
    expect(p.display).toMatchObject({
      kind_label_key: 'alert.petty_cash.lock',
      table_code: null,
    });
    expect(textsOf(entry_id)).toEqual([{ field: 'paid_to', text: paid_to }]);
    expect(pettyEvents()).toEqual([]);
    expect(kicks()).toEqual([]);
    expect(expectedOf(drawerShift)).toBe(0);
  });

  it('[05 §3.12] a requires_approval grant raises the request for every amount (Rs 100)', async () => {
    await start({ cashierGrant: 'requires_approval' });
    const r = await record(cashier, {
      kind: 'in',
      amount_minor: 10_000,
      category_id: 'other',
    });
    expect(r.result).toMatchObject({
      pending: { alert_id: expect.any(String) },
    });
    expect(pettyEvents()).toEqual([]);
  });

  it("[05 §3.14] approve in person on the Cashier's kiosk (actor Cashier ≠ answerer Manager): the event with requester Cashier, approver = answerer, alert_id; no kick; expected moves", async () => {
    await start();
    const r = await record(cashier, {
      kind: 'advance',
      amount_minor: 700_000,
      category_id: 'staff_advance',
      advance_staff_id: STAFF.orderTaker,
      note: text('salary advance 0d4c'),
    });
    const alert_id = pendingOf(r);
    const entry_id = r.result!.entry_id as string;
    const a = await post(hub, cashier, 'answer-request', 'AnswerRequest', {
      alert_id,
      decision: 'approve',
      method: 'in_person',
      answerer_staff_id: STAFF.manager,
      pin: PIN.b,
    });
    expect(a.status, JSON.stringify(a.error)).toBe(200);
    const done = a.events.filter((e) => e.event_type === 'PettyCashAdvanced');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({
      stream_type: 'shift',
      stream_id: drawerShift,
      actor_id: STAFF.cashier,
    });
    expect(done[0]!.payload).toEqual({
      entry_id,
      shift_id: drawerShift,
      amount_minor: 700_000,
      category_id: 'staff_advance',
      has_paid_to: false,
      advance_staff_id: STAFF.orderTaker,
      has_note: true,
      requester_staff_id: STAFF.cashier,
      approver_staff_id: STAFF.manager,
      alert_id,
    });
    expect(kicks()).toEqual([]);
    expect(expectedOf(drawerShift)).toBe(-700_000);
    expect(alerts.listOpen(db(), { kind: 'petty_cash' })).toEqual([]);
    // the approved advance settles as any other
    expect(
      (
        await settle(cashier, {
          entry_id,
          spent_minor: 700_000,
          returned_minor: 0,
        })
      ).status,
    ).toBe(200);
  });

  it('[05 §3.14, H6-2] re-check on approve: the shift closed meanwhile → the answer is refused 409 SHIFT_NOT_OPEN; nothing written; reject still closes it', async () => {
    await start();
    const alert_id = pendingOf(
      await record(cashier, {
        kind: 'out',
        amount_minor: 600_000,
        category_id: 'supplies',
      }),
    );
    hub.clock.advance(1_000);
    hub.deps.writer.run((tx) =>
      tx.append([
        {
          stream_type: 'shift',
          stream_id: drawerShift,
          event_type: 'ShiftClosed',
          schema_version: 1,
          payload: {
            ...(aShiftClosed().payload as Record<string, unknown>),
            shift_id: drawerShift,
            closed_by: STAFF.cashier,
          } as PosEvent['payload'],
          occurred_at: hub.clock.branchNow(),
          actor_id: STAFF.cashier,
          device_id: 'D_FIXTURE',
        },
      ]),
    );
    const a = await answer(hub, manager, alert_id, 'approve');
    expect(a.status).toBe(409);
    expect(a.error).toEqual({
      code: 'SHIFT_NOT_OPEN',
      details: { reason: 'not_open' },
    });
    expect(pettyEvents()).toEqual([]);
    expect(
      alerts.listOpen(db(), { kind: 'petty_cash' }).map((x) => x.alert_id),
    ).toEqual([alert_id]);
    expect((await answer(hub, manager, alert_id, 'reject')).status).toBe(200);
    expect(alerts.listOpen(db(), { kind: 'petty_cash' })).toEqual([]);
    expect(pettyEvents()).toEqual([]);
  });

  for (const grant of ['allowed', 'requires_approval'] as const) {
    it(`[05 #53b, H1-1] approver matrix (Cashier grant ${grant}): the Cashier himself and another holder-less answerer refused; Manager and Owner accepted`, async () => {
      await start(
        grant === 'allowed' ? {} : { cashierGrant: 'requires_approval' },
      );
      const amount = grant === 'allowed' ? 600_000 : 10_000;
      const ask = async () =>
        pendingOf(
          await record(cashier, {
            kind: 'out',
            amount_minor: amount,
            category_id: 'supplies',
          }),
        );
      const self = await answer(hub, cashier, await ask(), 'approve');
      expect(self.status).toBe(403);
      expect(pettyEvents()).toEqual([]);
      const byManager = await answer(hub, manager, await ask(), 'approve');
      expect(byManager.status, JSON.stringify(byManager.error)).toBe(200);
      const byOwner = await answer(hub, owner, await ask(), 'approve');
      expect(byOwner.status, JSON.stringify(byOwner.error)).toBe(200);
      expect(pettyEvents().map((e) => e.payload.approver_staff_id)).toEqual([
        STAFF.manager,
        OWNER,
      ]);
    });
  }

  it("[05 #53b, H1-1] a Manager's own over-limit request: the Manager cannot answer it, the Owner can; an Order taker (no close-shift-for-others) is refused", async () => {
    await start();
    await managerShift();
    const alert_id = pendingOf(
      await record(manager, {
        kind: 'out',
        amount_minor: 600_000,
        category_id: 'supplies',
      }),
    );
    expect((await answer(hub, manager, alert_id, 'approve')).status).toBe(403);
    expect((await answer(hub, waiter, alert_id, 'approve')).status).toBe(403);
    expect(pettyEvents()).toEqual([]);
    const a = await answer(hub, owner, alert_id, 'approve');
    expect(a.status, JSON.stringify(a.error)).toBe(200);
    expect(
      pettyEvents().map((e) => [
        e.payload.requester_staff_id,
        e.payload.approver_staff_id,
      ]),
    ).toEqual([[STAFF.manager, OWNER]]);
  });
});

// ================================================================================================= statement counts

describe('[05 §6.20 Statements ≤ 4 each] fixed counts (00 envelope excluded; 01d raise its own bound)', () => {
  it('[05 §6.20] Record direct on the drawer: read + texts + kick (2) = 4; without texts 3; on a tablet without a drawer 1; a refusal stops at 1', async () => {
    await start();
    await record(cashier, {
      kind: 'out',
      amount_minor: 10_000,
      category_id: 'supplies',
      paid_to: text('Shop 3a91'),
      note: text('counted 7b20'),
    });
    expect(handled['record-petty-cash']).toBe(4);
    await record(cashier, {
      kind: 'in',
      amount_minor: 10_000,
      category_id: 'supplies',
    });
    expect(handled['record-petty-cash']).toBe(3);
    await record(cashier, {
      kind: 'out',
      amount_minor: 10_000,
      category_id: 'nope',
    });
    expect(handled['record-petty-cash']).toBe(1);
    await managerShift();
    await record(manager, {
      kind: 'out',
      amount_minor: 10_000,
      category_id: 'supplies',
    });
    expect(handled['record-petty-cash']).toBe(1);
  });

  it("[05 §6.20] Record request path: read + texts = 2 besides 01d's raise", async () => {
    await start();
    let inRaise = 0;
    const real = alerts.raise.bind(alerts);
    const original = alerts.raise;
    alerts.raise = ((ctx, input) => {
      const before = counter.count;
      try {
        return real(ctx, input);
      } finally {
        inRaise = counter.count - before;
      }
    }) as typeof alerts.raise;
    try {
      const r = await record(cashier, {
        kind: 'out',
        amount_minor: 600_000,
        category_id: 'supplies',
        note: text('over the limit 5e3c'),
      });
      expect(r.result).toMatchObject({
        pending: { alert_id: expect.any(String) },
      });
      expect(inRaise).toBeGreaterThan(0);
      expect(handled['record-petty-cash']! - inRaise).toBe(2);
    } finally {
      alerts.raise = original;
    }
  });

  it('[05 §6.20] Settle: read (1) + note (1) = 2; without a note 1', async () => {
    await start();
    const a = (
      await record(cashier, {
        kind: 'advance',
        amount_minor: 20_000,
        category_id: 'staff_advance',
        advance_staff_id: STAFF.orderTaker,
      })
    ).result!.entry_id as string;
    const b = (
      await record(cashier, {
        kind: 'advance',
        amount_minor: 20_000,
        category_id: 'staff_advance',
        advance_staff_id: STAFF.orderTaker,
      })
    ).result!.entry_id as string;
    await settle(cashier, {
      entry_id: a,
      spent_minor: 20_000,
      returned_minor: 0,
      note: text('receipt lost 9c11'),
    });
    expect(handled['settle-petty-advance']).toBe(2);
    await settle(cashier, {
      entry_id: b,
      spent_minor: 0,
      returned_minor: 20_000,
    });
    expect(handled['settle-petty-advance']).toBe(1);
  });

  it("[05 §3.14] the kind's apply on approve: 1 statement, read-only; reject 0; the approver is the answerer, never the actor", async () => {
    await start();
    const alert_id = pendingOf(
      await record(cashier, {
        kind: 'out',
        amount_minor: 600_000,
        category_id: 'supplies',
      }),
    );
    const rec = alerts
      .listOpen(db(), { kind: 'petty_cash' })
      .find((x) => x.alert_id === alert_id)!;
    const request = kindOf('petty_cash')!.request!;
    const run = (decision: 'approve' | 'reject') =>
      hub.deps.writer.run((tx) => {
        const ctx = {
          tx: readOnlyTx(tx),
          state: tx.state,
          clock: tx.clock,
          ids: tx.ids,
          actor: {
            kind: 'staff',
            staffId: STAFF.cashier,
            stationId: null,
            sessionId: cashier.sessionId,
            deviceId: cashier.deviceId,
          },
          permission: null,
          directory: currentDirectory(hub.app),
          alert: rec,
        } as unknown as AlertApplyCtx<never, never>;
        counter.reset();
        const out = request.apply(ctx, {
          decision,
          answerer_staff_id: STAFF.manager,
          method: 'pin',
          device_id: manager.deviceId,
          answered_at: hub.clock.branchNow(),
        });
        return { out, statements: counter.count };
      }).result;
    const approved = run('approve');
    expect(approved.statements).toBe(1);
    expect(approved.out.map((d) => d.event_type)).toEqual(['PettyCashOut']);
    expect(approved.out[0]!.payload).toMatchObject({
      requester_staff_id: STAFF.cashier,
      approver_staff_id: STAFF.manager,
      alert_id,
    });
    expect(run('reject')).toEqual({ out: [], statements: 0 });
  });
});

describe('[05 B30, §7] the privacy scan is live', () => {
  it('a probe value in a hub log line is found', async () => {
    await start();
    const probe = 'PROBE-paid-to-e2b7';
    hub.app.log.info({ probe }, 'scan probe');
    expect(leaksOf(probe)).toContain('hub.logs()');
  });
});
