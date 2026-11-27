import type { Language } from '../../../../i18n';
import type { Cart, CartLine } from '../order-screen/cart';

export const DISPLAY_CHANNEL = 'pos-customer-display';
export const DISPLAY_ROUTE = '/customer-display';

interface DisplayLine {
  name: string;
  qty: number;
  line_minor: number | null;
}

export interface DisplayMessage {
  v: 1;
  kind: 'cart' | 'paid' | 'idle';
  lines: DisplayLine[];
  total_minor: number | null;
  ready_by_ms: number | null;
  change_minor?: number;
  lang: Language;
}

export function idleDisplay(lang: Language): DisplayMessage {
  return { v: 1, kind: 'idle', lines: [], total_minor: 0, ready_by_ms: null, lang };
}

/** The only fields taken from the draft are quantities and menu lookups for its lines. */
export function cartDisplay(
  cart: Cart,
  nameOf: (line: CartLine) => string,
  priceOf: (line: CartLine) => number | null,
  total: number | null,
  ready: number | null,
  lang: Language,
  quantityOf: (line: CartLine) => number = (line) => line.quantity ?? 1,
): DisplayMessage {
  if (cart.lines.length === 0) return idleDisplay(lang);
  return {
    v: 1,
    kind: 'cart',
    lines: cart.lines.map((line) => ({ name: nameOf(line), qty: quantityOf(line), line_minor: priceOf(line) })),
    total_minor: total,
    ready_by_ms: ready,
    lang,
  };
}

export function openDisplayChannel(): BroadcastChannel | null {
  try {
    return new BroadcastChannel(DISPLAY_CHANNEL);
  } catch {
    return null;
  }
}

const whole = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const amount = (value: unknown): value is number | null => value === null || whole(value);
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

function isLine(value: unknown): value is DisplayLine {
  return object(value) && keys(value, ['name', 'qty', 'line_minor']) &&
    typeof value['name'] === 'string' && whole(value['qty']) && value['qty'] > 0 && amount(value['line_minor']);
}

export function readDisplayMessage(value: unknown): DisplayMessage | null {
  if (!object(value) || !keys(value, ['v', 'kind', 'lines', 'total_minor', 'ready_by_ms', 'change_minor', 'lang'])) return null;
  const { v, kind, lines, total_minor, ready_by_ms, change_minor, lang } = value;
  if (v !== 1 || (lang !== 'en' && lang !== 'ur')) return null;
  if (kind !== 'idle' && kind !== 'cart' && kind !== 'paid') return null;
  if (!Array.isArray(lines) || !lines.every(isLine) || !amount(total_minor) || !amount(ready_by_ms)) return null;
  if (ready_by_ms !== null && ready_by_ms > 8.63e15) return null;
  if (kind === 'idle' && (lines.length !== 0 || total_minor !== 0 || ready_by_ms !== null)) return null;
  if (kind === 'cart' && lines.length === 0) return null;
  if (change_minor !== undefined && (kind !== 'paid' || !whole(change_minor))) return null;
  return { v, kind, lines, total_minor, ready_by_ms, lang, ...(change_minor === undefined ? {} : { change_minor }) };
}

/**
 * ⚠️ 02b-TK L-CLIENT-6b item 7 (QA BUG-11, frame CustomerDisplay; G-14): a display window that opens (or reloads)
 * after the cart was built asks for the current screen with this hello; the order screen's publisher answers with what
 * it last showed (or has pending), so the customer sees the cart at once, not only after the next change.
 */
export const DISPLAY_HELLO = { v: 1, hello: true } as const;

export function isDisplayHello(value: unknown): boolean {
  return object(value) && value['v'] === 1 && value['hello'] === true && keys(value, ['v', 'hello']);
}

/** Cart and ETA updates share a trailing send. Paid and idle supersede pending cart updates. */
export function createDisplayPublisher(initialLanguage: Language) {
  const channel = openDisplayChannel();
  let lang = initialLanguage;
  let pending: DisplayMessage | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSent: string | null = null;
  let last: DisplayMessage | null = null;

  function send(message: DisplayMessage, force = false) {
    const serialized = JSON.stringify(message);
    if (serialized === lastSent && !force) return;
    channel?.postMessage(message);
    lastSent = serialized;
    last = message;
  }
  channel?.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (!isDisplayHello(event.data)) return;
    const now = pending ?? last;
    if (now !== null) send(now, true);
  });

  function cancel() {
    clearTimeout(timer);
    timer = undefined;
    pending = null;
  }

  function publish(message: DisplayMessage) {
    if (channel === null) return;
    const safe = readDisplayMessage(message);
    if (safe === null) return;
    lang = safe.lang;
    if (safe.kind !== 'cart') {
      cancel();
      send(safe);
      return;
    }
    pending = safe;
    timer ??= setTimeout(() => {
      if (pending !== null) send(pending);
      cancel();
    }, 150);
  }

  return {
    publish,
    close() {
      publish(idleDisplay(lang));
      channel?.close();
    },
  };
}
