import { t } from '../../../i18n';
import { lockText, timeText } from '../../alerts/labels';
import type { ToneContext } from '../../alerts/sounds';
import type { AlertRow } from '../../alerts/store';
import { FamilyPill, Tag } from '../../alerts/ui';

// 03b §8 (K5; frame KdsLockSound): the browser blocks audio until a tap (autoplay policy): "Tap to turn on sound",
// shown once after load while the page's AudioContext is suspended (the caller checks soundBlocked once); the tap
// resumes it and the button goes for good.

/** the browser has not let this page play sound yet (autoplay policy) */
export function soundBlocked(audio: () => ToneContext | null): boolean {
  return audio()?.state === 'suspended';
}

export function TapForSound({ audio, onTurnedOn }: { audio: () => ToneContext | null; onTurnedOn: () => void }) {
  return (
    <button
      type="button"
      className="kbn kbn--solid kbn--sound"
      onClick={() => {
        void audio()?.resume().catch(() => undefined);
        onTurnedOn();
      }}
    >
      <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 9.5h4l5-4v13l-5-4H4z" />
        <path d="M16.5 8.5a5 5 0 0 1 0 7" />
      </svg>
      {t('kds.tap_for_sound')}
    </button>
  );
}

/**
 * 03b §8, 01d §8.1 (K5; frames KdsLockSound, AlertLockDark): the station socket's open alerts as 01d lock lines on
 * the dark KDS kit — family, lock text (never details), Escalated, time (12-hour hub time). No buttons: a station
 * session answers nothing.
 */
export function LockLines({ rows, utcOffsetMs }: { rows: readonly AlertRow[]; utcOffsetMs: number }) {
  const open = rows.filter((r) => r.state === 'open');
  if (open.length === 0) return null;
  return (
    <>
      {open.map((r) => (
        <div key={r.alert_id} className="lockp__r lockp__r--kds" role="status">
          <FamilyPill row={r} />
          <span>{lockText(r)}</span>
          {r.escalation && (
            <Tag tone="danger" icon="esc">
              {t('alerts.tag.escalated')}
            </Tag>
          )}
          <span className="ac__time num">{timeText(r.raised_at, utcOffsetMs)}</span>
        </div>
      ))}
    </>
  );
}
