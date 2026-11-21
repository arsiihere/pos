// 05 §6.23a `GET /queries/bill-printers` (task 27; G-28 / R-27, 05 v1.0.5): #60b. `take-order` with any grant, staff
// session; the branch's active printers `{ printer_id, name }` sorted by name; 1 statement whatever their number.
// Printers by 03c's real `PrinterSaved` events through the print_config fold.
import { afterEach, describe, expect, it } from 'vitest';
import { queryRegistry, type QueryDef } from '../../src/queries/registry';
import { statementCounter } from '../helpers/statement-counter';
import { openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { billingDirectory, signIn, STAFF, startBilling, type Who } from './fixtures';

let hub: TestHub;

afterEach(async () => {
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

const branch = () => hub.deps.config.provisioned!.branch_id;

function printers(list: Array<{ printer_id: string; name: string; archived?: boolean }>): void {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  hub.deps.writer.run((tx) =>
    tx.append(
      list.map((p, i) => ({
        stream_type: 'hub' as const,
        stream_id: branch(),
        event_type: 'PrinterSaved',
        schema_version: 1,
        payload: { printer_id: p.printer_id, name: p.name, connection: 'lan', address: `192.168.2.${(i % 250) + 1}:9100`, paper_width_mm: 80, archived: p.archived ?? false },
        occurred_at: now,
        actor_id: STAFF.manager,
        device_id: 'D_FIXTURE',
      })),
    ),
  );
}

async function list(who: { token: string; sessionToken: string }): Promise<{ status: number; body: { data?: unknown; error?: { code: string } } }> {
  const res = await hub.app.inject({ method: 'GET', url: '/queries/bill-printers', headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
  return { status: res.statusCode, body: res.json() as { data?: unknown; error?: { code: string } } };
}

let directoryVersion = 1;
type Directory = Awaited<ReturnType<typeof billingDirectory>>;
type Grants = Directory['roles'][number]['permissions'];
async function orderTakerGrants(f: (g: Grants) => Grants): Promise<Who> {
  directoryVersion += 1; // a re-seed applies only with a newer directory version
  const dir = await billingDirectory({ directory_version: directoryVersion });
  await seedDirectory(hub, { ...dir, roles: dir.roles.map((r) => (r.role_id === 'R_WAIT' ? { ...r, permissions: f(r.permissions) } : r)) });
  return signIn(hub, STAFF.orderTaker);
}

const THREE = { printers: [{ printer_id: 'P_A', name: 'Alpha' }, { printer_id: 'P_M', name: 'Middle' }, { printer_id: 'P_Z', name: 'Zulu' }] };

describe('[05 §6.23a, #60b] GET /queries/bill-printers', () => {
  it('[05 #60b] three active printers (names out of insert order) and one archived → the active ones, { printer_id, name }, sorted by name; 1 statement', async () => {
    hub = await startBilling();
    printers([
      { printer_id: 'P_Z', name: 'Zulu' },
      { printer_id: 'P_A', name: 'Alpha' },
      { printer_id: 'P_OLD', name: 'Beta', archived: true },
      { printer_id: 'P_M', name: 'Middle' },
    ]);
    countHandle();
    const r = await list(signIn(hub, STAFF.orderTaker));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toEqual(THREE);
    expect(handled.count).toBe(1);
  });

  it('[05 #60b] no printers → { printers: [] }', async () => {
    hub = await startBilling();
    const r = await list(signIn(hub, STAFF.orderTaker));
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ printers: [] });
  });

  it('[05 #60b, #91] 1 statement with 40 printers, as with 1', async () => {
    hub = await startBilling();
    const who = signIn(hub, STAFF.orderTaker);
    countHandle();
    printers([{ printer_id: 'P_ONE', name: 'One' }]);
    expect((await list(who)).status).toBe(200);
    expect(handled.count).toBe(1);
    printers(Array.from({ length: 39 }, (_, i) => ({ printer_id: `P_${String(i).padStart(2, '0')}`, name: `Printer ${String(i).padStart(2, '0')}` })));
    const r = await list(who);
    expect((r.body.data as { printers: unknown[] }).printers).toHaveLength(40);
    expect(handled.count).toBe(1);
  });

  it('[05 #60b, §10 grant states] allowed at each scope and requires_approval → the whole list; not granted, take-payment only → 403', async () => {
    hub = await startBilling();
    printers([
      { printer_id: 'P_Z', name: 'Zulu' },
      { printer_id: 'P_A', name: 'Alpha' },
      { printer_id: 'P_M', name: 'Middle' },
    ]);
    for (const scope of ['branch', 'my_floors', 'own_tables'] as const) {
      // out of scope does not exist: the caller holds no table and is on no floor, and still gets the whole list
      const who = await orderTakerGrants((g) => g.map((x) => (x.permission === 'take-order' ? { ...x, scope } : x)));
      const r = await list(who);
      expect(r.status, `${scope}: ${JSON.stringify(r.body)}`).toBe(200);
      expect(r.body.data).toEqual(THREE);
    }
    const approval = await orderTakerGrants((g) => g.map((x) => (x.permission === 'take-order' ? { ...x, grant_type: 'requires_approval' as const, approver_role_id: 'R_MGR', approver_role_ids: ['R_MGR'] } : x)));
    expect((await list(approval)).body.data).toEqual(THREE);

    // the order taker keeps take-payment (own_tables, row B-2): a holder of only take-payment is refused
    const paymentOnly = await orderTakerGrants((g) => g.filter((x) => x.permission !== 'take-order'));
    const denied = await list(paymentOnly);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatchObject({ code: 'PERMISSION_DENIED' });
    const none = await orderTakerGrants((g) => g.filter((x) => x.permission !== 'take-order' && x.permission !== 'take-payment'));
    expect((await list(none)).status).toBe(403);
  });

  it('[05 #60b] a station or an admin session without a staff session is refused by 00\'s auth', async () => {
    hub = await startBilling();
    printers([{ printer_id: 'P_A', name: 'Alpha' }]);
    const kds = pairDevice(hub, { type: 'kds', stationId: 'ST_GRILL' });
    const station = openSession(hub, { kind: 'station', stationId: 'ST_GRILL', deviceId: kds.deviceId });
    const s = await list({ token: kds.token, sessionToken: station.token });
    expect(s.status).toBe(401);
    expect(s.body.error).toMatchObject({ code: 'SESSION_INVALID' });
    const tablet = pairDevice(hub, { type: 'tablet' });
    const admin = openSession(hub, { kind: 'admin', staffId: STAFF.manager, deviceId: tablet.deviceId });
    const a = await list({ token: tablet.token, sessionToken: admin.token });
    expect(a.status).toBe(401);
    expect(a.body.error).toMatchObject({ code: 'SESSION_INVALID' });
  });
});

/** Handler statements of the last `GET /queries/bill-printers` (the route's device / session reads left out). */
const handled: { count?: number } = {};
function countHandle(): void {
  const def = queryRegistry(hub.app).byResource('bill-printers') as QueryDef | undefined;
  if (def === undefined) return; // not registered: every call answers 404 (the failing-first state)
  const counter = statementCounter(hub.deps.readDb); // queries read on the read connection
  const original = def.handle;
  def.handle = (ctx, q) => {
    counter.reset();
    try {
      return original.call(def, ctx, q);
    } finally {
      handled.count = counter.count;
    }
  };
}
