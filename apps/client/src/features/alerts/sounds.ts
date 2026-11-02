import type { AlertFamily } from '@pos/domain';
import type { RequestOutcome } from '@pos/events';

// 01d §8.3 (G0-2, G1-14) and the design hand-off CHANGES §4 (DQ6): Web Audio tones, no audio files, no
// dependency. Volume follows the device; no mute, no snooze. At most five sounds in total (G0-2).

export type SoundName = 'urgent' | 'action' | 'info' | 'rising' | 'falling';

/** One sine note: start offset, length, envelope (gain 0 → peak in attack_ms, back to 0 over release_ms). */
export interface Note {
  hz: number;
  /** a glide: the frequency ramps to this by the note's end */
  to_hz?: number;
  at_ms: number;
  dur_ms: number;
  attack_ms: number;
  release_ms: number;
}

const ENV = { attack_ms: 10, release_ms: 120 } as const;

/** CHANGES §4, exactly. */
export const SOUND_RECIPES: Readonly<Record<SoundName, readonly Note[]>> = Object.freeze({
  // 660 Hz 150 ms, 40 ms gap, 880 Hz 220 ms (two-tone rising)
  urgent: [
    { hz: 660, at_ms: 0, dur_ms: 150, ...ENV },
    { hz: 880, at_ms: 190, dur_ms: 220, ...ENV },
  ],
  // 784 Hz 120 ms, 80 ms gap, 784 Hz 120 ms (bright double ding)
  action: [
    { hz: 784, at_ms: 0, dur_ms: 120, ...ENV },
    { hz: 784, at_ms: 200, dur_ms: 120, ...ENV },
  ],
  // 523 Hz 300 ms, soft attack of 30 ms (single soft chime)
  info: [{ hz: 523, at_ms: 0, dur_ms: 300, attack_ms: 30, release_ms: 120 }],
  // request_result approved / rejected (G0-2, AD-82): 523 ↔ 784 Hz glide over 260 ms
  rising: [{ hz: 523, to_hz: 784, at_ms: 0, dur_ms: 260, ...ENV }],
  falling: [{ hz: 784, to_hz: 523, at_ms: 0, dur_ms: 260, ...ENV }],
});

/** CHANGES §4: the peak gain; the escalation step raises it by one step (G1-14c). */
export const BASE_GAIN = 0.6;
export const STEP_UP_GAIN = 0.8;

/** Where sounds go. Injected, so tests use a recording fake. */
export interface AudioSink {
  play(sound: SoundName, gain: number): void;
}

/** §8.1 / §8.3: the family's sound; none for a silent kind; a request_result by its outcome (brief N04). */
export function soundFor(a: {
  kind: string;
  family: AlertFamily;
  silent?: boolean | undefined;
  outcome?: RequestOutcome | null | undefined;
}): SoundName | null {
  if (a.silent === true) return null;
  if (a.kind === 'request_result') {
    if (a.outcome === 'approved') return 'rising';
    if (a.outcome === 'rejected') return 'falling';
    if (a.outcome === 'withdrawn') return null; // the requester withdrew it here: no sound (brief N04)
    return 'info';
  }
  return a.family;
}

// The part of the Web Audio API the sink uses (AudioContext satisfies it).
interface Param {
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
}
export interface ToneContext {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  createOscillator(): {
    type: string;
    frequency: Param;
    connect(node: never): unknown;
    start(when: number): void;
    stop(when: number): void;
  };
  createGain(): { gain: Param; connect(node: never): unknown };
}

/**
 * The browser sink. `getContext` returns the page's one AudioContext (created lazily by the caller, as
 * browsers allow audio only after a user gesture), or null where there is none: then nothing plays.
 */
export function webAudioSink(getContext: () => ToneContext | null): AudioSink {
  return {
    play(sound, gain) {
      const ctx = getContext();
      if (ctx === null) return;
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      const t0 = ctx.currentTime;
      for (const note of SOUND_RECIPES[sound]) {
        const start = t0 + note.at_ms / 1000;
        const end = start + note.dur_ms / 1000;
        const osc = ctx.createOscillator();
        const amp = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(note.hz, start);
        if (note.to_hz !== undefined) osc.frequency.linearRampToValueAtTime(note.to_hz, end);
        amp.gain.setValueAtTime(0, start);
        amp.gain.linearRampToValueAtTime(gain, start + note.attack_ms / 1000);
        amp.gain.setValueAtTime(gain, start + Math.max(note.attack_ms, note.dur_ms - note.release_ms) / 1000);
        amp.gain.linearRampToValueAtTime(0, end);
        osc.connect(amp as never);
        amp.connect(ctx.destination as never);
        osc.start(start);
        osc.stop(end);
      }
    },
  };
}
