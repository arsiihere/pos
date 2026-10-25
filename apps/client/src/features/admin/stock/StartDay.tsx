import { BusyButton } from '../../../components/BusyButton';
import { t } from '../../../i18n';

// §8.2, S33: the large Start day action. `place` 'rows' sits above the stock rows whenever no day is
// open; 'retry' sits next to the save after a 409 BUSINESS_DAY_NOT_OPEN. One tap, no confirmation.
export function StartDay({
  place,
  busy,
  primary = true,
  onStart,
}: {
  place: 'rows' | 'retry';
  busy: boolean;
  primary?: boolean;
  onStart: () => void;
}) {
  return (
    <section className="pos-card pos-stack" data-start-day={place}>
      <p>{t(place === 'rows' ? 'admin_stock.day.none_open' : 'admin_stock.day.retry_needs_day')}</p>
      <BusyButton primary={primary} busy={busy} onClick={onStart}>
        {t('admin_stock.day.start')}
      </BusyButton>
    </section>
  );
}
