import { useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { CloseX, Dialog } from '../../../alerts/ui';
import { Stepper } from './RefillSheet';

/** SetZoneStock on_hand 0–5,000 (02b §3.10, §6.10). */
export const COUNT_MAX = 5_000;

// 02b v1.0.11 §8 Zone stock screen, §3.10, §6.10: Count (= n) sets what is physically there (SetZoneStock). It does
// not touch the store's stock; it fixes the zone's own count.

export interface CountSheetProps {
  zone: string;
  item: string;
  /** the count now */
  now: number;
  sheet: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (onHand: number) => void;
}

export function CountSheet({ zone, item, now, sheet, busy, onCancel, onConfirm }: CountSheetProps) {
  const [n, setN] = useState(Math.min(now, COUNT_MAX));
  return (
    <Dialog sheet={sheet} labelledBy="zone-count-title" onClose={onCancel}>
      <div className="dlg__h">
        <div className="dlg__t">
          <h2 id="zone-count-title">{fill(t('zone.count_title'), { item, zone })}</h2>
          <div className="ac__who">{fill(t('zone.now_count'), { n: String(now) })}</div>
        </div>
        <CloseX onClose={onCancel} />
      </div>
      <div className="qline">
        <b>{t('zone.counted_is')}</b>
        <Stepper value={n} min={0} max={COUNT_MAX} onChange={setN} />
        <span className="pv">
          <strong className="num">= {n}</strong>
        </span>
      </div>
      <div className="acts">
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => onConfirm(n)}>
          {t('zone.count')}
        </button>
      </div>
    </Dialog>
  );
}
