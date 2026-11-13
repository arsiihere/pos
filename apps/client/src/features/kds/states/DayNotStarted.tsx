import { t } from '../../../i18n';

// 03b §3.3, 00 Q10 (K4; frame 03b-F01 KdsDayNotStarted): before BusinessDayOpened — full screen, no button at all. It
// ends by itself when the day opens (Q-44: the BusinessDay* frames reach station sockets; before HK1, at the next
// reconnect's catch-up).
export function DayNotStarted() {
  return (
    <div className="kfull">
      <span className="ring ring--140 c-mute" aria-hidden="true">
        <svg viewBox="0 0 140 140">
          <circle className="trk" cx={70} cy={70} r={65} strokeWidth={10} />
        </svg>
        <span className="ring__in">
          <svg className="ico" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3.5 2" />
          </svg>
        </span>
      </span>
      <b>{t('kds.day_not_started')}</b>
      <span>{t('kds.day_not_started_sub')}</span>
    </div>
  );
}
