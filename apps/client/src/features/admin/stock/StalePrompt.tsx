import { hubTimeText, type HubClock } from '../../../app/hub-clock';
import { BusyButton } from '../../../components/BusyButton';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';

// §8.2, S33: shown above the rows while the query says day_stale. "Close and start new day" sends
// CloseBusinessDay then OpenBusinessDay; "Keep this day open" hides it until the page reloads.
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
    <section className="pos-card pos-stack" data-stale-prompt="">
      <p>{fill(t('admin_stock.stale.text'), { time: hubTimeText(openedAt, clock.utcOffsetMs) })}</p>
      <div className="pos-row">
        <BusyButton busy={busy} onClick={onCloseAndStart}>
          {t('admin_stock.stale.close_and_start')}
        </BusyButton>
        <button type="button" className="pos-btn" disabled={busy} onClick={onKeep}>
          {t('admin_stock.stale.keep')}
        </button>
      </div>
    </section>
  );
}
