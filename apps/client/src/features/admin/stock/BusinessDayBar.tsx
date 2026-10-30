import { hubDayText, hubTimeText, type HubClock } from '../../../app/hub-clock';
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
// Opened from the app bar's More menu (01a hand-off CHANGES §2, StockMore).
export function CloseDayDialog({
  day,
  clock,
  keepsOvernight,
  switchedOff,
  onClose,
  onCancel,
}: {
  day: BusinessDay;
  clock: HubClock;
  keepsOvernight: readonly string[];
  switchedOff: readonly string[];
  onClose: () => void;
  onCancel: () => void;
}) {
  const offset = clock.utcOffsetMs;
  return (
    <Dialog
      title={t('admin_stock.day.close_title')}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="pos-btn" onClick={onCancel}>
            {t('admin_stock.day.cancel')}
          </button>
          <button type="button" className="pos-btn pos-btn--danger" onClick={onClose}>
            {t('admin_stock.day.close')}
          </button>
        </>
      }
    >
      <p className="pos-dialog__body">{t('admin_stock.day.close_confirm')}</p>
      <ul className="pos-list pos-list--pairs">
        <li className="pos-list__row">
          <span>{t('admin_stock.day.started')}</span>
          <strong className="pos-ltr">{`${hubDayText(day.opened_at, offset)}, ${hubTimeText(day.opened_at, offset)}`}</strong>
        </li>
        <li className="pos-list__row">
          <span>{t('admin_stock.day.keeps_overnight')}</span>
          <strong>{keepsOvernight.length === 0 ? '–' : keepsOvernight.join(', ')}</strong>
        </li>
        <li className="pos-list__row">
          <span>{t('admin_stock.day.switched_off')}</span>
          <strong>{switchedOff.length === 0 ? '–' : switchedOff.join(', ')}</strong>
        </li>
      </ul>
    </Dialog>
  );
}
