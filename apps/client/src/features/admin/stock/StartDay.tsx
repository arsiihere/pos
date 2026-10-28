import { BusyButton } from '../../../components/BusyButton';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';

// §8.2, S33 (01a-B13): the large Start day action. `place` 'rows' sits above the stock rows whenever no
// day is open; 'retry' replaces the save after a 409 BUSINESS_DAY_NOT_OPEN and re-sends it with the same
// command_id. One tap, no confirmation.
export function StartDay({
  place,
  busy,
  primary = true,
  waiting = 0,
  onStart,
}: {
  place: 'rows' | 'retry';
  busy: boolean;
  primary?: boolean;
  waiting?: number;
  onStart: () => void;
}) {
  return (
    <section className={`pos-callout${place === 'retry' ? ' pos-callout--warn' : ' pos-callout--accent'}`} data-start-day={place}>
      <div className="pos-callout__text">
        <h2>{t(place === 'rows' ? 'admin_stock.day.start_title' : 'admin_stock.day.not_saved_title')}</h2>
        <p>
          {place === 'rows'
            ? t('admin_stock.day.none_open')
            : `${t('admin_stock.day.retry_needs_day')} ${fill(t('admin_stock.day.counts_kept'), { n: String(waiting) })}`}
        </p>
      </div>
      <BusyButton primary={primary} busy={busy} onClick={onStart}>
        {t(place === 'rows' ? 'admin_stock.day.start' : 'admin_stock.day.start_and_save')}
      </BusyButton>
    </section>
  );
}
