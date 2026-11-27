import type { ReactNode } from 'react';
import { t } from '../../../i18n';
import { badgeText } from '../../alerts/labels';
import { Ico, initial, type IconName } from '../../alerts/ui';
import type { ContextSlotValue } from '../shell/context-slot';
import { PersonMenu, type PersonMenuActions } from '../shell/PersonMenu';
import type { TabItem } from '../shell/screens';
import { FloorControl, type FloorChoice } from './FloorControl';
import { TabGlyph, type PhoneTab } from './PhoneTabs';

// 02a §8 Top bar (frame 02a-C10; TableMap, TableMapPortrait, TableMapKiosk, TableMapPhone; 01d AD-168): 80 px maroon.
// Start: brand block + the 01d B05 alerts line (tablets only: the shell passes `bind` or nothing). Middle: the floor
// control. End: Live, clock, Requests (shield, approvers only: the shell passes the count or null), Inbox (tray),
// person chip. Portrait: the floors on their own row under the bar. Phone: the phone top bar (title, live line,
// avatar); its tabs are PhoneTabs.
// 02b-TK A2 item 1 (frames ShellAnatomy, PersonMenu; MAPPING TK-SH01, TK-SH02): a screen's context slot ("New takeaway
// · Usman" + one sub-line) stands in for the brand block; the current tab carries the one selected style (.is-sel);
// the person chip opens the person menu (Switch user, Lock screen, My shift, Sign out) — never a one-tap sign out.

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
  /** ⚠️ 03b v1.0.17 §8: the screen's own row in the bar (the Pass's type tabs), after the screen tabs */
  extra?: ReactNode;
  clock: string;
  person: { name: string } | null;
  /** answerable requests; null = not an approver / nothing to answer: no button */
  requests: number | null;
  /** unseen alerts */
  inbox: number;
  /** 05a §8 C-1: the device's screens as tabs, in the profile's list order (width never changes the list) */
  tabs?: readonly TabItem[];
  currentTab?: PhoneTab | null;
  /** 05 §8 Shift (task 39, R5): manage-own-shift allowed → "My shift" (#/shift), in the person menu (02b-TK TK-SH02) */
  shift?: boolean;
  /** 02b-TK TK-SH01: the screen's context slot, drawn in place of the brand block; null / absent = the brand */
  context?: ContextSlotValue | null;
  /** 02b-TK TK-SH02: the person menu's Switch user / Lock screen and My shift's sub-line */
  menu?: PersonMenuActions;
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

function TakeawayLabel({ context }: { context: ContextSlotValue }) {
  return (
    <>
      {context.label}
      {context.token !== null && (
        <>
          {' '}
          <span dir="ltr" className="num">
            {context.token}
          </span>
        </>
      )}
      {context.name !== null && (
        <>
          {' · '}
          <bdi>{context.name}</bdi>
        </>
      )}
    </>
  );
}

export function TopBar(p: TopBarProps) {
  if (p.phone) {
    return (
      <header className={p.context ? "ph-top ph-top--takeaway" : "ph-top"}>
        {p.context !== null && p.context !== undefined && (
          <span className="tk-ctx__ic"><TabGlyph screen="takeaway" /></span>
        )}
        <div className="grow">
          <h1>{p.context ? <TakeawayLabel context={p.context} /> : p.title}</h1>
          <span className="sub">{p.context?.sub ?? p.phoneSub}</span>
        </div>
        {p.context && <span className="ph-top__live">{p.phoneSub}</span>}
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
        {p.context != null ? (
          <div className="tk-ctx">
            <span className="tk-ctx__ic">
              <TabGlyph screen="takeaway" />
            </span>
            <div>
              <b>
                <TakeawayLabel context={p.context} />
              </b>
              {p.context.sub !== null && <small>{p.context.sub}</small>}
              {p.bind}
            </div>
          </div>
        ) : (
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
        )}
        {p.person !== null && p.tabs !== undefined && p.tabs.length > 0 && (
          <nav className="tabs-top" aria-label={t('tabs.tables')}>
            {p.tabs.map((tab) => (
              <a key={tab.key} className={p.currentTab === tab.key ? 'btn is-sel' : 'btn'} href={`#${tab.path}`} {...(p.currentTab === tab.key ? { 'aria-current': 'page' as const } : {})}>
                <TabGlyph screen={tab.key} />
                {tab.label}
                {tab.hint !== null && <small className="hint">{tab.hint}</small>}
              </a>
            ))}
          </nav>
        )}
        {p.person !== null && p.extra != null && p.extra !== false && <div className="top-extra">{p.extra}</div>}
        {!p.portrait && floorControl}
        <div className="end">
          {p.live}
          <span className="clock">{p.clock}</span>
          {p.person !== null && (
            <>
              {p.requests !== null && <IconButton icon="shield" label={t('alerts.nav.requests')} count={p.requests} onClick={() => p.onNavigate('/requests')} />}
              <IconButton icon="tray" label={t('alerts.nav.inbox')} count={p.inbox} onClick={() => p.onNavigate('/inbox')} />
              <PersonMenu
                name={p.person.name}
                where={p.deviceLine}
                shift={p.shift === true}
                onShift={() => p.onNavigate('/shift')}
                onSignOut={p.onSignOut}
                {...(p.menu ?? {})}
              />
            </>
          )}
        </div>
      </header>
      {p.portrait && floorControl !== null && <div className="on-light navrow">{floorControl}</div>}
    </>
  );
}
