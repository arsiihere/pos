import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HubClock } from '../../../../app/hub-clock';
import { createStaffApi, type Device, type PageMeta, type StaffApi } from '../../api';
import { createLiveBus, type LiveBus } from '../../shell/live';
import type { QueueEntry } from '../contracts';
import { createMemoryQueueStore, type MemoryQueueBacking } from './memory-store';
import { createBroadcastPresence, createCommandQueue, DEFAULT_QUEUE_AUTO_SEND_MAX_MS, keptAtLoad, type CommandQueue, type Presence, type SentNotice } from './queue';

// 02b v1.0.11 §3.12, §8 Queue, §10 #35; 00 v1.9.1 §8.1, H-1; owner Q-2 (25b): the queue core against the real staff
// api over a scripted hub (fetch fake). The hub's answers are scripted per call; every call is recorded.

const device: Device = { token: 'DEV-TOKEN', id: 'dev-1', type: 'cashier_kiosk' };
const meta: PageMeta = { tenantId: 'ten', branchId: 'br', branchName: 'Gulberg', hubNowMs: 0, utcOffsetMs: 0 };

interface Call {
  path: string;
  headers: Record<string, string>;
  body: { command_id?: string; actor_id?: string; payload?: unknown } | null;
}

type Answer = { status: number; body: unknown } | 'network' | Promise<{ status: number; body: unknown }>;

function ok(result: unknown): Answer {
  return { status: 200, body: { data: { command_id: 'x', event_ids: [], result } } };
}
function err(status: number, code: string, details: Record<string, unknown> = {}): Answer {
  return { status, body: { error: { code, message: code, details } } };
}

function hub() {
  const calls: Call[] = [];
  /** answers for /commands/* in order; when empty: network error */
  const script: Answer[] = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    const headers = { ...(init?.headers as Record<string, string>) };
    const body = init?.body === undefined ? null : (JSON.parse(String(init.body)) as Call['body']);
    calls.push({ path: input, headers, body });
    if (input === '/auth/pin') {
      const staff = (body as unknown as { staff_id: string }).staff_id;
      return json(200, { data: { session_token: `TOK-${staff}`, session_id: `SES-${staff}`, staff_id: staff, display_name: staff, role_ids: [], idle_ttl_ms: 600_000 } });
    }
    if (input === '/auth/logout') return json(200, { data: {} });
    if (!input.startsWith('/commands/')) return json(200, { data: {} });
    const next = script.shift();
    if (next === undefined || next === 'network') throw new TypeError('Failed to fetch');
    const a = await next;
    return json(a.status, a.body);
  });
  return { calls, script, fetch, commands: () => calls.filter((c) => c.path.startsWith('/commands/')) };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Rig {
  h: ReturnType<typeof hub>;
  api: StaffApi;
  live: LiveBus;
  backing: MemoryQueueBacking;
  now: { ms: number };
  revoked: number;
  queue: CommandQueue;
  signedOut: number;
  reload(): CommandQueue;
}

function rig(o: { backing?: MemoryQueueBacking; maxAgeMs?: () => number | null; presence?: (mine: () => string[]) => Presence } = {}): Rig {
  const h = hub();
  const r = { signedOut: 0, revoked: 0 } as Rig;
  const api = createStaffApi({ device, meta, fetch: h.fetch, onSignedOut: () => (r.signedOut += 1) });
  const live = createLiveBus();
  const backing = o.backing ?? new Map();
  const now = { ms: 1_000_000 };
  const clock = (): HubClock => ({ nowMs: () => now.ms, utcOffsetMs: 0 });
  let n = 0;
  const make = () =>
    createCommandQueue({
      api,
      device,
      clock,
      live,
      store: createMemoryQueueStore(backing),
      onDeviceRevoked: () => (r.revoked += 1),
      newId: () => `01ENTRY${String(++n).padStart(4, '0')}`,
      ...(o.maxAgeMs === undefined ? {} : { maxAgeMs: o.maxAgeMs }),
      ...(o.presence === undefined ? {} : { presence: o.presence }),
    });
  Object.assign(r, { h, api, live, backing, now, queue: make(), reload: make });
  return r;
}

const order = (id: string) => ({ order_id: id, order_type: 'takeaway', lines: [{ order_item_id: `${id}-L1`, item_id: 'naan' }] });
const meta1 = { label: 'Takeaway · 1 item' };

const served = { lines: [{ order_id: 'O0', order_item_ids: ['X'] }] };

/** An entry the queue log holds for "Send again" since its session ended (a reload keeps an order queued, QO-1). */
function endedSession(backing: MemoryQueueBacking, id: string): void {
  const e = backing.get(id)!;
  backing.set(id, { ...e, state: 'log', log_reason: 'SESSION_EXPIRED' });
}

function reconnect(live: LiveBus) {
  live.connection(true);
  live.connection(false);
  live.connection(true);
}

afterEach(() => vi.useRealTimers());

const flushMicro = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('[02b §3.12] queue core', () => {
  it('[02b #35] replay in queued_at order with X-Queued-At and the same command_id', async () => {
    const r = rig();
    await r.api.signIn('ali', '1234', false);
    const first = await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    r.now.ms += 5_000;
    const second = await r.queue.enqueue('MarkServed', { lines: [{ order_id: 'O0', order_item_ids: ['X'] }] }, { label: 'Served' });
    expect(first).toEqual({ status: 'queued', entry_id: '01ENTRY0001' });
    expect(second).toEqual({ status: 'queued', entry_id: '01ENTRY0002' });
    // the first send was a plain command (no X-Queued-At); the second enqueue waits behind the first (sent again, as a
    // replay) and is not tried while the hub does not answer
    expect(r.h.commands().map((c) => [c.path, c.body?.command_id, c.headers['X-Queued-At']])).toEqual([
      ['/commands/submit-order', '01ENTRY0001', undefined],
      ['/commands/submit-order', '01ENTRY0001', '1000000'],
    ]);
    r.h.script.push(ok({ order_id: 'O1', token: 57, groups: [], lines: [] }), ok({ served: 1, skipped: [] }));
    reconnect(r.live);
    await r.queue.drain();
    const replays = r.h.commands().slice(2);
    expect(replays.map((c) => [c.path, c.body?.command_id, c.headers['X-Queued-At'], c.headers['X-Session-Token'], c.body?.actor_id])).toEqual([
      ['/commands/submit-order', '01ENTRY0001', '1000000', 'TOK-ali', 'ali'],
      ['/commands/mark-served', '01ENTRY0002', '1005000', 'TOK-ali', 'ali'],
    ]);
    expect(r.queue.pendingCount()).toBe(0);
    expect(r.backing.size).toBe(0);
  });

  it('[02b #35] no "sent" before a 2xx', async () => {
    const r = rig();
    await r.api.signIn('ali', '1234', false);
    let answer!: (a: { status: number; body: unknown }) => void;
    r.h.script.push(new Promise((res) => (answer = res)));
    const sentNotices: string[] = [];
    r.queue.onSent((n) => sentNotices.push(`${n.entry.entry_id}:${String(n.later)}`));
    let settled: unknown = null;
    const p = r.queue.enqueue('SubmitOrder', order('O1'), meta1).then((v) => (settled = v));
    await vi.waitFor(() => expect(r.h.commands()).toHaveLength(1));
    // stored, sending, not sent
    expect(r.backing.size).toBe(1);
    expect(r.queue.pendingCount()).toBe(1);
    expect(settled).toBeNull();
    expect(sentNotices).toEqual([]);
    answer((ok({ order_id: 'O1', token: 12, groups: [], lines: [] }) as { status: number; body: unknown }));
    await p;
    expect(settled).toEqual({ status: 'sent', result: { order_id: 'O1', token: 12, groups: [], lines: [] } });
    expect(sentNotices).toEqual(['01ENTRY0001:false']);
    expect(r.backing.size).toBe(0);
  });

  it('[02b #35] a 4xx goes to the queue log; the next entry is sent', async () => {
    const r = rig();
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    await r.queue.enqueue('SubmitOrder', order('O2'), meta1);
    r.h.script.push(err(409, 'ITEM_SOLD_OUT', { item_id: 'naan' }), ok({ order_id: 'O2', token: 3, groups: [], lines: [] }));
    reconnect(r.live);
    await r.queue.drain();
    expect(r.h.commands().slice(-2).map((c) => [c.body?.command_id, c.headers['X-Queued-At']])).toEqual([
      ['01ENTRY0001', '1000000'],
      ['01ENTRY0002', '1000001'],
    ]);
    expect(r.queue.log()).toEqual([expect.objectContaining({ entry_id: '01ENTRY0001', state: 'log', log_reason: 'ITEM_SOLD_OUT', log_details: { item_id: 'naan' } })]);
    expect(r.queue.pendingCount()).toBe(0);
    expect([...r.backing.values()]).toEqual([expect.objectContaining({ entry_id: '01ENTRY0001', state: 'log' })]);
  });

  // ⚠️ 02b v1.0.28 QR2-1 (owner ruling R2-2 of 2026-11-28 QA-R2, BUG-2): a queued order is never dropped for a closed day
  const dayOpened = (live: LiveBus, seq: number) =>
    live.frame({ type: 'event', seq, event: { event_id: `E${seq}`, event_type: 'BusinessDayOpened', schema_version: 2, payload: {} } } as never);

  it('[02b #100 QR2-1] a replay refused BUSINESS_DAY_NOT_OPEN stays queued (waiting for the day), the entries after it still go; BusinessDayOpened sends it with the same id', async () => {
    const r = rig();
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1); // offline: queued
    r.now.ms += 1_000;
    await r.queue.enqueue('MarkServed', { lines: [{ order_id: 'O0', order_item_ids: ['X'] }] }, { label: 'Served' });
    r.h.script.push(err(409, 'BUSINESS_DAY_NOT_OPEN'), ok({ served: 1, skipped: [] }));
    reconnect(r.live);
    await r.queue.drain();
    expect(r.queue.queued().map((e) => e.entry_id)).toEqual(['01ENTRY0001']);
    expect(r.queue.waitingDay('01ENTRY0001')).toBe(true);
    expect(r.queue.log()).toEqual([]);
    expect([...r.backing.values()]).toEqual([expect.objectContaining({ entry_id: '01ENTRY0001', state: 'queued' })]);
    // still no day: another drain tries it once and keeps it
    r.h.script.push(err(409, 'BUSINESS_DAY_NOT_OPEN'));
    const before = r.h.commands().length;
    await r.queue.drain();
    expect(r.h.commands().length - before).toBe(1);
    expect(r.queue.pendingCount()).toBe(1);
    // the day opens: sent at once, the same command_id, as a replay
    r.h.script.push(ok({ order_id: 'O1', token: 1, groups: [], lines: [] }));
    const sent: Array<{ id: string; later: boolean }> = [];
    r.queue.onSent((n) => sent.push({ id: n.entry.entry_id, later: n.later }));
    dayOpened(r.live, 10);
    await vi.waitFor(() => expect(r.queue.pendingCount()).toBe(0));
    const last = r.h.commands().at(-1)!;
    expect([last.path, last.body?.command_id, last.headers['X-Queued-At'], last.body?.actor_id]).toEqual(['/commands/submit-order', '01ENTRY0001', '1000000', 'ali']);
    expect(sent).toEqual([{ id: '01ENTRY0001', later: true }]);
    expect(r.queue.waitingDay('01ENTRY0001')).toBe(false);
    expect(r.backing.size).toBe(0);
  });

  it('[02b #100 QR2-1] a plain Send refused BUSINESS_DAY_NOT_OPEN is still refused to its caller (Day not started, the cart kept)', async () => {
    const r = rig();
    await r.api.signIn('ali', '1234', false);
    r.h.script.push(err(409, 'BUSINESS_DAY_NOT_OPEN'));
    const answer = await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    expect(answer).toMatchObject({ status: 'refused', error: { code: 'BUSINESS_DAY_NOT_OPEN' } });
    expect(r.queue.pendingCount()).toBe(0);
  });

  it('[02b #100 QR2-1] waiting for the day is never logged as too old (a day can stay closed overnight)', async () => {
    const r = rig({ maxAgeMs: () => 60_000 });
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    r.h.script.push(err(409, 'BUSINESS_DAY_NOT_OPEN'));
    await r.queue.drain();
    expect(r.queue.waitingDay('01ENTRY0001')).toBe(true);
    r.now.ms += 10 * 3_600_000;
    r.h.script.push(ok({ order_id: 'O1', token: 1, groups: [], lines: [] }));
    dayOpened(r.live, 11);
    await vi.waitFor(() => expect(r.queue.pendingCount()).toBe(0));
    expect(r.queue.log()).toEqual([]);
  });

  it('[02b #100 QR2-1] its session ended meanwhile: kept, then sent as the person signed in now; nobody signed in → it waits for the sign-in', async () => {
    const r = rig();
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    r.h.script.push(err(409, 'BUSINESS_DAY_NOT_OPEN'));
    await r.queue.drain();
    // Ali's own session ends on the hub (the page signs out): the waiting order stays queued, not logged
    r.h.script.push(err(401, 'SESSION_EXPIRED'));
    dayOpened(r.live, 12);
    await vi.waitFor(() => expect(r.signedOut).toBe(1));
    await r.queue.drain();
    expect(r.queue.log()).toEqual([]);
    expect(r.queue.queued().map((e) => e.entry_id)).toEqual(['01ENTRY0001']);
    const count = r.h.commands().length;
    await r.queue.drain(); // nobody signed in: nothing sent
    expect(r.h.commands().length).toBe(count);
    await r.api.signIn('sara', '1234', false);
    r.h.script.push(ok({ order_id: 'O1', token: 1, groups: [], lines: [] }));
    await r.queue.drain();
    const last = r.h.commands().at(-1)!;
    expect([last.body?.command_id, last.headers['X-Session-Token'], last.body?.actor_id, last.headers['X-Queued-At']]).toEqual(['01ENTRY0001', 'TOK-sara', 'sara', '1000000']);
    expect(r.queue.pendingCount()).toBe(0);
  });

  it('[02b §3.12 review #165] the log keeps only the refused item / deal id of the details — never a name', async () => {
    const backing: MemoryQueueBacking = new Map();
    const r = rig({ backing });
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', { ...order('O1'), order_type: 'dine_in', table_id: 'F4', seating_id: 'S1' }, meta1);
    await r.queue.enqueue('SubmitOrder', order('O2'), meta1);
    r.h.script.push(err(409, 'TABLE_ALREADY_LOCKED', { table_id: 'F4', locked_by_staff_id: 'bilal', locked_by_name: 'Bilal' }), err(409, 'ITEM_SOLD_OUT', { item_id: 'naan', available: 0 }));
    await r.queue.drain();
    const stored = [...backing.values()];
    expect(stored.map((e) => [e.log_reason, e.log_details])).toEqual([
      ['TABLE_ALREADY_LOCKED', undefined],
      ['ITEM_SOLD_OUT', { item_id: 'naan' }],
    ]);
    expect(JSON.stringify(stored)).not.toMatch(/Bilal|bilal|locked_by/);
    expect(JSON.stringify(r.queue.log())).not.toMatch(/Bilal|bilal|locked_by/);
    // Send again clears the old details while it is queued again
    r.h.script.push('network');
    expect(await r.queue.sendAgain('01ENTRY0002')).toEqual({ status: 'queued', entry_id: '01ENTRY0002' });
    expect(r.queue.queued().find((e) => e.entry_id === '01ENTRY0002')).not.toHaveProperty('log_details');
    expect(backing.get('01ENTRY0002')).not.toHaveProperty('log_details');
  });

  it('[02b §3.12] a 4xx to a first send the caller still waits on is refused to the caller, not logged', async () => {
    const r = rig();
    await r.api.signIn('ali', '1234', false);
    r.h.script.push(err(409, 'ITEM_SOLD_OUT'));
    const a = await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    expect(a).toEqual({ status: 'refused', error: { kind: 'api', status: 409, code: 'ITEM_SOLD_OUT', details: {} } });
    expect(r.queue.log()).toEqual([]);
    expect(r.backing.size).toBe(0);
  });

  it('[02b #35] own pending ORDER_ITEM_ID_IN_USE → shown as sent', async () => {
    const r = rig();
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    await r.queue.enqueue('SubmitOrder', order('O2'), meta1);
    const sent: unknown[] = [];
    r.queue.onSent((n) => sent.push([n.entry.entry_id, n.result, n.later]));
    // O1: the hub has it (its own order); O2: an id that belongs to another order → a real refusal
    r.h.script.push(err(409, 'ORDER_ITEM_ID_IN_USE', { order_id: 'O1' }), err(409, 'ORDER_ITEM_ID_IN_USE', { order_id: 'OTHER' }));
    reconnect(r.live);
    await r.queue.drain();
    expect(sent).toEqual([['01ENTRY0001', undefined, true]]);
    expect(r.queue.log().map((e) => [e.entry_id, e.log_reason])).toEqual([['01ENTRY0002', 'ORDER_ITEM_ID_IN_USE']]);
  });

  it('[02b #35] a 426 keeps the command queued', async () => {
    const r = rig();
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    await r.queue.enqueue('SubmitOrder', order('O2'), meta1);
    r.h.script.push(err(426, 'CLIENT_UPGRADE_REQUIRED'));
    reconnect(r.live);
    await r.queue.drain();
    // the drain stopped at the first; both still queued, nothing in the log
    expect(r.h.commands().slice(2).map((c) => c.body?.command_id)).toEqual(['01ENTRY0001']);
    expect(r.queue.pendingCount()).toBe(2);
    expect(r.queue.log()).toEqual([]);
  });

  it('[02b §3.12] a 5xx, a network error or a lost 2xx body keeps it queued and stops the drain', async () => {
    const r = rig();
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    await r.queue.enqueue('SubmitOrder', order('O2'), meta1);
    for (const a of [err(503, 'HUB_BUSY'), 'network' as const, { status: 200, body: 'cut' }]) {
      r.h.script.push(a);
      const before = r.h.commands().length;
      await r.queue.drain();
      expect(r.h.commands().length - before).toBe(1);
      expect(r.queue.pendingCount()).toBe(2);
    }
  });

  it('[02b §3.12] 401 SESSION_* stops the drain; 403 DEVICE_REVOKED → the 20a wipe path', async () => {
    const r = rig();
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    await r.queue.enqueue('SubmitOrder', order('O2'), meta1);
    await r.api.signIn('sara', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O3'), meta1);
    // Ali's session ended on the hub: his entries go to the log ("Send again"), the drain stops; Sara stays signed in
    r.h.script.push(err(401, 'SESSION_EXPIRED'));
    await r.queue.drain();
    expect(r.h.commands().slice(3).map((c) => c.body?.command_id)).toEqual(['01ENTRY0001']);
    expect(r.queue.log().map((e) => [e.entry_id, e.log_reason])).toEqual([
      ['01ENTRY0001', 'SESSION_EXPIRED'],
      ['01ENTRY0002', 'SESSION_EXPIRED'],
    ]);
    expect(r.queue.queued().map((e) => e.entry_id)).toEqual(['01ENTRY0003']);
    expect(r.signedOut).toBe(0);
    // revoked: the wipe runs, the entry stays queued, no later drain sends anything
    r.h.script.push(err(403, 'DEVICE_REVOKED'));
    await r.queue.drain();
    expect(r.revoked).toBe(1);
    expect(r.queue.queued().map((e) => e.entry_id)).toEqual(['01ENTRY0003']);
    const count = r.h.commands().length;
    reconnect(r.live);
    await r.queue.drain();
    expect(r.h.commands().length).toBe(count);
  });

  it('[02b §3.12] the page\'s own session ending (signed_out) logs that entry and stops', async () => {
    const r = rig();
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    r.h.script.push(err(401, 'SESSION_EXPIRED'));
    await r.queue.drain();
    expect(r.signedOut).toBe(1);
    expect(r.queue.log().map((e) => e.log_reason)).toEqual(['SESSION_EXPIRED']);
  });

  it('[02b lane note] CLIENT_SESSION_WITHOUT_ACTOR (status 0) is a definitive refusal: logged, never retried', async () => {
    const r = rig();
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    vi.spyOn(r.api, 'command').mockResolvedValueOnce({ ok: false, error: { kind: 'api', status: 0, code: 'CLIENT_SESSION_WITHOUT_ACTOR', details: { local: true } } });
    await r.queue.drain();
    expect(r.queue.log().map((e) => e.log_reason)).toEqual(['CLIENT_SESSION_WITHOUT_ACTOR']);
    await r.queue.drain();
    expect(r.queue.pendingCount()).toBe(0);
  });

  it('[02b Q-2, #120 QO-1] within the page life the same person drains; after reload a queued order stays queued (never the log) and nothing is sent before a sign-in', async () => {
    const backing: MemoryQueueBacking = new Map();
    const r = rig({ backing });
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    await r.queue.enqueue('SubmitOrder', order('O2'), meta1);
    // Sara signs in on the same page: Ali's first entry is still sent as Ali
    await r.api.signIn('sara', '1234', false);
    r.h.script.push(ok({ order_id: 'O1', token: 1, groups: [], lines: [] }));
    const before = r.h.commands().length;
    await r.queue.drain();
    expect(r.h.commands()[before]).toMatchObject({ headers: { 'X-Session-Token': 'TOK-ali' }, body: { actor_id: 'ali', command_id: '01ENTRY0001' } });
    expect(r.queue.queued().map((e) => e.entry_id)).toEqual(['01ENTRY0002']);
    // reload: no token survives; the order stays queued ("Waiting to send"), stored as queued, nothing sent on reconnect
    r.api.drop();
    r.queue.dispose();
    const reloaded = r.reload();
    await reloaded.ready;
    expect(reloaded.pendingCount()).toBe(1);
    expect(reloaded.queued()).toEqual([expect.objectContaining({ entry_id: '01ENTRY0002', state: 'queued', staff_id: 'ali' })]);
    expect(reloaded.log()).toEqual([]);
    expect([...backing.values()]).toEqual([expect.objectContaining({ entry_id: '01ENTRY0002', state: 'queued' })]);
    const count = r.h.commands().length;
    reconnect(r.live);
    await reloaded.drain();
    expect(r.h.commands().length).toBe(count);
    expect(reloaded.pendingCount()).toBe(1);
  });

  it('[02b #120 QO-1, R3-1] a reloaded order is sent automatically once someone signs in and the hub answers: same command_id, as that person, X-Queued-At, once', async () => {
    const backing: MemoryQueueBacking = new Map();
    const r = rig({ backing });
    await r.api.signIn('ali', '1234', false);
    // offline Send: queued
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    expect(r.queue.pendingCount()).toBe(1);
    r.api.drop();
    r.queue.dispose();
    const reloaded = r.reload();
    const sent: SentNotice[] = [];
    reloaded.onSent((n) => sent.push(n));
    await reloaded.ready;
    // the sign-in screen's drain (before POST /auth/pin) sends nothing: nobody to send as
    const count = r.h.commands().length;
    await reloaded.drain();
    expect(r.h.commands().length).toBe(count);
    await r.api.signIn('sara', '1234', false);
    // the hub is still away: stays queued
    r.h.script.push('network');
    await reloaded.drain();
    expect(reloaded.pendingCount()).toBe(1);
    // the hub answers: sent as Sara, a replay with the same id
    r.h.script.push(ok({ order_id: 'O1', token: 7, groups: [], lines: [] }));
    reconnect(r.live);
    await reloaded.drain();
    const tries = r.h.commands().slice(count);
    expect(tries.map((c) => c.body?.command_id)).toEqual(['01ENTRY0001', '01ENTRY0001']);
    expect(tries[1]).toMatchObject({ headers: { 'X-Session-Token': 'TOK-sara', 'X-Queued-At': '1000000' }, body: { actor_id: 'sara', payload: order('O1') } });
    expect(sent).toEqual([expect.objectContaining({ result: { order_id: 'O1', token: 7, groups: [], lines: [] }, later: true })]);
    expect(reloaded.pendingCount()).toBe(0);
    expect(backing.size).toBe(0);
    // nothing more is sent
    await reloaded.drain();
    expect(r.h.commands().length).toBe(count + 2);
  });

  it('[02b #120 QO-1] the other queueable commands still go to the log at load (Q-2); the orders after them still go', async () => {
    const backing: MemoryQueueBacking = new Map();
    const r = rig({ backing });
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('MarkServed', served, { label: 'Served' });
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    r.api.drop();
    const reloaded = r.reload();
    await reloaded.ready;
    expect(reloaded.log().map((e) => [e.entry_id, e.log_reason])).toEqual([['01ENTRY0001', 'reloaded']]);
    expect(reloaded.queued().map((e) => e.entry_id)).toEqual(['01ENTRY0002']);
    await r.api.signIn('ali', '1234', false);
    r.h.script.push(ok({ order_id: 'O1', token: 3, groups: [], lines: [] }));
    await reloaded.drain();
    expect(r.h.commands().at(-1)?.body).toMatchObject({ command_id: '01ENTRY0002', actor_id: 'ali' });
    expect(reloaded.pendingCount()).toBe(0);
  });

  it('[02b #120 QO-1] BUG-1: an order an older build moved to the log at load (`reloaded`) is queued again and sent', async () => {
    const backing: MemoryQueueBacking = new Map();
    const r = rig({ backing });
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    const e = backing.get('01ENTRY0001')!;
    backing.set(e.entry_id, { ...e, state: 'log', log_reason: 'reloaded' });
    r.api.drop();
    const reloaded = r.reload();
    await reloaded.ready;
    expect(reloaded.log()).toEqual([]);
    expect(backing.get('01ENTRY0001')).toEqual(expect.objectContaining({ state: 'queued' }));
    expect(backing.get('01ENTRY0001')).not.toHaveProperty('log_reason');
    await r.api.signIn('ali', '1234', false);
    r.h.script.push(ok({ order_id: 'O1', token: 4, groups: [], lines: [] }));
    await reloaded.drain();
    expect(reloaded.pendingCount()).toBe(0);
    expect(r.h.commands().at(-1)?.body?.command_id).toBe('01ENTRY0001');
  });

  it('[02b #120 QO-1] the signed-in session ends during the send: the reloaded order stays queued for the next sign-in', async () => {
    const backing: MemoryQueueBacking = new Map();
    const r = rig({ backing });
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    r.api.drop();
    const reloaded = r.reload();
    await reloaded.ready;
    await r.api.signIn('sara', '1234', false);
    r.h.script.push(err(401, 'SESSION_EXPIRED'));
    await reloaded.drain();
    expect(reloaded.queued().map((e) => e.entry_id)).toEqual(['01ENTRY0001']);
    expect(reloaded.log()).toEqual([]);
    await r.api.signIn('bilal', '1234', false);
    r.h.script.push(ok({ order_id: 'O1', token: 5, groups: [], lines: [] }));
    await reloaded.drain();
    expect(r.h.commands().at(-1)?.body).toMatchObject({ command_id: '01ENTRY0001', actor_id: 'bilal' });
    expect(reloaded.pendingCount()).toBe(0);
  });

  it('[02b #120 QO-1] a reloaded order older than queue_auto_send_max_ms goes to the log ("Send again"), never sent by itself', async () => {
    const backing: MemoryQueueBacking = new Map();
    const r = rig({ backing });
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    r.api.drop();
    const reloaded = r.reload();
    await reloaded.ready;
    await r.api.signIn('ali', '1234', false);
    r.now.ms += DEFAULT_QUEUE_AUTO_SEND_MAX_MS + 1;
    const count = r.h.commands().length;
    await reloaded.drain();
    expect(r.h.commands().length).toBe(count);
    expect(reloaded.log().map((e) => e.log_reason)).toEqual(['too_old']);
  });

  it('[02b #120 QO-1] keptAtLoad: the orders a load keeps (the offline boot count)', () => {
    const base = { entry_id: 'E', payload: {}, queued_at: 1, staff_id: 's', device_id: 'd', label: 'x' };
    expect(keptAtLoad({ ...base, command_type: 'SubmitOrder', state: 'queued' })).toBe(true);
    expect(keptAtLoad({ ...base, command_type: 'SubmitOrder', state: 'log', log_reason: 'reloaded' })).toBe(true);
    expect(keptAtLoad({ ...base, command_type: 'SubmitOrder', state: 'log', log_reason: 'ITEM_SOLD_OUT' })).toBe(false);
    expect(keptAtLoad({ ...base, command_type: 'MarkServed', state: 'queued' })).toBe(false);
  });

  it('[02b Q-2] Send again reuses the command_id (stored 2xx if already committed)', async () => {
    const backing: MemoryQueueBacking = new Map();
    const r = rig({ backing });
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    endedSession(backing, '01ENTRY0001');
    r.api.drop();
    const reloaded = r.reload();
    await reloaded.ready;
    expect(await reloaded.sendAgain('01ENTRY0001')).toEqual({ status: 'needs_person' });
    await r.api.signIn('sara', '1234', false);
    // the hub had committed it before the reply was lost: M19 answers the stored 2xx
    r.h.script.push(ok({ order_id: 'O1', token: 57, groups: [], lines: [] }));
    expect(await reloaded.sendAgain('01ENTRY0001')).toEqual({ status: 'sent', result: { order_id: 'O1', token: 57, groups: [], lines: [] } });
    const sent = r.h.commands().at(-1)!;
    expect(sent.body).toMatchObject({ command_id: '01ENTRY0001', actor_id: 'sara', payload: order('O1') });
    expect(sent.headers['X-Session-Token']).toBe('TOK-sara');
    expect(sent.headers['X-Queued-At']).toBe('1000000');
    expect(reloaded.log()).toEqual([]);
    expect(backing.size).toBe(0);
  });

  it('[02b §8 Queue] Send again refused → back in the log with the new code; Discard removes it', async () => {
    const backing: MemoryQueueBacking = new Map();
    const r = rig({ backing });
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    endedSession(backing, '01ENTRY0001');
    const reloaded = r.reload();
    r.h.script.push(err(409, 'ITEM_SOLD_OUT'));
    expect(await reloaded.sendAgain('01ENTRY0001')).toEqual({ status: 'log', reason: 'ITEM_SOLD_OUT' });
    expect(reloaded.log().map((e) => [e.log_reason, e.staff_id])).toEqual([['ITEM_SOLD_OUT', 'ali']]);
    await reloaded.discard('01ENTRY0001');
    expect(reloaded.log()).toEqual([]);
    expect(backing.size).toBe(0);
  });

  it('[02b §3.12] an entry older than queue_auto_send_max_ms goes to the log, not sent', async () => {
    let max: number | null = null;
    const r = rig({ maxAgeMs: () => max });
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    await r.queue.enqueue('SubmitOrder', order('O2'), meta1);
    // config not known yet: the 01a default (4 h)
    r.now.ms += DEFAULT_QUEUE_AUTO_SEND_MAX_MS + 2;
    const count = r.h.commands().length;
    await r.queue.drain();
    expect(r.h.commands().length).toBe(count);
    expect(r.queue.log().map((e) => e.log_reason)).toEqual(['too_old', 'too_old']);
    max = 60_000;
    await r.queue.enqueue('SubmitOrder', order('O3'), meta1);
    expect(r.queue.pendingCount()).toBe(1);
    r.now.ms += 60_001;
    await r.queue.drain();
    expect(r.queue.log().map((e) => e.entry_id)).toEqual(['01ENTRY0001', '01ENTRY0002', '01ENTRY0003']);
  });

  it('[02b #35] frozen cart: a queued SubmitOrder payload never changes', async () => {
    const r = rig();
    await r.api.signIn('ali', '1234', false);
    const payload = order('O1');
    await r.queue.enqueue('SubmitOrder', payload, meta1);
    payload.lines.push({ order_item_id: 'O1-L2', item_id: 'karahi' });
    payload.order_type = 'parking';
    (r.queue.queued()[0]!.payload as { lines: unknown[] }).lines.length = 0;
    r.h.script.push(ok({ order_id: 'O1', token: 1, groups: [], lines: [] }));
    await r.queue.drain();
    expect(r.h.commands().map((c) => c.body?.payload)).toEqual([order('O1'), order('O1')]);
  });

  it('[02b §8 Queue] on reconnect the queue drains first', async () => {
    const r = rig();
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    // a screen subscribed after the queue refetches on reconnect
    r.live.subscribe((m) => {
      if (m.kind === 'reconnect') void r.api.query('/queries/open-orders');
    });
    r.h.script.push(ok({ order_id: 'O1', token: 1, groups: [], lines: [] }));
    const before = r.h.calls.length;
    reconnect(r.live);
    await r.queue.drain();
    expect(r.h.calls.slice(before).map((c) => c.path)).toEqual(['/commands/submit-order', '/queries/open-orders']);
  });

  it('[02b §3.12] the store rejects (blocked site data): the queue goes on in memory for the page\'s life', async () => {
    const r = rig();
    const broken = { put: () => Promise.reject(new Error('blocked')), list: () => Promise.reject(new Error('blocked')), remove: () => Promise.reject(new Error('blocked')) };
    let n = 0;
    const queue = createCommandQueue({ api: r.api, device, clock: () => ({ nowMs: () => 5, utcOffsetMs: 0 }), live: r.live, store: broken, onDeviceRevoked: () => {}, newId: () => `E${++n}` });
    await r.api.signIn('ali', '1234', false);
    expect(await queue.enqueue('RequestBill', { table_id: 'T4', seating_id: 'S1' }, { table_id: 'T4', seating_id: 'S1', label: 'Ask for bill' })).toEqual({ status: 'queued', entry_id: 'E1' });
    expect(queue.pendingFor('T4')).toBe(1);
    r.h.script.push(ok({ requested: true }));
    await queue.drain();
    expect(queue.pendingFor('T4')).toBe(0);
  });

  it('[02b §3.12 review #156] a second open tab: its queued entries are left alone (not logged, not sent here)', async () => {
    const backing: MemoryQueueBacking = new Map();
    const r = rig({ backing });
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    // an earlier page life's MarkServed (an order would be kept queued, QO-1)
    const stale: QueueEntry = { ...[...backing.values()][0]!, entry_id: '01OLDPAGE', queued_at: 1, command_type: 'MarkServed', payload: served };
    backing.set(stale.entry_id, stale);
    // the second tab loads while the first is open and names 01ENTRY0001 as its own
    const second = createCommandQueue({
      api: r.api,
      device,
      clock: () => ({ nowMs: () => r.now.ms, utcOffsetMs: 0 }),
      live: r.live,
      store: createMemoryQueueStore(backing),
      onDeviceRevoked: () => {},
      presence: () => ({ ownedElsewhere: async () => new Set(['01ENTRY0001']), announceRemoved: () => {}, onRemoved: () => () => {}, dispose: () => {} }),
    });
    await second.ready;
    expect(second.pendingCount()).toBe(0);
    expect(second.log().map((e) => e.entry_id)).toEqual(['01OLDPAGE']);
    expect(backing.get('01ENTRY0001')?.state).toBe('queued');
    r.h.script.push(ok({ order_id: 'O1', token: 1, groups: [], lines: [] }));
    const before = r.h.commands().length;
    await second.drain();
    expect(r.h.commands().length).toBe(before);
    await r.queue.drain();
    expect(r.h.commands().at(-1)?.body?.command_id).toBe('01ENTRY0001');
  });

  it('[02b Q-2 review #162] the age window is for the automatic send only: an older entry sent again by hand is sent', async () => {
    const backing: MemoryQueueBacking = new Map();
    const r = rig({ backing, maxAgeMs: () => 60_000 });
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    r.now.ms += 60_001;
    await r.queue.drain();
    expect(r.queue.log().map((e) => e.log_reason)).toEqual(['too_old']);
    r.h.script.push(ok({ order_id: 'O1', token: 9, groups: [], lines: [] }));
    expect(await r.queue.sendAgain('01ENTRY0001')).toEqual({ status: 'sent', result: { order_id: 'O1', token: 9, groups: [], lines: [] } });
    expect(r.h.commands().at(-1)?.body?.command_id).toBe('01ENTRY0001');
  });

  it('[02b §8 Queue review #162] a double tap on Send again is one send, never a failure', async () => {
    const backing: MemoryQueueBacking = new Map();
    const r = rig({ backing });
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    endedSession(backing, '01ENTRY0001');
    r.queue.dispose();
    const reloaded = r.reload();
    await reloaded.ready;
    r.h.script.push(ok({ order_id: 'O1', token: 9, groups: [], lines: [] }));
    const before = r.h.commands().length;
    const [a, b] = await Promise.all([reloaded.sendAgain('01ENTRY0001'), reloaded.sendAgain('01ENTRY0001')]);
    expect(a).toEqual({ status: 'sent', result: { order_id: 'O1', token: 9, groups: [], lines: [] } });
    expect(b).toEqual(a);
    expect(r.h.commands().length - before).toBe(1);
  });

  it('[02b §3.12 review #162] second tab load race: an entry the first tab sent while the tabs answered is not written back', async () => {
    const backing: MemoryQueueBacking = new Map();
    const r = rig({ backing });
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    expect(backing.get('01ENTRY0001')?.state).toBe('queued');
    let removed: ((ids: string[]) => void) | null = null;
    const second = createCommandQueue({
      api: r.api,
      device,
      clock: () => ({ nowMs: () => r.now.ms, utcOffsetMs: 0 }),
      live: createLiveBus(),
      store: createMemoryQueueStore(backing),
      onDeviceRevoked: () => {},
      presence: () => ({
        // the first tab answers before its 2xx (so it does not name the entry as its own any more) and removes it
        ownedElsewhere: async () => {
          backing.delete('01ENTRY0001');
          return new Set<string>();
        },
        announceRemoved: () => {},
        onRemoved: (l) => {
          removed = l;
          return () => {};
        },
        dispose: () => {},
      }),
    });
    await second.ready;
    expect(second.log()).toEqual([]);
    expect(backing.has('01ENTRY0001')).toBe(false);
    void removed;
  });

  it('[02b §3.12 review #162] removals are broadcast: a copy the second tab wrote back is removed again', async () => {
    const backing: MemoryQueueBacking = new Map();
    const r = rig({ backing });
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('MarkServed', served, { label: 'Served' });
    let removed: ((ids: string[]) => void) | null = null;
    const second = createCommandQueue({
      api: r.api,
      device,
      clock: () => ({ nowMs: () => r.now.ms, utcOffsetMs: 0 }),
      live: createLiveBus(),
      store: createMemoryQueueStore(backing),
      onDeviceRevoked: () => {},
      presence: () => ({
        ownedElsewhere: async () => new Set<string>(),
        announceRemoved: () => {},
        onRemoved: (l) => {
          removed = l;
          return () => {};
        },
        dispose: () => {},
      }),
    });
    await second.ready;
    // the race lost: it is in the second tab's log and stored as "reloaded"
    expect(second.log().map((e) => e.entry_id)).toEqual(['01ENTRY0001']);
    // the first tab sends it and says so
    removed!(['01ENTRY0001']);
    await flushMicro();
    expect(second.log()).toEqual([]);
    expect(backing.has('01ENTRY0001')).toBe(false);
  });

  it('[02b §3.12 review #162] second tab load: a removal heard while it writes back the first entry skips the next', async () => {
    const backing: MemoryQueueBacking = new Map();
    const r = rig({ backing });
    await r.api.signIn('ali', '1234', false);
    await r.queue.enqueue('MarkServed', served, { label: 'Served' });
    await r.queue.enqueue('MarkServed', served, { label: 'Served' });
    let removed: ((ids: string[]) => void) | null = null;
    const inner = createMemoryQueueStore(backing);
    // the first write-back (E1) is where the first tab's "removed E2" arrives (it sent E2 meanwhile)
    const store = {
      ...inner,
      async put(e: QueueEntry) {
        await inner.put(e);
        if (e.entry_id === '01ENTRY0001') {
          backing.delete('01ENTRY0002');
          removed!(['01ENTRY0002']);
        }
      },
    };
    const second = createCommandQueue({
      api: r.api,
      device,
      clock: () => ({ nowMs: () => r.now.ms, utcOffsetMs: 0 }),
      live: createLiveBus(),
      store,
      onDeviceRevoked: () => {},
      presence: () => ({
        ownedElsewhere: async () => new Set<string>(),
        announceRemoved: () => {},
        onRemoved: (l) => {
          removed = l;
          return () => {};
        },
        dispose: () => {},
      }),
    });
    await second.ready;
    expect(second.log().map((e) => e.entry_id)).toEqual(['01ENTRY0001']);
    expect([...backing.keys()]).toEqual(['01ENTRY0001']);
  });

  it('[02b §3.12 review #162] the queue announces every removal to the other tabs', async () => {
    const announced: string[][] = [];
    const r = rig({ presence: () => ({ ownedElsewhere: async () => new Set<string>(), announceRemoved: (ids) => announced.push(ids), onRemoved: () => () => {}, dispose: () => {} }) });
    await r.api.signIn('ali', '1234', false);
    r.h.script.push(ok({ order_id: 'O1', token: 1, groups: [], lines: [] }));
    await r.queue.enqueue('SubmitOrder', order('O1'), meta1);
    expect(announced).toEqual([['01ENTRY0001']]);
  });

  it('[02b §3.12 review #156] broadcast presence: an open page names its queued ids to a page that loads', async () => {
    vi.useFakeTimers();
    const channels: Array<{ onmessage: ((m: MessageEvent) => void) | null; postMessage(d: unknown): void; close(): void }> = [];
    const create = () => {
      const ch = {
        onmessage: null as ((m: MessageEvent) => void) | null,
        postMessage(data: unknown) {
          for (const other of channels) if (other !== ch) other.onmessage?.({ data } as MessageEvent);
        },
        close() {},
      };
      channels.push(ch);
      return ch as unknown as BroadcastChannel;
    };
    createBroadcastPresence(() => ['A1', 'A2'], { create });
    const loading = createBroadcastPresence(() => [], { create, waitMs: 200 });
    const owned = loading.ownedElsewhere();
    await vi.advanceTimersByTimeAsync(200);
    expect([...(await owned)].sort()).toEqual(['A1', 'A2']);
    // removals reach the other pages
    const heard: string[][] = [];
    loading.onRemoved((ids) => heard.push(ids));
    createBroadcastPresence(() => [], { create }).announceRemoved(['A1']);
    expect(heard).toEqual([['A1']]);
    // no BroadcastChannel: nobody else, no wait
    expect([...(await createBroadcastPresence(() => [], { create: () => null }).ownedElsewhere())]).toEqual([]);
  });
});
