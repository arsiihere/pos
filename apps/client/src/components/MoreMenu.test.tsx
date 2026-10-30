import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';
import { Drawer } from './Drawer';
import { MoreMenu } from './MoreMenu';

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
});

const $ = <T extends Element = HTMLElement>(selector: string) => {
  const el = container.querySelector<T & Element>(selector);
  if (el === null) throw new Error(`${selector} missing`);
  return el as T;
};

function key(target: Element, name: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  });
}

describe('MoreMenu (Pulse ⋯ menu, 01a hand-off CHANGES §2)', () => {
  function renderMenu(onArchive = vi.fn(), onShow = vi.fn()) {
    act(() =>
      root.render(
        <header className="pos-appbar">
          <MoreMenu
            label="More for Paye"
            info={{ title: 'Archive', detail: 'It disappears from ordering. Past orders keep it.' }}
            items={[
              { label: 'Show archived items', onSelect: onShow },
              { label: 'Locked', onSelect: vi.fn(), disabled: true },
              { label: 'Archive Paye', onSelect: onArchive, danger: true },
            ]}
          />
          <button type="button">outside</button>
        </header>,
      ),
    );
    return { onArchive, onShow };
  }

  it('a 56 px ⋯ button with aria-haspopup="menu" opens a menu with an info head and its items', () => {
    renderMenu();
    const more = $<HTMLButtonElement>('button.pos-more');
    expect(more.getAttribute('aria-label')).toBe('More for Paye');
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(more.querySelector('svg.pos-icon')).not.toBeNull();
    expect(container.querySelector('.pos-menu')).toBeNull();

    act(() => more.click());
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const menu = $('.pos-menu');
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.getAttribute('aria-label')).toBe('More for Paye');
    expect(menu.querySelector('.pos-menu__info b')?.textContent).toBe('Archive');
    expect(menu.querySelector('.pos-menu__info span')?.textContent).toBe('It disappears from ordering. Past orders keep it.');
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button.pos-menu__item')];
    expect(items.map((b) => [b.textContent, b.getAttribute('role'), b.disabled])).toEqual([
      ['Show archived items', 'menuitem', false],
      ['Locked', 'menuitem', true],
      ['Archive Paye', 'menuitem', false],
    ]);
    expect(items[2]?.classList.contains('pos-menu__item--danger')).toBe(true);
    expect(items[0]?.classList.contains('pos-menu__item--danger')).toBe(false);
    // Focus moves to the first item.
    expect(document.activeElement).toBe(items[0]);
  });

  it('a pick calls it, closes the menu and returns focus to the ⋯ button', () => {
    const { onArchive } = renderMenu();
    const more = $<HTMLButtonElement>('button.pos-more');
    act(() => more.click());
    act(() => [...container.querySelectorAll<HTMLButtonElement>('.pos-menu__item')][2]!.click());
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.pos-menu')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('Escape closes it and returns focus; arrow keys move between enabled items', () => {
    renderMenu();
    const more = $<HTMLButtonElement>('button.pos-more');
    act(() => more.click());
    const items = [...container.querySelectorAll<HTMLButtonElement>('.pos-menu__item')];
    key(items[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(items[2]); // skips the disabled one
    key(items[2]!, 'ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    key(items[0]!, 'ArrowUp');
    expect(document.activeElement).toBe(items[2]);
    key(items[2]!, 'Escape');
    expect(container.querySelector('.pos-menu')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('Tab closes it (items are not tab stops; arrow keys move focus)', () => {
    renderMenu();
    const more = $<HTMLButtonElement>('button.pos-more');
    act(() => more.click());
    const items = [...container.querySelectorAll<HTMLButtonElement>('.pos-menu__item')];
    expect(items.map((b) => b.tabIndex)).toEqual([-1, -1, -1]);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => {
      items[0]!.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(false); // focus moves on naturally
    expect(container.querySelector('.pos-menu')).toBeNull();
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });

  it('Escape inside a Dialog closes only the menu, not the dialog', () => {
    const onClose = vi.fn();
    act(() =>
      root.render(
        <Dialog title="Edit" onClose={onClose}>
          <div className="pos-section">
            <MoreMenu label="More for Paye" items={[{ label: 'Archive Paye', onSelect: vi.fn(), danger: true }]} />
          </div>
        </Dialog>,
      ),
    );
    const more = $<HTMLButtonElement>('button.pos-more');
    act(() => more.click());
    key($('.pos-menu__item'), 'Escape');
    expect(container.querySelector('.pos-menu')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('two items with the same label both render', () => {
    act(() =>
      root.render(
        <header className="pos-appbar">
          <MoreMenu label="More" items={[{ label: 'Same', onSelect: vi.fn() }, { label: 'Same', onSelect: vi.fn() }]} />
        </header>,
      ),
    );
    act(() => $<HTMLButtonElement>('button.pos-more').click());
    expect(container.querySelectorAll('.pos-menu__item')).toHaveLength(2);
  });

  it('an outside tap closes it without a pick; the ⋯ button toggles it', () => {
    const { onShow, onArchive } = renderMenu();
    const more = $<HTMLButtonElement>('button.pos-more');
    act(() => more.click());
    act(() => {
      container.querySelector('.pos-menu__info')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(container.querySelector('.pos-menu')).not.toBeNull();
    act(() => {
      $('header > button:not(.pos-more)').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(container.querySelector('.pos-menu')).toBeNull();
    expect(onShow).not.toHaveBeenCalled();
    expect(onArchive).not.toHaveBeenCalled();

    act(() => more.click());
    expect(container.querySelector('.pos-menu')).not.toBeNull();
    act(() => more.click());
    expect(container.querySelector('.pos-menu')).toBeNull();
  });
});

describe('Drawer (owner phone side menu, spec 01a S50 a v1.3.1)', () => {
  const onClose = vi.fn();
  function renderDrawer(open: boolean) {
    act(() =>
      root.render(
        <>
          <button type="button" id="opener">
            open
          </button>
          {open && (
            <Drawer label="Restaurant setup" onClose={onClose}>
              <nav className="pos-sidenav pos-sidenav--drawer">
                <button type="button" className="pos-more pos-drawer__close" onClick={onClose}>
                  x
                </button>
                <a href="#/menu">Menu</a>
                <button type="button">Sign out</button>
              </nav>
            </Drawer>
          )}
        </>,
      ),
    );
  }

  function openFromOpener() {
    renderDrawer(false);
    act(() => $<HTMLButtonElement>('#opener').focus());
    renderDrawer(true);
  }

  it('a modal dialog over a scrim; focus moves in and Tab stays inside', () => {
    openFromOpener();
    const layer = $('.pos-drawer-layer');
    expect(layer.querySelector(':scope > .pos-scrim')).not.toBeNull();
    const dialog = $('[role="dialog"]');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Restaurant setup');
    expect(document.activeElement).toBe($('.pos-drawer__close'));
    const last = $<HTMLButtonElement>('nav > button:last-child');
    act(() => last.focus());
    key(last, 'Tab');
    expect(document.activeElement).toBe($('.pos-drawer__close'));
    act(() => {
      $('.pos-drawer__close').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    });
    expect(document.activeElement).toBe(last);
  });

  it('Escape and a scrim tap call onClose; focus returns to the opener when it goes away', () => {
    onClose.mockClear();
    openFromOpener();
    key($('[role="dialog"]'), 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => $('.pos-scrim').click());
    expect(onClose).toHaveBeenCalledTimes(2);
    renderDrawer(false);
    expect(document.activeElement).toBe($('#opener'));
  });
});
