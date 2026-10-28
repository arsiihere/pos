import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudAdmin } from '../../api/cloud-admin';
import { setLanguage } from '../../i18n';
import { GuardProvider } from './guard';
import { Page, Shell } from './Shell';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setLanguage('en');
  vi.unstubAllGlobals();
  window.location.hash = '';
});

const api = createCloudAdmin({ onLoggedOut: () => {}, fetch: async () => new Response('{}', { status: 200 }) });

function renderShell(route = '/staff') {
  act(() =>
    root.render(
      <GuardProvider>
        <Shell route={route} userName="Arif" counts={{ staff: 9, roles: 7, branches: 3 }} onSignOut={() => {}}>
          <Page api={api} title="Staff">
            <p>body</p>
          </Page>
        </Shell>
      </GuardProvider>,
    ),
  );
}

// The side nav as text: group headings as "# name", items as "label [count]", in order.
function navOutline(nav: Element) {
  return [...nav.querySelectorAll(':scope > .pos-sidenav__group, :scope > .pos-sidenav__item')].map((el) =>
    el.classList.contains('pos-sidenav__group')
      ? `# ${el.textContent}`
      : `${el.childNodes[1]?.textContent}${el.querySelector('small') ? ` [${el.querySelector('small')?.textContent}]` : ''}`,
  );
}

function stubPhone() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-width: 760px)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('[01b §8] owner shell (design handoff README §9)', () => {
  it('laptop: Menu, Floors and tables, Kitchen stations; People: Staff, Roles, Teams, Stock counting; Branches: Branches and settings; counts; foot', () => {
    renderShell();
    const nav = container.querySelector('nav.pos-sidenav')!;
    expect(navOutline(nav)).toEqual([
      'Menu',
      'Floors and tables',
      'Kitchen stations',
      '# People',
      'Staff [9]',
      'Roles [7]',
      'Teams',
      'Stock counting',
      '# Branches',
      'Branches and settings [3]',
    ]);
    expect(nav.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('#/staff');
    expect(nav.querySelector('.pos-sidenav__item small .pos-ltr')?.textContent).toBe('9');
    const foot = nav.querySelector('.pos-sidenav__foot')!;
    expect(foot.querySelector('.pos-sidenav__who')?.textContent).toBe('Arif');
    expect(foot.querySelector('a.pos-sidenav__item')?.getAttribute('href')).toBe('#/account/password');
    expect(foot.querySelector('a.pos-sidenav__item')?.textContent).toBe('Change password');
    expect(foot.querySelector('button')?.textContent).toBe('Sign out');
    expect(foot.querySelector('button svg.pos-icon')).not.toBeNull();
    expect(container.querySelector('.pos-appbar button[aria-label="Menu"]')).toBeNull();
  });

  it('laptop, Urdu: the nav texts come from the Urdu screens', () => {
    setLanguage('ur');
    renderShell();
    const nav = container.querySelector('nav.pos-sidenav')!;
    expect(navOutline(nav)).toEqual([
      'مینیو',
      'فلور اور میزیں',
      'کچن اسٹیشن',
      '# لوگ',
      'اسٹاف [9]',
      'رولز [7]',
      'ٹیمیں',
      'اسٹاک کی گنتی',
      '# برانچیں',
      'برانچیں اور سیٹنگ [3]',
    ]);
    expect(nav.querySelector('.pos-sidenav__foot a')?.textContent).toBe('پاس ورڈ بدلیں');
  });

  // P-4 answer B: on a phone the app bar's Menu button opens the side nav as an overlay on the kit Dialog;
  // no tab bar. Change password and Sign out are reachable from it.
  it('[01a §10 #180] phone: Menu button opens the nav on Dialog (role, Escape, focus trap and return); items, foot and navigation', async () => {
    stubPhone();
    renderShell();
    expect(container.querySelector('nav.pos-sidenav')).toBeNull();
    expect(container.querySelector('nav.pos-actionbar--tabs')).toBeNull();
    const menu = container.querySelector<HTMLButtonElement>('.pos-appbar button[aria-label="Menu"]')!;
    expect(menu).not.toBeNull();

    const open = () => {
      act(() => {
        menu.focus();
        menu.click();
      });
      const dialog = container.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
      if (dialog === null) throw new Error('nav dialog missing');
      return dialog;
    };

    let dialog = open();
    const nav = dialog.querySelector('nav.pos-sidenav')!;
    expect([...nav.querySelectorAll(':scope > a.pos-sidenav__item')].map((a) => a.getAttribute('href'))).toEqual([
      '#/menu',
      '#/floors',
      '#/stations',
      '#/staff',
      '#/roles',
      '#/teams',
      '#/stock-counting',
      '#/branches',
    ]);
    expect(nav.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('#/staff');
    const foot = nav.querySelector('.pos-sidenav__foot')!;
    expect(foot.querySelector('a')?.getAttribute('href')).toBe('#/account/password');
    expect(foot.querySelector('button')?.textContent).toBe('Sign out');

    // Focus moves in and Tab stays inside.
    expect(dialog.contains(document.activeElement)).toBe(true);
    const focusables = [...dialog.querySelectorAll<HTMLElement>('button, [href]')];
    act(() => focusables.at(-1)!.focus());
    act(() => {
      focusables.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(focusables[0]);

    // Escape closes and focus returns to the Menu button.
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(menu);

    // A nav item closes the overlay and navigates.
    dialog = open();
    await act(async () => dialog.querySelector<HTMLAnchorElement>('a[href="#/roles"]')!.click());
    expect(window.location.hash).toBe('#/roles');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
