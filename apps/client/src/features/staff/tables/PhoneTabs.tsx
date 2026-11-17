import { t } from '../../../i18n';
import { badgeText } from '../../alerts/labels';
import { Ico, initial } from '../../alerts/ui';

// 02a §8 Top bar, phone (frame TableMapPhone; handoff Q8): tabs Tables · Orders · Inbox · Me (60 px). Plain hash
// links: the routes are #/tables, #/orders, #/inbox, #/me. Orders holds open orders and New order (02b).

export type PhoneTab = 'tables' | 'orders' | 'inbox' | 'me';

function TabIcon({ name }: { name: 'tables' | 'orders' }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
      {name === 'tables' ? (
        <>
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </>
      ) : (
        <>
          <path d="M5 8h14l-1.2 12.5H6.2z" />
          <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
        </>
      )}
    </svg>
  );
}

export function PhoneTabs({ current, inbox }: { current: PhoneTab; inbox: number }) {
  const badge = badgeText(inbox);
  const link = (id: PhoneTab, icon: ReactIcon, label: string, count: string | null = null) => (
    <a className="tab" href={`#/${id}`} {...(current === id ? { 'aria-current': 'page' as const } : {})}>
      {icon}
      {label}
      {count !== null && <span className="badge num">{count}</span>}
    </a>
  );
  return (
    <nav className="tabbar" aria-label={t('tabs.tables')}>
      {link('tables', <TabIcon name="tables" />, t('tabs.tables'))}
      {link('orders', <TabIcon name="orders" />, t('tabs.orders'))}
      {link('inbox', <Ico name="tray" />, t('alerts.nav.inbox'), badge)}
      {link('me', <Ico name="user" />, t('tabs.me'))}
    </nav>
  );
}

type ReactIcon = ReturnType<typeof TabIcon> | ReturnType<typeof Ico>;

/** The Me tab: who is signed in, and sign out (it used to be the second tab of the 01d bar). */
export function MeTab({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  return (
    <main className="ph-body">
      <div className="card col signin__phone">
        <span className="av av--me av--48">{initial(name)}</span>
        <b>{name}</b>
        <button type="button" className="btn btn--lg" onClick={onSignOut}>
          <Ico name="signout" />
          {t('alerts.sign_out_short')}
        </button>
      </div>
    </main>
  );
}
