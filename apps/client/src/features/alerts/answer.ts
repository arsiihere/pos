import { AnswerRequestPayload } from '@pos/events';
import { newUlid } from '../../app/ulid';
import { answerErrorText } from './labels';

// 01d §8.1, §6.2; 00 v1.6 §8.5 H-10: AnswerRequest is online-only by construction (AD-2). It is never queued and
// never written to IndexedDB, localStorage or sessionStorage. The PIN lives only in the pad's memory: typing
// is refused while the hub socket is down (B03), a socket drop clears it, and it is cleared after every
// response, error included; on a network error the person types it again. There is no retry.

/** The hub socket's state (the alert connection, socket.ts). */
export interface HubLink {
  isUp(): boolean;
  subscribe(listener: () => void): () => void;
}

/** Who sends: the device and session tokens, and the F §6.3 envelope fields. In memory only. */
export interface AnswerContext {
  deviceToken: string;
  sessionToken: string;
  tenantId: string;
  branchId: string;
  deviceId: string;
  staffId: string;
}

export const PIN_MIN = 4;
export const PIN_MAX = 6;

export interface PinPad {
  press(digit: string): void;
  back(): void;
  clear(): void;
  /** the number of digits typed (for the masked dots); the digits themselves are never exposed */
  length(): number;
  /** B03: the socket is down, or an answer is in flight */
  disabled(): boolean;
  busy(): boolean;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

// The sender reads the digits through this module-private table, so no UI code can read the PIN back.
const secrets = new WeakMap<PinPad, { take(): string; setBusy(busy: boolean): void }>();

export function createPinPad(link: HubLink): PinPad {
  let digits = '';
  let busy = false;
  const listeners = new Set<() => void>();
  const changed = (): void => {
    for (const fn of [...listeners]) fn();
  };
  const clear = (): void => {
    if (digits === '') return;
    digits = '';
    changed();
  };
  // B03: "the typed PIN is cleared" when the socket goes down; the pad comes back by itself on reconnect
  const unlink = link.subscribe(() => {
    if (!link.isUp()) digits = '';
    changed();
  });
  const pad: PinPad = {
    press(digit) {
      if (pad.disabled() || !/^\d$/.test(digit) || digits.length >= PIN_MAX) return;
      digits += digit;
      changed();
    },
    back() {
      if (pad.disabled() || digits === '') return;
      digits = digits.slice(0, -1);
      changed();
    },
    clear,
    length: () => digits.length,
    disabled: () => busy || !link.isUp(),
    busy: () => busy,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose() {
      digits = '';
      unlink();
      listeners.clear();
    },
  };
  secrets.set(pad, {
    take: () => digits,
    setBusy(next) {
      busy = next;
      changed();
    },
  });
  return pad;
}

export type AnswerInput =
  | { alert_id: string; decision: AnswerRequestPayload['decision']; method: 'session' }
  | { alert_id: string; decision: AnswerRequestPayload['decision']; method: 'pin' }
  | { alert_id: string; decision: AnswerRequestPayload['decision']; method: 'in_person'; answerer_staff_id: string };

/** §6.2 Result */
export interface AnswerResult {
  alert_id: string;
  decision: AnswerRequestPayload['decision'];
  answered_at: number;
}

export type AnswerOutcome =
  | { ok: true; result: AnswerResult }
  | { ok: false; code: string; details: Record<string, unknown>; message: string };

export interface AnswerSenderDeps {
  link: HubLink;
  /** null when no staff session is signed in */
  context: () => AnswerContext | null;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  baseUrl?: string;
  newCommandId?: () => string;
  now?: () => number;
}

export interface AnswerSender {
  /** B03: answering is possible only while the hub socket is up */
  canSend(): boolean;
  /**
   * `pin` / `in_person` read the PIN from `pad`; the pad is cleared when this resolves, whatever the outcome.
   * While an answer is in flight, another call returns `IN_FLIGHT` at once and sends nothing (the UI ignores it).
   */
  answer(input: AnswerInput, pad?: PinPad, request?: { requester_name?: string | null }): Promise<AnswerOutcome>;
}

function failure(code: string, details: Record<string, unknown> = {}, request: { requester_name?: string | null } = {}): AnswerOutcome {
  return { ok: false, code, details, message: answerErrorText(code, details, request) };
}

export function createAnswerSender(deps: AnswerSenderDeps): AnswerSender {
  const fetchFn = deps.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const base = deps.baseUrl ?? '';
  const newCommandId = deps.newCommandId ?? (() => newUlid());
  const now = deps.now ?? (() => Date.now());
  let inFlight = false;

  async function post(body: unknown, ctx: AnswerContext): Promise<{ status: number; body: unknown } | null> {
    try {
      const response = await fetchFn(`${base}/commands/answer-request`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ctx.deviceToken}`,
          'X-Session-Token': ctx.sessionToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      return { status: response.status, body: parsed };
    } catch {
      return null;
    }
  }

  async function send(input: AnswerInput, pin: string | undefined, request: { requester_name?: string | null }): Promise<AnswerOutcome> {
    // H-10: never sent while the socket is down, and never kept for later
    if (!deps.link.isUp()) return failure('NETWORK');
    const ctx = deps.context();
    if (ctx === null) return failure('SESSION_INVALID');
    const payload = AnswerRequestPayload.safeParse(input.method === 'session' ? input : { ...input, pin });
    if (!payload.success) return failure('VALIDATION_FAILED');
    const reply = await post(
      {
        command_id: newCommandId(), // fresh per send: a PIN answer is never retried with a stored id
        tenant_id: ctx.tenantId,
        branch_id: ctx.branchId,
        command_type: 'AnswerRequest',
        payload: payload.data,
        occurred_at: now(),
        actor_id: ctx.staffId,
        device_id: ctx.deviceId,
      },
      ctx,
    );
    if (reply === null) return failure('NETWORK', {}, request);
    if (reply.status >= 200 && reply.status < 300) {
      const result = (reply.body as { data?: { result?: AnswerResult } } | null)?.data?.result;
      if (result !== undefined) return { ok: true, result };
      return failure('INTERNAL_ERROR');
    }
    const error = (reply.body as { error?: { code?: unknown; details?: unknown } } | null)?.error;
    const code = typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR';
    const details = typeof error?.details === 'object' && error.details !== null ? (error.details as Record<string, unknown>) : {};
    return failure(code, details, request);
  }

  return {
    canSend: () => deps.link.isUp(),

    async answer(input, pad, request = {}) {
      // a double tap while an answer is in flight sends nothing: a second PIN guess must never be counted
      if (inFlight) return { ok: false, code: 'IN_FLIGHT', details: {}, message: answerErrorText('SERVICE_UNAVAILABLE', {}) };
      inFlight = true;
      const secret = pad === undefined ? undefined : secrets.get(pad);
      const pin = input.method === 'session' || secret === undefined ? undefined : secret.take();
      secret?.setBusy(true);
      try {
        return await send(input, pin === '' ? undefined : pin, request);
      } finally {
        inFlight = false;
        // §8.1: the PIN is discarded once the response arrives (or fails), also on an error
        secret?.setBusy(false);
        pad?.clear();
      }
    },
  };
}
