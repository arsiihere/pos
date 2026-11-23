import type { ReactNode } from 'react';
import type { ScreenKey } from '@pos/domain';
import { t } from '../../../i18n';
import { Ico, initial } from '../../alerts/ui';
import type { TabItem } from '../shell/screens';

// 02a §8 Top bar, phone (frame TableMapPhone): the bottom tab bar (60 px). 05a §8 C-1: its tabs are the device's
// screens in list order, then Me; plain hash links.

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

export type PhoneTab = ScreenKey | 'me';

/** 05a §8 C-1: one tab per visible screen, in the profile's list order, then Me. Inbox and Requests are in the top bar. */
export function PhoneTabs({ tabs, current }: { tabs: readonly TabItem[]; current: PhoneTab | null }) {
  const link = (id: PhoneTab, path: string, icon: ReactNode, label: string, hint: string | null = null) => (
    <a key={id} className="tab" href={`#${path}`} {...(current === id ? { 'aria-current': 'page' as const } : {})}>
      {icon}
      {label}
      {hint !== null && <small className="hint">{hint}</small>}
    </a>
  );
  return (
    <nav className={`tabbar tabbar--n${tabs.length + 1}`} aria-label={t('tabs.tables')}>
      {tabs.map((tab) => link(tab.key, tab.path, <TabGlyph screen={tab.key} />, tab.label, tab.hint))}
      {link('me', '/me', <Ico name="user" />, t('tabs.me'))}
    </nav>
  );
}

export function TabGlyph({ screen }: { screen: ScreenKey }) {
  switch (screen) {
    case 'dine_in':
      return <TabIcon name="tables" />;
    case 'takeaway':
      return <TabIcon name="orders" />;
    case 'parking':
      return <Ico name="pin" />;
    case 'cashier':
      return <Ico name="cash" />;
    case 'pass':
      return <Ico name="hand" />;
    case 'manager':
      return <Ico name="shield" />;
  }
}

/** The Me tab: who is signed in, and sign out (it used to be the second tab of the 01d bar). */
export function MeTab({ name, onSignOut, onShift }: { name: string; onSignOut: () => void; /** 05 §8 Shift (task 39): manage-own-shift */ onShift?: () => void }) {
  return (
    <main className="ph-body">
      <div className="card col signin__phone">
        <span className="av av--me av--48">{initial(name)}</span>
        <b>{name}</b>
        {onShift !== undefined && (
          <button type="button" className="btn btn--lg" onClick={onShift}>
            <Ico name="cash" />
            {t('billing.shift.nav')}
          </button>
        )}
        <button type="button" className="btn btn--lg" onClick={onSignOut}>
          <Ico name="signout" />
          {t('alerts.sign_out_short')}
        </button>
      </div>
    </main>
  );
}
