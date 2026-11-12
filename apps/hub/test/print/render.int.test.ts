import type { Doc } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import type { BranchConfig, PosEvent } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { renderText as renderTextContract } from '../../src/print/contracts';
import { encodeDoc } from '../../src/print/escpos';
import { renderJob, type RenderCtx, type RenderJob } from '../../src/print/render/jobs';
import { renderText } from '../../src/print/render/text';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FX, append, appendOrder, fireLines, fixtureMenu, openDay, openSeating, removeLine } from '../kds/fixtures';

// 03c §3.3 (ticket layout), §3.5 (slips, REPRINT), §3.6 (Doc, mapping, renderText, render at send), task c10.
// Orders, fires, merges, serves, returns and removals are real events (02b / 03b fixtures, real routes for
// SubmitOrder and ReturnToKitchen). The `tickets` / `ticket_lines` rows are c7's fold (owner ruling C1-3); the
// `station_outputs` rows are inserted here.

let hub: TestHub;
afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
});

const DAY = 86_400_000;
const engine = (): EngineState => hub.deps.state.get() as EngineState;
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** fixtureMenu with S1 "Tandoor", Raita cooked at S2 "Counter", tables "4" (FX.table), "5" (FX.zoneTable), "7". */
function menu(o: { readyRaita?: boolean } = {}): BranchConfig {
  const m = fixtureMenu();
  const floor = m.floors[0]!;
  const sides = m.modifier_groups[0]!;
  const cola = { ...sides.options[0]!, option_id: 'O_COLA', name: 'Cola', linked_item_id: FX.zoneItem, sort_order: 1 };
  return {
    ...m,
    modifier_groups: [{ ...sides, options: [...sides.options, cola] }],
    stations: [{ ...m.stations[0]!, name: 'Tandoor' }, m.stations[1]!],
    items: m.items.map((i) => (i.item_id === FX.optionItem ? { ...i, station_id: FX.zoneStation, is_ready_item: o.readyRaita ?? false } : i)),
    floors: [
      {
        ...floor,
        tables: [
          { ...floor.tables[0]!, name: '5' },
          { ...floor.tables[1]!, name: '4' },
          { table_id: 'T3', name: '7', seats: 4, sort_order: 2, zone_id: null },
        ],
      },
    ],
  };
}

async function start(o: { readyRaita?: boolean } = {}): Promise<void> {
  hub = await createTestHub({ provisioned: true });
  await seedDirectory(hub, await aDirectory());
  openDay(hub, { menu: menu(o) });
}

/** The preview centres a size-2 line as the printer does: 2 columns per character. */
const centre2 = (text: string, cols: number): string => ' '.repeat(Math.floor((cols - 2 * text.length) / 2)) + text;

/** Fires `ids` at `station` (real FireDispatched); c7's `kitchen_tickets` folds the ticket rows (owner ruling C1-3). */
function fireTicket(station: string, order_id: string, ids: string[], reason: 'scheduled' | 'pulled' = 'pulled'): { ticket_id: string; fired_at: number } {
  const fire = fireLines(hub, station, ids, reason).find((e: PosEvent) => e.event_type === 'FireDispatched')!;
  const ticket_id = `${fire.event_id}:${order_id}`;
  expect(hub.deps.db.prepare('SELECT station_id, order_id, fire_event_id, fired_at, reason FROM tickets WHERE ticket_id = ?').get(ticket_id)).toEqual({
    station_id: station,
    order_id,
    fire_event_id: fire.event_id,
    fired_at: fire.recorded_at,
    reason,
  });
  expect(hub.deps.db.prepare('SELECT order_item_id FROM ticket_lines WHERE ticket_id = ? ORDER BY order_item_id').pluck().all(ticket_id)).toEqual([...ids].sort());
  return { ticket_id, fired_at: fire.recorded_at };
}

/** The UTC offset that shows `at` as 1:22 PM (whatever the test clock's date). */
const offsetFor = (at: number): number => 13 * 3_600_000 + 22 * 60_000 - (at % DAY);

const ctx = (width_cols: 32 | 48, utc_offset_ms: number, state: EngineState = engine()): RenderCtx => ({
  db: hub.deps.db,
  state,
  now: hub.clock.branchNow(),
  utc_offset_ms,
  width_cols,
});

const kitchen = (ticket_id: string): RenderJob => ({ kind: 'kitchen', ticket_id, is_reprint: false });

let jobSeq = 0;
/** A `cancel` row as c8 writes it (§3.3 payload `{ ticket_id, order_item_id, units: p.units ?? null }`); 1 ms apart. */
function cancelJob(ticket_id: string, order_item_id: string, units: number | null, is_reprint = false): RenderJob {
  jobSeq += 1;
  const job_id = `E${String(jobSeq).padStart(4, '0')}:cancel:1`;
  hub.clock.advance(1);
  const created_at = hub.clock.branchNow();
  hub.deps.db
    .prepare("INSERT INTO print_jobs (job_id, kind, station_id, ticket_id, payload, created_at, is_reprint) VALUES (?, 'cancel', ?, ?, ?, ?, ?)")
    .run(job_id, FX.station, ticket_id, JSON.stringify({ ticket_id, order_item_id, units }), created_at, is_reprint ? 1 : 0);
  return { kind: 'cancel', job_id, created_at, ticket_id, order_item_id, units, is_reprint };
}

async function command(command_type: string, url: string, payload: Record<string, unknown>): Promise<void> {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId: 'S_OWNER', deviceId: device.deviceId });
  const res = await hub.app.inject({
    method: 'POST',
    url,
    headers: { authorization: `Bearer ${device.token}`, 'x-session-token': session.token },
    payload: {
      command_id: `cmd-${command_type}-${hub.deps.ids.next()}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: 'S_OWNER',
      device_id: device.deviceId,
    },
  });
  expect(res.statusCode, res.body).toBe(200);
}

/** The dine-in order of the golden ticket: T4 + T5, item + options + note, naan, a deal; Raita at S2. */
function dineInOrder(o: { butter?: number } = {}): { order_id: string } {
  openSeating(hub, { table_id: FX.table, seating_id: 'SE1' });
  append(hub, [
    {
      stream_type: 'table',
      stream_id: FX.table,
      event_type: 'TablesMerged',
      payload: { into_seating_id: 'SE1', into_table_id: FX.table, table_ids: [FX.zoneTable], absorbed_seating_id: null, order_ids: [], by_staff_id: 'S_WAIT' },
    },
  ]);
  return appendOrder(hub, {
    order_type: 'dine_in',
    seating_id: 'SE1',
    order_id: 'O_DINE_7F3K2Q',
    lines: [
      { order_item_id: 'K1', item_id: FX.piece, item: { kitchen_note: 'less spicy' } },
      { order_item_id: 'C1', option_id: FX.option, parent_order_item_id: 'K1' },
      { order_item_id: 'C2', option_id: FX.option, parent_order_item_id: 'K1', quantity: o.butter ?? 1, item: { name: 'Extra butter', station_id: null } },
      { order_item_id: 'N1', item_id: FX.naan, quantity: 4 },
      { order_item_id: 'DL', deal_id: FX.deal },
      { order_item_id: 'DM', deal_part_id: FX.dealParts[0], parent_order_item_id: 'DL' },
      { order_item_id: 'DB', deal_part_id: FX.dealParts[1], parent_order_item_id: 'DL' },
    ],
  });
}

const dineInText = (cols: number, butter = 'Extra butter'): string =>
  [
    'TANDOOR' + ' '.repeat(cols - 14) + '1:22 PM',
    '='.repeat(cols),
    centre2('T4 + T5', cols),
    'DINE-IN  Order taker  #7F3K2Q',
    '-'.repeat(cols),
    '1 x Chicken Karahi',
    `    + ${butter}`,
    '    NOTE: less spicy',
    '4 x Naan',
    ...(cols === 32 ? ['1 x Chicken Karahi (Karahi', 'combo)'] : ['1 x Chicken Karahi (Karahi combo)']),
    '2 x Naan (Karahi combo)',
  ].join('\n');

describe('[03c #1] kitchen ticket golden bytes 32 / 48', () => {
  it('[03c #1] dine-in: item, option child, kitchen note, deal parts; child at another station on its own ticket; exact ESC/POS bytes', async () => {
    await start();
    const { order_id } = dineInOrder();
    const s1 = fireTicket(FX.station, order_id, ['K1', 'N1', 'DM', 'DB']);
    const s2 = fireTicket(FX.zoneStation, order_id, ['C1']);
    const off = offsetFor(s1.fired_at);

    for (const cols of [32, 48] as const) {
      const doc = renderJob(ctx(cols, off), kitchen(s1.ticket_id))!;
      expect(renderText(doc, cols)).toBe(dineInText(cols));
      const ESC = 0x1b;
      const GS = 0x1d;
      const LF = 0x0a;
      const line = (s: string): number[] => [...ascii(s), LF];
      expect([...encodeDoc(doc, 32)], `golden bytes ${cols}`).toEqual([
        ESC, 0x40,
        ESC, 0x45, 1, ...line('TANDOOR' + ' '.repeat(cols - 14) + '1:22 PM'),
        ESC, 0x45, 0, ...line('='.repeat(cols)),
        ESC, 0x61, 1, ESC, 0x45, 1, GS, 0x21, 0x11, ...line('T4 + T5'),
        ESC, 0x61, 0, ESC, 0x45, 0, GS, 0x21, 0x00, ...line('DINE-IN  Order taker  #7F3K2Q'),
        ...line('-'.repeat(cols)),
        ESC, 0x45, 1, ...line('1 x Chicken Karahi'),
        ESC, 0x45, 0, ...line('    + Extra butter'),
        ...line('    NOTE: less spicy'),
        ESC, 0x45, 1, ...line('4 x Naan'),
        ...(cols === 32 ? [...line('1 x Chicken Karahi (Karahi'), ...line('combo)')] : line('1 x Chicken Karahi (Karahi combo)')),
        ...line('2 x Naan (Karahi combo)'),
        GS, 0x56, 66, 0,
      ]);
    }
    expect(renderText(renderJob(ctx(32, offsetFor(s2.fired_at)), kitchen(s2.ticket_id))!, 32).split('\n')).toEqual([
      'COUNTER' + ' '.repeat(18) + '1:22 PM',
      '='.repeat(32),
      centre2('T4 + T5', 32),
      'DINE-IN  Order taker  #7F3K2Q',
      '-'.repeat(32),
      '1 x Raita - for Chicken Karahi',
    ]);
  });

  it('[03c #1] takeaway token with its earlier date, order note (wrapped at 32), kitchen note mapping of — × −', async () => {
    await start();
    await command('SubmitOrder', '/commands/submit-order', {
      order_id: 'O1',
      order_type: 'takeaway',
      order_note: 'birthday, bring together',
      lines: [{ order_item_id: 'L1', item_id: FX.naan, quantity: 3, kitchen_note: 'well done — 2×crisp, −salt' }],
    });
    const first = engine().business_day!.business_date;
    hub.clock.advance(DAY);
    openDay(hub, { menu: menu() });
    const t = fireTicket(FX.station, 'O1', ['L1']);
    const [, m, d] = first.split('-');
    const ident = `#1 ${Number(d)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]}`;
    const off = offsetFor(t.fired_at);
    const body = (cols: number): string[] => [
      'TANDOOR' + ' '.repeat(cols - 14) + '1:22 PM',
      '='.repeat(cols),
      centre2(ident, cols),
      'TAKEAWAY  Owner  #O1',
      '-'.repeat(cols),
      '3 x Naan',
      ...(cols === 32 ? ['    NOTE: well done - 2xcrisp,', '-salt'] : ['    NOTE: well done - 2xcrisp, -salt']),
      '-'.repeat(cols),
    ];
    expect(renderText(renderJob(ctx(32, off), kitchen(t.ticket_id))!, 32).split('\n')).toEqual([...body(32), 'ORDER NOTE: birthday, bring', 'together']);
    expect(renderText(renderJob(ctx(48, off), kitchen(t.ticket_id))!, 48).split('\n')).toEqual([...body(48), 'ORDER NOTE: birthday, bring together']);
    const bytes = [...encodeDoc(renderJob(ctx(32, off), kitchen(t.ticket_id))!, 32)];
    expect(bytes.filter((b) => b > 0x7e), 'the mapping leaves no byte outside ASCII').toEqual([]);
  });

  it('[03c #1] parking with FIRST (boost); RETURN with the old item and table; no prices / COMP / zone-served lines', async () => {
    await start();
    const park = appendOrder(hub, { order_type: 'parking', car_number: 'LEB 1234', lines: [{ order_item_id: 'P1', item_id: FX.naan, quantity: 2 }] });
    // A boost marks the order's unfired lines (03a boostOrder); a scheduled fire keeps the mark.
    append(hub, [{ stream_type: 'order', stream_id: park.order_id, event_type: 'OrderBoosted', payload: { order_id: park.order_id } }]);
    const pt = fireTicket(FX.station, park.order_id, ['P1'], 'scheduled');
    expect(engine().lines.P1!.mark).toBe('boost');
    const parkText = renderText(renderJob(ctx(32, offsetFor(pt.fired_at)), kitchen(pt.ticket_id))!, 32).split('\n');
    expect(parkText.slice(2)).toEqual([
      'PARKING LEB 1234', // size 2: wrapped at 16 characters = 32 printer columns
      centre2('SEDAN', 32),
      `PARKING  Order taker  #${park.order_id.slice(-6)}`,
      '** FIRST - PARKING LEB 1234',
      'SEDAN is eating **',
      '-'.repeat(32),
      '2 x Naan',
    ]);

    // RETURN: a served naan on table "7" comes back as a remake (02b ReturnToKitchen).
    openSeating(hub, { table_id: 'T3', seating_id: 'SE3' });
    const { order_id } = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SE3', lines: [{ order_item_id: 'N7', item_id: FX.naan }] });
    const on = (event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, payload });
    fireLines(hub, FX.station, ['N7']);
    append(hub, [on('ItemStarted', { order_item_id: 'N7', started_at: hub.clock.branchNow(), source: 'tap' })]);
    append(hub, [on('ItemDone', { order_item_id: 'N7', done_at: hub.clock.branchNow(), source: 'tap' })]);
    append(hub, [on('ItemServed', { order_item_ids: ['N7'], source: 'tap' })]);
    await command('ReturnToKitchen', '/commands/return-to-kitchen', { order_item_id: 'N7', return_order_item_id: 'R7', mode: 'remake' });
    const rt = fireTicket(engine().lines.R7!.station_id, order_id, ['R7']);
    const text = renderText(renderJob(ctx(48, offsetFor(rt.fired_at)), kitchen(rt.ticket_id))!, 48);
    expect(text.split('\n').slice(4)).toEqual(['** RETURN - REMAKE - was T7 Naan **', '-'.repeat(48), '1 x Naan']);
    // Out of the engine: the RETURN header from order_lines.return_of (the mode lives only in the engine).
    const exited: EngineState = { ...engine(), orders: {}, lines: {} };
    const gone = renderText(renderJob(ctx(48, offsetFor(rt.fired_at), exited), kitchen(rt.ticket_id))!, 48);
    expect(gone.split('\n').slice(2, 5)).toEqual([centre2('T7', 48), `DINE-IN  Order taker  #${order_id.slice(-6)}`, '** RETURN - was T7 Naan **']);
    expect(text).not.toMatch(/Rs|PKR|COMP|[0-9]{3,}\.[0-9]/);
  });
});

describe('[03c §3.5, §3.6] render at send: slips, REPRINT, empty, stale, fallback, statements', () => {
  it('[03c §3.5] CANCELLED partial ("- 1 x Naan  3 left", units left at send) and whole; FIRST slip; done line → empty', async () => {
    await start();
    const { order_id } = dineInOrder();
    const t = fireTicket(FX.station, order_id, ['K1', 'N1', 'DM', 'DB']);
    const off = offsetFor(hub.clock.branchNow() + 60_000);
    removeLine(hub, order_id, 'N1', 1);
    const slip = (job: RenderJob): string[] | null => {
      const doc = renderJob(ctx(32, off), job);
      return doc === null ? null : renderText(doc, 32).split('\n').slice(1);
    };
    const partial = cancelJob(t.ticket_id, 'N1', 1);
    expect(slip(partial)).toEqual(['CANCELLED  T4 + T5  - 1 x Naan', '3 left']);
    // 02b M-5: Naan 4 → remove 1 → remove the rest. The whole-line job (§3.3 payload units null) prints the units
    // still to cancel: 4 ordered − 1 of the earlier cancel job = 3.
    removeLine(hub, order_id, 'N1');
    const whole = cancelJob(t.ticket_id, 'N1', null);
    const counter = statementCounter(hub.deps.db);
    expect(slip(whole)).toEqual(['CANCELLED  T4 + T5  3 x Naan']);
    expect(counter.count, 'a cancel job render: ticket read (+ earlier cancels) 1, buildLineDetails 2').toBe(3);
    // C1-2 (a): sent only now, with no live units left, the earlier partial job prints the whole form with its units.
    expect(slip(partial)).toEqual(['CANCELLED  T4 + T5  1 x Naan']);
    removeLine(hub, order_id, 'K1');
    expect(slip(cancelJob(t.ticket_id, 'K1', null))).toEqual(['CANCELLED  T4 + T5  1 x Chicken', 'Karahi']);
    expect(slip({ kind: 'first', ticket_id: t.ticket_id, order_item_ids: ['N1', 'K1', 'DM', 'DB'], reason: 'boost', is_reprint: false })).toEqual([
      'FIRST  T4 + T5  1 x Chicken',
      'Karahi (boost)',
      'FIRST  T4 + T5  2 x Naan (boost)',
    ]);
    hub.deps.db.prepare('UPDATE ticket_lines SET done_at = 1 WHERE order_item_id IN (?, ?, ?)').run('DM', 'DB', 'N1');
    expect(slip(cancelJob(t.ticket_id, 'DB', 1)), 'done → stale').toBeNull();
    expect(slip({ kind: 'first', ticket_id: t.ticket_id, order_item_ids: ['N1', 'DM', 'DB'], reason: 'expedite', is_reprint: false })).toBeNull();
    expect(slip(cancelJob(t.ticket_id, 'GONE', null)), 'gone').toBeNull();
    expect(renderJob(ctx(32, off), kitchen('NOPE:NOPE')), 'no ticket').toBeNull();
  });

  it('[03c §3.5] a cancel with units that leaves no live units prints the whole form (C1-2): Naan 4, 1 removed before print, RemoveItems the rest', async () => {
    await start();
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'N1', item_id: FX.naan, quantity: 4 }] });
    removeLine(hub, order_id, 'N1', 1); // before the ticket printed: no cancel job
    const t = fireTicket(FX.station, order_id, ['N1']);
    const slip = (job: RenderJob): string[] => renderText(renderJob(ctx(32, 0), job)!, 32).split('\n').slice(1);
    // 02b's real RemoveItems without units writes ItemRemoved { units: live units } = 3 (the §3.3 payload carries 3).
    await command('RemoveItems', '/commands/remove-items', { order_id, lines: [{ order_item_id: 'N1' }] });
    const removed = hub.deps.db.prepare("SELECT payload FROM events WHERE event_type = 'ItemRemoved' ORDER BY seq DESC LIMIT 1").pluck().get() as string;
    expect(JSON.parse(removed)).toMatchObject({ order_item_id: 'N1', units: 3 });
    expect(slip(cancelJob(t.ticket_id, 'N1', 3))).toEqual(['CANCELLED  #1  3 x Naan']);
  });

  it('[03c §3.5] a partial cancel that leaves units keeps "- n x <name>  k left"; units null keeps ordered − earlier', async () => {
    await start();
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'N1', item_id: FX.naan, quantity: 4 }] });
    const t = fireTicket(FX.station, order_id, ['N1']);
    const slip = (job: RenderJob): string[] => renderText(renderJob(ctx(48, 0), job)!, 48).split('\n').slice(1);
    removeLine(hub, order_id, 'N1', 1);
    expect(slip(cancelJob(t.ticket_id, 'N1', 1))).toEqual(['CANCELLED  #1  - 1 x Naan  3 left']);
    removeLine(hub, order_id, 'N1');
    expect(slip(cancelJob(t.ticket_id, 'N1', null))).toEqual(['CANCELLED  #1  3 x Naan']);
  });

  it('[03c §3.5] a re-sent CANCELLED slip (is_reprint) is not counted again by the whole-line slip', async () => {
    await start();
    const { order_id } = dineInOrder();
    const t = fireTicket(FX.station, order_id, ['K1', 'N1', 'DM', 'DB']);
    const lines = (job: RenderJob): string[] => renderText(renderJob(ctx(32, 0), job)!, 32).split('\n');
    // Naan 4 → cancel 1 → that slip re-sent (suspect recovery, REPRINT header) → remove the rest → 3, not 2.
    removeLine(hub, order_id, 'N1', 1);
    cancelJob(t.ticket_id, 'N1', 1);
    const resent = lines(cancelJob(t.ticket_id, 'N1', 1, true));
    expect(resent[0]).toBe('         ** REPRINT **');
    expect(resent.slice(2)).toEqual(['CANCELLED  T4 + T5  - 1 x Naan', '3 left']);
    removeLine(hub, order_id, 'N1');
    expect(lines(cancelJob(t.ticket_id, 'N1', null)).slice(1)).toEqual(['CANCELLED  T4 + T5  3 x Naan']);
  });

  it('[03c §3.6] kitchen prints not-done live lines (empty → null); reprint every live line with the REPRINT header; is_reprint too', async () => {
    await start();
    const { order_id } = dineInOrder();
    const t = fireTicket(FX.station, order_id, ['K1', 'N1', 'DM', 'DB']);
    const off = offsetFor(t.fired_at);
    hub.deps.db.prepare("UPDATE ticket_lines SET done_at = 1 WHERE order_item_id IN ('K1', 'DM', 'DB')").run();
    const lines = (job: RenderJob): string[] => renderText(renderJob(ctx(32, off), job)!, 32).split('\n');
    expect(lines(kitchen(t.ticket_id)).slice(5)).toEqual(['4 x Naan']);
    expect(lines({ kind: 'kitchen', ticket_id: t.ticket_id, is_reprint: true })[0]).toBe('         ** REPRINT **');
    const reprint = lines({ kind: 'reprint', ticket_id: t.ticket_id, is_reprint: false });
    expect(reprint[0]).toBe('         ** REPRINT **');
    expect(reprint.slice(1).join('\n')).toBe(dineInText(32));
    hub.deps.db.prepare("UPDATE ticket_lines SET done_at = 1 WHERE order_item_id = 'N1'").run();
    expect(renderJob(ctx(32, off), kitchen(t.ticket_id)), 'every line done → empty').toBeNull();
    removeLine(hub, order_id, 'N1');
    expect(lines({ kind: 'reprint', ticket_id: t.ticket_id, is_reprint: false }).slice(6)).not.toContain('4 x Naan');
  });

  it('[03c §3.6] an order no longer in the engine falls back to order_lines and config names; station toggles', async () => {
    // Raita as a ready item: an option child with is_food = 0 that still has a station and its own ticket.
    await start({ readyRaita: true });
    const { order_id } = dineInOrder({ butter: 2 });
    const t = fireTicket(FX.station, order_id, ['K1', 'N1', 'DM', 'DB']);
    fireTicket(FX.zoneStation, order_id, ['C1']);
    const off = offsetFor(t.fired_at);
    // Options carry their units and leave out Raita (own ticket line), with the engine and without it; without the
    // engine the identifier is every table of the open seating (primary first, P-1 "T").
    expect(renderText(renderJob(ctx(32, off), kitchen(t.ticket_id))!, 32)).toBe(dineInText(32, '2 x Extra butter'));
    const exited: EngineState = { ...engine(), orders: {}, lines: {} };
    expect(renderText(renderJob(ctx(32, off, exited), kitchen(t.ticket_id))!, 32)).toBe(dineInText(32, '2 x Extra butter'));
    hub.deps.db.prepare("INSERT INTO station_outputs (station_id, mode, printer_id, show_taker, show_order_id) VALUES (?, 'screen', NULL, 0, 0)").run(FX.station);
    expect(renderText(renderJob(ctx(32, off), kitchen(t.ticket_id))!, 32).split('\n')[3]).toBe('DINE-IN');
  });

  it('[03c #1] a zone-served option child is never on the ticket, with or without the engine', async () => {
    await start();
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'SEZ' });
    const { order_id } = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'SEZ',
      lines: [
        { order_item_id: 'KZ', item_id: FX.piece },
        // The option-child branch of appendOrder has no from_zone: the zone serve is set on the ItemAdded payload.
        { order_item_id: 'CZ', option_id: 'O_COLA', parent_order_item_id: 'KZ', item: { served_from_zone_id: FX.zone } },
      ],
    });
    expect(hub.deps.db.prepare("SELECT served_from_zone_id FROM order_lines WHERE order_item_id = 'CZ'").pluck().get()).toBe(FX.zone);
    const t = fireTicket(FX.station, order_id, ['KZ']);
    const off = offsetFor(t.fired_at);
    const exited: EngineState = { ...engine(), orders: {}, lines: {} };
    for (const state of [engine(), exited]) {
      const text = renderText(renderJob(ctx(32, off, state), kitchen(t.ticket_id))!, 32).split('\n');
      expect(text.slice(4)).toEqual(['-'.repeat(32), '1 x Chicken Karahi']);
    }
  });

  it('[03c §3.6] COMING UP from stationPlan; stale after 10 min; statements: ticket job 3, COMING UP 2', async () => {
    await start();
    const { order_id } = dineInOrder();
    const t = fireTicket(FX.station, order_id, ['K1', 'N1']);
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'U1', item_id: FX.naan }] });
    const now = hub.clock.branchNow();
    const counter = statementCounter(hub.deps.db);
    const doc = renderJob(ctx(32, 0), { kind: 'coming_up', station_id: FX.station, created_at: now, is_reprint: false })!;
    expect(counter.count).toBe(2);
    const text = renderText(doc, 32).split('\n');
    expect(text[0]).toBe(centre2('COMING UP', 32));
    expect(text).toContainEqual(expect.stringMatching(/^\d{1,2}:\d\d [AP]M {2}#1 {2}1 x Naan$/));
    expect(text).not.toContainEqual(expect.stringContaining('4 x Naan')); // fired lines are not coming up
    expect(renderJob(ctx(32, 0), { kind: 'coming_up', station_id: FX.station, created_at: now - 600_001, is_reprint: false })).toBeNull();
    counter.reset();
    renderJob(ctx(32, 0), kitchen(t.ticket_id));
    expect(counter.count).toBe(3);
  });

  it('[03c §4.2] renderText through the contract (provided by lane C2): align, size, rule, feed; cut / drawer print nothing', async () => {
    hub = await createTestHub({ provisioned: true });
    const doc: Doc = {
      blocks: [{ text: 'BILL', size: 2, align: 'center' }, { text: 'Total 1,200', align: 'right' }, { rule: true }, { feed: 1 }, { text: 'x' }, { cut: true }, { drawer: true }],
    };
    expect(renderTextContract(doc, 32).split('\n')).toEqual([centre2('BILL', 32), ' '.repeat(21) + 'Total 1,200', '-'.repeat(32), '', 'x']);
    expect(renderTextContract({ ...doc, width_cols: 48 }, 32).split('\n')[2]).toBe('-'.repeat(48));
    expect(renderTextContract({ blocks: [{ text: 'a\nb' }] }, 32), 'a newline breaks the line, as in encodeDoc').toBe('a\nb');
  });
});

describe('[03c v1.0.3 §3.3, §3.6, #9] plain options on tickets (B3-2, task P0.16)', () => {
  it('[03c v1.0.3 §3.3] plain options print under their line after the option children ("    + 2 x No onion"), scaled to live units; still 3 statements', async () => {
    await start();
    const plain = (name: string, quantity: number) => ({ option_id: `O_${name}`, modifier_group_id: 'G_PLAIN', name, price_minor: 0, quantity, charge_minor: 0 });
    const { order_id } = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'K1', item_id: FX.piece, item: { kitchen_note: 'less spicy', options: [plain('No onion', 2), plain('Less salt', 1)] } },
        { order_item_id: 'C2', option_id: FX.option, parent_order_item_id: 'K1', item: { name: 'Extra butter', station_id: null } },
        { order_item_id: 'K2', item_id: FX.piece, quantity: 3, item: { options: [plain('Mild', 1)] } },
      ],
    });
    const t = fireTicket(FX.station, order_id, ['K1', 'K2']);
    removeLine(hub, order_id, 'K2', 1);
    const counter = statementCounter(hub.deps.db);
    const text = renderText(renderJob(ctx(32, offsetFor(t.fired_at)), kitchen(t.ticket_id))!, 32).split('\n');
    expect(counter.count, 'ticket read 1 + buildLineDetails 2').toBe(3);
    expect(text.slice(5)).toEqual(['1 x Chicken Karahi', '    + Extra butter', '    + 2 x No onion', '    + Less salt', '    NOTE: less spicy', '2 x Chicken Karahi', '    + 2 x Mild']);
  });

  it('[03c v1.0.3 #9] a reprint of an order no longer in the engine prints its plain options from order_lines.options_json', async () => {
    await start();
    const plain = (name: string, quantity: number) => ({ option_id: `O_${name}`, modifier_group_id: 'G_PLAIN', name, price_minor: 0, quantity, charge_minor: 0 });
    const { order_id } = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'K1', item_id: FX.piece, item: { options: [plain('No onion', 2)] } },
        { order_item_id: 'C2', option_id: FX.option, parent_order_item_id: 'K1', quantity: 2, item: { name: 'Extra butter', station_id: null } },
        { order_item_id: 'N1', item_id: FX.naan, quantity: 2 },
      ],
    });
    const t = fireTicket(FX.station, order_id, ['K1', 'N1']);
    const off = offsetFor(t.fired_at);
    const body = ['1 x Chicken Karahi', '    + 2 x Extra butter', '    + 2 x No onion', '2 x Naan'];
    const reprint: RenderJob = { kind: 'reprint', ticket_id: t.ticket_id, is_reprint: false };
    expect(renderText(renderJob(ctx(32, off), reprint)!, 32).split('\n').slice(6)).toEqual(body);
    const exited: EngineState = { ...engine(), orders: {}, lines: {} };
    expect(renderText(renderJob(ctx(32, off, exited), reprint)!, 32).split('\n').slice(6)).toEqual(body);
    expect(renderText(renderJob(ctx(32, off, exited), kitchen(t.ticket_id))!, 32).split('\n').slice(5)).toEqual(body);
  });
});
