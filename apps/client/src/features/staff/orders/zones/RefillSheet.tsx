import { useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { CloseX, Dialog } from '../../../alerts/ui';

// 02b v1.0.11 §8 Zone stock screen, §3.10, §6.9 (frame ZoneRefill): "Add {item} to {zone}": a stepper and the new
// count, "→ 15". Refill moves stock from the store (AddZoneStock); the hub says when the store is short.

/** AddZoneStock quantity 1–500 (02b §3.10, §6.9). */
export const REFILL_MAX = 500;

/** The − / + stepper of the kit (`.step`): the number in an <output>. */
export function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <span className="step">
      <button type="button" aria-label={t('cart.less')} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <output className="num">{value}</output>
      <button type="button" aria-label={t('cart.more')} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </span>
  );
}

export interface RefillSheetProps {
  zone: string;
  item: string;
  /** the count now */
  now: number;
  sheet: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (quantity: number) => void;
}

export function RefillSheet({ zone, item, now, sheet, busy, onCancel, onConfirm }: RefillSheetProps) {
  const [n, setN] = useState(1);
  return (
    <Dialog sheet={sheet} labelledBy="zone-refill-title" onClose={onCancel}>
      <div className="dlg__h">
        <div className="dlg__t">
          <h2 id="zone-refill-title">{fill(t('zone.refill_title'), { item, zone })}</h2>
          <div className="ac__who">{fill(t('zone.now_store'), { n: String(now) })}</div>
        </div>
        <CloseX onClose={onCancel} />
      </div>
      <div className="qline">
        <b>{t('zone.add')}</b>
        <Stepper value={n} min={1} max={REFILL_MAX} onChange={setN} />
        <span className="pv">
          <strong className="num">→ {now + n}</strong>
        </span>
      </div>
      <div className="acts">
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => onConfirm(n)}>
          {t('zone.refill')}
        </button>
      </div>
    </Dialog>
  );
}
