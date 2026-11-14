import { useEffect, useRef, useState } from 'react';
import { BASE_GAIN, type AudioSink } from '../../alerts/sounds';
import { t } from '../../../i18n';
import { Glyph } from './StationRow';

// 03b §3.8, 03b-D02, handoff Q-17: the station's sound volume 0–100. The value is saved (SetStationScreen) when the
// slider is let go (pointer up, key up, blur) and differs from the stored one; "Play on this device" plays the KDS
// chime here only, at the value shown. S35 d: a native range input (the frame's track fill is an inline style).
export const VOLUME_STEP = 5;

/** The KDS chime (01d sounds, K5): the soft `info` tone at the station's volume. */
export function playChime(sink: AudioSink, volume: number): void {
  sink.play('info', BASE_GAIN * (volume / 100));
}

export function VolumeControl({
  stationName,
  volume,
  disabled,
  sink,
  onSave,
}: {
  stationName: string;
  volume: number;
  disabled: boolean;
  sink: AudioSink;
  onSave: (volume: number) => void;
}) {
  const [value, setValue] = useState(volume);
  // The value last sent, so key up and the blur after it save once.
  const sent = useRef<number | null>(null);
  useEffect(() => {
    setValue(volume);
    sent.current = null;
  }, [volume]);

  const commit = () => {
    if (value === volume || value === sent.current) return;
    sent.current = value;
    onSave(value);
  };

  return (
    <div className="vol">
      <span className="vol__l">
        <Glyph name="volume" />
        {t('kitchen_screens.volume')}
      </span>
      <input
        type="range"
        className="vol__t"
        min={0}
        max={100}
        step={VOLUME_STEP}
        value={value}
        disabled={disabled}
        aria-label={`${t('kitchen_screens.volume')} · ${stationName}`}
        onChange={(e) => setValue(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="vol__v">{value}</span>
      <button type="button" className="pos-btn" onClick={() => playChime(sink, value)}>
        <Glyph name="play" />
        {t('kitchen_screens.play')}
      </button>
    </div>
  );
}
