import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudAdmin } from '../../api/cloud-admin';
import { setLanguage } from '../../i18n';
import { BranchNames } from './branch';
import { BranchPicker } from './BranchPicker';
import { GuardProvider } from './guard';
import { LoginView } from './login/LoginView';
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

describe('[01a S50 a, Pulse 01a-A] owner shell, sign in and picker in the Pulse layout', () => {
  it('laptop: the shell fits the screen and only the content region scrolls; brand avatar, name and "Restaurant setup"', () => {
    renderShell();
    const main = container.querySelector('.pos-page.pos-page--fit > .pos-shell > .pos-shell__main > main.pos-content');
    expect(main).not.toBeNull();
    expect(container.querySelector('.pos-shell > nav.pos-sidenav:not(.pos-sidenav--drawer)')).not.toBeNull();
    const brand = container.querySelector('.pos-sidenav__brand')!;
    expect(brand.querySelector('.pos-avatar')?.textContent).toBe('A');
    expect(brand.querySelector('strong')?.textContent).toBe('Arif');
    expect(brand.querySelector(':scope > div > span')?.textContent).toBe('Restaurant setup');
    expect(container.querySelector('.pos-drawer__close')).toBeNull();
  });

  it('[01a §10 #180] phone: the Menu button reports the drawer; the close button and a scrim tap close it and focus returns to Menu', () => {
    stubPhone();
    renderShell();
    expect(container.querySelector('.pos-page--fit')).toBeNull();
    const menu = container.querySelector<HTMLButtonElement>('.pos-appbar.pos-appbar--phone > button.pos-more[aria-label="Menu"]')!;
    expect(menu.getAttribute('aria-haspopup')).toBe('dialog');
    expect(menu.getAttribute('aria-expanded')).toBe('false');

    for (const how of ['close', 'scrim'] as const) {
      act(() => {
        menu.focus();
        menu.click();
      });
      expect(menu.getAttribute('aria-expanded')).toBe('true');
      const layer = container.querySelector('.pos-drawer-layer')!;
      const dialog = layer.querySelector('[role="dialog"]')!;
      const nav = dialog.querySelector('nav.pos-sidenav.pos-sidenav--drawer')!;
      const close = nav.querySelector<HTMLButtonElement>(':scope > button.pos-more.pos-drawer__close')!;
      expect(close.getAttribute('aria-label')).toBe('Close the side menu');
      expect(document.activeElement).toBe(close);
      act(() => (how === 'close' ? close : layer.querySelector<HTMLElement>(':scope > .pos-scrim')!).click());
      expect(container.querySelector('.pos-drawer-layer')).toBeNull();
      expect(menu.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(menu);
    }
  });

  it('picker: a note under the tiles while a branch has no name, gone once names load; one link line to the menu', () => {
    const ids = ['01JBRANCHONE0000000000P0AB', '01JBRANCHTWO0000000000M6PQ'];
    const picker = (names: ReadonlyMap<string, string>) =>
      act(() =>
        root.render(
          <BranchNames.Provider value={names}>
            <BranchPicker branchIds={ids} selectedId={ids[0]!} userName="Arif" onContinue={() => {}} onSignOut={() => {}} />
          </BranchNames.Provider>,
        ),
      );
    picker(new Map());
    const note = container.querySelector('.pos-tiles--pick + .pos-note');
    expect(note?.textContent).toBe(
      'Branch names show once they are set in Branch settings. Until then the end of each branch’s ID shows.',
    );
    const line = container.querySelector('p.pos-linkline')!;
    expect(line.querySelector('span')?.textContent).toBe('Menu is the same for every branch.');
    expect(line.querySelector('a')?.getAttribute('href')).toBe('#/menu');
    expect(line.querySelector('a')?.textContent).toBe('Open the menu');
    expect(container.querySelector('.pos-callout')).toBeNull();
    expect(container.querySelector('.pos-appbar .pos-sidenav__brand strong')?.textContent).toBe('Arif');
    expect(container.querySelector('.pos-picker__go > button.pos-btn--primary')?.textContent).toBe('Continue with …P0AB');

    picker(new Map([[ids[0]!, 'Gulberg'], [ids[1]!, 'Johar Town']]));
    expect(container.querySelector('.pos-note')).toBeNull();
    expect(container.querySelector('.pos-picker__go > button.pos-btn--primary')?.textContent).toBe('Continue with Gulberg');
  });

  it('sign in: brand aside with the second sentence marked; the Show button sits in the 56 px affix; a large block Sign in', () => {
    act(() => root.render(<LoginView api={api} onLoggedIn={() => {}} />));
    const aside = container.querySelector('.pos-login > aside.pos-login__aside')!;
    expect(aside.querySelector('.pos-login__mark strong')?.textContent).toBe('POS');
    expect(aside.querySelector('h1')?.textContent).toBe('Set up your restaurant once. Every branch follows.');
    expect(aside.querySelector('h1 em')?.textContent).toBe('Every branch follows.');
    const show = container.querySelector<HTMLButtonElement>('.pos-input-affix > span > button.pos-btn')!;
    expect(show.textContent).toBe('Show');
    act(() => show.click());
    expect(container.querySelector<HTMLInputElement>('.pos-input-affix > input')?.type).toBe('text');
    expect(container.querySelector('button[type="submit"]')?.className).toBe('pos-btn pos-btn--primary pos-btn--lg pos-btn--block');
  });
});
