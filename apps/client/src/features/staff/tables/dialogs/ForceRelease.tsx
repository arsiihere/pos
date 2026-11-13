import { useRef, useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import type { HubError } from '../../../../api/hub-admin';
import { useShell } from '../../shell/hooks';
import type { SeatingRef } from '../contracts';
import { FORCE_RELEASE_REASONS, REASON_MAX, encodeReason, reasonLabel, type ReasonToken } from '../sheet/reasons';
import { DialogFrame } from './TableBusy';

// 02a §8 Open, §6.4 (02-D12 ForceRelease): `ForceReleaseTableLock { table_id, seating_id, reason }` with a required
// reason chip and an optional note, sent as `<token>` or `<token>: <note>` cut to 120 (Q-18). Anything the old
// holder has not sent stays on his device (§3.3).

export interface ForceReleaseProps {
  code: string;
  /** the lock holder's name */
  name: string;
  /** the seating the dialog opened on (sent as it is: a change answers 409 TABLE_SEATING_CHANGED) */
  seating: SeatingRef;
  onClose(): void;
  onReleased(released: boolean): void;
  onFailed(error: HubError): void;
}

export function ForceRelease({ code, name, seating, onClose, onReleased, onFailed }: ForceReleaseProps) {
  const { tables } = useShell();
  const [token, setToken] = useState<ReasonToken | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);

  async function release(): Promise<void> {
    if (token === null || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    const answer = await tables.forceReleaseTableLock({ ...seating, reason: encodeReason(token, note) });
    inflight.current = false;
    setBusy(false);
    if (answer.ok) onReleased(answer.data.released);
    else onFailed(answer.error);
  }

  return (
    <DialogFrame code={code} title={fill(t('release.title'), { name, table: code })} onClose={onClose}>
      <p className="dlg__line">{t('release.body')}</p>
      <div className="fld" role="group" aria-label={t('release.reason')}>
        <span className="fld__l">
          {t('release.reason')}
          <small>{t('release.required')}</small>
        </span>
        <div className="chips">
          {FORCE_RELEASE_REASONS.map((r) => (
            <button key={r} type="button" className="chip" aria-pressed={token === r} onClick={() => setToken(r)}>
              {reasonLabel(r)}
            </button>
          ))}
        </div>
      </div>
      <label className="fld">
        <span className="fld__l">
          {t('release.note')}
          <span className="cntr num">
            {note.length}/{REASON_MAX}
          </span>
        </span>
        <input
          className="inp"
          dir="auto"
          value={note}
          maxLength={REASON_MAX}
          placeholder={t('release.note_hint')}
          onChange={(e) => setNote(e.target.value.slice(0, REASON_MAX))}
        />
      </label>
      <div className="acts">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--danger" disabled={token === null || busy} onClick={() => void release()}>
          {t('release.go')}
        </button>
      </div>
    </DialogFrame>
  );
}
