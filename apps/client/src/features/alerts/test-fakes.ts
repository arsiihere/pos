import type { AlertView } from '@pos/events';
import type { AudioSink, SoundName } from './sounds';
import type { Timers } from './store';

// Test helpers for the alert store: a manual clock with timers, and a sink that records every sound.

export interface FakeTimers extends Timers {
  now(): number;
  advance(ms: number): void;
  pending(): number;
}

export function fakeTimers(): FakeTimers {
  let now = 0;
  let nextId = 1;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      due.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      due.delete(handle as number);
    },
    now: () => now,
    pending: () => due.size,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let first: [number, { at: number; fn: () => void }] | undefined;
        for (const entry of due) if (entry[1].at <= end && (first === undefined || entry[1].at < first[1].at)) first = entry;
        if (first === undefined) break;
        due.delete(first[0]);
        now = first[1].at;
        first[1].fn();
      }
      now = end;
    },
  };
}

export interface Played {
  sound: SoundName;
  gain: number;
  at: number;
}

export function recordingSink(timers: FakeTimers): AudioSink & { played: Played[] } {
  const played: Played[] = [];
  return {
    played,
    play(sound, gain) {
      played.push({ sound, gain, at: timers.now() });
    },
  };
}

export function view(over: Partial<AlertView> & { alert_id: string }): AlertView {
  return {
    kind: 'void_approval',
    family: 'urgent',
    step: 0,
    escalation: false,
    set: 'answerer',
    for_staff_id: null,
    lock: { kind_label_key: 'alert.void_approval.lock', table_code: '12', point_code: null, requester_name: 'Hamza' },
    raised_at: 0,
    ...over,
  };
}
