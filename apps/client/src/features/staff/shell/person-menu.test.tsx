import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../../../../test/dom';
import { setLanguage } from '../../../i18n';
import { TopBar, type TopBarProps } from '../tables/TopBar';
import { ShellBanners } from './ShellBanners';

// 02b-TK A2 item 1 (frames ShellAnatomy, PersonMenu, DayNotStarted; MAPPING TK-SH01, TK-SH02, TK-SH03; 05a v1.0.6 §8
// C-1): the top bar's context slot, the one selected tab style (.is-sel), and the person chip's menu — Switch user,
// Lock screen, My shift, Sign out; the chip never signs out on one tap. The day / shift banners under the bar.

let m: Mounted;
afterEach(() => {
  m?.unmount();
  setLanguage('en');
});

function props(over: Partial<TopBarProps> = {}): TopBarProps {
  return {
    phone: false,
    portrait: false,
    brandName: 'Arif Chatkhara',
    deviceLine: 'Lake City · Cashier kiosk',
    floors: null,
    live: <span className="live">Live</span>,
    clock: '1:20 PM',
    person: { name: 'Sana' },
    requests: null,
    inbox: 0,
    title: 'Takeaway',
    phoneSub: 'Live',
    onNavigate: () => {},
    onSignOut: () => {},
    ...over,
  };
}

const chip = (root: ParentNode) => root.querySelector<HTMLButtonElement>('header.top button.me')!;
const menu = () => document.querySelector('[role="menu"]');
const items = () => [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];

describe('[02b-TK TK-SH02] the person chip menu', () => {
  it('[frame PersonMenu] one tap opens the menu, never signs out; Switch user · Lock screen · My shift · Sign out with their sub-lines', () => {
    const out = vi.fn();
    const sw = vi.fn();
    const lock = vi.fn();
    const go = vi.fn();
    m = mount();
    m.render(<TopBar {...props({ onSignOut: out, onNavigate: go, shift: true, menu: { onSwitch: sw, onLock: lock, shiftSub: 'Opened 7:02 AM · float Rs 5,000' } })} />);
    const me = chip(m.container);
    expect(me.getAttribute('aria-haspopup')).toBe('menu');
    expect(me.getAttribute('aria-expanded')).toBe('false');
    expect(menu()).toBeNull();
    m.click(me);
    expect(out).not.toHaveBeenCalled();
    expect(me.getAttribute('aria-expanded')).toBe('true');
    expect(menu()?.querySelector('.tk-pop__h')?.textContent).toContain('Sana');
    expect(items().map((i) => i.textContent)).toEqual([
      'Switch userHand the counter to someone else',
      'Lock screenYour orders stay as they are',
      'My shiftOpened 7:02 AM · float Rs 5,000',
      'Sign outUnsent orders are held first',
    ]);
    expect(items()[3]!.classList.contains('tk-mi--danger')).toBe(true);
    m.click(items()[0]);
    expect(sw).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
    m.click(me);
    m.click(items()[1]);
    expect(lock).toHaveBeenCalledTimes(1);
    m.click(me);
    m.click(items()[2]);
    expect(go).toHaveBeenCalledWith('/shift');
    m.click(me);
    m.click(items()[3]);
    expect(out).toHaveBeenCalledTimes(1);
  });

  it('Escape or a tap outside closes it; no shift grant → no My shift; the old one-tap shift button is gone from the bar', () => {
    m = mount();
    m.render(<TopBar {...props({ menu: { onSwitch: () => {}, onLock: () => {}, shiftSub: null } })} />);
    expect([...m.container.querySelectorAll('header.top button')].some((b) => b.textContent === 'My shift')).toBe(false);
    m.click(chip(m.container));
    expect(items().some((i) => i.textContent?.startsWith('My shift'))).toBe(false);
    expect(items()).toHaveLength(3);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(menu()).toBeNull();
    m.click(chip(m.container));
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(menu()).toBeNull();
  });

  it('[frame ShellAnatomy] the context slot ("New takeaway · Usman" + one sub-line) stands in for the brand block', () => {
    m = mount();
    m.render(<TopBar {...props({ context: { label: 'Token', token: '57', name: 'Usman', sub: 'Take payment' } })} />);
    const ctx = m.container.querySelector('header.top .tk-ctx')!;
    expect(ctx.querySelector('b')?.textContent).toBe('Token 57 · Usman');
    expect(ctx.querySelector('b [dir="ltr"]')?.textContent).toBe('57');
    expect(ctx.querySelector('small')?.textContent).toBe('Take payment');
    expect(m.container.querySelector('header.top .brand')).toBeNull();
    m.render(<TopBar {...props({ context: null })} />);
    expect(m.container.querySelector('.tk-ctx')).toBeNull();
    expect(m.container.querySelector('header.top .brand')).not.toBeNull();
  });

  it('[CHANGES §2 one selected style] the current tab carries .is-sel (and aria-current), no other does', () => {
    const tabs = [
      { key: 'takeaway' as const, path: '/takeaway', label: 'Takeaway', hint: null },
      { key: 'parking' as const, path: '/orders', label: 'Parking', hint: null },
    ];
    m = mount();
    m.render(<TopBar {...props({ tabs, currentTab: 'takeaway' })} />);
    const links = [...m.container.querySelectorAll('header.top nav.tabs-top a')];
    expect(links.map((a) => a.classList.contains('is-sel'))).toEqual([true, false]);
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual(['page', null]);
  });

  it('[Urdu] the menu reads in Urdu', () => {
    setLanguage('ur');
    m = mount();
    m.render(<TopBar {...props({ menu: { onSwitch: () => {}, onLock: () => {}, shiftSub: null } })} />);
    m.click(chip(m.container));
    expect(items().map((i) => i.querySelector('span')?.firstChild?.textContent)).toEqual(['یوزر بدلیں', 'اسکرین لاک کریں', 'سائن آؤٹ']);
  });
});

describe('[02b-TK TK-SH01, TK-SH03] the day / shift banners under the bar', () => {
  it('[frame DayNotStarted] no open day: the warn banner; Start day for a branch manage-stock holder, else "Ask the manager"', () => {
    m = mount();
    m.render(<ShellBanners day="closed" canStartDay place="Lake City · 7:04 AM" shift={null} onOpenShift={null} />);
    const b = m.container.querySelector('.tk-banner.tk-banner--warn')!;
    expect(b.textContent).toContain('Day not started — orders can’t be sent and times can’t show');
    expect(b.textContent).toContain('Lake City · 7:04 AM');
    expect(b.querySelector('a')?.getAttribute('href')).toBe('/admin/stock/');
    expect(b.querySelector('a')?.textContent).toBe('Start day');
    m.render(<ShellBanners day="closed" canStartDay={false} place={null} shift={null} onOpenShift={null} />);
    expect(m.container.querySelector('.tk-banner a')).toBeNull();
    expect(m.text()).toContain('Ask the manager to start the day');
    m.render(<ShellBanners day="open" canStartDay place={null} shift={null} onOpenShift={null} />);
    expect(m.container.querySelector('.tk-banner')).toBeNull();
    m.render(<ShellBanners day="unknown" canStartDay place={null} shift={null} onOpenShift={null} />);
    expect(m.container.querySelector('.tk-banner')).toBeNull();
  });

  it('[frame ShellAnatomy; 05 §6.16] no open shift: "No shift open — cash can’t be taken" + Open my shift; an open or unknown shift: none', () => {
    const open = vi.fn();
    m = mount();
    m.render(<ShellBanners day="open" canStartDay={false} place={null} shift={{ kind: 'none' }} onOpenShift={open} />);
    const b = m.container.querySelector('.tk-banner.tk-banner--warn')!;
    expect(b.textContent).toContain('No shift open — cash can’t be taken');
    m.click(m.button('Open my shift', b));
    expect(open).toHaveBeenCalledTimes(1);
    m.render(<ShellBanners day="open" canStartDay={false} place={null} shift={{ kind: 'open', opened_at: 1, float_minor: 0 }} onOpenShift={open} />);
    expect(m.container.querySelector('.tk-banner')).toBeNull();
    m.render(<ShellBanners day="open" canStartDay={false} place={null} shift={{ kind: 'unknown' }} onOpenShift={open} />);
    expect(m.container.querySelector('.tk-banner')).toBeNull();
    // the day comes first: both banners when both are missing
    m.render(<ShellBanners day="closed" canStartDay={false} place={null} shift={{ kind: 'none' }} onOpenShift={open} />);
    expect(m.container.querySelectorAll('.tk-banner')).toHaveLength(2);
    expect(m.container.querySelector('.tk-banner')?.textContent).toContain('Day not started');
  });
});

describe('[BUG-16; 02b v1.0.28 QK-3] the person menu language switch', () => {
  it('English / اردو: the current one checked; a pick calls onPick with that language and closes the menu', async () => {
    const { chooseLanguage, t } = await import('../../../i18n');
    const pickLang = vi.fn();
    m = mount();
    m.render(<TopBar {...props({ menu: { language: { current: 'en', onPick: pickLang } } })} />);
    m.click(chip(m.container));
    const radios = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitemradio"]')];
    expect(radios.map((r) => r.textContent)).toEqual(['English', 'اردو']);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    m.click(radios[1]!);
    expect(pickLang).toHaveBeenCalledWith('ur');
    expect(menu()).toBeNull();
    // chooseLanguage: stored per device, applied now; the lock text has its Urdu
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as unknown as Storage;
    chooseLanguage('ur', storage);
    expect(store.get('pos-lang')).toBe('ur');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(t('lock.sign_in')).not.toBe('Sign in to see details');
    chooseLanguage('en', storage);
    expect(store.get('pos-lang')).toBe('en');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });
});
