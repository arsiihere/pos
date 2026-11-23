import type { MarkServedPayload } from '../contracts';

// 02b-TK C2-2 (02b v1.0.24 §3.7, §6.4; frame HandoverUndo; CHANGES §4 item 5): a hand-over (Hand over all, Give
// ready items now, the ready tile's Hand over) shows "48 handed over · Undo" for UNDO_MS and only then sends
// MarkServed. No undo command exists (§6.4): Undo = the command is never sent. The page going away (hidden,
// pagehide) or the screen closing sends every waiting hand-over at once, so a bag that left the counter is never
// left unserved. Only ids and counts are passed on (02b §7).

export const UNDO_MS = 5_000;

export interface Handover {
  id: string;
  /** the queue key of the token (`<business_date>:<token>`) */
  token_key: string;
  /** what the toast shows ("48") */
  ident: string;
  payload: MarkServedPayload;
}

export interface Handovers {
  start(h: Handover): void;
  /** Undo: drop it unsent; false when it was already sent */
  undo(id: string): boolean;
  pending(): Handover[];
  /** send every waiting hand-over now */
  flush(): void;
  subscribe(listener: () => void): () => void;
  version(): number;
  /** listen for the page hiding / going away; the returned stop (the screen closing) also flushes */
  attach(): () => void;
}

export function createHandovers(o: { send(h: Handover): void; delayMs?: number; target?: Pick<Window, 'addEventListener' | 'removeEventListener'>; doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> }): Handovers {
  const delay = o.delayMs ?? UNDO_MS;
  const win = o.target ?? window;
  const doc = o.doc ?? document;
  const waiting = new Map<string, { h: Handover; timer: ReturnType<typeof setTimeout> }>();
  const listeners = new Set<() => void>();
  let v = 0;
  const changed = () => {
    v += 1;
    for (const l of [...listeners]) l();
  };
  const fire = (id: string) => {
    const w = waiting.get(id);
    if (w === undefined) return;
    clearTimeout(w.timer);
    waiting.delete(id);
    changed();
    o.send(w.h);
  };
  const flush = () => {
    for (const id of [...waiting.keys()]) fire(id);
  };
  const onHidden = () => {
    if (doc.visibilityState === 'hidden') flush();
  };
  return {
    start(h) {
      waiting.set(h.id, { h, timer: setTimeout(() => fire(h.id), delay) });
      changed();
    },
    undo(id) {
      const w = waiting.get(id);
      if (w === undefined) return false;
      clearTimeout(w.timer);
      waiting.delete(id);
      changed();
      return true;
    },
    pending: () => [...waiting.values()].map((w) => w.h),
    flush,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    version: () => v,
    attach() {
      doc.addEventListener('visibilitychange', onHidden);
      win.addEventListener('pagehide', flush);
      return () => {
        doc.removeEventListener('visibilitychange', onHidden);
        win.removeEventListener('pagehide', flush);
        flush();
      };
    },
  };
}
