import { createContext, useContext, useState, type ReactNode } from 'react';
import type { CloudAdmin } from '../../api/cloud-admin';
import { AppBar } from '../../components/AppBar';
import { Drawer } from '../../components/Drawer';
import { Icon } from '../../components/Icon';
import { SideNav, type NavItem } from '../../components/SideNav';
import { navigate } from '../../app/router';
import { t, typeClass, type MessageKey } from '../../i18n';
import { useBranchName } from './branch';
import { LockoutBanner } from './account/LockoutBanner';
import { CloudDownBanner } from './cloud';
import { useLeave } from './guard';
import { usePhone } from '../../app/phone';

// Opens the side nav on a phone; Page puts its Menu button in the app bar.
const OpenMenu = createContext<{ open: () => void; expanded: boolean } | null>(null);

export interface NavCounts {
  branches?: number;
}

// The People pages: Staff, Roles, Teams and Stock counting share one nav entry (owner decision 2026-10-30,
// 01c CHANGES §1) and a tab strip on their list pages.
function isPeopleRoute(route: string): boolean {
  const path = route.split('?')[0] ?? '';
  return /^\/(staff|roles)(\/|$)/.test(path) || path === '/teams' || path === '/stock-counting';
}

// S50 a, 01b README §9, 01c CHANGES §1: the owner shell. Side nav on a laptop or tablet: Menu: Items, Size
// groups, Choice groups, Deals, Stock items; Restaurant: Floors and tables, Kitchen stations, People (Staff,
// Roles, Teams, Stock counting as tabs; owner decision 2026-10-30), Branches and settings; foot: who is signed in,
// Change password, Sign out. A count next to Branches when known. On a phone the same nav opens from
// the app bar's Menu button as an overlay drawer with the kit Dialog's focus rules (S50 a v1.3.1, P-4 answer B;
// Pulse frame OwnerMenuPhoneNav): close button, Escape, a scrim tap and choosing a page close it. Every nav link
// goes through the discard guard (S50 c). Laptop and tablet fit the screen: the shell is 100dvh and only the
// content region scrolls (01a hand-off PROMPT, layout). Login returns no restaurant name or email (S50 a), so
// the brand block shows the owner's display name over "Restaurant setup".
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
  const menu = t('owner.nav.group.menu');
  const restaurant = t('owner.nav.group.restaurant');
  const items: NavItem[] = [
    // 01c hand-off CHANGES §1, Q4: section "Menu" with Items · Size groups · Choice groups · Deals · Stock items.
    { href: '#/menu', icon: 'list', label: t('owner.nav.items'), current: route.split('?')[0] === '/menu', group: menu },
    { href: '#/size-groups', icon: 'layers', label: t('owner.nav.size_groups'), current: route.startsWith('/size-groups'), group: menu },
    { href: '#/choice-groups', icon: 'sliders', label: t('owner.nav.choice_groups'), current: route.startsWith('/choice-groups'), group: menu },
    { href: '#/deals', icon: 'tag', label: t('owner.nav.deals'), current: route.startsWith('/deals'), group: menu },
    { href: '#/stock-items', icon: 'pot', label: t('owner.nav.stock_items'), current: route.startsWith('/stock-items'), group: menu },
    {
      href: '#/floors',
      icon: 'grid',
      label: t(phone ? 'owner.nav.floors_short' : 'owner.nav.floors'),
      current: route === '/floors',
      group: restaurant,
    },
    {
      href: '#/stations',
      icon: 'flame',
      label: t(phone ? 'owner.nav.stations_short' : 'owner.nav.stations'),
      current: route === '/stations',
      group: restaurant,
    },
    // 03a D1, A-1: where food is handed over (#/points)
    { href: '#/points', icon: 'forward', label: t('owner.nav.points'), current: route === '/points', group: restaurant },
    // 01b §8; one entry for Staff, Roles, Teams and Stock counting (owner decision 2026-10-30)
    { href: '#/staff', icon: 'user', label: t('owner.nav.people'), current: isPeopleRoute(route), group: restaurant },
    {
      href: '#/branches',
      icon: 'home',
      label: t('owner.nav.branches'),
      count: counts.branches,
      current: route.startsWith('/branches'),
      group: restaurant,
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
      brand={{ title: userName, sub: t('owner.title'), avatar: userName }}
      items={items}
      onNavigate={onNavigate}
      drawer={phone ? { onClose: () => setMenuOpen(false), closeLabel: t('owner.nav.close') } : undefined}
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
      <OpenMenu.Provider value={{ open: () => setMenuOpen(true), expanded: menuOpen }}>
        <div className="pos-page">
          {children}
          {menuOpen && (
            <Drawer label={t('owner.title')} onClose={() => setMenuOpen(false)}>
              {nav}
            </Drawer>
          )}
        </div>
      </OpenMenu.Provider>
    );
  }
  return (
    <div className="pos-page pos-page--fit">
      <div className="pos-shell">
        {nav}
        <div className="pos-shell__main">{children}</div>
      </div>
    </div>
  );
}

// The phone app bar's first button (StaffPhoneList.html); nothing outside the shell or on a laptop.
function MenuButton() {
  const menu = useContext(OpenMenu);
  if (menu === null) return null;
  return (
    <button
      type="button"
      className="pos-more"
      aria-label={t('owner.nav.open')}
      aria-haspopup="dialog"
      aria-expanded={menu.expanded}
      onClick={menu.open}
    >
      <Icon name="menu" />
    </button>
  );
}

export type PeopleTab = 'staff' | 'roles' | 'teams' | 'counting';

const PEOPLE_TABS: readonly { tab: PeopleTab; href: string; label: MessageKey }[] = [
  { tab: 'staff', href: '#/staff', label: 'staff.title' },
  { tab: 'roles', href: '#/roles', label: 'roles.title' },
  { tab: 'teams', href: '#/teams', label: 'teams.title' },
  { tab: 'counting', href: '#/stock-counting', label: 'counting.title' },
];

// Owner decision 2026-10-30 (01c CHANGES §1): the tab strip at the top of the four People list pages (not on
// the staff form or role editor). Each tab is a link to its route; a choice goes through the discard guard.
export function PeopleTabs({ current }: { current: PeopleTab }) {
  const leave = useLeave();
  return (
    <nav className="pos-seg pos-peopletabs" aria-label={t('owner.nav.people')}>
      {PEOPLE_TABS.map(({ tab, href, label }) => (
        <a
          key={tab}
          className="pos-seg__opt"
          href={href}
          aria-current={tab === current ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault();
            leave(() => navigate(href.replace(/^#/, '')));
          }}
        >
          {t(label)}
        </a>
      ))}
    </nav>
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
    <label className="pos-row pos-appbar__branch">
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
        // Phone: a page with a back link shows back alone (StaffFormPhone, RoleEditorPhone); others get Menu.
        start={phone ? (start ?? <MenuButton />) : start}
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
