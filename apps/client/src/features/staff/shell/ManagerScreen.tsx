import { t } from '../../../i18n';
import { AIco } from '../../audit/icons';
import { Ico, type IconName } from '../../alerts/ui';
import { StartDayButton } from '../orders/order-screen/DayNotStarted';
import type { DayOpen } from '../orders/order-screen/day-open';
import type { Permissions } from './permissions';

// 05a §3.6 `manager`: reports and day close; audit, test alert and the device list only where the permission is
// unmasked (§3.3a: `view-audit-log` and `manage-devices` are listed-only). What shows depends on the permissions only.
// ⚠️ 02b v1.0.28 QR2-2 (owner 2026-11-28 QA-R2, BUG-9): Start day, while no day is open, for `close-business-day`
// holders (the permission of Close day); it sends OpenBusinessDay from the staff app, no admin page.

export function ManagerScreen({ permissions, day = 'unknown', onNavigate }: { permissions: Permissions; day?: DayOpen; onNavigate: (path: string) => void }) {
  const items: Array<{ path: string; label: string; icon: IconName | 'list'; on: boolean }> = [
    { path: '/reports', label: t('billing.report.nav'), icon: 'eye', on: permissions.allowed('view-reports') },
    { path: '/day-close', label: t('billing.dayclose.nav'), icon: 'lock', on: permissions.allowed('close-business-day') },
    { path: '/audit', label: t('audit.tab'), icon: 'list', on: permissions.allowed('view-audit-log') },
    { path: '/test-alert', label: t('alerts.nav.test'), icon: 'pulse', on: permissions.allowed('manage-devices') },
    { path: '/devices', label: t('devices.title'), icon: 'tablet', on: permissions.allowed('manage-devices') },
  ];
  return (
    <main className="ph-body">
      <div className="card col manager__list">
        <b>{t('shell.manager.title')}</b>
        {day === 'closed' && permissions.allowed('close-business-day') && <StartDayButton className="btn btn--lg btn--primary" />}
        {items
          .filter((i) => i.on)
          .map((i) => (
            <button key={i.path} type="button" className="btn btn--lg" onClick={() => onNavigate(i.path)}>
              {i.icon === 'list' ? <AIco name="list" /> : <Ico name={i.icon} />}
              {i.label}
            </button>
          ))}
      </div>
    </main>
  );
}
