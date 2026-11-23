import type { ReactNode } from 'react';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import { badgeText } from '../../alerts/labels';
import { Ico, initial, type IconName } from '../../alerts/ui';
import type { TabItem } from '../shell/screens';
import { FloorControl, type FloorChoice } from './FloorControl';
import { TabGlyph, type PhoneTab } from './PhoneTabs';

// 02a §8 Top bar (frame 02a-C10; TableMap, TableMapPortrait, TableMapKiosk, TableMapPhone; 01d AD-168): 80 px maroon.
// Start: brand block + the 01d B05 alerts line (tablets only: the shell passes `bind` or nothing). Middle: the floor
// control. End: Live, clock, Requests (shield, approvers only: the shell passes the count or null), Inbox (tray),
// person chip (sign out). Portrait: the floors on their own row under the bar. Phone: the phone top bar (title, live
// line, avatar); its tabs are PhoneTabs.

export interface TopBarProps {
  phone: boolean;
  portrait: boolean;
  brandName: string;
  /** "Gulberg · Tablet 3" */
  deviceLine: string;
  /** the B05 alerts line; null on kiosk and phone */
  bind?: ReactNode;
  /** null until the map store gives the floors (21a): no control */
  floors: { choices: readonly FloorChoice[]; selected: string | null; onSelect: (floor_id: string) => void } | null;
  /** the Live / Hub offline pill, or null */
  live: ReactNode;
  clock: string;
  person: { name: string } | null;
  /** answerable requests; null = not an approver / nothing to answer: no button */
  requests: number | null;
  /** unseen alerts */
  inbox: number;
  /** 05a §8 C-1: the device's screens as tabs, in the profile's list order (width never changes the list) */
  tabs?: readonly TabItem[];
  currentTab?: PhoneTab | null;
  /** 05 §8 Shift (task 39, R5): manage-own-shift allowed → "My shift" (#/shift) */
  shift?: boolean;
  /** phone top bar */
  title: string;
  phoneSub: ReactNode;
  onNavigate: (path: string) => void;
  onSignOut: () => void;
}

function IconButton({ icon, label, count, onClick }: { icon: IconName; label: string; count: number | null; onClick: () => void }) {
  const badge = count === null ? null : badgeText(count);
  return (
    <button type="button" className="btn btn--icon" onClick={onClick}>
      <Ico name={icon} />
      <span className="sr">{label}</span>
      {badge !== null && <span className="badge num">{badge}</span>}
    </button>
  );
}

export function TopBar(p: TopBarProps) {
  if (p.phone) {
    return (
      <header className="ph-top">
        <div className="grow">
          <h1>{p.title}</h1>
          <span className="sub">{p.phoneSub}</span>
        </div>
        {p.person !== null && (
          <div className="end">
            {p.requests !== null && <IconButton icon="shield" label={t('alerts.nav.requests')} count={p.requests} onClick={() => p.onNavigate('/requests')} />}
            <IconButton icon="tray" label={t('alerts.nav.inbox')} count={p.inbox} onClick={() => p.onNavigate('/inbox')} />
            <span className="av av--me av--48">{initial(p.person.name)}</span>
          </div>
        )}
      </header>
    );
  }
  const floorControl =
    p.person !== null && p.floors !== null ? (
      <FloorControl floors={p.floors.choices} selected={p.floors.selected} onSelect={p.floors.onSelect} fill={p.portrait} />
    ) : null;
  return (
    <>
      <header className="top">
        <div className="brand">
          <div className="mark" aria-hidden="true">
            {initial(p.brandName)}
          </div>
          <div>
            <b>{p.brandName}</b>
            <span>{p.deviceLine}</span>
            {p.bind}
          </div>
        </div>
        {p.person !== null && p.tabs !== undefined && p.tabs.length > 0 && (
          <nav className="tabs-top" aria-label={t('tabs.tables')}>
            {p.tabs.map((tab) => (
              <a key={tab.key} className="btn" href={`#${tab.path}`} {...(p.currentTab === tab.key ? { 'aria-current': 'page' as const } : {})}>
                <TabGlyph screen={tab.key} />
                {tab.label}
                {tab.hint !== null && <small className="hint">{tab.hint}</small>}
              </a>
            ))}
          </nav>
        )}
        {!p.portrait && floorControl}
        <div className="end">
          {p.live}
          <span className="clock">{p.clock}</span>
          {p.person !== null && (
            <>
              {p.requests !== null && <IconButton icon="shield" label={t('alerts.nav.requests')} count={p.requests} onClick={() => p.onNavigate('/requests')} />}
              {p.shift === true && <IconButton icon="cash" label={t('billing.shift.nav')} count={null} onClick={() => p.onNavigate('/shift')} />}
              <IconButton icon="tray" label={t('alerts.nav.inbox')} count={p.inbox} onClick={() => p.onNavigate('/inbox')} />
              <button type="button" className="me" aria-label={fill(t('alerts.sign_out'), { name: p.person.name })} onClick={p.onSignOut}>
                <span className="av av--sm av--me">{initial(p.person.name)}</span>
                {p.person.name}
              </button>
            </>
          )}
        </div>
      </header>
      {p.portrait && floorControl !== null && <div className="on-light navrow">{floorControl}</div>}
    </>
  );
}
