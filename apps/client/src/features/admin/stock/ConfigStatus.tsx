import type { HubConfigStatus } from '@pos/events';
import type { HubClock } from '../../../app/hub-clock';
import { Banner } from '../../../components/Banner';
import { Chip } from '../../../components/Chip';
import { Icon } from '../../../components/Icon';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';

// §6.21, §8.2 (01a-B10): one status line as the app bar's chip, and the danger banner while
// last_problem is set (S29, S43).
export function statusLine(status: HubConfigStatus, clock: HubClock | null): string {
  const poll = status.last_poll;
  if (poll?.outcome === 'not_ready') return t('admin_stock.status.waiting');
  let line =
    status.config_version === null
      ? t('admin_stock.status.no_menu')
      : fill(t('admin_stock.status.version'), { version: String(status.config_version) });
  if (poll !== null && clock !== null) {
    const minutes = Math.max(0, Math.floor((clock.nowMs() - poll.at) / 60_000));
    line += minutes === 0 ? t('admin_stock.status.checked_now') : fill(t('admin_stock.status.checked'), { minutes: String(minutes) });
  }
  if (poll?.outcome === 'offline') line += t('admin_stock.status.offline');
  return line;
}

function problemText(status: HubConfigStatus): string | null {
  const problem = status.last_problem;
  if (problem === null) return null;
  if (problem.outcome === 'unauthorized') return t('admin_stock.problem.unauthorized');
  const head =
    problem.reason === 'apply_failed'
      ? t('admin_stock.problem.apply_failed')
      : fill(t('admin_stock.problem.rejected'), { reason: problem.reason ?? '' });
  const tail =
    status.config_version === null
      ? t('admin_stock.problem.no_menu')
      : fill(t('admin_stock.problem.still_using'), { version: String(status.config_version) });
  return head + tail;
}

export function ConfigChip({ status, clock }: { status: HubConfigStatus; clock: HubClock | null }) {
  const problem = status.last_problem !== null;
  const offline = status.last_poll?.outcome === 'offline';
  return (
    <span data-status-line="">
      <Chip tone={problem ? 'warn' : offline ? 'info' : 'ok'} icon={problem ? 'alert' : undefined}>{statusLine(status, clock)}</Chip>
    </span>
  );
}

export function ConfigProblem({ status }: { status: HubConfigStatus }) {
  const problem = problemText(status);
  return problem === null ? null : <Banner tone="danger" text={problem} detail={t('admin_stock.problem.body')} />;
}

// 01a hand-off StockMore: the status line also heads the app bar's More menu (the header chip stays, S54 e); "Menu up to date" over the line
// while the hub runs a menu version and its last poll went through, otherwise the line alone (warn while
// last_problem is set, info while offline or waiting).
export function MenuStatus({ status, clock }: { status: HubConfigStatus; clock: HubClock | null }) {
  const problem = status.last_problem !== null;
  const outcome = status.last_poll?.outcome;
  const upToDate = !problem && status.config_version !== null && outcome !== 'offline' && outcome !== 'not_ready';
  const line = statusLine(status, clock);
  const tone = upToDate ? '' : problem ? ' pos-menu__status--warn' : ' pos-menu__status--info';
  return (
    <div className={`pos-menu__status${tone}`}>
      <Icon name={upToDate ? 'check' : problem ? 'alert' : 'sync'} />
      <div>
        {upToDate ? (
          <>
            <b>{t('admin_stock.menu_ok')}</b>
            <span>{line}</span>
          </>
        ) : (
          <b>{line}</b>
        )}
      </div>
    </div>
  );
}

// The chip and the banner together (the stock view places them apart).
export function ConfigStatus({ status, clock }: { status: HubConfigStatus; clock: HubClock | null }) {
  return (
    <>
      <ConfigChip status={status} clock={clock} />
      <ConfigProblem status={status} />
    </>
  );
}
