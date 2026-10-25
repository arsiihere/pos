import { useState } from 'react';
import { hubDayText, hubTimeText, type HubClock } from '../../../app/hub-clock';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';

export interface BusinessDay {
  business_date: string;
  opened_at: number;
  closed_at: number | null;
}

// §8.2, S33: "Day open: Sat 24 Oct since 09:12 (15 h)" or "Day closed at 01:10". The line's tone comes
// from the day's age, not its date (review 2 nit 5). Close day asks for confirmation first.
export function BusinessDayBar({
  day,
  clock,
  staleAfterHours,
  busy,
  onClose,
}: {
  day: BusinessDay | null;
  clock: HubClock;
  staleAfterHours: number;
  busy: boolean;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (day === null) return null;
  const offset = clock.utcOffsetMs;

  if (day.closed_at !== null) {
    return <Banner tone="info" text={fill(t('admin_stock.day.closed'), { time: hubTimeText(day.closed_at, offset) })} />;
  }

  const ageMs = clock.nowMs() - day.opened_at;
  const hours = Math.max(0, Math.floor(ageMs / 3_600_000));
  const text = fill(t('admin_stock.day.open'), {
    day: hubDayText(day.opened_at, offset),
    time: hubTimeText(day.opened_at, offset),
    hours: String(hours),
  });
  return (
    <div className="pos-row">
      <Banner tone={ageMs > staleAfterHours * 3_600_000 ? 'warn' : 'ok'} text={text} />
      <BusyButton busy={busy} onClick={() => setConfirming(true)}>
        {t('admin_stock.day.close')}
      </BusyButton>
      {confirming && (
        <div className="pos-scrim">
          <div className="pos-dialog" role="dialog" aria-modal="true" aria-labelledby="close-day-title">
            <h2 className="pos-dialog__title" id="close-day-title">
              {t('admin_stock.day.close')}
            </h2>
            <p className="pos-dialog__body">{t('admin_stock.day.close_confirm')}</p>
            <div className="pos-dialog__actions">
              <button type="button" className="pos-btn" onClick={() => setConfirming(false)}>
                {t('admin_stock.day.cancel')}
              </button>
              <button
                type="button"
                className="pos-btn pos-btn--danger"
                onClick={() => {
                  setConfirming(false);
                  onClose();
                }}
              >
                {t('admin_stock.day.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
