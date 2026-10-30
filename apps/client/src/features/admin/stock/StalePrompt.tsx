import { hubTimeText, type HubClock } from '../../../app/hub-clock';
import { BusyButton } from '../../../components/BusyButton';
import { Icon } from '../../../components/Icon';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';

// §8.2, S33 (01a-B12): shown above the rows while the query says day_stale. Close it and start today
// sends CloseBusinessDay then OpenBusinessDay; Keep it open hides it until the page reloads.
export function StalePrompt({
  openedAt,
  clock,
  busy,
  onCloseAndStart,
  onKeep,
}: {
  openedAt: number;
  clock: HubClock;
  busy: boolean;
  onCloseAndStart: () => void;
  onKeep: () => void;
}) {
  return (
    <section className="pos-callout pos-callout--warn" data-stale-prompt="">
      <div className="pos-callout__icon">
        <Icon name="clock" />
      </div>
      <div className="pos-callout__text">
        <h2>{fill(t('admin_stock.stale.text'), { time: hubTimeText(openedAt, clock.utcOffsetMs) })}</h2>
        <p>{t('admin_stock.stale.body')}</p>
      </div>
      <div className="pos-callout__actions">
        <button type="button" className="pos-btn" disabled={busy} onClick={onKeep}>
          {t('admin_stock.stale.keep')}
        </button>
        <BusyButton busy={busy} primary size="lg" onClick={onCloseAndStart}>
          {t('admin_stock.stale.close_and_start')}
        </BusyButton>
      </div>
    </section>
  );
}
