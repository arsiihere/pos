import { t } from '../../../../i18n';
import { Ico } from '../../../alerts/ui';
import type { Permissions } from '../../shell/permissions';

// 02b-B11 OrderDayNotStarted (02b §8 Queue, §10 #36; owner ruling Q-20): Send answered BUSINESS_DAY_NOT_OPEN. The
// cart is kept. "Start day" opens the hub admin page /admin/stock/ (its own Start day, admin PIN login; the command is
// an admin-session one) for people with `manage-stock` at `branch`; everyone else is asked to get the manager.

export const START_DAY_HREF = '/admin/stock/';

export function canStartDay(permissions: Permissions): boolean {
  return permissions.allowed('manage-stock') && permissions.scope('manage-stock') === 'branch';
}

export function DayNotStarted({ canStart }: { canStart: boolean }) {
  return (
    <div className="day">
      <div className="msg c-warn" role="alert">
        <Ico name="warn" />
        <span>{t('day.not_started')}</span>
      </div>
      {canStart ? (
        <a className="btn btn--primary btn--lg btn--block" href={START_DAY_HREF}>
          {t('day.start')}
        </a>
      ) : (
        <>
          <p className="muted">{t('day.ask_manager')}</p>
          <button type="button" className="btn btn--primary btn--lg btn--block" disabled>
            <Ico name="send" />
            {t('cart.send')}
          </button>
        </>
      )}
    </div>
  );
}
