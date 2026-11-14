import { BASE_GAIN, STEP_UP_GAIN, type AudioSink, type SoundName, type ToneContext } from '../../alerts/sounds';
import { isReturn, ON_TOP } from '../station/MarkTag';
import type { KdsView } from '../store';

// 03b v1.0.8 §3.8, §8 (sounds per P7), E3-KDS AC5 (K5): a line that enters Now live plays the chime; a RETURN /
// BOOST / EXPEDITE line the strong sound. Both at the station's `sound_volume` (0–100, set on the hub admin page;
// `StationScreenSet` changes it live, Q-44 — the next sound uses the new value). No mute and no volume control on
// the KDS. The tones are 01d's (alerts/sounds.ts, read only): chime = `info`, strong = `urgent`; one sound per frame
// (the strongest), never for the lines a catch-up brings (they are not new to the kitchen).

export const CHIME: SoundName = 'info';
export const STRONG: SoundName = 'urgent';

/** proposed AD: the 01d peak gains scaled by the station volume (100 = 01d's level, 0 = silent) */
export function gainFor(volume: number, strong: boolean): number {
  const v = Math.max(0, Math.min(100, volume)) / 100;
  return (strong ? STEP_UP_GAIN : BASE_GAIN) * v;
}

/**
 * Watches the store's views; plays once per view that brought lines into Now live (`arrived_at` gained ids). A
 * catch-up empties `arrived_at`, so it never sounds.
 */
export function createKdsSound(sink: AudioSink) {
  let heard = new Set<string>();
  return {
    onView(view: KdsView): void {
      if (view.station === null) return;
      const fresh = [...view.arrived_at.keys()].filter((id) => !heard.has(id));
      heard = new Set(view.arrived_at.keys());
      if (fresh.length === 0) return;
      const rows = view.rows.filter((r) => fresh.includes(r.order_item_id) && r.stage !== 'done');
      if (rows.length === 0) return;
      const strong = rows.some((r) => isReturn(r.mark, r.detail) || (r.mark !== null && ON_TOP.has(r.mark)));
      const volume = view.station.sound_volume;
      if (volume <= 0) return;
      sink.play(strong ? STRONG : CHIME, gainFor(volume, strong));
    },
  };
}

let audio: AudioContext | null = null;

/** the page's one AudioContext (browsers allow sound only after a tap; TapForSound resumes it) */
export function kdsAudio(): ToneContext | null {
  try {
    audio ??= new AudioContext();
    return audio as unknown as ToneContext;
  } catch {
    return null;
  }
}
