import { Fragment, useContext, useEffect, useSyncExternalStore } from 'react';
import { t } from '../../i18n';
import { fill } from '../../i18n/en';
import { navigate } from '../../app/router';
import { CALL_KIND, CallCard } from '../staff/tables/cards/CallCard';
import { HANDOVER_KIND, pendingHandovers } from '../staff/tables/cards/pending-handovers';
import { forceMoveNotice, handoverCards } from '../staff/tables/cards/ResultBanner';
import { ShellContext } from '../staff/shell/hooks';
import type { AlertRow } from './store';
import { FromLine, Ico, Tags, WaitRing, detailLine, tableOf, toneOf } from './ui';
import { handoverDetailsText, titleText } from './labels';

// 01d §8.1 B01 (frames BannerUrgent, BannerStack, BannerResult, BannerKiosk, BannerPhone, BannerPortrait, DQ1, DQ3):
// floating cards at the top-end under the top bar, at most 2 (newest on top), then the maroon "{n} more new ·
// Open inbox" bar. Open is the tinted button, so the screen keeps one primary. No close and no snooze: the store
// hides action banners after 6 s and info after 4 s; urgent stays until opened or seen.
// 02 kinds (23b): a handover reads "3 orders · Rs 14,250" (02a-C02); a call is the call card (Q-12, 02a-C05); a
// zone stock alert opens #/zones (02b-C05); a request_result is reported to the pending-handover store (Q-14),
// and one it shows as a handover result is not shown again here. The handover cards (results, the force-move
// notice; staff/tables/cards/ResultBanner.tsx) are part of this one stack, on top, inside the same limit of 2, so
// they follow its phone / wide variant and never overlap it (signed in, staff shell only).

const ZONE_KINDS: ReadonlySet<string> = new Set(['zone_stock_low', 'zone_stock_out']);

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
  useSyncExternalStore(pendingHandovers.subscribe, pendingHandovers.version);
  useSyncExternalStore(forceMoveNotice.subscribe, forceMoveNotice.get);
  const staffShell = useContext(ShellContext) !== null;
  const results = banners
    .filter((b) => b.kind === 'request_result')
    .map((b) => `${b.alert_id}\u0000${(b.card ?? b.lock).table_code ?? ''}`)
    .join('\u0001');
  useEffect(() => {
    for (const r of results === '' ? [] : results.split('\u0001')) {
      const [id, code] = r.split('\u0000');
      void pendingHandovers.resultSeen(id!, code === '' || code === undefined ? null : code);
    }
  }, [results]);
  const listed = banners.filter((b) => !(b.kind === 'request_result' && pendingHandovers.isHandoverResult(b.alert_id)));
  const cards = staffShell && !lockOnly ? handoverCards() : [];
  if (listed.length === 0 && cards.length === 0) return null;
  const shownCards = cards.slice(0, MAX_BANNERS);
  const shown = listed.slice(0, MAX_BANNERS - shownCards.length);
  const more = listed.length - shown.length + (cards.length - shownCards.length);
  return (
    <div className={`abns${variant === 'side' ? '' : ` abns--${variant}`}`}>
      {shownCards.map((c) => (
        <Fragment key={c.key}>{c.node}</Fragment>
      ))}
      {shown.map((b) => {
        const row = lockOnly ? { ...b, card: undefined } : b;
        if (row.kind === CALL_KIND) return <CallCard key={b.alert_id} row={row} onOpen={() => onOpen(b)} />;
        const tone = toneOf(row);
        const table = tableOf(row);
        const det = row.kind === HANDOVER_KIND ? handoverDetailsText(row.card?.details) : detailLine(row.card, true);
        const open = ZONE_KINDS.has(row.kind) ? () => navigate('/zones') : () => onOpen(b);
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
            <button type="button" className={`btn btn--tone c-${tone}`} onClick={open}>
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
