import type { ReactNode } from 'react';
import type { CloudAdmin } from '../../api/cloud-admin';
import { AppBar } from '../../components/AppBar';
import { SideNav, TabBar, type NavItem } from '../../components/SideNav';
import { navigate } from '../../app/router';
import { t, typeClass } from '../../i18n';
import { idTail } from './branch';
import { CloudDownBanner } from './cloud';
import { useLeave } from './guard';
import { usePhone } from './phone';

// S50 a: the owner shell. Side menu on a laptop or tablet; on a phone the same items as a bottom tab
// bar. Every menu item goes through the discard guard (S50 c).
export function Shell({
  route,
  userName,
  onSignOut,
  children,
}: {
  route: string;
  userName: string;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const phone = usePhone();
  const leave = useLeave();
  const items: NavItem[] = [
    { href: '#/menu', icon: 'list', label: t('owner.nav.menu'), current: route === '/menu' },
    { href: '#/floors', icon: 'grid', label: t(phone ? 'owner.nav.floors_short' : 'owner.nav.floors'), current: route === '/floors' },
    {
      href: '#/stations',
      icon: 'flame',
      label: t(phone ? 'owner.nav.stations_short' : 'owner.nav.stations'),
      current: route === '/stations',
    },
  ];
  const onNavigate = (href: string) => {
    leave(() => navigate(href.replace(/^#/, '')));
    return false;
  };

  if (phone) {
    return (
      <div className="pos-page">
        {children}
        <TabBar label={t('owner.nav.label')} items={items} onNavigate={onNavigate} />
      </div>
    );
  }
  return (
    <div className="pos-page">
      <div className="pos-shell">
        <SideNav
          label={t('owner.title')}
          brand={{ title: t('owner.title') }}
          items={items}
          onNavigate={onNavigate}
          foot={
            <>
              <span className={typeClass('body')}>{userName}</span>
              <button type="button" className="pos-btn pos-btn--block" onClick={() => leave(onSignOut)}>
                {t('owner.sign_out')}
              </button>
            </>
          }
        />
        <div>{children}</div>
      </div>
    </div>
  );
}

// S52: the app bar's branch select on Floors and Stations; a change goes through the discard guard.
export function BranchSelect({
  branchIds,
  value,
  onChange,
  disabled = false,
}: {
  branchIds: readonly string[];
  value: string;
  onChange: (branchId: string) => void;
  disabled?: boolean;
}) {
  const leave = useLeave();
  if (branchIds.length < 2) return null;
  return (
    <label className="pos-row">
      <span className="pos-field__label">{t('owner.branch')}</span>
      <select
        className="pos-select pos-ltr"
        name="branch"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          leave(() => onChange(next));
        }}
      >
        {branchIds.map((id) => (
          <option key={id} value={id}>
            {idTail(id)}
          </option>
        ))}
      </select>
    </label>
  );
}

// One owner screen: the app bar, then the content with the cloud-unreachable banner on top (S53).
export function Page({
  api,
  title,
  start,
  after,
  end,
  narrow = false,
  children,
}: {
  api: CloudAdmin;
  title: string;
  start?: ReactNode;
  after?: ReactNode;
  end?: ReactNode;
  narrow?: boolean;
  children: ReactNode;
}) {
  const phone = usePhone();
  return (
    <>
      <AppBar title={title} phone={phone} start={start} after={after}>
        {end}
      </AppBar>
      <main className={`pos-content${narrow ? ' pos-content--narrow' : ''}`}>
        <CloudDownBanner api={api} />
        {children}
      </main>
    </>
  );
}
