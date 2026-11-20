// 05 §6.28a `SetFiscalToken`, B22, row H-2 / H-4, H10-5, H11-4, §5 `fiscal_credentials`, §6.29 `FiscalTokenSet`
// (05-plan §3 row 31a; test #81). Real admin commands over HTTP (`/admin/commands/set-fiscal-token`) through the hub's
// writer, the real 0023 tables, the real `billing` fold (task 7) and the worker's real seams (29b) for the "next pass"
// check. The token value is held to `fiscal_credentials` by a permanent scan of `hub.logs()` and every other table,
// run after every test. No timing asserts (03a AD-32).
import { InvoiceIssued, SnapshotBillingSchema, type BranchConfig, type EventDef, type SnapshotBilling } from '@pos/events';
import { anInvoiceIssued } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { hubBilling } from '../../../src/billing/defaults';
import { fiscalAdapterFor, registerFiscalAdapter, resetFiscalAdapters } from '../../../src/billing/fiscal/port';
import { fiscalWorkerSeams, resetFiscalWorker, runOnce, type FiscalWorkerDeps } from '../../../src/billing/fiscal/worker';
import type { CommandDef } from '../../../src/commands/registry';
import { commandRegistry } from '../../../src/commands/route';
import { queryRegistry, type QueryDef } from '../../../src/queries/registry';
import { swapBranchConfig } from '../../../src/sync/branch-config-holder';
import { statementCounter } from '../../helpers/statement-counter';
import { openSession, type TestHub } from '../../helpers/test-hub';
import { pairDevice } from '../../kds/fixtures';
import { openDay, voidsMenu } from '../../voids/fixtures';
import { STAFF, startBilling } from '../fixtures';
import { fakeAdapter, type FakeAdapter } from './fake-adapter';

let hub: TestHub;
let fake: FakeAdapter;
let device: { deviceId: string; token: string };
let n = 0;

/** Every token value a test sends: the afterEach scan holds each of them to `fiscal_credentials`. */
const SECRETS = new Set<string>();
const secret = (s: string): string => {
  SECRETS.add(s);
  return s;
};

afterEach(async () => {
  // B22, H-4, #81: the permanent scan — no token value in the hub log or in any table but fiscal_credentials
  const found = hub === undefined ? [] : [...SECRETS].flatMap((s) => leaksOf(s).map((place) => `${s} in ${place}`));
  SECRETS.clear();
  swapBranchConfig(null);
  resetFiscalAdapters();
  resetFiscalWorker();
  await hub?.close();
  hub = undefined as unknown as TestHub;
  expect(found).toEqual([]);
});

/** B22 / H-4: every place a token could leak to — the hub log and every table but the one that holds it. */
function leaksOf(needle: string): string[] {
  const places: string[] = [];
  if (hub.logs().includes(needle)) places.push('hub.logs()');
  const tables = hub.deps.db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'fiscal_credentials' ORDER BY name`)
    .pluck()
    .all() as string[];
  for (const t of tables) {
    if (JSON.stringify(hub.deps.db.prepare(`SELECT * FROM "${t}"`).all()).includes(needle)) places.push(`table ${t}`);
  }
  return places;
}

// ------------------------------------------------------------------------------------------------ config

/** The PK built-in document with the branch adapter `FAKE` (credentialNames ['token']) and two POS IDs. */
function billingDoc(): SnapshotBilling {
  const pk = hubBilling({ currency_code: 'PKR', tax_classes: [], billing: undefined });
  return {
    ...pk.settings,
    fiscal: {
      ...pk.settings.fiscal,
      environment: 'sandbox',
      pos_ids: [
        { pos_id: 'POS-1', label: 'Counter' },
        { pos_id: 'POS-2', label: 'Bar' },
      ],
      default_pos_id: 'POS-1',
      adapter_settings: { FAKE: {} },
    },
    jurisdiction: { ...pk.jurisdiction, adapter_key: 'FAKE' },
    tax_profiles: [],
  } as SnapshotBilling;
}

/** handler statements of the last SetFiscalToken (the payments countHandle pattern) */
let handled = -1;

async function start(): Promise<void> {
  hub = await startBilling({ open: false });
  const menu: BranchConfig = { ...voidsMenu(), billing: SnapshotBillingSchema.parse(billingDoc()) };
  openDay(hub, { menu });
  fake = fakeAdapter({ key: 'FAKE', ordering: 'strict_per_pos_id', credentialNames: ['token'] });
  registerFiscalAdapter(fake);
  // a second adapter, recorded only on pending rows (a switch away, §3.15): two named credentials (H10-5, #75)
  registerFiscalAdapter(fakeAdapter({ key: 'FAKE2', ordering: 'none', credentialNames: ['api_key', 'device_key'] }));
  device = pairDevice(hub, { type: 'tablet' });
  sessions.clear();
  handled = -1;
  const def = commandRegistry(hub.app).byPath('set-fiscal-token') as CommandDef | undefined;
  if (def !== undefined) {
    const counter = statementCounter(hub.deps.db);
    const original = def.handle;
    def.handle = (ctx, payload, cmd) => {
      counter.reset();
      try {
        return original.call(def, ctx, payload, cmd);
      } finally {
        handled = counter.count;
      }
    };
  }
}

// ------------------------------------------------------------------------------------------------ helpers

type Reply = { status: number; result?: Record<string, unknown>; error?: { code: string; details?: Record<string, unknown> }; raw: string };

const OWNER = 'S_OWNER';

/** One session per (kind, staff) per test: an admin retransmit is identified by its session (00 §3.7, route.ts decide). */
const sessions = new Map<string, { sessionId: string; token: string }>();

/** POST /admin/commands/set-fiscal-token (or the device route) as `staffId` in its admin (or staff) session. */
async function setToken(payload: Record<string, unknown>, o: { staffId?: string; commandId?: string; route?: 'admin' | 'device' } = {}): Promise<Reply> {
  hub.clock.advance(1_000);
  const staffId = o.staffId ?? OWNER;
  const deviceRoute = o.route === 'device';
  const kind = deviceRoute ? 'staff' : 'admin';
  let session = sessions.get(`${kind}:${staffId}`);
  if (session === undefined) {
    session = openSession(hub, { kind, staffId, deviceId: device.deviceId });
    sessions.set(`${kind}:${staffId}`, session);
  }
  const provisioned = hub.deps.config.provisioned!;
  const response = await hub.app.inject({
    method: 'POST',
    url: `${deviceRoute ? '/commands/' : '/admin/commands/'}set-fiscal-token`,
    headers: { authorization: `Bearer ${device.token}`, [deviceRoute ? 'x-session-token' : 'x-admin-session']: session.token },
    payload: {
      command_id: o.commandId ?? `cmd-sft-${++n}`,
      tenant_id: provisioned.tenant_id,
      branch_id: provisioned.branch_id,
      command_type: 'SetFiscalToken',
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: staffId,
      device_id: device.deviceId,
    },
  });
  const body = response.json() as { data?: { result: Record<string, unknown> }; error?: Reply['error'] };
  return { status: response.statusCode, result: body.data?.result, error: body.error, raw: response.body };
}

const credentials = () =>
  hub.deps.db.prepare('SELECT pos_id, name, token, set_at, set_by_staff_id FROM fiscal_credentials ORDER BY pos_id, name').all() as Array<{
    pos_id: string;
    name: string;
    token: string;
    set_at: number;
    set_by_staff_id: string;
  }>;

const eventsOf = <P extends z.ZodType>(def: EventDef<P>) =>
  (
    hub.deps.db.prepare('SELECT stream_type, stream_id, actor_id, payload FROM events WHERE event_type = ? ORDER BY seq').all(def.eventType) as Array<{
      stream_type: string;
      stream_id: string;
      actor_id: string | null;
      payload: string;
    }>
  ).map((e) => ({ ...e, payload: JSON.parse(e.payload) as Record<string, unknown> }));

const tokenEvents = () =>
  (
    hub.deps.db.prepare(`SELECT stream_type, stream_id, actor_id, payload FROM events WHERE event_type = 'FiscalTokenSet' ORDER BY seq`).all() as Array<{
      stream_type: string;
      stream_id: string;
      actor_id: string | null;
      payload: string;
    }>
  ).map((e) => ({ ...e, payload: JSON.parse(e.payload) as Record<string, unknown> }));

/** A pending row recorded under `adapter_key` (an invoice of an earlier adapter, §3.15 Switch). */
function pendingRow(invoice_id: string, adapter_key: string, pos_id = 'POS-1'): void {
  hub.deps.db
    .prepare(
      `INSERT INTO fiscal_outbox (invoice_id, ord, ref_invoice_id, jurisdiction_id, adapter_key, pos_id, state, queued_at)
       VALUES (?, 999999, NULL, 'TEST-J', ?, ?, 'pending', 0)`,
    )
    .run(invoice_id, adapter_key, pos_id);
}

// ================================================================================================ #81

describe('[05 #81, §6.28a] SetFiscalToken — permission and session', () => {
  it('[05 #81, B-2] the Owner is allowed: result { pos_id, name, set_at }, the token in fiscal_credentials only, FiscalTokenSet ids only', async () => {
    await start();
    const token = secret('TOKEN-OWNER-0001');
    const r = await setToken({ pos_id: 'POS-1', token });
    expect(r.status, r.raw).toBe(200);
    const set_at = hub.clock.branchNow();
    expect(r.result).toEqual({ pos_id: 'POS-1', name: 'token', set_at });
    expect(r.raw).not.toContain(token);
    expect(credentials()).toEqual([{ pos_id: 'POS-1', name: 'token', token, set_at, set_by_staff_id: OWNER }]);
    expect(tokenEvents()).toEqual([
      { stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, actor_id: OWNER, payload: { pos_id: 'POS-1', name: 'token', set_at, set_by_staff_id: OWNER } },
    ]);
    // processed_commands keeps only the result (row H-4): checked by the afterEach scan; the scan is live:
    expect(leaksOf('POS-1').length).toBeGreaterThan(0);
    expect(JSON.stringify(hub.deps.db.prepare('SELECT * FROM fiscal_credentials').all())).toContain(token);
  });

  it('[05 #81, B-2, H6-13] a Manager (default role) is refused 403 PERMISSION_DENIED; nothing written, nothing echoed', async () => {
    await start();
    const token = secret('TOKEN-MANAGER-0002');
    const r = await setToken({ pos_id: 'POS-1', token }, { staffId: STAFF.manager });
    expect([r.status, r.error?.code]).toEqual([403, 'PERMISSION_DENIED']);
    expect(r.raw).not.toContain(token);
    expect(credentials()).toEqual([]);
    expect(tokenEvents()).toEqual([]);
  });

  it('[05 §6.28a, row H-1] admin only: the staff route /commands/set-fiscal-token does not take it', async () => {
    await start();
    const token = secret('TOKEN-DEVICE-0003');
    const r = await setToken({ pos_id: 'POS-1', token }, { route: 'device' });
    expect(r.status).toBe(404);
    expect(r.raw).not.toContain(token);
    expect(credentials()).toEqual([]);
  });
});

describe('[05 #81, §6.28a] SetFiscalToken — references', () => {
  it('[05 #81] a pos_id not in the branch fiscal settings → 422 CONFIG_REFERENCE_INVALID { field: pos_id, reason: not_found }', async () => {
    await start();
    const token = secret('TOKEN-BADPOS-0004');
    const r = await setToken({ pos_id: 'POS-9', token });
    expect([r.status, r.error?.code, r.error?.details]).toEqual([422, 'CONFIG_REFERENCE_INVALID', { field: 'pos_id', reason: 'not_found' }]);
    expect(r.raw).not.toContain(token);
    expect(credentials()).toEqual([]);
    expect(tokenEvents()).toEqual([]);
  });

  it('[05 #81, H10-5] a name outside the adapters\' credentialNames → 422 CONFIG_REFERENCE_INVALID { field: name, reason: not_found }', async () => {
    await start();
    const token = secret('TOKEN-BADNAME-0005');
    const r = await setToken({ pos_id: 'POS-1', name: 'api_key', token });
    expect([r.status, r.error?.code, r.error?.details]).toEqual([422, 'CONFIG_REFERENCE_INVALID', { field: 'name', reason: 'not_found' }]);
    expect(r.raw).not.toContain(token);
    expect(credentials()).toEqual([]);
  });

  it('[05 #81, H10-5, H11-4] a name of an adapter recorded on a pending row is accepted; a second name for one pos_id is a second row', async () => {
    await start();
    pendingRow('INV-OLD-1', 'FAKE2');
    const a = await setToken({ pos_id: 'POS-1', name: 'api_key', token: secret('TOKEN-APIKEY-0006') });
    const b = await setToken({ pos_id: 'POS-1', name: 'device_key', token: secret('TOKEN-DEVKEY-0007') });
    const c = await setToken({ pos_id: 'POS-1', token: secret('TOKEN-PLAIN-0008') });
    expect([a.status, b.status, c.status], a.raw + b.raw + c.raw).toEqual([200, 200, 200]);
    expect(credentials().map((x) => [x.pos_id, x.name, x.token])).toEqual([
      ['POS-1', 'api_key', 'TOKEN-APIKEY-0006'],
      ['POS-1', 'device_key', 'TOKEN-DEVKEY-0007'],
      ['POS-1', 'token', 'TOKEN-PLAIN-0008'],
    ]);
    expect(tokenEvents().map((e) => e.payload['name'])).toEqual(['api_key', 'device_key', 'token']);
    // once the row is no longer pending its adapter's names are refused again
    hub.deps.db.prepare(`UPDATE fiscal_outbox SET state = 'acked' WHERE invoice_id = 'INV-OLD-1'`).run();
    const d = await setToken({ pos_id: 'POS-1', name: 'api_key', token: secret('TOKEN-APIKEY-0009') });
    expect([d.status, d.error?.details]).toEqual([422, { field: 'name', reason: 'not_found' }]);
  });
});

describe('[05 #81, §6.28a] SetFiscalToken — replace, retransmit, validation', () => {
  it('[05 #81, B22] replacing: a new token overwrites the row (one row per (pos_id, name)), set_at and set_by move; one event per set', async () => {
    await start();
    const first = await setToken({ pos_id: 'POS-2', token: secret('TOKEN-FIRST-0010') });
    expect(first.status, first.raw).toBe(200);
    const second = await setToken({ pos_id: 'POS-2', name: 'token', token: secret('TOKEN-SECOND-0011') });
    expect(second.status, second.raw).toBe(200);
    expect(credentials()).toEqual([{ pos_id: 'POS-2', name: 'token', token: 'TOKEN-SECOND-0011', set_at: second.result!['set_at'], set_by_staff_id: OWNER }]);
    expect(second.result!['set_at']).toBeGreaterThan(first.result!['set_at'] as number);
    expect(tokenEvents()).toHaveLength(2);
  });

  it('[05 #81, row H-4, H1-19] hashOmit token: a resend of the same command_id with only the token changed replays the stored reply and writes nothing', async () => {
    await start();
    const first = await setToken({ pos_id: 'POS-1', token: secret('TOKEN-ORIGINAL-0012') }, { commandId: 'cmd-sft-replay' });
    expect(first.status, first.raw).toBe(200);
    const again = await setToken({ pos_id: 'POS-1', token: secret('TOKEN-CHANGED-0013') }, { commandId: 'cmd-sft-replay' });
    expect([again.status, again.result], again.raw).toEqual([200, first.result]);
    expect(again.raw).not.toContain('TOKEN-CHANGED-0013');
    expect(credentials().map((c) => c.token)).toEqual(['TOKEN-ORIGINAL-0012']);
    expect(tokenEvents()).toHaveLength(1);
    // a change to a hashed field is a different command: command_id already used (00 §3.7, 400 VALIDATION_FAILED)
    const other = await setToken({ pos_id: 'POS-2', token: secret('TOKEN-OTHER-0014') }, { commandId: 'cmd-sft-replay' });
    expect([other.status, other.error?.code]).toEqual([400, 'VALIDATION_FAILED']);
    expect(credentials().map((c) => c.pos_id)).toEqual(['POS-1']);
    expect(other.raw).not.toContain('TOKEN-OTHER-0014');
  });

  it('[05 §6.28a, row H-4] token 1–512 printable: empty, 513 chars or a control character → 400 VALIDATION_FAILED that never echoes it', async () => {
    await start();
    const long = secret(`TOKEN-LONG-${'x'.repeat(502)}`);
    expect(long).toHaveLength(513);
    const control = secret('TOKEN-CTRL-0015\n');
    for (const token of ['', long, control]) {
      const r = await setToken({ pos_id: 'POS-1', token });
      expect([r.status, r.error?.code], r.raw).toEqual([400, 'VALIDATION_FAILED']);
      if (token !== '') expect(r.raw).not.toContain(token.trim());
    }
    const max = await setToken({ pos_id: 'POS-1', token: secret(`TOKEN-MAX-${'y'.repeat(502)}`) });
    expect(max.status, max.raw).toBe(200);
    expect((await setToken({ pos_id: 'POS-1' })).status).toBe(400);
    expect((await setToken({ pos_id: '', token: secret('TOKEN-NOPOS-0016') })).status).toBe(400);
    expect((await setToken({ pos_id: 'POS-1', name: 'n'.repeat(41), token: secret('TOKEN-LONGNAME-0017') })).status).toBe(400);
    // .strict(): an unknown key is refused, and its value is not echoed either
    const extra = await setToken({ pos_id: 'POS-1', token: secret('TOKEN-EXTRA-0018'), secret_copy: secret('TOKEN-EXTRA-0019') });
    expect([extra.status, extra.error?.code], extra.raw).toEqual([400, 'VALIDATION_FAILED']);
    expect(extra.raw).not.toContain('TOKEN-EXTRA-0018');
    expect(extra.raw).not.toContain('TOKEN-EXTRA-0019');
    expect(tokenEvents()).toHaveLength(1);
  });

  it('[05 §6.28a] statements: the upsert alone on the branch adapter\'s names (1); + the pending-rows adapter read otherwise (2)', async () => {
    await start();
    expect((await setToken({ pos_id: 'POS-1', token: secret('TOKEN-STMT-0018') })).status).toBe(200);
    expect(handled).toBe(1);
    pendingRow('INV-OLD-2', 'FAKE2');
    expect((await setToken({ pos_id: 'POS-1', name: 'api_key', token: secret('TOKEN-STMT-0019') })).status).toBe(200);
    expect(handled).toBe(2);
    expect((await setToken({ pos_id: 'POS-1', name: 'nope', token: secret('TOKEN-STMT-0020') })).status).toBe(422);
    expect(handled).toBe(1);
  });
});

// ================================================================================================ worker

/** The worker deps the hub boots with (index.ts startBillingWorkers), over this test hub. */
function workerDeps(): FiscalWorkerDeps {
  return {
    db: hub.deps.db,
    clock: hub.clock,
    adapterFor: fiscalAdapterFor,
    loadSubmission: (row) => fiscalWorkerSeams.loadSubmission(hub.deps, row),
    onAnswer: (row, answer) => fiscalWorkerSeams.onAnswer(hub.deps, row, answer),
  };
}

/** A FAKE-fiscalized sale on POS-1 (the seams test's shape), appended as InvoiceIssued: the billing fold queues it. */
function issueSale(i: number): string {
  const base = anInvoiceIssued().payload as Record<string, unknown> & { fiscal: Record<string, unknown> };
  const invoice_id = `01J0000000000000000000T${String(i).padStart(3, '0')}`;
  const bill_id = `BILL_T${i}`;
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  hub.deps.writer.run((tx) =>
    tx.append([
      {
        ...anInvoiceIssued({
          stream_id: bill_id,
          payload: {
            invoice_id,
            number: i,
            invoice_ref: `AC1-T${String(i).padStart(6, '0')}`,
            bill_id,
            jurisdiction_id: 'TEST-J',
            payment_ids: [],
            has_buyer_id: false,
            fiscal: { ...base.fiscal, adapter_key: 'FAKE', pos_id: 'POS-1', payment_codes: [] },
          },
        }),
        occurred_at: now,
        actor_id: 'S_CASH',
        device_id: 'D_FIXTURE',
      },
    ]),
  );
  return invoice_id;
}

describe('[05 §6.28a, §3.15] the worker picks the new token at its next send', () => {
  it('[05 §6.28a, #75] token_missing before; after SetFiscalToken the next pass sends it; after a replace the next send carries the new one', async () => {
    await start();
    const invoice_id = issueSale(1);
    expect(eventsOf(InvoiceIssued)).toHaveLength(1);
    expect(await runOnce(workerDeps())).toBe(0);
    expect(hub.deps.db.prepare('SELECT state, last_error FROM fiscal_outbox WHERE invoice_id = ?').get(invoice_id)).toEqual({ state: 'pending', last_error: 'token_missing' });
    expect(fake.calls).toEqual([]);

    const first = secret('TOKEN-WORKER-0021');
    expect((await setToken({ pos_id: 'POS-1', token: first })).status).toBe(200);
    fake.script({ outcome: 'retry', error_code: 'timeout' });
    expect(await runOnce(workerDeps())).toBe(1);
    expect(fake.calls.map((c) => c.sub.credentials)).toEqual([{ token: first }]);

    const second = secret('TOKEN-WORKER-0022');
    expect((await setToken({ pos_id: 'POS-1', token: second })).status).toBe(200);
    hub.clock.advance(60_000); // past the first back-off (5 s)
    fake.script({ outcome: 'ok', fiscal_number: 'FN-1', qr_payload: null });
    expect(await runOnce(workerDeps())).toBe(1);
    expect(fake.calls.map((c) => c.sub.credentials)).toEqual([{ token: first }, { token: second }]);
    expect(hub.deps.db.prepare('SELECT state FROM fiscal_outbox WHERE invoice_id = ?').pluck().get(invoice_id)).toBe('acked');
  });
});

// ================================================================================================ §6.28b

/** handler statements of the last fiscal-credentials read (wrapped like the command, below) */
let read = -1;
/** SQL text the fiscal-credentials read prepared (§6.28b: never the token column) */
let readSql: string[] = [];

function countRead(): void {
  const def = queryRegistry(hub.app).byResource('fiscal-credentials') as QueryDef | undefined;
  if (def === undefined) return; // not registered: every call answers 404 (the failing-first state)
  const counter = statementCounter(hub.deps.readDb); // queries read on the read-only connection
  const prepare = hub.deps.readDb.prepare.bind(hub.deps.readDb);
  let recording = false;
  hub.deps.readDb.prepare = ((sql: string) => {
    if (recording) readSql.push(sql);
    return prepare(sql);
  }) as typeof hub.deps.readDb.prepare;
  const original = def.handle;
  def.handle = (ctx, q) => {
    counter.reset();
    readSql = [];
    recording = true;
    try {
      return original.call(def, ctx, q);
    } finally {
      recording = false;
      read = counter.count;
    }
  };
}

/** GET /admin/queries/fiscal-credentials (or the staff route) as `staffId` in its admin (or staff) session. */
async function listCredentials(o: { staffId?: string; route?: 'admin' | 'device' } = {}): Promise<{ status: number; data?: { credentials: unknown[] }; error?: Reply['error']; raw: string }> {
  const staffId = o.staffId ?? OWNER;
  const deviceRoute = o.route === 'device';
  const kind = deviceRoute ? 'staff' : 'admin';
  let session = sessions.get(`${kind}:${staffId}`);
  if (session === undefined) {
    session = openSession(hub, { kind, staffId, deviceId: device.deviceId });
    sessions.set(`${kind}:${staffId}`, session);
  }
  read = -1;
  const response = await hub.app.inject({
    method: 'GET',
    url: `${deviceRoute ? '/queries/' : '/admin/queries/'}fiscal-credentials`,
    headers: { authorization: `Bearer ${device.token}`, [deviceRoute ? 'x-session-token' : 'x-admin-session']: session.token },
  });
  const body = response.json() as { data?: { credentials: unknown[] }; error?: Reply['error'] };
  return { status: response.statusCode, data: body.data, error: body.error, raw: response.body };
}

describe('[05 §6.28b, R-63] GET /admin/queries/fiscal-credentials', () => {
  it('[05 §6.28b] one entry per pos_id × the branch adapter\'s names, ordered by pos_id, name; set_at null until set, then the set time; never the token', async () => {
    await start();
    countRead();
    const before = await listCredentials();
    expect(before.status, before.raw).toBe(200);
    expect(before.data).toEqual({
      credentials: [
        { pos_id: 'POS-1', label: 'Counter', name: 'token', set_at: null },
        { pos_id: 'POS-2', label: 'Bar', name: 'token', set_at: null },
      ],
    });
    const token = secret('TOKEN-LIST-0030');
    const set = await setToken({ pos_id: 'POS-2', token });
    expect(set.status, set.raw).toBe(200);
    const after = await listCredentials();
    expect(after.data!.credentials).toEqual([
      { pos_id: 'POS-1', label: 'Counter', name: 'token', set_at: null },
      { pos_id: 'POS-2', label: 'Bar', name: 'token', set_at: set.result!['set_at'] },
    ]);
    expect(after.raw).not.toContain(token);
    expect(read).toBe(2);
  });

  it('[05 §6.28b, H11-4] the names of an adapter on a pending row are listed for every pos_id; a row no longer pending drops them; 2 statements throughout', async () => {
    await start();
    countRead();
    pendingRow('INV-OLD-3', 'FAKE2');
    pendingRow('INV-OLD-4', 'GONE'); // an adapter this hub does not know: no names
    expect((await setToken({ pos_id: 'POS-1', name: 'device_key', token: secret('TOKEN-LIST-0031') })).status).toBe(200);
    const r = await listCredentials();
    expect(r.status, r.raw).toBe(200);
    expect((r.data!.credentials as Array<{ pos_id: string; name: string; set_at: number | null }>).map((c) => [c.pos_id, c.name, c.set_at === null ? 'not set' : 'set'])).toEqual([
      ['POS-1', 'api_key', 'not set'],
      ['POS-1', 'device_key', 'set'],
      ['POS-1', 'token', 'not set'],
      ['POS-2', 'api_key', 'not set'],
      ['POS-2', 'device_key', 'not set'],
      ['POS-2', 'token', 'not set'],
    ]);
    expect(read).toBe(2);
    hub.deps.db.prepare(`UPDATE fiscal_outbox SET state = 'acked'`).run();
    const later = await listCredentials();
    expect((later.data!.credentials as Array<{ name: string }>).map((c) => c.name)).toEqual(['token', 'token']);
    expect(read).toBe(2);
  });

  it('[05 §6.28b] manage-fiscal-settings is checked before any read: a Manager gets 403 PERMISSION_DENIED and 0 statements; the staff route has no such query', async () => {
    await start();
    countRead();
    const r = await listCredentials({ staffId: STAFF.manager });
    expect([r.status, r.error?.code]).toEqual([403, 'PERMISSION_DENIED']);
    expect(read).toBe(0);
    expect((await listCredentials({ route: 'device' })).status).toBe(404);
  });

  it('[05 §6.28b] with no branch config → { credentials: [] }', async () => {
    await start();
    countRead();
    swapBranchConfig(null);
    const r = await listCredentials();
    expect([r.status, r.data], r.raw).toEqual([200, { credentials: [] }]);
  });

  it('[05 §6.28b] leak test: the read selects no token — every answer, the log and every table but fiscal_credentials stay clean', async () => {
    await start();
    countRead();
    pendingRow('INV-OLD-5', 'FAKE2');
    const tokens = ['TOKEN-LEAK-0032', 'TOKEN-LEAK-0033', 'TOKEN-LEAK-0034'].map(secret);
    for (const [i, name] of (['token', 'api_key', 'device_key'] as const).entries()) {
      expect((await setToken({ pos_id: 'POS-1', name, token: tokens[i]! })).status).toBe(200);
    }
    const r = await listCredentials();
    expect(r.status).toBe(200);
    for (const tk of tokens) expect(r.raw).not.toContain(tk);
    // §6.28b: "the read selects pos_id, name, set_at only" — pinned on the SQL text it prepared
    const credSql = readSql.filter((sql) => /\bfiscal_credentials\b/.test(sql));
    expect(credSql).toHaveLength(1);
    expect(credSql[0]).toMatch(/^SELECT pos_id, name, set_at FROM fiscal_credentials\b/);
    expect(readSql.filter((sql) => /\btoken\b|\*/.test(sql))).toEqual([]);
    // the scan is live: the tokens are in fiscal_credentials (the afterEach scan holds them to it)
    expect(credentials().map((c) => c.token).sort()).toEqual([...tokens].sort());
  });
});
