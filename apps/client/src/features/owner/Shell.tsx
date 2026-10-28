import { createContext, useContext, useState, type ReactNode } from 'react';
import type { CloudAdmin } from '../../api/cloud-admin';
import { AppBar } from '../../components/AppBar';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { SideNav, type NavItem } from '../../components/SideNav';
import { navigate } from '../../app/router';
import { t, typeClass } from '../../i18n';
import { useBranchName } from './branch';
import { LockoutBanner } from './account/LockoutBanner';
import { CloudDownBanner } from './cloud';
import { useLeave } from './guard';
import { usePhone } from '../../app/phone';

// Opens the side nav on a phone; Page puts its Menu button in the app bar.
const OpenMenu = createContext<(() => void) | null>(null);

export interface NavCounts {
  staff?: number;
  roles?: number;
  branches?: number;
}

// S50 a, 01b README §9: the owner shell. Side nav on a laptop or tablet: Menu, Floors and tables, Kitchen
// stations; People: Staff, Roles, Teams, Stock counting; Branches: Branches and settings; foot: who is signed in,
// Change password, Sign out. Counts next to Staff, Roles, Branches when known. On a phone the same nav opens from
// the app bar's Menu button as an overlay on the kit Dialog (P-4 answer B; replaces the S50 a tab bar). Every nav
// link goes through the discard guard (S50 c).
export function Shell({
  route,
  userName,
  counts = {},
  onSignOut,
  children,
}: {
  route: string;
  userName: string;
  counts?: NavCounts;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const phone = usePhone();
  const leave = useLeave();
  const [menuOpen, setMenuOpen] = useState(false);
  const people = t('owner.nav.group.people');
  const branches = t('owner.nav.group.branches');
  const items: NavItem[] = [
    { href: '#/menu', icon: 'list', label: t('owner.nav.menu'), current: route === '/menu' },
    { href: '#/floors', icon: 'grid', label: t(phone ? 'owner.nav.floors_short' : 'owner.nav.floors'), current: route === '/floors' },
    { href: '#/stations', icon: 'flame', label: t(phone ? 'owner.nav.stations_short' : 'owner.nav.stations'), current: route === '/stations' },
    // 01b §8
    { href: '#/staff', icon: 'user', label: t('owner.nav.staff'), count: counts.staff, current: route.startsWith('/staff'), group: people },
    { href: '#/roles', icon: 'shield', label: t('owner.nav.roles'), count: counts.roles, current: route.startsWith('/roles'), group: people },
    { href: '#/teams', icon: 'team', label: t('owner.nav.teams'), current: route === '/teams', group: people },
    { href: '#/stock-counting', icon: 'clipboard', label: t('owner.nav.stock_counting'), current: route === '/stock-counting', group: people },
    {
      href: '#/branches',
      icon: 'home',
      label: t('owner.nav.branches'),
      count: counts.branches,
      current: route.startsWith('/branches'),
      group: branches,
    },
  ];
  const onNavigate = (href: string) => {
    setMenuOpen(false);
    leave(() => navigate(href.replace(/^#/, '')));
    return false;
  };
  const password = '#/account/password';

  const nav = (
    <SideNav
      label={t('owner.title')}
      brand={{ title: t('owner.title') }}
      items={items}
      onNavigate={onNavigate}
      foot={
        <>
          <span className={`pos-sidenav__who ${typeClass('caption')}`}>{userName}</span>
          <a
            className="pos-sidenav__item"
            href={password}
            aria-current={route === '/account/password' ? 'page' : undefined}
            onClick={(event) => {
              if (!onNavigate(password)) event.preventDefault();
            }}
          >
            <Icon name="key" />
            {t('owner.nav.change_password')}
          </a>
          <button
            type="button"
            className="pos-btn pos-btn--block"
            onClick={() => {
              setMenuOpen(false);
              leave(onSignOut);
            }}
          >
            <Icon name="logout" />
            {t('owner.sign_out')}
          </button>
        </>
      }
    />
  );

  if (phone) {
    return (
      <OpenMenu.Provider value={() => setMenuOpen(true)}>
        <div className="pos-page">
          {children}
          {menuOpen && (
            <Dialog title={t('owner.title')} form={false} variant="nav" onClose={() => setMenuOpen(false)}>
              {nav}
            </Dialog>
          )}
        </div>
      </OpenMenu.Provider>
    );
  }
  return (
    <div className="pos-page">
      <div className="pos-shell">
        {nav}
        <div>{children}</div>
      </div>
    </div>
  );
}

// The phone app bar's first button (StaffPhoneList.html); nothing outside the shell or on a laptop.
function MenuButton() {
  const open = useContext(OpenMenu);
  if (open === null) return null;
  return (
    <button type="button" className="pos-btn" aria-label={t('owner.nav.open')} onClick={open}>
      <Icon name="menu" />
    </button>
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
  const branchName = useBranchName();
  if (branchIds.length < 2) return null;
  return (
    <label className="pos-row">
      <span className="pos-field__label">{t('owner.branch')}</span>
      <select
        className="pos-select"
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
            {branchName(id)}
          </option>
        ))}
      </select>
    </label>
  );
}

// One owner screen: the app bar, then the content with the cloud-unreachable banner (S53) and the
// owner lock notice (01b B01) on top.
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
      <AppBar
        title={title}
        phone={phone}
        start={
          phone ? (
            <>
              <MenuButton />
              {start}
            </>
          ) : (
            start
          )
        }
        after={after}
      >
        {end}
      </AppBar>
      <main className={`pos-content${narrow ? ' pos-content--narrow' : ''}`}>
        <CloudDownBanner api={api} />
        <LockoutBanner api={api} />
        {children}
      </main>
    </>
  );
}
