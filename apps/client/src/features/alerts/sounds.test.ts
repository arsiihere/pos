import { describe, expect, it } from 'vitest';
import { BASE_GAIN, SOUND_RECIPES, STEP_UP_GAIN, soundFor, webAudioSink, type ToneContext } from './sounds';

// A Web Audio stand-in: records every oscillator and every gain / frequency automation.
function fakeContext() {
  const log: string[] = [];
  const param = (name: string) => ({
    setValueAtTime: (v: number, t: number) => void log.push(`${name} set ${v} @${Math.round(t * 1000)}`),
    linearRampToValueAtTime: (v: number, t: number) => void log.push(`${name} ramp ${v} @${Math.round(t * 1000)}`),
  });
  let resumed = 0;
  const ctx: ToneContext = {
    currentTime: 1,
    state: 'suspended',
    destination: {},
    resume: () => {
      resumed++;
      return Promise.resolve();
    },
    createOscillator: () => ({
      type: 'square',
      frequency: param('hz'),
      connect: () => undefined,
      start: (t: number) => void log.push(`start @${Math.round(t * 1000)}`),
      stop: (t: number) => void log.push(`stop @${Math.round(t * 1000)}`),
    }),
    createGain: () => ({ gain: param('gain'), connect: () => undefined }),
  };
  return { ctx, log, resumed: () => resumed };
}

describe('[01d §8.3] sounds', () => {
  it('[01d §8.3] at most five sounds in total: urgent, action, info, rising, falling (G0-2)', () => {
    expect(Object.keys(SOUND_RECIPES).sort()).toEqual(['action', 'falling', 'info', 'rising', 'urgent']);
  });

  it('[01d §8.3] the CHANGES §4 recipes, exactly', () => {
    expect(SOUND_RECIPES.urgent).toEqual([
      { hz: 660, at_ms: 0, dur_ms: 150, attack_ms: 10, release_ms: 120 },
      { hz: 880, at_ms: 190, dur_ms: 220, attack_ms: 10, release_ms: 120 },
    ]);
    expect(SOUND_RECIPES.action).toEqual([
      { hz: 784, at_ms: 0, dur_ms: 120, attack_ms: 10, release_ms: 120 },
      { hz: 784, at_ms: 200, dur_ms: 120, attack_ms: 10, release_ms: 120 },
    ]);
    expect(SOUND_RECIPES.info).toEqual([{ hz: 523, at_ms: 0, dur_ms: 300, attack_ms: 30, release_ms: 120 }]);
    expect(SOUND_RECIPES.rising).toEqual([{ hz: 523, to_hz: 784, at_ms: 0, dur_ms: 260, attack_ms: 10, release_ms: 120 }]);
    expect(SOUND_RECIPES.falling).toEqual([{ hz: 784, to_hz: 523, at_ms: 0, dur_ms: 260, attack_ms: 10, release_ms: 120 }]);
    expect([BASE_GAIN, STEP_UP_GAIN]).toEqual([0.6, 0.8]);
  });

  it('[01d §8.3] the family picks the sound; a silent kind and a withdrawn result have none', () => {
    expect(soundFor({ kind: 'void_approval', family: 'urgent' })).toBe('urgent');
    expect(soundFor({ kind: 'ready_to_serve', family: 'action' })).toBe('action');
    expect(soundFor({ kind: 'test_alert', family: 'info' })).toBe('info');
    expect(soundFor({ kind: 'approval_receipt', family: 'info', silent: true })).toBeNull();
    expect(soundFor({ kind: 'request_result', family: 'info', outcome: 'approved' })).toBe('rising');
    expect(soundFor({ kind: 'request_result', family: 'info', outcome: 'rejected' })).toBe('falling');
    expect(soundFor({ kind: 'request_result', family: 'info', outcome: 'withdrawn' })).toBeNull();
    expect(soundFor({ kind: 'request_result', family: 'info', outcome: 'obsolete' })).toBe('info');
    expect(soundFor({ kind: 'request_result', family: 'info', outcome: null })).toBe('info');
  });

  it('[01d §8.3] the Web Audio sink plays sine tones with the recipe envelope, at the given gain', () => {
    const { ctx, log, resumed } = fakeContext();
    webAudioSink(() => ctx).play('urgent', STEP_UP_GAIN);
    expect(resumed()).toBe(1); // a suspended context (autoplay) is resumed
    expect(log).toEqual([
      'hz set 660 @1000',
      'gain set 0 @1000',
      'gain ramp 0.8 @1010',
      'gain set 0.8 @1030',
      'gain ramp 0 @1150',
      'start @1000',
      'stop @1150',
      'hz set 880 @1190',
      'gain set 0 @1190',
      'gain ramp 0.8 @1200',
      'gain set 0.8 @1290',
      'gain ramp 0 @1410',
      'start @1190',
      'stop @1410',
    ]);
  });

  it('[01d §8.3] a glide ramps the frequency; no audio context means no sound and no error', () => {
    const { ctx, log } = fakeContext();
    webAudioSink(() => ctx).play('falling', BASE_GAIN);
    expect(log).toContain('hz ramp 523 @1260');
    expect(() => webAudioSink(() => null).play('info', BASE_GAIN)).not.toThrow();
  });
});
