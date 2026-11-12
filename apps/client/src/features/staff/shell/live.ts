import type { WsServerMessage } from '@pos/events';

// 02a §8 Table map (Q-5), 02b §8 (W0.6): the staff page's live bus. The alert socket hands every `catch_up` and
// `event` frame here (`createAlertConnection({ onFrame })`); the bus passes them on in seq order — an event at or
// below the last seq seen (the catch-up's as_of_seq, or an earlier event) is dropped — and publishes a socket
// reconnect (up again after a drop) and `visibilitychange` → visible, the two refetch triggers besides frames.

type CatchUpFrame = Extract<WsServerMessage, { type: 'catch_up' }>;
type EventFrame = Extract<WsServerMessage, { type: 'event' }>;

export type LiveMessage =
  | { kind: 'catch_up'; as_of_seq: number; state: CatchUpFrame['state'] }
  | { kind: 'event'; seq: number; event: EventFrame['event'] }
  | { kind: 'reconnect' }
  | { kind: 'visible' };

export interface LiveBus {
  /** the socket's frames (onFrame); other frame types are ignored */
  frame(frame: WsServerMessage): void;
  /** the socket's up / down state; up again after a drop publishes `reconnect` */
  connection(up: boolean): void;
  /** called on visibilitychange; publishes `visible` when the page became visible */
  visibility(state: DocumentVisibilityState): void;
  /** the last catch-up part by name (`tables`, `orders`, `stock`, …), for a subscriber that mounts later */
  part(name: string): unknown;
  lastSeq(): number;
  subscribe(listener: (message: LiveMessage) => void): () => void;
}

export function createLiveBus(): LiveBus {
  const listeners = new Set<(message: LiveMessage) => void>();
  let lastSeq = -1;
  let parts: Record<string, unknown> = {};
  let wasUp = false;
  let wentDown = false;
  const publish = (message: LiveMessage) => {
    for (const l of [...listeners]) l(message);
  };
  return {
    frame(frame) {
      if (frame.type === 'catch_up') {
        lastSeq = frame.as_of_seq;
        parts = { ...frame.state };
        publish({ kind: 'catch_up', as_of_seq: frame.as_of_seq, state: frame.state });
      } else if (frame.type === 'event') {
        if (frame.seq <= lastSeq) return;
        lastSeq = frame.seq;
        publish({ kind: 'event', seq: frame.seq, event: frame.event });
      }
    },
    connection(up) {
      if (!up) {
        if (wasUp) wentDown = true;
        return;
      }
      const again = wentDown;
      wasUp = true;
      wentDown = false;
      if (again) publish({ kind: 'reconnect' });
    },
    visibility(state) {
      if (state === 'visible') publish({ kind: 'visible' });
    },
    part: (name) => parts[name],
    lastSeq: () => lastSeq,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
