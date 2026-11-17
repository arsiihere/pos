import { afterEach, describe, expect, it } from 'vitest';
import type { SendResult } from '../../src/print/transport/lan';
import { createPrintWorker, type PrinterTransport } from '../../src/print/worker';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import type { TestHub } from '../helpers/test-hub';
import { append, appendOrder, dealX2, FX, post, signIn, STAFF, stagedOrder, startVoids, toStage, VX, type Reply, type Who } from '../voids/fixtures';
import { fakeClock } from './fixtures';

// 03c v1.0.8 §3.3, §3.5, test 4b (04 Q-15 b, Q-17; 04 task p1), end to end: a real 04 VoidItems over HTTP on a cooking
// line whose kitchen ticket printed → 03c's fold queues the cancel job → the real worker renders and encodes it at
// send and hands the bytes to an injected transport. A `moved` share prints MOVED TO STOCK; every other share
// CANCELLED. No printer, no timing asserts.
let hub: TestHub;
const stops: Array<() => void> = [];
afterEach(async () => {
  for (const s of stops.splice(0)) s();
  swapBranchConfig(null);
  await hub.close();
});

const MOVED = 'MOVED TO STOCK - FINISH & KEEP';

function printerAtS1(): void {
  const branch = hub.deps.config.provisioned!.branch_id;
  append(
    hub,
    [
      { stream_type: 'hub', stream_id: branch, event_type: 'PrinterSaved', payload: { printer_id: 'PR1', name: 'PR1', connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived: false } },
      { stream_type: 'hub', stream_id: branch, event_type: 'StationOutputSet', payload: { station_id: FX.station, mode: 'both', printer_id: 'PR1', show_taker: true, show_order_id: true } },
    ],
    { actor: null },
  );
}

/** The worker's send + ack of the line's kitchen ticket (§3.1 "printed"), on the real row. */
function printed(order_item_id: string): string {
  const ticket_id = hub.deps.db.prepare('SELECT ticket_id FROM ticket_lines WHERE order_item_id = ?').pluck().get(order_item_id) as string;
  const at = hub.clock.branchNow();
  const n = hub.deps.db.prepare(`UPDATE print_jobs SET sent_at = ?, sent_printer_id = 'PR1', acked_at = ? WHERE ticket_id = ? AND kind = 'kitchen'`).run(at, at, ticket_id).changes;
  expect(n, 'a kitchen job was queued at fire').toBe(1);
  return ticket_id;
}

const cancelJobs = () =>
  (hub.deps.db.prepare(`SELECT job_id, payload FROM print_jobs WHERE kind = 'cancel' ORDER BY created_at, job_id`).all() as Array<{ job_id: string; payload: string }>).map((j) => ({
    job_id: j.job_id,
    payload: JSON.parse(j.payload) as Record<string, unknown>,
  }));

/** Runs the real worker over every queued job; each send acks at once. Returns the printed slips as text lines. */
async function printAll(): Promise<string[][]> {
  const sends: string[] = [];
  const t: PrinterTransport = {
    send(bytes: Uint8Array): Promise<SendResult> {
      sends.push(Buffer.from(bytes).toString('latin1'));
      return Promise.resolve({ ok: true });
    },
    close() {},
  };
  const w = createPrintWorker({ db: hub.deps.db, state: hub.deps.state, clock: hub.clock, timers: fakeClock(), transportFor: () => t, log: { error: () => {} } });
  stops.push(() => w.stop());
  const pending = () => hub.deps.db.prepare('SELECT COUNT(*) FROM print_jobs WHERE acked_at IS NULL AND cancelled_at IS NULL').pluck().get() as number;
  for (let i = 0; i < 20 && pending() > 0; i += 1) {
    w.pass();
    for (let k = 0; k < 5; k += 1) await new Promise((resolve) => setImmediate(resolve));
  }
  expect(pending()).toBe(0);
  return sends.map(textLines);
}

/** The printed text lines of one send: the ESC / GS commands encodeDoc emits (ESC @, ESC E n, ESC a n, GS ! n, GS V m n) dropped. */
function textLines(bytes: string): string[] {
  const ESC = '\u001b';
  const GS = '\u001d';
  const out: string[] = [];
  let line = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const c = bytes[i]!;
    if (c === ESC) i += bytes[i + 1] === '@' ? 1 : 2;
    else if (c === GS) i += bytes[i + 1] === 'V' ? 3 : 2;
    else if (c === '\n') {
      if (line.length > 0) out.push(line);
      line = '';
    } else line += c;
  }
  if (line.length > 0) out.push(line);
  return out;
}

type Line = { order_item_id: string; units?: number; disposition: 'moved' | 'wastage' | 'staff_meal' | 'other' };
const voidItems = (who: Who, order_id: string, lines: Line[]): Promise<Reply> =>
  post(hub, who, 'void-items', 'VoidItems', { order_id, reason_code: 'customer_changed_mind', note: null, disposition_note: null, lines });

/** A takeaway of 4 stock-tracked naan at S1, cooking, its kitchen ticket printed. */
async function cookingNaan(): Promise<{ order_id: string; ticket_id: string; mgr: Who }> {
  hub = await startVoids({ stock: { [FX.stock]: 0, [VX.naanStock]: 4 } });
  printerAtS1();
  const mgr = signIn(hub, STAFF.manager);
  const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'N4', item_id: VX.stockNaan, quantity: 4 }] });
  toStage(hub, order_id, ['N4'], 'cooking');
  return { order_id, ticket_id: printed('N4'), mgr };
}

describe('[03c #4b] MOVED TO STOCK slip from a real 04 VoidItems (04 Q-15)', () => {
  it('[03c #4b, 04 V4] moved 2 of 4 on a cooking line with a printed ticket → ItemMovedToStock then ItemVoided moved → one MOVED TO STOCK slip, no CANCELLED', async () => {
    const { order_id, ticket_id, mgr } = await cookingNaan();
    const r = await voidItems(mgr, order_id, [{ order_item_id: 'N4', units: 2, disposition: 'moved' }]);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.events.map((e) => e.event_type).filter((t) => t === 'ItemMovedToStock' || t === 'ItemVoided')).toEqual(['ItemMovedToStock', 'ItemVoided']);
    expect(cancelJobs().map((j) => j.payload)).toEqual([{ ticket_id, order_item_id: 'N4', units: 2, slip: 'moved' }]);
    const [slip, ...more] = await printAll();
    expect(more).toEqual([]);
    expect(slip!.slice(1)).toEqual([MOVED, expect.stringMatching(/^#\d+ {2}- 2 x Tandoori naan {2}2 left$/)]);
    expect(slip!.join('\n')).not.toContain('CANCELLED');
  });

  it('[03c #4b] one void of a deal with a moved part and a wastage part (1 of 2 deals) → MOVED for the karahi share, CANCELLED for the naan share', async () => {
    hub = await startVoids();
    printerAtS1();
    const mgr = signIn(hub, STAFF.manager);
    const d = dealX2(hub);
    toStage(hub, d.order_id, [d.karahiPart, d.naanPart], 'cooking');
    const ticket_id = printed(d.karahiPart);
    const r = await voidItems(mgr, d.order_id, [{ order_item_id: d.deal, units: 1, disposition: 'moved' }]);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    // 04 V3: the karahi part is movable (it draws K1) → moved; the plain naan part has no draw → wastage; header null
    expect(r.events.filter((e) => e.event_type === 'ItemVoided').map((e) => [e.payload.order_item_id, e.payload.units, e.payload.disposition])).toEqual([
      [d.deal, 1, null],
      [d.karahiPart, 1, 'moved'],
      [d.naanPart, 2, 'wastage'],
    ]);
    expect(cancelJobs().map((j) => j.payload)).toEqual([
      { ticket_id, order_item_id: d.karahiPart, units: 1, slip: 'moved' },
      { ticket_id, order_item_id: d.naanPart, units: 2 },
    ]);
    const slips = (await printAll()).map((s) => s.slice(1));
    expect(slips).toHaveLength(2);
    expect(slips).toContainEqual([MOVED, expect.stringMatching(/^#\d+ {2}- 1 x Chicken Karahi {2}1 left$/)]);
    expect(slips).toContainEqual([expect.stringMatching(/^CANCELLED {2}#\d+ {2}- 2 x Naan {2}2 left$/)]);
  });

  it('[03c #4b] a wastage void of a printed cooking line still prints CANCELLED', async () => {
    hub = await startVoids();
    printerAtS1();
    const mgr = signIn(hub, STAFF.manager);
    const s = stagedOrder(hub);
    const ticket_id = printed(s.cooking);
    const r = await voidItems(mgr, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }]);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(cancelJobs().map((j) => j.payload)).toEqual([{ ticket_id, order_item_id: s.cooking, units: 1 }]);
    const slips = (await printAll()).filter((x) => x.some((l) => l.includes(s.cooking) || l.includes('Chicken Karahi')));
    expect(slips).toEqual([[expect.any(String), expect.stringMatching(/^CANCELLED {2}#\d+ {2}1 x Chicken Karahi$/)]]);
  });

  it('[03c #4b, §3.3] a moved void of a line whose ticket never printed → no slip, as before', async () => {
    hub = await startVoids({ stock: { [FX.stock]: 0, [VX.naanStock]: 4 } });
    printerAtS1();
    const mgr = signIn(hub, STAFF.manager);
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'N4', item_id: VX.stockNaan, quantity: 4 }] });
    toStage(hub, order_id, ['N4'], 'cooking'); // kitchen job queued, never sent
    const r = await voidItems(mgr, order_id, [{ order_item_id: 'N4', units: 2, disposition: 'moved' }]);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(cancelJobs()).toEqual([]);
  });
});
