import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { flush } from '../../../test/dom';
import { lineActions, lineTags, onSlotsChanged, passCardActions, publishFrame, runSlotAction } from '../kds/slots';
import { registerPrintSlots } from './register';
import { catchUp, fakeTransport, line, ticket } from './test-fakes';

let stop: (() => void) | null = null;

afterEach(() => {
  stop?.();
  stop = null;
});

const KDS = { station_id: 'S-T', has_printer: true, surface: 'kds' } as const;
const TAKEOVER = { station_id: 'S-T', has_printer: true, surface: 'takeover' } as const;
const QUEUED = (n: number) => `Reprinting ${n} tickets. It prints when the printer is back.`;
const NETWORK = { ok: false as const, error: { kind: 'network' as const } };
const sent = (t: ReturnType<typeof fakeTransport>) => t.commands.map((c) => ({ type: c.type, payload: c.payload }));

describe('reprint (03c-C02, C03)', () => {
  it('[03c Q-50] KDS row action Reprint only when ctx.has_printer (both or printer); station_notice output flips it', async () => {
    const transport = fakeTransport();
    stop = registerPrintSlots(transport);
    expect(lineActions(line('L1'), { ...KDS, has_printer: false })).toEqual([]);
    const [action] = lineActions(line('L1'), KDS);
    expect(action?.label).toBe('Reprint');
    // the KDS (a station session) reprints its own station's tickets of the order: one ReprintTicket by order;
    // the hub queues it even while the printer is down (brief §3.6 03c-C02)
    expect(await runSlotAction(action!)).toEqual({ toast: QUEUED(1) });
    expect(sent(transport)).toEqual([{ type: 'ReprintTicket', payload: { order_id: 'O1' } }]);
    // the output notice re-renders 03b's rows, which then ask with the new has_printer
    let renders = 0;
    const off = onSlotsChanged(() => {
      renders += 1;
    });
    publishFrame({ type: 'station_notice', station_id: 'S-T', kind: 'output', has_printer: false });
    expect(renders).toBe(1);
    expect(lineActions(line('L1'), { ...KDS, has_printer: false })).toEqual([]);
    publishFrame({ type: 'station_notice', station_id: 'S-T', kind: 'archived', open_lines: 2 });
    expect(renders).toBe(1);
    off();
    // no transport (IR-15): the tag only, no Reprint anywhere
    stop();
    stop = registerPrintSlots();
    expect(lineActions(line('L1'), KDS)).toEqual([]);
  });

  it('[03c Q-51] takeover row Reprint → order-tickets(order_id), tickets of that station with has_printer → one ReprintTicket { ticket_id } each; toast sums the results', async () => {
    const transport = fakeTransport();
    transport.ticketAnswers.set('O1', {
      ok: true,
      data: { tickets: [ticket('TK1', 'S-T', true), ticket('TK2', 'S-K', true), ticket('TK3', 'S-T', true), ticket('TK4', 'S-T', false)] },
    });
    transport.reprintAnswers.push(
      { ok: true, data: { ticket_ids: ['TK1'], skipped: [] } },
      { ok: true, data: { ticket_ids: [], skipped: [{ ticket_id: 'TK3', reason: 'nothing_live' }] } },
    );
    stop = registerPrintSlots(transport);
    const [action] = lineActions(line('L1'), TAKEOVER);
    expect(await runSlotAction(action!)).toEqual({ toast: QUEUED(1) });
    expect(transport.reads).toEqual(['O1']);
    expect(sent(transport)).toEqual([
      { type: 'ReprintTicket', payload: { ticket_id: 'TK1' } },
      { type: 'ReprintTicket', payload: { ticket_id: 'TK3' } },
    ]);
    // nothing of that station's with a printer → no command, "Nothing to reprint"; no tickets at all → "This order has no tickets"
    transport.ticketAnswers.set('O2', { ok: true, data: { tickets: [ticket('TK5', 'S-K', true)] } });
    expect(await runSlotAction(lineActions(line('L2', 'O2'), TAKEOVER)[0]!)).toEqual({ toast: 'Nothing to reprint' });
    expect(await runSlotAction(lineActions(line('L3', 'O3'), TAKEOVER)[0]!)).toEqual({ toast: 'This order has no tickets' });
    expect(transport.commands).toHaveLength(2);
  });

  it('[03c §3.5] Pass card Reprint shown only when a cached ticket has has_printer; result.skipped → "Nothing to reprint"', async () => {
    const transport = fakeTransport();
    transport.ticketAnswers.set('O1', { ok: true, data: { tickets: [ticket('TK1', 'S-K', false), ticket('TK2', 'S-T', true)] } });
    transport.ticketAnswers.set('O2', { ok: true, data: { tickets: [ticket('TK3', 'S-K', false)] } });
    stop = registerPrintSlots(transport);
    const card = (order_id: string) => passCardActions({ order_id, point_id: 'P-PASS' });
    expect(card('O1')).toEqual([]); // not read yet: the read starts, nothing shown
    expect(card('O2')).toEqual([]);
    await flush();
    expect(card('O1').map((a) => a.label)).toEqual(['Reprint']);
    expect(card('O2')).toEqual([]);
    transport.reprintAnswers.push({ ok: true, data: { ticket_ids: [], skipped: [{ ticket_id: 'TK2', reason: 'nothing_live' }] } });
    expect(await runSlotAction(card('O1')[0]!)).toEqual({ toast: 'Nothing to reprint' });
    // the staff session reprints by order: every station's tickets with a printer
    expect(sent(transport)).toEqual([{ type: 'ReprintTicket', payload: { order_id: 'O1' } }]);
    // both queued and skipped tickets: the toast counts the queued ones
    transport.reprintAnswers.push({ ok: true, data: { ticket_ids: ['TK2', 'TK7'], skipped: [{ ticket_id: 'TK9', reason: 'no_printer' }] } });
    expect(await runSlotAction(card('O1')[0]!)).toEqual({ toast: QUEUED(2) });
    // without reprint-ticket: no read, no action
    transport.can = false;
    expect(card('O9')).toEqual([]);
    await flush();
    expect(transport.reads).toEqual(['O1', 'O2']);
    expect(card('O1')).toEqual([]);
  });

  it('[03c-C02] 404 ORDER_NOT_FOUND → "This order has no tickets"; 403 PERMISSION_DENIED hides Reprint (no toast); a network failure rejects', async () => {
    const transport = fakeTransport();
    transport.ticketAnswers.set('O1', { ok: true, data: { tickets: [ticket('TK2', 'S-T', true)] } });
    stop = registerPrintSlots(transport);
    transport.reprintAnswers.push({ ok: false, error: { kind: 'api', status: 404, code: 'ORDER_NOT_FOUND', details: {} } });
    expect(await runSlotAction(lineActions(line('L1'), KDS)[0]!)).toEqual({ toast: 'This order has no tickets' });
    transport.reprintAnswers.push(NETWORK);
    await expect(runSlotAction(lineActions(line('L1'), KDS)[0]!)).rejects.toThrow();
    passCardActions({ order_id: 'O1', point_id: 'P-PASS' });
    await flush();
    expect(passCardActions({ order_id: 'O1', point_id: 'P-PASS' })).toHaveLength(1);
    let renders = 0;
    const off = onSlotsChanged(() => {
      renders += 1;
    });
    transport.reprintAnswers.push({ ok: false, error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: { permission: 'reprint-ticket' } } });
    expect(await runSlotAction(lineActions(line('L1'), KDS)[0]!)).toEqual({});
    expect(renders).toBe(1);
    expect(lineActions(line('L1'), KDS)).toEqual([]);
    expect(lineActions(line('L1'), TAKEOVER)).toEqual([]);
    expect(passCardActions({ order_id: 'O1', point_id: 'P-PASS' })).toEqual([]);
    off();
    // a takeover read refused 403 hides it too, with no owner-app words
    stop();
    const t2 = fakeTransport();
    t2.ticketAnswers.set('O4', { ok: false, error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: {} } });
    stop = registerPrintSlots(t2);
    expect(await runSlotAction(lineActions(line('L4', 'O4'), TAKEOVER)[0]!)).toEqual({});
    expect(lineActions(line('L4', 'O4'), TAKEOVER)).toEqual([]);
  });

  it('[00 M47 03c §3.5] Reprint again after a network failure resends the same command_id; a definitive answer ends it', async () => {
    const transport = fakeTransport();
    transport.ticketAnswers.set('O1', { ok: true, data: { tickets: [ticket('TK2', 'S-T', true)] } });
    stop = registerPrintSlots(transport);
    const kds = () => lineActions(line('L1'), KDS)[0]!;
    transport.reprintAnswers.push(NETWORK, { ok: false, error: { kind: 'signed_out' } });
    await expect(runSlotAction(kds())).rejects.toThrow();
    await expect(runSlotAction(kds())).rejects.toThrow();
    await runSlotAction(kds());
    await runSlotAction(kds());
    const ids = transport.commands.map((c) => c.commandId);
    expect(ids[0]).toEqual(expect.any(String));
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).toBe(ids[0]); // the third send got the answer
    expect(ids[3]).not.toBe(ids[0]); // a new tap after a definitive answer is a new command
    // the Pass card keeps its own id per order
    passCardActions({ order_id: 'O1', point_id: 'P-PASS' });
    await flush();
    const card = () => passCardActions({ order_id: 'O1', point_id: 'P-PASS' })[0]!;
    transport.reprintAnswers.push(NETWORK);
    await expect(runSlotAction(card())).rejects.toThrow();
    await runSlotAction(card());
    const [a, b] = transport.commands.slice(4).map((c) => c.commandId);
    expect(b).toBe(a);
    expect(a).not.toBe(ids[3]);
  });

  it('[00 M47 03c Q-51] takeover: a retry after a network failure resends only the tickets not yet answered, each with its own first id; a later refusal says how many went', async () => {
    const transport = fakeTransport();
    transport.ticketAnswers.set('O1', { ok: true, data: { tickets: [ticket('TA', 'S-T', true), ticket('TB', 'S-T', true), ticket('TC', 'S-T', true)] } });
    transport.reprintAnswers.push({ ok: true, data: { ticket_ids: ['TA'], skipped: [] } }, NETWORK);
    stop = registerPrintSlots(transport);
    const takeover = () => lineActions(line('L1'), TAKEOVER)[0]!;
    await expect(runSlotAction(takeover())).rejects.toThrow();
    expect(sent(transport).map((c) => c.payload)).toEqual([{ ticket_id: 'TA' }, { ticket_id: 'TB' }]);
    const idB = transport.commands[1]!.commandId;
    expect(await runSlotAction(takeover())).toEqual({ toast: QUEUED(3) });
    expect(sent(transport).map((c) => c.payload)).toEqual([{ ticket_id: 'TA' }, { ticket_id: 'TB' }, { ticket_id: 'TB' }, { ticket_id: 'TC' }]);
    expect(transport.commands[2]!.commandId).toBe(idB);
    expect(transport.reads).toEqual(['O1']); // the retry continues, it does not read again
    // one queued, then a refusal: the toast says how many went
    transport.reprintAnswers.push(
      { ok: true, data: { ticket_ids: ['TA'], skipped: [] } },
      { ok: false, error: { kind: 'api', status: 404, code: 'ORDER_NOT_FOUND', details: {} } },
    );
    expect(await runSlotAction(takeover())).toEqual({ toast: QUEUED(1) });
  });

  it('[03c §3.5] a double tap runs one Reprint: the second run() returns the first one\'s promise', async () => {
    const transport = fakeTransport();
    transport.holdCommands = true;
    stop = registerPrintSlots(transport);
    const action = lineActions(line('L1'), KDS)[0]!;
    const first = runSlotAction(action);
    const second = runSlotAction(lineActions(line('L1'), KDS)[0]!);
    await flush();
    expect(transport.commands).toHaveLength(1);
    await act(async () => transport.releaseCommands());
    expect(await first).toEqual({ toast: QUEUED(1) });
    expect(await second).toEqual({ toast: QUEUED(1) });
    expect(transport.commands).toHaveLength(1);
  });

  it('[IR-15] registering again with a transport keeps the printed tags and the ticket cache', async () => {
    const transport = fakeTransport();
    transport.ticketAnswers.set('O1', { ok: true, data: { tickets: [ticket('TK2', 'S-T', true)] } });
    registerPrintSlots();
    publishFrame(catchUp({ kds_printed: { order_item_ids: ['L1'] } }));
    stop = registerPrintSlots(transport);
    expect(lineTags(line('L1'))).toHaveLength(1);
    passCardActions({ order_id: 'O1', point_id: 'P-PASS' });
    await flush();
    stop = registerPrintSlots(transport);
    expect(passCardActions({ order_id: 'O1', point_id: 'P-PASS' })).toHaveLength(1);
    expect(transport.reads).toEqual(['O1']);
    expect(lineTags(line('L1'))).toHaveLength(1);
  });
});
