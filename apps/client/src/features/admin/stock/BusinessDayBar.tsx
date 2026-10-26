import { useState } from 'react';
import { hubDayText, hubTimeText, type HubClock } from '../../../app/hub-clock';
import { BusyButton } from '../../../components/BusyButton';
import { Chip } from '../../../components/Chip';
import { Dialog } from '../../../components/Dialog';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';

export interface BusinessDay {
  business_date: string;
  opened_at: number;
  closed_at: number | null;
}

// §8.2, S33 (01a-B11): the app bar's day chip, "Day open: Sat 24 Oct since 09:12 (15 h)" or "Day closed
// at 01:10". Its tone comes from the day's age, not its date (review 2 nit 5).
export function DayChip({ day, clock, staleAfterHours }: { day: BusinessDay | null; clock: HubClock; staleAfterHours: number }) {
  if (day === null) return null;
  const offset = clock.utcOffsetMs;
  if (day.closed_at !== null) {
    return <Chip tone="info">{fill(t('admin_stock.day.closed'), { time: hubTimeText(day.closed_at, offset) })}</Chip>;
  }
  const ageMs = clock.nowMs() - day.opened_at;
  const hours = Math.max(0, Math.floor(ageMs / 3_600_000));
  return (
    <Chip tone={ageMs > staleAfterHours * 3_600_000 ? 'warn' : 'ok'}>
      {fill(t('admin_stock.day.open'), {
        day: hubDayText(day.opened_at, offset),
        time: hubTimeText(day.opened_at, offset),
        hours: String(hours),
      })}
    </Chip>
  );
}

// 01a-D10: Close day asks first, with what the close means for the counts (§8.2's text) and a summary.
export function CloseDayButton({
  day,
  clock,
  busy,
  keepsOvernight,
  switchedOff,
  onClose,
}: {
  day: BusinessDay;
  clock: HubClock;
  busy: boolean;
  keepsOvernight: readonly string[];
  switchedOff: readonly string[];
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const offset = clock.utcOffsetMs;
  return (
    <>
      <BusyButton busy={busy} onClick={() => setConfirming(true)}>
        {t('admin_stock.day.close')}
      </BusyButton>
      {confirming && (
        <Dialog
          title={t('admin_stock.day.close_title')}
          onClose={() => setConfirming(false)}
          footer={
            <>
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
            </>
          }
        >
          <p className="pos-dialog__body">{t('admin_stock.day.close_confirm')}</p>
          <ul className="pos-list pos-list--stack">
            <li className="pos-list__row">
              <span className="pos-list__name">
                <strong>{t('admin_stock.day.started')}</strong>
                <span className="pos-ltr">{`${hubDayText(day.opened_at, offset)}, ${hubTimeText(day.opened_at, offset)}`}</span>
              </span>
            </li>
            <li className="pos-list__row">
              <span className="pos-list__name">
                <strong>{t('admin_stock.day.keeps_overnight')}</strong>
                <span>{keepsOvernight.length === 0 ? '–' : keepsOvernight.join(', ')}</span>
              </span>
            </li>
            <li className="pos-list__row">
              <span className="pos-list__name">
                <strong>{t('admin_stock.day.switched_off')}</strong>
                <span>{switchedOff.length === 0 ? '–' : switchedOff.join(', ')}</span>
              </span>
            </li>
          </ul>
        </Dialog>
      )}
    </>
  );
}
