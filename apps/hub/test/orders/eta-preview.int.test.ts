import { availableStock, type EngineState } from '@pos/engine';
import type { BranchConfig, DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { branchConfig, runBranchConfigHooks, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FX, fixtureMenu, openDay, openSeating, setZoneStock } from './fixtures';

// 02b v1.0.3 §6.14 GET /queries/eta-preview: §3.2 steps 4–8 read-only on a draft with temp keys, follow_up as §3.3,
// reserveStock (nothing appended) then calculateETA; §10 #33 (preview half), #3 (config between preview and submit).

let hub: TestHub;

afterEach(async () => {
  activity.drain();
  swapBranchConfig(null);
  await hub.close();
});

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const grant = (permission: string) => ({ permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope: 'branch' as const });
  return {
    ...base,
    roles: [...base.roles, { role_id: 'R_TAKER', name: 'R_TAKER', session_idle_ttl_ms: 3_600_000, permissions: [grant('take-order')] }],
    staff: [...base.staff, { staff_id: 'S_ALI', display_name: 'Ali', pin_hash: pin, role_ids: ['R_TAKER'], denied_permissions: [], lead_staff_id: null, floor_ids: [] }],
  };
}

async function setUp(o: { menu?: BranchConfig; stock?: Record<string, number>; zone?: number } = {}): Promise<void> {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  openDay(hub, { menu: o.menu, stock: o.stock });
  if (o.zone !== undefined) setZoneStock(hub, FX.zone, FX.zoneItem, o.zone);
}

interface Who {
  staffId: string;
  deviceId: string;
  token: string;
  sessionId: string;
  sessionToken: string;
}

function signIn(staffId = 'S_ALI'): Who {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, token: device.token, sessionId: session.sessionId, sessionToken: session.token };
}

interface PreviewLine {
  key: string;
  eta_ms: number | null;
  from_stock: boolean;
  zone_served: boolean;
  refused?: { code: string; details: Record<string, unknown> };
}
interface Preview {
  as_of_seq: number;
  groups: Array<{ promise_ms: number; keys: string[] }>;
  lines: PreviewLine[];
}

async function preview(who: Who, draft: unknown, raw?: string): Promise<{ status: number; data?: Preview; error?: { code: string; details: Record<string, unknown> } }> {
  const res = await hub.app.inject({
    method: 'GET',
    url: `/queries/eta-preview?draft=${encodeURIComponent(raw ?? JSON.stringify(draft))}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
  });
  const body = res.json() as { data?: Preview; error?: { code: string; details: Record<string, unknown> } };
  return { status: res.statusCode, data: body.data, error: body.error };
}

interface SubmitResult {
  groups: Array<{ group_id: string; promise_ms: number; order_item_ids: string[] }>;
  lines: Array<{ order_item_id: string; eta_ms: number | null; from_stock: boolean; zone_served: boolean }>;
}

let commandSeq = 0;

/** Submits the draft with each key as its id (keys → order_item_id) and returns the result in the preview's shape. */
async function submitDraft(who: Who, order_id: string, draft: Record<string, unknown>): Promise<{ status: number; asPreview: Omit<Preview, 'as_of_seq'>; placed: Record<string, unknown> }> {
  const payload = JSON.parse(JSON.stringify({ order_id, ...draft }).replace(/"key":/g, '"order_item_id":')) as Record<string, unknown>;
  const res = await hub.app.inject({
    method: 'POST',
    url: '/commands/submit-order',
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id: `cmd-${(commandSeq += 1)}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'SubmitOrder',
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: who.staffId,
      device_id: who.deviceId,
    },
  });
  const body = res.json() as { data?: { event_ids: string[]; result: SubmitResult } };
  const result = body.data!.result;
  const placed = hub.deps.db
    .prepare("SELECT payload FROM events WHERE event_type = 'OrderPlaced' AND stream_id = ?")
    .pluck()
    .get(order_id) as string;
  return {
    status: res.statusCode,
    asPreview: {
      groups: result.groups.map((g) => ({ promise_ms: g.promise_ms, keys: g.order_item_ids })),
      lines: result.lines.map(({ order_item_id, ...rest }) => ({ key: order_item_id, ...rest })),
    },
    placed: JSON.parse(placed) as Record<string, unknown>,
  };
}

function append(draft: Omit<EventDraft, 'occurred_at' | 'schema_version' | 'device_id' | 'actor_id'> & { actor_id?: string | null }): void {
  const at = hub.clock.branchNow();
  hub.deps.writer.run((tx) => tx.append([{ schema_version: 1, actor_id: null, device_id: 'hub', occurred_at: at, ...draft } as EventDraft]));
}
const serve = (order_id: string, order_item_ids: string[]): void =>
  append({ stream_type: 'order', stream_id: order_id, event_type: 'ItemServed', payload: { order_item_ids, source: 'tap' }, actor_id: 'S_ALI' });
const pause = (station_id: string): void => append({ stream_type: 'station', stream_id: station_id, event_type: 'StationPauseSet', payload: { station_id, paused: true } });
const makeUnavailable = (item_id: string): void =>
  append({ stream_type: 'stock', stream_id: item_id, event_type: 'ItemMadeUnavailable', payload: { item_id }, actor_id: 'S_MGR' });

const engine = (): EngineState => hub.deps.state.get() as EngineState;
const eventCount = (): number => (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
const stockLeft = (): number => availableStock(engine(), FX.stock, engine().business_day!.opened_at, branchConfig()!.stock_items[0]!);
const zoneCount = (): number | undefined =>
  (hub.deps.db.prepare('SELECT on_hand FROM zone_stock WHERE zone_id = ? AND item_id = ?').get(FX.zone, FX.zoneItem) as { on_hand: number } | undefined)?.on_hand;

const line = (key: string, item_id: string, quantity = 1, o: Record<string, unknown> = {}) => ({ key, item_id, quantity, ...o });
const takeaway = (lines: unknown[]) => ({ order_type: 'takeaway', lines });
const dineIn = (lines: unknown[], table_id: string = FX.table, seating_id = 'SEAT1') => ({ order_type: 'dine_in', table_id, seating_id, lines });
/**
 * karahi with a linked raita (option_child), 2 naan, a water, a combo deal (karahi + 2 naan). The keys sort in draft
 * order, as ids a device mints in line order (ULIDs) do: the engine breaks ties by order_item_id (03a), so the submit
 * of the same cart plans the same way only when its ids sort as the preview's minted ids do.
 */
const fullCart = (): unknown[] => [
  line('c1', FX.piece, 1, { options: [{ option_id: FX.option, quantity: 1, key: 'c1o' }] }),
  line('c2', FX.naan, 2),
  line('c3', FX.ready),
  {
    key: 'c4',
    deal_id: FX.deal,
    quantity: 1,
    deal_choices: [
      { deal_part_id: FX.dealParts[0], item_id: FX.piece, key: 'c4a' },
      { deal_part_id: FX.dealParts[1], item_id: FX.naan, key: 'c4b' },
    ],
  },
];

describe('02b eta-preview (§6.14)', () => {
  it('[02b #33 preview] appends nothing; { as_of_seq, groups [{ promise_ms, keys }], lines [{ key, eta_ms, from_stock, zone_served }] } = the submit of the same cart at the same instant', async () => {
    await setUp({ stock: { [FX.stock]: 500 } }); // one karahi from stock
    const ali = signIn();
    const before = eventCount();
    const stock = stockLeft();
    const state = engine();
    const r = await preview(ali, takeaway(fullCart()));
    expect(r.status).toBe(200);
    expect(eventCount()).toBe(before);
    expect(engine()).toBe(state); // no fold ran: nothing appended
    expect(stockLeft()).toBe(stock); // reserveStock claimed nothing
    expect(r.data!.as_of_seq).toBe(hub.deps.writer.lastSeq());
    expect(r.data!.lines.map((l) => l.key)).toEqual(['c1', 'c1o', 'c2', 'c3', 'c4', 'c4a', 'c4b']);
    for (const l of r.data!.lines) expect(Object.keys(l).sort()).toEqual(['eta_ms', 'from_stock', 'key', 'zone_served']);
    for (const g of r.data!.groups) expect(Object.keys(g).sort()).toEqual(['keys', 'promise_ms']);
    // The same preview twice reads the same state.
    expect((await preview(ali, takeaway(fullCart()))).data).toEqual(r.data);
    const s = await submitDraft(ali, 'O1', takeaway(fullCart()));
    expect(s.status).toBe(200);
    expect({ groups: r.data!.groups, lines: r.data!.lines }).toEqual(s.asPreview);
  });

  it('[02b #33 preview] uses from_stock: reserveStock in line order (the first karahi from stock, the second fresh); nothing claimed', async () => {
    await setUp({ stock: { [FX.stock]: 500 } });
    const ali = signIn();
    const now = hub.clock.branchNow();
    const one = await preview(ali, takeaway([line('a', FX.piece)]));
    expect(one.data!.lines[0]).toMatchObject({ from_stock: true });
    expect(one.data!.lines[0]!.eta_ms! - now).toBeLessThan(1_200_000); // stock time, not cook_time_ms
    const r = await preview(ali, takeaway([line('a', FX.piece), line('b', FX.piece)]));
    expect(r.data!.lines.map((l) => [l.key, l.from_stock])).toEqual([
      ['a', true],
      ['b', false],
    ]);
    expect(r.data!.lines[1]!.eta_ms! - now).toBeGreaterThanOrEqual(1_200_000); // the fresh one: cook_time_ms
    expect(stockLeft()).toBe(500);
    const s = await submitDraft(ali, 'O1', takeaway([line('a', FX.piece), line('b', FX.piece)]));
    expect({ groups: r.data!.groups, lines: r.data!.lines }).toEqual(s.asPreview);
  });

  it('[02b #33 preview] follow_up: round 2 preview = round 2 submit (after a served food line)', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    const ali = signIn();
    expect((await submitDraft(ali, 'O1', dineIn([line('r1', FX.piece)]))).status).toBe(200);
    serve('O1', ['r1']); // the karahi: a food line
    const round2 = dineIn([line('r2', FX.piece), line('r3', FX.naan)]);
    const p = await preview(ali, round2);
    expect(p.status).toBe(200);
    const s = await submitDraft(ali, 'O2', round2);
    expect(s.placed.follow_up).toBe(true);
    expect({ groups: p.data!.groups, lines: p.data!.lines }).toEqual(s.asPreview);
  });

  it('[02b #33 preview] countsAsActivity: false (no activity touch; a countsAsActivity query on the same session does touch)', async () => {
    await setUp();
    const ali = signIn();
    hub.clock.advance(60_000);
    expect((await preview(ali, takeaway([line('a', FX.naan)]))).status).toBe(200);
    expect(activity.get(ali.sessionId)).toBeUndefined();
    const control = await hub.app.inject({ method: 'GET', url: '/queries/test-activity', headers: { authorization: `Bearer ${ali.token}`, 'x-session-token': ali.sessionToken } });
    expect(control.statusCode).toBe(200);
    expect(activity.get(ali.sessionId)).toBeDefined();
  });

  it('[02b #33 preview] 3 statements (availability, zone counts, follow_up) on a dine-in draft with a zone candidate; fewer where a read cannot apply', async () => {
    await setUp({ zone: 5 });
    const ali = signIn();
    const counter = statementCounter(hub.deps.readDb);
    const zoned = await preview(ali, dineIn([line('z', FX.zoneItem, 1, { from_zone: true }), line('n', FX.naan)], FX.zoneTable));
    expect(counter.count).toBe(3);
    expect(zoned.status).toBe(200);
    expect(zoned.data!.lines.find((l) => l.key === 'z')).toEqual({ key: 'z', eta_ms: null, from_stock: false, zone_served: true });
    expect(zoneCount()).toBe(5); // nothing claimed
    // Dine-in without a zone candidate: availability + follow_up (no zone counts to read).
    counter.reset();
    expect((await preview(ali, dineIn([line('n', FX.naan)]))).status).toBe(200);
    expect(counter.count).toBe(2);
    // Takeaway: availability only (follow_up is false without a read, §3.3; no zone).
    counter.reset();
    expect((await preview(ali, takeaway([line('n', FX.naan)]))).status).toBe(200);
    expect(counter.count).toBe(1);
  });

  it('[02b #33 preview] a draft over 8 KB → 400 VALIDATION_FAILED at draft; exactly 8 KB is read; bad JSON / shape / repeated key → 400', async () => {
    await setUp();
    const ali = signIn();
    const sized = (bytes: number): string => {
      const shell = JSON.stringify(takeaway([line('', FX.naan)]));
      return shell.replace('"key":""', `"key":"${'k'.repeat(bytes - shell.length)}"`);
    };
    expect(Buffer.byteLength(sized(8_192))).toBe(8_192);
    expect((await preview(ali, null, sized(8_192))).status).toBe(200);
    const over = await preview(ali, null, sized(8_193));
    expect(over.status).toBe(400);
    expect(over.error!.code).toBe('VALIDATION_FAILED');
    expect(over.error!.details.issues).toEqual([expect.objectContaining({ path: 'draft' })]);
    const before = eventCount();
    for (const raw of ['{not json', JSON.stringify({ order_type: 'delivery', lines: [line('a', FX.naan)] }), JSON.stringify(takeaway([line('a', FX.naan), line('a', FX.ready)]))]) {
      const r = await preview(ali, null, raw);
      expect([r.status, r.error!.code]).toEqual([400, 'VALIDATION_FAILED']);
    }
    // A repeated key is reported at its path; a linked option without its key at the option's key.
    expect((await preview(ali, takeaway([line('a', FX.naan), line('a', FX.ready)]))).error!.details.issues).toEqual([expect.objectContaining({ path: 'draft.lines.1.key' })]);
    const noKey = await preview(ali, takeaway([line('a', FX.naan), line('b', FX.piece, 1, { options: [{ option_id: FX.option, quantity: 1 }] })]));
    expect(noKey.status).toBe(400);
    expect(noKey.error!.details.issues).toEqual([expect.objectContaining({ path: 'draft.lines.1.options.0.key' })]);
    // Ids are minted by the hub, never taken from the client.
    expect((await preview(ali, { order_id: 'O1', ...takeaway([line('a', FX.naan)]) })).status).toBe(400);
    expect((await preview(ali, takeaway([{ order_item_id: 'L1', item_id: FX.naan, quantity: 1 }]))).status).toBe(400);
    expect(eventCount()).toBe(before);
  });

  it('[02b §6.14] refusals are per line (refused { code, details }, no eta) and the other lines are still previewed; no open day → 409 BUSINESS_DAY_NOT_OPEN', async () => {
    const menu = fixtureMenu();
    menu.items = [
      ...menu.items,
      { ...menu.items.find((i) => i.item_id === FX.piece)!, item_id: 'I_PAYE', name: 'Paye', out_of_stock_behaviour: 'sold_out' as const },
      { ...menu.items.find((i) => i.item_id === FX.naan)!, item_id: 'I_ROTI', name: 'Roti', station_id: FX.zoneStation },
    ];
    await setUp({ menu, stock: { [FX.stock]: 500 } }); // one karahi (or Paye) of K1
    makeUnavailable(FX.ready);
    pause(FX.zoneStation);
    const ali = signIn();
    const r = await preview(
      ali,
      takeaway([
        line('l1_nope', 'I_NOPE'),
        line('l2_water', FX.ready),
        line('l3_roti', 'I_ROTI'),
        line('l4_paye1', 'I_PAYE'),
        line('l5_paye2', 'I_PAYE'),
        line('l6_karahi', FX.piece, 1, { options: [{ option_id: FX.option, quantity: 6, key: 'l6o_raita' }] }),
        line('l7_naan', FX.naan),
      ]),
    );
    expect(r.status).toBe(200);
    const refused = (key: string) => r.data!.lines.find((l) => l.key === key)!;
    const none = { eta_ms: null, from_stock: false, zone_served: false };
    expect(refused('l1_nope')).toEqual({ key: 'l1_nope', ...none, refused: { code: 'MENU_ITEM_NOT_FOUND', details: { item_id: 'I_NOPE' } } });
    expect(refused('l2_water')).toEqual({ key: 'l2_water', ...none, refused: { code: 'ITEM_UNAVAILABLE', details: { item_id: FX.ready } } });
    expect(refused('l3_roti')).toEqual({ key: 'l3_roti', ...none, refused: { code: 'STATION_PAUSED', details: { station_id: FX.zoneStation } } });
    // The first Paye takes the last stock; the second is refused with what is left after it (N-7).
    expect(refused('l4_paye1')).toMatchObject({ from_stock: true, eta_ms: expect.any(Number) });
    expect(refused('l4_paye1').refused).toBeUndefined();
    expect(refused('l5_paye2')).toEqual({ key: 'l5_paye2', ...none, refused: { code: 'ITEM_SOLD_OUT', details: { item_id: 'I_PAYE', available: 0 } } });
    // OPTION_CHOICE_INVALID names the line by its key; every key of a refused line is listed with the refusal.
    expect(refused('l6_karahi').refused).toMatchObject({ code: 'OPTION_CHOICE_INVALID', details: { order_item_id: 'l6_karahi', violations: expect.any(Array) } });
    expect(refused('l6o_raita').refused).toEqual(refused('l6_karahi').refused);
    expect(refused('l7_naan')).toMatchObject({ from_stock: false, eta_ms: expect.any(Number) });
    expect(r.data!.lines.map((l) => l.key)).toEqual(['l1_nope', 'l2_water', 'l3_roti', 'l4_paye1', 'l5_paye2', 'l6_karahi', 'l6o_raita', 'l7_naan']);
    expect(r.data!.groups.flatMap((g) => g.keys).sort()).toEqual(['l4_paye1', 'l7_naan']);
    // A preview of the accepted lines alone = their submit.
    const s = await submitDraft(ali, 'O1', takeaway([line('l4_paye1', 'I_PAYE'), line('l7_naan', FX.naan)]));
    expect(r.data!.groups).toEqual(s.asPreview.groups);

    append({ stream_type: 'hub', stream_id: 'branch-1', event_type: 'BusinessDayClosed', payload: {} });
    const closed = await preview(ali, takeaway([line('l7_naan', FX.naan)]));
    expect([closed.status, closed.error!.code]).toEqual([409, 'BUSINESS_DAY_NOT_OPEN']);
  });

  it('[02b #3] config applied between preview and submit → the submit uses the config at submit (D25); a new preview reads it too', async () => {
    await setUp();
    const ali = signIn();
    const now = hub.clock.branchNow();
    const cart = takeaway([line('n', FX.naan)]);
    const before = await preview(ali, cart);
    expect(before.data!.lines[0]!.eta_ms! - now).toBeLessThan(1_200_000); // naan cook 5 min
    const menu = fixtureMenu();
    const next: BranchConfig = { ...menu, config_version: menu.config_version + 1, items: menu.items.map((i) => (i.item_id === FX.naan ? { ...i, cook_time_ms: 1_800_000 } : i)) };
    hub.deps.writer.run((tx) => runBranchConfigHooks(branchConfig(), next, tx));
    swapBranchConfig({ config: next, snapshotHash: 'e'.repeat(64), configVersion: next.config_version, snapshotSchemaVersion: 4, appliedAt: now });
    const after = await preview(ali, cart);
    expect(after.data!.lines[0]!.eta_ms! - now).toBeGreaterThanOrEqual(1_800_000);
    const s = await submitDraft(ali, 'O1', cart);
    expect(s.status).toBe(200);
    expect(s.asPreview.lines[0]!.eta_ms).not.toBe(before.data!.lines[0]!.eta_ms);
    expect({ groups: after.data!.groups, lines: after.data!.lines }).toEqual(s.asPreview);
  });
});
