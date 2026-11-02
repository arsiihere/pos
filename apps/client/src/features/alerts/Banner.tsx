import { t } from '../../i18n';
import { fill } from '../../i18n/en';
import type { AlertRow } from './store';
import { FromLine, Ico, Tags, WaitRing, detailLine, tableOf, toneOf } from './ui';
import { titleText } from './labels';

// 01d §8.1 B01 (frames BannerUrgent, BannerStack, BannerResult, BannerKiosk, BannerPhone, BannerPortrait, DQ1, DQ3):
// floating cards at the top-end under the top bar, at most 2 (newest on top), then the maroon "{n} more new ·
// Open inbox" bar. Open is the tinted button, so the screen keeps one primary. No close and no snooze: the store
// hides action banners after 6 s and info after 4 s; urgent stays until opened or seen.

export const MAX_BANNERS = 2;

export function Banners({
  banners,
  nowMs,
  lockOnly,
  variant = 'side',
  onOpen,
  onOpenInbox,
}: {
  banners: readonly AlertRow[];
  nowMs: number;
  /** F01: lock text only (an always-on screen, or nobody signed in) */
  lockOnly: boolean;
  variant?: 'side' | 'wide' | 'phone';
  onOpen: (row: AlertRow) => void;
  onOpenInbox: () => void;
}) {
  if (banners.length === 0) return null;
  const shown = banners.slice(0, MAX_BANNERS);
  const more = banners.length - shown.length;
  return (
    <div className={`abns${variant === 'side' ? '' : ` abns--${variant}`}`}>
      {shown.map((b) => {
        const row = lockOnly ? { ...b, card: undefined } : b;
        const tone = toneOf(row);
        const table = tableOf(row);
        const det = detailLine(row.card, true);
        return (
          <div key={b.alert_id} className={`abn c-${tone}${row.family === 'info' ? ' abn--info' : ''}`} role="alert" data-alert={b.alert_id}>
            <WaitRing row={row} nowMs={nowMs} size={56} />
            <div className="ac__body">
              <Tags row={row} />
              <div className="ac__title">
                {table !== null && <span className="tcode tcode--sm">{table}</span>}
                <b>{titleText(row)}</b>
              </div>
              <FromLine row={row} utcOffsetMs={0} time={false} />
              {det !== null && <div className="ac__det">{det}</div>}
            </div>
            <button type="button" className={`btn btn--tone c-${tone}`} onClick={() => onOpen(b)}>
              {t('alerts.open')}
              <Ico name="chev" />
            </button>
          </div>
        );
      })}
      {more > 0 && (
        <div className="abn__more">
          {fill(t('alerts.more_new'), { n: String(more) })}
          <button type="button" className="btn" onClick={onOpenInbox}>
            <Ico name="tray" />
            {t('alerts.open_inbox')}
          </button>
        </div>
      )}
    </div>
  );
}
