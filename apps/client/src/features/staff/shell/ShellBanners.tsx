import { t } from '../../../i18n';
import { Ico } from '../../alerts/ui';
import type { DayOpen } from '../orders/order-screen/day-open';
import { StartDay, type StartDayMode } from '../orders/order-screen/DayNotStarted';
import type { OwnShift } from './own-shift';

// 02b-TK A2 item 1 (frames ShellAnatomy "Day / shift banners (under the top bar, before the first item)", DayNotStarted;
// MAPPING TK-SH01, TK-SH03): the warn banners under the top bar on the takeaway screens, before the first item.
// - No open business day (catch-up `stock.business_day`, BusinessDay* frames: day-open.ts): "Day not started — …",
//   Start day (the hub admin page /admin/stock/, 02b Q-20) for a branch manage-stock holder, else "Ask the manager".
//   ⚠️ 02b v1.0.28 QR2-2 (BUG-9): a close-business-day holder's Start day sends OpenBusinessDay from the staff app.
// - A take-payment holder with no open shift (05 §6.16 → 404 SHIFT_NOT_FOUND): "No shift open — cash can’t be
//   taken" + Open my shift (#/shift). An unknown shift (not read, refused, offline) shows nothing.

export interface ShellBannersProps {
  day: DayOpen;
  startDay: StartDayMode;
  /** "Lake City · 7:04 AM", or null */
  place: string | null;
  /** null: not asked (no take-payment) */
  shift: OwnShift | null;
  /** null: no My shift screen for this person */
  onOpenShift: (() => void) | null;
}

export function ShellBanners({ day, startDay, place, shift, onOpenShift }: ShellBannersProps) {
  const dayBanner = day === 'closed';
  const shiftBanner = shift?.kind === 'none';
  if (!dayBanner && !shiftBanner) return null;
  return (
    <div className="tk-banners">
      {dayBanner && (
        <div className="tk-banner tk-banner--warn" role="status">
          <Ico name="warn" />
          <span>{t('shell.day.closed')}</span>
          {place !== null && <span className="muted">· {place}</span>}
          {startDay !== null ? (
            <StartDay mode={startDay} staffClass="tk-btn tk-btn--primary" linkClass="tk-btn tk-btn--primary" />
          ) : (
            <span className="tk-banner__ask">{t('shell.day.ask')}</span>
          )}
        </div>
      )}
      {shiftBanner && (
        <div className="tk-banner tk-banner--warn" role="status">
          <Ico name="cash" />
          <span>{t('shell.shift.closed')}</span>
          {onOpenShift !== null && (
            <button type="button" className="tk-btn tk-btn--primary" onClick={onOpenShift}>
              {t('shell.shift.open')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
