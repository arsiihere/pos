import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnswerSender, createPinPad, type AnswerContext, type HubLink } from './answer';

// 01d §8.1, §6.2, H-10: AnswerRequest is sent online only; the PIN lives in memory until the response.

function fakeLink(up: boolean): HubLink & { set(up: boolean): void } {
  let isUp = up;
  const listeners = new Set<() => void>();
  return {
    isUp: () => isUp,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    set(next) {
      isUp = next;
      for (const fn of [...listeners]) fn();
    },
  };
}

const CTX: AnswerContext = {
  deviceToken: 'dev-tok',
  sessionToken: 'sess-1',
  tenantId: 'T1',
  branchId: 'B1',
  deviceId: 'D1',
  staffId: 'S-IMRAN',
};

function reply(status: number, body: unknown): Response {
  return { status, json: async () => body } as Response;
}

const OK = reply(200, { data: { result: { alert_id: 'A1', decision: 'approve', answered_at: 5 } } });

function type(pad: ReturnType<typeof createPinPad>, digits: string): void {
  for (const d of digits) pad.press(d);
}

let setItem: ReturnType<typeof vi.spyOn>;
let idbOpen: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setItem = vi.spyOn(Storage.prototype, 'setItem');
  idbOpen = vi.fn(() => {
    throw new Error('indexedDB must not be used');
  });
  vi.stubGlobal('indexedDB', { open: idbOpen });
});

afterEach(() => {
  setItem.mockRestore();
  vi.unstubAllGlobals();
});

function noStorageWrites(): void {
  expect(setItem).not.toHaveBeenCalled();
  expect(idbOpen).not.toHaveBeenCalled();
  expect(JSON.stringify({ ...localStorage })).not.toContain('4711');
  expect(JSON.stringify({ ...sessionStorage })).not.toContain('4711');
}

describe('online-only answers', () => {
  it('[01d #56 client] with the socket down the PIN pad is disabled and answer() writes nothing and sends no request', async () => {
    const link = fakeLink(false);
    const pad = createPinPad(link);
    const fetch = vi.fn(async () => OK);
    const sender = createAnswerSender({ link, context: () => CTX, fetch });
    expect(pad.disabled()).toBe(true);
    type(pad, '4711');
    expect(pad.length()).toBe(0);
    expect(sender.canSend()).toBe(false);

    const out = await sender.answer({ alert_id: 'A1', decision: 'approve', method: 'pin' }, pad);
    expect(out).toEqual({ ok: false, code: 'NETWORK', details: {}, message: 'No connection to the hub — try again.' });
    expect(fetch).not.toHaveBeenCalled();
    const session = await sender.answer({ alert_id: 'A1', decision: 'accept', method: 'session' });
    expect(session.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    noStorageWrites();
  });

  it('[01d #56 client] the socket dropping while a PIN is typed clears it; the pad comes back when the socket does', () => {
    const link = fakeLink(true);
    const pad = createPinPad(link);
    const changes = vi.fn();
    pad.subscribe(changes);
    type(pad, '47');
    expect(pad.length()).toBe(2);
    link.set(false);
    expect(pad.length()).toBe(0);
    expect(pad.disabled()).toBe(true);
    link.set(true);
    expect(pad.disabled()).toBe(false);
    type(pad, '4711');
    expect(pad.length()).toBe(4);
    expect(changes).toHaveBeenCalled();
    noStorageWrites();
  });

  it('[01d #56 client] on a network error the PIN is dropped from memory: "No connection to the hub — try again"; no retry', async () => {
    const link = fakeLink(true);
    const pad = createPinPad(link);
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const sender = createAnswerSender({ link, context: () => CTX, fetch });
    type(pad, '4711');
    const out = await sender.answer({ alert_id: 'A1', decision: 'approve', method: 'pin' }, pad);
    expect(out).toMatchObject({ ok: false, code: 'NETWORK', message: 'No connection to the hub — try again.' });
    expect(pad.length()).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    // the sender keeps nothing: a second answer has no PIN to send
    const again = await sender.answer({ alert_id: 'A1', decision: 'approve', method: 'pin' }, pad);
    expect(again).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(fetch).toHaveBeenCalledTimes(1);
    noStorageWrites();
  });

  it('[01d #56 client] the PIN is held until the response arrives, then cleared; the pad is busy meanwhile', async () => {
    const link = fakeLink(true);
    const pad = createPinPad(link);
    let release!: (r: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((r) => (release = r)));
    const sender = createAnswerSender({ link, context: () => CTX, fetch });
    type(pad, '4711');
    const pending = sender.answer({ alert_id: 'A1', decision: 'approve', method: 'pin' }, pad);
    expect(pad.busy()).toBe(true);
    expect(pad.disabled()).toBe(true);
    pad.press('9');
    expect(pad.length()).toBe(4);
    release(OK);
    const out = await pending;
    expect(out).toEqual({ ok: true, result: { alert_id: 'A1', decision: 'approve', answered_at: 5 } });
    expect(pad.length()).toBe(0);
    expect(pad.busy()).toBe(false);
    noStorageWrites();
  });

  it('[01d §6.2] POST /commands/answer-request with the device token, the session token and a fresh command id', async () => {
    const link = fakeLink(true);
    const pad = createPinPad(link);
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => OK);
    let n = 0;
    const sender = createAnswerSender({
      link,
      context: () => CTX,
      fetch,
      baseUrl: 'http://hub.local',
      newCommandId: () => `CMD${++n}`,
      now: () => 1_000,
    });
    type(pad, '4711');
    await sender.answer({ alert_id: 'A1', decision: 'approve', method: 'pin' }, pad);
    await sender.answer({ alert_id: 'A2', decision: 'accept', method: 'session' });
    type(pad, '123456');
    await sender.answer({ alert_id: 'A3', decision: 'reject', method: 'in_person', answerer_staff_id: 'S-SANA' }, pad);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://hub.local/commands/answer-request');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer dev-tok',
      'X-Session-Token': 'sess-1',
      'Content-Type': 'application/json',
    });
    const bodies = fetch.mock.calls.map((c) => JSON.parse(String(c[1]?.body)) as Record<string, unknown>);
    expect(bodies[0]).toEqual({
      command_id: 'CMD1',
      tenant_id: 'T1',
      branch_id: 'B1',
      command_type: 'AnswerRequest',
      payload: { alert_id: 'A1', decision: 'approve', method: 'pin', pin: '4711' },
      occurred_at: 1_000,
      actor_id: 'S-IMRAN',
      device_id: 'D1',
    });
    expect(bodies[1]).toMatchObject({ command_id: 'CMD2', payload: { alert_id: 'A2', decision: 'accept', method: 'session' } });
    expect(bodies[2]).toMatchObject({
      command_id: 'CMD3',
      payload: { alert_id: 'A3', decision: 'reject', method: 'in_person', answerer_staff_id: 'S-SANA', pin: '123456' },
    });
    noStorageWrites();
  });

  it('[01d §9, §8.1] a hub error clears the PIN and gives the §8.1 / brief §6 text', async () => {
    const link = fakeLink(true);
    const pad = createPinPad(link);
    const replies = [
      reply(401, { error: { code: 'PIN_INVALID', message: 'x', details: {} } }),
      reply(409, {
        error: { code: 'REQUEST_NOT_PENDING', message: 'x', details: { close_reason: 'answered', decision: 'approve', answered_by_name: 'Sana' } },
      }),
      reply(403, { error: { code: 'PERMISSION_DENIED', message: 'x', details: { reason: 'out_of_range' } } }),
      reply(500, 'not json'),
    ];
    const fetch = vi.fn(async () => replies.shift()!);
    const sender = createAnswerSender({ link, context: () => CTX, fetch });
    const texts: string[] = [];
    for (let i = 0; i < 4; i++) {
      type(pad, '4711');
      const out = await sender.answer({ alert_id: 'A1', decision: 'approve', method: 'pin' }, pad);
      expect(out.ok).toBe(false);
      if (!out.ok) texts.push(out.message);
      expect(pad.length()).toBe(0);
    }
    expect(texts).toEqual([
      'Wrong PIN.',
      'Already approved by Sana.',
      'Not your team — a manager can approve.',
      'Something went wrong. Try again.',
    ]);
    noStorageWrites();
  });

  it('[01d §6.2] a PIN outside 4–6 digits or a missing session never leaves the device', async () => {
    const link = fakeLink(true);
    const pad = createPinPad(link);
    const fetch = vi.fn(async () => OK);
    let ctx: AnswerContext | null = CTX;
    const sender = createAnswerSender({ link, context: () => ctx, fetch });
    type(pad, '471');
    const short = await sender.answer({ alert_id: 'A1', decision: 'approve', method: 'pin' }, pad);
    expect(short).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(pad.length()).toBe(0);
    type(pad, '1234567');
    expect(pad.length()).toBe(6); // the pad holds at most 6 digits
    pad.press('x');
    expect(pad.length()).toBe(6);
    pad.back();
    expect(pad.length()).toBe(5);
    ctx = null;
    const signedOut = await sender.answer({ alert_id: 'A1', decision: 'approve', method: 'pin' }, pad);
    expect(signedOut).toMatchObject({ ok: false, code: 'SESSION_INVALID' });
    expect(pad.length()).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('[01d #56 client] a double tap while an answer is in flight sends nothing more (no second PIN guess)', async () => {
    const link = fakeLink(true);
    const pad = createPinPad(link);
    let release!: (r: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((r) => (release = r)));
    const sender = createAnswerSender({ link, context: () => CTX, fetch });
    type(pad, '4711');
    const first = sender.answer({ alert_id: 'A1', decision: 'approve', method: 'pin' }, pad);
    const second = await sender.answer({ alert_id: 'A1', decision: 'approve', method: 'pin' }, pad);
    expect(second).toMatchObject({ ok: false, code: 'IN_FLIGHT' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(pad.busy()).toBe(true); // the second call does not release the first one's pad
    release(reply(401, { error: { code: 'PIN_INVALID', message: 'x', details: {} } }));
    expect(await first).toMatchObject({ ok: false, code: 'PIN_INVALID' });
    expect(pad.length()).toBe(0);
    expect(pad.busy()).toBe(false);
  });
});

