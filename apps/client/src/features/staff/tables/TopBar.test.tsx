import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../../../../test/dom';
import { setLanguage } from '../../../i18n';
import { FloorControl, type FloorChoice } from './FloorControl';
import { PhoneTabs } from './PhoneTabs';
import { TopBar, type TopBarProps } from './TopBar';

// 02a §8 Top bar (frame 02a-C10; TableMap, TableMapPortrait, TableMapPhone, TableMapKiosk), 01d AD-168.

let m: Mounted;
afterEach(() => {
  m?.unmount();
  setLanguage('en');
});

const FLOORS: FloorChoice[] = [
  { floor_id: 'F1', name: 'Ground floor', count: 12 },
  { floor_id: 'F2', name: 'Family hall', count: 12 },
  { floor_id: 'F3', name: 'Rooftop', count: 6 },
];

function props(over: Partial<TopBarProps> = {}): TopBarProps {
  return {
    phone: false,
    portrait: false,
    brandName: 'Arif Chatkhara',
    deviceLine: 'Gulberg · Tablet 3',
    bind: <span className="bind">Alerts: Ali</span>,
    floors: null,
    live: <span className="live">Live</span>,
    clock: '8:15 PM',
    person: { name: 'Ali' },
    requests: null,
    inbox: 0,
    testAlert: false,
    title: 'Tables',
    phoneSub: 'Live',
    onNavigate: () => {},
    onSignOut: () => {},
    ...over,
  };
}

const names = (root: ParentNode) => [...root.querySelectorAll('button')].map((b) => b.textContent ?? '');

describe('[02a §8 Top bar] TopBar', () => {
  it('[02a §8 Top bar] Requests (n) only for approvers, Inbox (n) for everyone, person chip', () => {
    const go = vi.fn();
    const out = vi.fn();
    m = mount();
    m.render(<TopBar {...props({ requests: 2, inbox: 3, onNavigate: go, onSignOut: out })} />);
    const header = m.container.querySelector('header.top')!;
    expect(header.textContent).toContain('Arif Chatkhara');
    expect(m.button('Requests', header).querySelector('.badge')?.textContent).toBe('2');
    expect(m.button('Inbox', header).querySelector('.badge')?.textContent).toBe('3');
    m.click(m.button('Requests', header));
    m.click(m.button('Inbox', header));
    expect(go.mock.calls).toEqual([['/requests'], ['/inbox']]);
    m.click(m.button('Ali — sign out', header));
    expect(out).toHaveBeenCalledTimes(1);
    m.unmount();

    // not an approver: no Requests; no unseen: no badge
    m = mount();
    m.render(<TopBar {...props({ requests: null, inbox: 0 })} />);
    expect(m.text()).not.toContain('Requests');
    expect(m.button('Inbox').querySelector('.badge')).toBeNull();
    expect(m.container.querySelector('.me')).not.toBeNull();
    m.unmount();

    // signed out: brand, live, clock only
    m = mount();
    m.render(<TopBar {...props({ person: null, requests: 2, inbox: 3 })} />);
    expect(m.text()).not.toContain('Inbox');
    expect(m.container.querySelector('.me')).toBeNull();
    expect(m.text()).toContain('8:15 PM');
  });

  it('[02a §8 Top bar] Test alert stays reachable for manage-devices (01d), after Requests', () => {
    m = mount();
    m.render(<TopBar {...props({ testAlert: true })} />);
    expect(m.button('Test alert')).toBeTruthy();
  });

  it('[02a §8 Top bar] floor control with counts; portrait puts the floors on their own row; kiosk variant', () => {
    const pick = vi.fn();
    const floors = { choices: FLOORS, selected: 'F2', onSelect: pick };
    m = mount();
    m.render(<TopBar {...props({ floors })} />);
    const seg = m.container.querySelector('header.top .seg')!;
    expect(seg.getAttribute('aria-label')).toBe('Floor');
    expect(names(seg)).toEqual(['Ground floor12', 'Family hall12', 'Rooftop6']);
    expect(seg.querySelector('button[aria-pressed="true"]')?.textContent).toContain('Family hall');
    expect(m.container.querySelector('.navrow')).toBeNull();
    m.click(m.button('Rooftop', seg));
    expect(pick).toHaveBeenCalledWith('F3');
    m.unmount();

    // portrait: not in the header, on its own full-width row
    m = mount();
    m.render(<TopBar {...props({ floors, portrait: true })} />);
    expect(m.container.querySelector('header.top .seg')).toBeNull();
    expect(m.container.querySelector('.navrow .seg.seg--fill')).not.toBeNull();
    m.unmount();

    // kiosk: no B05 alerts line (the shell passes none), floors in the header, no Requests for a non-approver
    m = mount();
    m.render(<TopBar {...props({ floors, bind: null, deviceLine: 'Gulberg · Cashier kiosk', inbox: 1 })} />);
    expect(m.container.querySelector('.bind')).toBeNull();
    expect(m.container.querySelector('header.top .seg')).not.toBeNull();
    expect(m.text()).not.toContain('Requests');
    // no floors yet (map store not there): no control
    m.unmount();
    m = mount();
    m.render(<TopBar {...props({ floors: null })} />);
    expect(m.container.querySelector('.seg')).toBeNull();
  });

  it('[02a §8 Top bar] phone: top bar + tabs Tables · Orders · Inbox · Me (60 px)', () => {
    m = mount();
    m.render(
      <>
        <TopBar {...props({ phone: true, title: 'Tables', phoneSub: 'Live · 8:15 PM' })} />
        <PhoneTabs current="inbox" inbox={2} />
      </>,
    );
    expect(m.container.querySelector('header.ph-top h1')?.textContent).toBe('Tables');
    expect(m.container.querySelector('header.ph-top .av')?.textContent).toBe('A');
    expect(m.container.querySelector('header.top')).toBeNull();
    const tabs = [...m.container.querySelectorAll('nav.tabbar a.tab')];
    expect(tabs.map((a) => a.textContent)).toEqual(['Tables', 'Orders', 'Inbox2', 'Me']);
    expect(tabs.map((a) => a.getAttribute('href'))).toEqual(['#/tables', '#/orders', '#/inbox', '#/me']);
    expect(tabs.map((a) => a.getAttribute('aria-current'))).toEqual([null, null, 'page', null]);
    // the 60 px tab height is the kit's .tab rule (pulse-staff.css), unchanged
  });

  it('[02a §8 Rules] Urdu: dir rtl, floor and table names LTR', () => {
    setLanguage('ur');
    m = mount();
    m.render(
      <div className="pu" lang="ur" dir="rtl">
        <TopBar {...props({ floors: { choices: [{ floor_id: 'F1', name: 'Ground floor', count: 12 }, { floor_id: 'F2', name: 'چھت', count: 6 }], selected: 'F1', onSelect: () => {} } })} />
      </div>,
    );
    const root = m.container.querySelector('.pu')!;
    expect(root.getAttribute('dir')).toBe('rtl');
    expect(m.container.querySelector('.seg')?.getAttribute('aria-label')).toBe('فلور');
    const latin = m.container.querySelector('.seg bdi')!;
    expect(latin.textContent).toBe('Ground floor');
    expect(latin.getAttribute('dir')).toBe('ltr');
    expect(m.container.querySelectorAll('.seg bdi')[1]!.getAttribute('dir')).toBe('rtl');
    // counts: Latin digits
    expect([...m.container.querySelectorAll('.seg .n')].map((n) => n.textContent)).toEqual(['12', '6']);
  });
});

describe('[02a §8 Top bar] FloorControl', () => {
  it('writes the choice and marks the selected floor; an empty list draws nothing', () => {
    const pick = vi.fn();
    m = mount();
    m.render(<FloorControl floors={FLOORS} selected={null} onSelect={pick} fill />);
    expect(m.container.querySelectorAll('button[aria-pressed="true"]').length).toBe(0);
    m.click(m.button('Family hall'));
    expect(pick).toHaveBeenCalledWith('F2');
    m.render(<FloorControl floors={[]} selected={null} onSelect={pick} />);
    expect(m.container.querySelector('.seg')).toBeNull();
  });
});
