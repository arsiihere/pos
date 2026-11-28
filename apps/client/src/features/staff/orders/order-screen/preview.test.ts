import { describe, expect, it } from 'vitest';
import type { HubResult } from '../../../../api/hub-admin';
import { createLiveBus } from '../../shell/live';
import type { EtaDraft, EtaPreviewBody } from '../contracts';
import { createPreview, type Preview } from './preview';

const draft = (n: number): EtaDraft => ({ order_type: 'takeaway', lines: [{ key: 'A', item_id: 'I1', quantity: n }] });
const body = (promise: number): EtaPreviewBody => ({ as_of_seq: 1, groups: [{ promise_ms: promise, keys: ['A'] }], lines: [{ key: 'A', eta_ms: promise - 60_000, from_stock: false, zone_served: false }] });
const ev = (seq: number, event_type: string) => ({ type: 'event' as const, seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload: {} } });

function harness(o: { online?: () => boolean; reply?: (d: EtaDraft) => Promise<HubResult<EtaPreviewBody>> } = {}) {
  const timers: Array<{ fn: () => void; at: number; id: number }> = [];
  let now = 0;
  let id = 0;
  const calls: EtaDraft[] = [];
  const live = createLiveBus();
  const preview: Preview = createPreview({
    live,
    online: o.online ?? (() => true),
    etaPreview: (d) => {
      calls.push(d);
      return o.reply?.(d) ?? Promise.resolve({ ok: true, data: body(1_000_000) });
    },
    setTimeout: (fn, ms) => {
      id += 1;
      timers.push({ fn, at: now + ms, id });
      return id;
    },
    clearTimeout: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const advance = async (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => x.at <= now)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  return { preview, live, calls, advance };
}

describe('[02b §8 Ordering screen] eta preview', () => {
  it('[02b §8 Ordering screen] eta-preview 250 ms after the last change; again on BranchConfigApplied, Stock* frames, stations_live', async () => {
    const h = harness();
    h.preview.set(draft(1));
    await h.advance(200);
    h.preview.set(draft(2));
    await h.advance(249);
    expect(h.calls).toHaveLength(0);
    await h.advance(1);
    expect(h.calls).toEqual([draft(2)]);
    expect(h.preview.state().kind).toBe('ok');
    h.live.frame(ev(1, 'BranchConfigApplied'));
    await h.advance(250);
    h.live.frame(ev(2, 'StockReserved'));
    await h.advance(250);
    h.live.frame({ type: 'catch_up', as_of_seq: 5, state: { stations_live: { as_of_seq: 5, now_ms: 0, stations: [] } } });
    await h.advance(250);
    h.live.frame(ev(6, 'TableOpened')); // not a timing frame
    await h.advance(250);
    expect(h.calls).toHaveLength(4);
    // an empty cart: no call
    h.preview.set(null);
    h.live.frame(ev(7, 'StockSet'));
    await h.advance(250);
    expect(h.calls).toHaveLength(4);
    expect(h.preview.state()).toEqual({ kind: 'none' });
  });

  it('[02b v1.0.26 CT-2, test 96; owner 2026-11-28 QA BUG-6] re-asks on the tiles\' station-load frames and every 30 s while the cart has a line; nothing for an empty cart', async () => {
    const h = harness();
    h.preview.set(draft(1));
    await h.advance(250);
    expect(h.calls).toHaveLength(1);
    for (const type of ['OrderPlaced', 'FireDispatched', 'ItemStarted', 'ItemDone', 'OrderBoosted']) {
      h.live.frame(ev(h.calls.length + 10, type));
      await h.advance(250);
    }
    expect(h.calls).toHaveLength(6);
    // no frame for 30 s → one more ask, then every 30 s
    await h.advance(29_999);
    expect(h.calls).toHaveLength(6);
    await h.advance(1);
    await h.advance(250);
    expect(h.calls).toHaveLength(7);
    await h.advance(30_000);
    await h.advance(250);
    expect(h.calls).toHaveLength(8);
    // an empty cart: no timer, no frame refetch
    h.preview.set(null);
    await h.advance(90_000);
    h.live.frame(ev(99, 'OrderPlaced'));
    await h.advance(250);
    expect(h.calls).toHaveLength(8);
  });

  it('[02b §8 Ordering screen] "time updated" when a promise moves ≥ 60 s', async () => {
    const promises = [1_000_000, 1_059_999, 1_120_000];
    let i = 0;
    const h = harness({ reply: () => Promise.resolve({ ok: true, data: body(promises[i++]!) }) });
    h.preview.set(draft(1));
    await h.advance(250);
    const moved = () => {
      const s = h.preview.state();
      return s.kind === 'ok' ? [...s.moved] : null;
    };
    expect(moved()).toEqual([]);
    h.preview.set(draft(2));
    await h.advance(250);
    expect(moved()).toEqual([]); // 59.999 s
    h.preview.set(draft(3));
    await h.advance(250);
    expect(moved()).toEqual(['A']); // 60.001 s
  });

  it('[02b §8 Ordering screen] preview failed / offline → "—", "set when sent"; Send stays on (queues)', async () => {
    let online = false;
    const h = harness({ online: () => online, reply: () => Promise.resolve({ ok: false, error: { kind: 'network' } } as HubResult<EtaPreviewBody>) });
    h.preview.set(draft(1));
    await h.advance(250);
    expect(h.calls).toHaveLength(0); // offline: no call at all
    expect(h.preview.state()).toEqual({ kind: 'failed' });
    online = true;
    h.preview.set(draft(2));
    await h.advance(250);
    expect(h.calls).toHaveLength(1);
    expect(h.preview.state()).toEqual({ kind: 'failed' });
  });

  it('[02b §6.14] a reply older than a later request is dropped', async () => {
    const resolvers: Array<(r: HubResult<EtaPreviewBody>) => void> = [];
    const h = harness({ reply: () => new Promise((r) => resolvers.push(r)) });
    h.preview.set(draft(1));
    await h.advance(250);
    h.preview.set(draft(2));
    await h.advance(250);
    resolvers[1]!({ ok: true, data: body(2_000_000) });
    await h.advance(0);
    resolvers[0]!({ ok: true, data: body(1_000_000) });
    await h.advance(0);
    const s = h.preview.state();
    expect(s.kind === 'ok' ? s.body.groups[0]!.promise_ms : null).toBe(2_000_000);
  });

  it('[02b §6.14; 02b-TK C1-1] 409 BUSINESS_DAY_NOT_OPEN keeps its code: day_not_open; a catch-up with `stock` asks again', async () => {
    let closed = true;
    const h = harness({ reply: () => Promise.resolve(closed ? ({ ok: false, error: { kind: 'api', status: 409, code: 'BUSINESS_DAY_NOT_OPEN', details: {} } } as HubResult<EtaPreviewBody>) : { ok: true, data: body(1_000_000) }) });
    h.preview.set(draft(1));
    await h.advance(250);
    expect(h.preview.state()).toEqual({ kind: 'day_not_open' });
    closed = false;
    h.live.frame({ type: 'catch_up', as_of_seq: 9, state: { stock: { business_day: null, business_day_started_at: null, items: {} } } });
    await h.advance(250);
    expect(h.calls).toHaveLength(2);
    expect(h.preview.state().kind).toBe('ok');
  });

  it('[02b-TK A2 item 5a, frame CartTimeDelta] Ready by later by ≥ 1 min after a cart change: the line that moved it; the next stable reply clears it', async () => {
    // A = karahi ×1 (ready 1:42), then ×2 (ready 2:00: +18 min); then N = naan added (ready stays); then a refetch
    const two = (a: number, b: number | null): EtaPreviewBody => ({
      as_of_seq: 1,
      groups: [{ promise_ms: a, keys: ['A'] }, ...(b === null ? [] : [{ promise_ms: b, keys: ['N'] }])],
      lines: [{ key: 'A', eta_ms: a, from_stock: false, zone_served: false }, ...(b === null ? [] : [{ key: 'N', eta_ms: b, from_stock: false, zone_served: false }])],
    });
    const T0 = 1_000 * 60_000;
    const replies = [two(T0, null), two(T0 + 18 * 60_000, null), two(T0 + 18 * 60_000, T0), two(T0 + 18 * 60_000, T0), two(T0 + 18 * 60_000 + 30_000, T0)];
    let i = 0;
    const h = harness({ reply: async () => ({ ok: true, data: replies[i++]! }) });
    const lines = (a: number, naan: boolean): EtaDraft => ({ order_type: 'takeaway', lines: [{ key: 'A', item_id: 'I1', quantity: a }, ...(naan ? [{ key: 'N', item_id: 'I5', quantity: 1 }] : [])] });
    const delta = () => (h.preview.state() as { delta?: unknown }).delta;
    h.preview.set(lines(1, false));
    await h.advance(250);
    expect(delta()).toBeNull();
    h.preview.set(lines(2, false));
    await h.advance(250);
    expect(delta()).toEqual({ key: 'A', ms: 18 * 60_000 });
    // a change that does not move Ready by: cleared
    h.preview.set(lines(2, true));
    await h.advance(250);
    expect(delta()).toBeNull();
    // a refetch with no cart change names no line
    h.live.frame(ev(1, 'StockReserved'));
    await h.advance(250);
    expect(delta()).toBeNull();
    // less than a minute later is not a move
    h.preview.set(lines(3, true));
    await h.advance(250);
    expect(delta()).toBeNull();
  });
});
