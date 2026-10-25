import type { HubConfigStatus } from '@pos/events';
import type { HubClock } from '../../../app/hub-clock';
import { Banner } from '../../../components/Banner';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';

// §6.21, §8.2: one status line, and the danger banner while last_problem is set (S29, S43).
function statusLine(status: HubConfigStatus, clock: HubClock | null): string {
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

export function ConfigStatus({ status, clock }: { status: HubConfigStatus; clock: HubClock | null }) {
  const problem = problemText(status);
  return (
    <>
      <p className="pos-field__help" data-status-line="">
        {statusLine(status, clock)}
      </p>
      {problem !== null && <Banner tone="danger" text={problem} />}
    </>
  );
}
