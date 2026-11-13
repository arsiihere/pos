import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush } from '../../../test/dom';
import { onSlotsChanged, passCardActions, publishFrame } from '../kds/slots';
import { registerPrintSlots } from './register';
import { catchUp, fakeTransport, fireDispatched, line, ticket } from './test-fakes';

let stop: (() => void) | null = null;

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

const card = (order_id: string) => passCardActions({ order_id, point_id: 'P-PASS' });

describe('order-tickets cache (Q-52)', () => {
  it('[03c Q-52] Pass card: order-tickets read once when the card first shows (reprint-ticket only), cached; re-read for that order on a FireDispatched naming its line; no timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    const transport = fakeTransport();
    transport.ticketAnswers.set('O1', { ok: true, data: { tickets: [ticket('TK1', 'S-K', false)] } });
    stop = registerPrintSlots(transport);
    let renders = 0;
    const off = onSlotsChanged(() => {
      renders += 1;
    });
    // the Pass catch-up tells which order each line belongs to
    publishFrame(
      catchUp({
        point_view: {
          point_id: 'P-PASS',
          stations: [],
          orders: [{ order_id: 'O1', identifier: { kind: 'table', label: 'T4' }, placed_at: 1, lines: [{ ...line('L1'), stage: 'added', handed_over: false }], ready: null }],
          takeovers: [],
        },
      }),
    );
    // many renders of the card while the read runs: one read
    transport.hold = true;
    card('O1');
    card('O1');
    card('O1');
    expect(transport.reads).toEqual(['O1']);
    transport.hold = false;
    transport.release();
    await flush();
    expect(renders).toBe(1); // notifySlots once the answer is in
    expect(card('O1')).toEqual([]); // no ticket with a printer yet
    card('O1');
    expect(transport.reads).toEqual(['O1']);
    // no timer re-reads it
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(transport.reads).toEqual(['O1']);
    // a fire of another order's line, or an unknown line: no read
    publishFrame(fireDispatched(['L-OTHER']));
    await flush();
    expect(transport.reads).toEqual(['O1']);
    // a fire naming its line: one re-read; the Tandoor ticket now has a printer → Reprint shows
    transport.ticketAnswers.set('O1', { ok: true, data: { tickets: [ticket('TK1', 'S-K', false), ticket('TK2', 'S-T', true)] } });
    publishFrame(fireDispatched(['L1']));
    await flush();
    expect(transport.reads).toEqual(['O1', 'O1']);
    expect(card('O1').map((a) => a.label)).toEqual(['Reprint']);
    expect(renders).toBe(2);
    off();
  });

  it('[03c Q-52] a line whose details arrive (point_lines) after its FireDispatched still re-reads its cached order', async () => {
    const transport = fakeTransport();
    stop = registerPrintSlots(transport);
    card('O1');
    await flush();
    expect(transport.reads).toEqual(['O1']);
    publishFrame(fireDispatched(['L7']));
    await flush();
    expect(transport.reads).toEqual(['O1']);
    publishFrame({ type: 'point_lines', point_id: 'P-PASS', lines: [line('L7', 'O1')] });
    await flush();
    expect(transport.reads).toEqual(['O1', 'O1']);
    // an uncached order's lines: nothing to re-read
    publishFrame(fireDispatched(['L8']));
    publishFrame({ type: 'point_lines', point_id: 'P-PASS', lines: [line('L8', 'O5')] });
    await flush();
    expect(transport.reads).toEqual(['O1', 'O1']);
  });

  it('[03c Q-52] a catch-up (reconnect) forgets the cache: the next render reads again; a failed read is not retried by renders', async () => {
    const transport = fakeTransport();
    transport.ticketAnswers.set('O1', { ok: false, error: { kind: 'network' } });
    stop = registerPrintSlots(transport);
    card('O1');
    await flush();
    card('O1');
    card('O1');
    await flush();
    expect(transport.reads).toEqual(['O1']);
    transport.ticketAnswers.set('O1', { ok: true, data: { tickets: [ticket('TK2', 'S-T', true)] } });
    publishFrame(catchUp({}));
    card('O1');
    await flush();
    expect(transport.reads).toEqual(['O1', 'O1']);
    expect(card('O1')).toHaveLength(1);
  });
});
