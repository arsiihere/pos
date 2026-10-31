import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { ActionBar } from './ActionBar';
import { AppBar } from './AppBar';
import { Chip } from './Chip';
import { ConfirmDialog, Dialog } from './Dialog';
import { EmptyState } from './EmptyState';
import { SavedChip, UndoChip, useFlash } from './FlashChip';
import { Icon } from './Icon';
import { List, ListRow } from './List';
import { Segmented } from './Segmented';
import { SideNav } from './SideNav';
import { Skeleton } from './Skeleton';
import { StaffTiles } from './StaffTiles';
import { Switch } from './Switch';

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
  vi.useRealTimers();
});

function render(node: React.ReactNode): void {
  act(() => root.render(node));
}

function $(selector: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`${selector} missing`);
  return el;
}

function click(el: Element): void {
  act(() => {
    (el as HTMLElement).click();
  });
}

function key(el: Element, k: string, shiftKey = false): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));
  });
}

describe('[01a S50] kit components', () => {
  it('Icon draws a kit icon, hidden from screen readers', () => {
    render(<Icon name="check" />);
    const svg = $('svg');
    expect(svg.getAttribute('class')).toBe('pos-icon');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelector('path')).not.toBeNull();
  });

  it('AppBar: title, content after it, end slot; phone variant', () => {
    render(
      <AppBar title="Menu" after={<span className="pos-chip">Shared</span>}>
        <button type="button">New item</button>
      </AppBar>,
    );
    const bar = $('header');
    expect(bar.className).toBe('pos-appbar');
    expect($('h1.pos-appbar__title').textContent).toBe('Menu');
    expect(bar.querySelector('.pos-chip')?.textContent).toBe('Shared');
    expect($('.pos-appbar__end button').textContent).toBe('New item');

    render(<AppBar title="Naan" phone start={<a href="#/menu">Back</a>} />);
    expect($('header').className).toBe('pos-appbar pos-appbar--phone');
    expect($('header').firstElementChild?.tagName).toBe('A');
    expect(container.querySelector('.pos-appbar__end')).toBeNull();
  });

  it('SideNav marks the current item and lets a guard stop navigation', () => {
    const onNavigate = vi.fn<(href: string) => boolean>(() => false);
    render(
      <SideNav
        label="Restaurant setup"
        brand={{ title: 'Restaurant setup', sub: 'Gulberg' }}
        items={[
          { href: '#/menu', icon: 'list', label: 'Menu', count: 42, current: true },
          { href: '#/floors', icon: 'grid', label: 'Floors and tables' },
        ]}
        onNavigate={onNavigate}
        foot={<button type="button">Sign out</button>}
      />,
    );
    const nav = $('nav.pos-sidenav');
    expect(nav.getAttribute('aria-label')).toBe('Restaurant setup');
    expect($('.pos-sidenav__brand strong').textContent).toBe('Restaurant setup');
    const links = [...container.querySelectorAll<HTMLAnchorElement>('a.pos-sidenav__item')];
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual(['page', null]);
    expect(links[0]?.querySelector('small')?.textContent).toBe('42');
    expect($('.pos-sidenav__foot button').textContent).toBe('Sign out');

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      links[1]?.dispatchEvent(event);
    });
    expect(onNavigate).toHaveBeenCalledWith('#/floors');
    expect(event.defaultPrevented).toBe(true);
  });

  it('SideNav brand: an initials avatar, a name and a line; the drawer form has a close button', () => {
    const onClose = vi.fn();
    render(
      <SideNav
        label="Restaurant setup"
        brand={{ title: 'Arif Chatkhara', sub: 'Restaurant setup', avatar: 'arif  chatkhara khan' }}
        items={[{ href: '#/menu', icon: 'list', label: 'Menu', current: true }]}
        drawer={{ onClose, closeLabel: 'Close the side menu' }}
      />,
    );
    expect($('.pos-sidenav__brand > .pos-avatar').textContent).toBe('AC');
    expect($('.pos-sidenav__brand > .pos-avatar').getAttribute('aria-hidden')).toBe('true');
    expect($('.pos-sidenav__brand strong').textContent).toBe('Arif Chatkhara');
    expect($('.pos-sidenav__brand div > span').textContent).toBe('Restaurant setup');
    expect($('nav').className).toBe('pos-sidenav pos-sidenav--drawer');
    const close = $('button.pos-more.pos-drawer__close');
    expect(close.getAttribute('aria-label')).toBe('Close the side menu');
    click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('List with a column preset, a head and rows', () => {
    render(
      <List preset="menu" head={['Item', 'Price']}>
        <ListRow touched>a</ListRow>
        <ListRow muted>b</ListRow>
      </List>,
    );
    expect($('ul').className).toBe('pos-list pos-list--menu');
    expect($('li.pos-list__head').textContent).toBe('ItemPrice');
    const rows = [...container.querySelectorAll('li.pos-list__row')];
    expect(rows.map((r) => r.className)).toEqual(['pos-list__row is-touched', 'pos-list__row is-muted']);

    render(<List busy>{null}</List>);
    expect($('ul').className).toBe('pos-list');
    expect($('ul').getAttribute('aria-busy')).toBe('true');
  });

  it('Switch is a button with role="switch" that reports the next state', () => {
    const onChange = vi.fn();
    render(<Switch checked label="Selling" onChange={onChange} />);
    const sw = $('button.pos-switch');
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.querySelector('.pos-switch__track')).not.toBeNull();
    expect(sw.textContent).toBe('Selling');
    click(sw);
    expect(onChange).toHaveBeenCalledWith(false);

    render(<Switch checked={false} label="Selling" onChange={onChange} disabled />);
    expect($('button.pos-switch').getAttribute('aria-checked')).toBe('false');
    expect(($('button.pos-switch') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Segmented: aria-pressed, counts, arrow keys follow the reading direction', () => {
    function Harness() {
      const [value, setValue] = useState('items');
      return (
        <Segmented
          label="Section"
          value={value}
          onChange={setValue}
          options={[
            { value: 'items', label: 'Items', count: 42 },
            { value: 'cats', label: 'Categories' },
            { value: 'tax', label: 'Tax rates' },
          ]}
        />
      );
    }
    render(<Harness />);
    const group = $('.pos-seg');
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Section');
    const opts = () => [...container.querySelectorAll<HTMLButtonElement>('.pos-seg__opt')];
    expect(opts().map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(opts()[0]?.querySelector('.pos-seg__count')?.textContent).toBe('42');

    click(opts()[2] as HTMLButtonElement);
    expect(opts().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);

    key(opts()[2] as HTMLButtonElement, 'ArrowLeft');
    expect(opts().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(document.activeElement).toBe(opts()[1]);
    key(opts()[1] as HTMLButtonElement, 'ArrowRight');
    expect(opts()[2]?.getAttribute('aria-pressed')).toBe('true');
    key(opts()[2] as HTMLButtonElement, 'ArrowRight');
    expect(opts()[2]?.getAttribute('aria-pressed')).toBe('true');
  });

  it('Segmented in RTL: ArrowLeft moves to the next option', () => {
    container.setAttribute('dir', 'rtl');
    const onChange = vi.fn();
    render(
      <Segmented
        label="Hours"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
      />,
    );
    key($('.pos-seg__opt'), 'ArrowLeft');
    expect(onChange).toHaveBeenCalledWith('b');
    container.removeAttribute('dir');
  });

  it('Chip: a status tone always has an icon and a word; a button chip calls back', () => {
    render(<Chip tone="ok">Saved</Chip>);
    expect($('span.pos-chip').className).toBe('pos-chip pos-chip--ok');
    expect($('.pos-chip svg.pos-icon')).not.toBeNull();
    expect($('.pos-chip').textContent).toBe('Saved');

    render(<Chip>Gulberg</Chip>);
    expect($('.pos-chip').className).toBe('pos-chip');
    expect(container.querySelector('.pos-chip svg')).toBeNull();

    const onClick = vi.fn();
    render(
      <Chip tone="warn" onClick={onClick}>
        Low: Paye
      </Chip>,
    );
    const button = $('button.pos-chip');
    expect(button.getAttribute('type')).toBe('button');
    click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ActionBar: info on the start side, actions at the end', () => {
    render(
      <ActionBar info={<strong>3 counts</strong>}>
        <button type="button">Save</button>
      </ActionBar>,
    );
    expect($('footer').className).toBe('pos-actionbar');
    expect($('.pos-actionbar__info').textContent).toBe('3 counts');
    expect($('.pos-actionbar__end button').textContent).toBe('Save');
  });

  it('EmptyState: heading, body, actions', () => {
    render(
      <EmptyState title="No items match" body="Check the spelling.">
        <button type="button">Clear search</button>
      </EmptyState>,
    );
    expect($('.pos-empty h3').textContent).toBe('No items match');
    expect($('.pos-empty p').textContent).toBe('Check the spelling.');
    expect($('.pos-empty button').textContent).toBe('Clear search');
  });

  it('Skeleton: busy placeholder lines with a spoken label', () => {
    render(<Skeleton lines={3} />);
    const box = $('[aria-busy="true"]');
    expect(box.getAttribute('role')).toBe('status');
    expect(box.getAttribute('aria-label')).toBe(t('common.loading'));
    expect(box.querySelectorAll('.pos-skeleton')).toHaveLength(3);
  });

  it('SavedChip shows for 3 s after flash()', () => {
    vi.useFakeTimers();
    function Harness() {
      const saved = useFlash(3_000);
      return (
        <>
          <button type="button" onClick={saved.flash}>
            go
          </button>
          <SavedChip shown={saved.shown} />
        </>
      );
    }
    render(<Harness />);
    expect(container.querySelector('.pos-chip')).toBeNull();
    click($('button'));
    expect($('.pos-chip--ok').textContent).toBe(t('common.saved'));
    expect($('.pos-chip--ok').closest('[role="status"]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(2_999));
    expect(container.querySelector('.pos-chip')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('.pos-chip')).toBeNull();
  });

  it('UndoChip calls onUndo, or onDone after 8 s; paused holds it open', () => {
    vi.useFakeTimers();
    const onUndo = vi.fn();
    const onDone = vi.fn();
    render(<UndoChip onUndo={onUndo} onDone={onDone} />);
    expect($('[role="status"]').textContent).toContain(t('archive.archived'));
    click($('button'));
    expect(onUndo).toHaveBeenCalledTimes(1);

    render(<UndoChip key="2" onUndo={onUndo} onDone={onDone} />);
    act(() => vi.advanceTimersByTime(7_999));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);

    onDone.mockClear();
    render(<UndoChip key="3" paused onUndo={onUndo} onDone={onDone} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDone).not.toHaveBeenCalled();
    render(<UndoChip key="3" onUndo={onUndo} onDone={onDone} />);
    act(() => vi.advanceTimersByTime(8_000));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('[01a §10 #161 component part] Dialog traps Tab, closes on Escape and returns focus to its trigger', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" id="trigger" onClick={() => setOpen(true)}>
            Archive
          </button>
          {open && (
            <Dialog title="Archive Paye?" onClose={() => setOpen(false)} footer={<button type="button">Last</button>}>
              <button type="button" id="first">
                First
              </button>
            </Dialog>
          )}
        </>
      );
    }
    render(<Harness />);
    const trigger = $('#trigger');
    trigger.focus();
    click(trigger);

    const dialog = $('[role="dialog"]');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const titleId = dialog.getAttribute('aria-labelledby');
    expect(titleId).toBeTruthy();
    expect(document.getElementById(titleId ?? '')?.textContent).toBe('Archive Paye?');
    expect(dialog.parentElement?.className).toBe('pos-scrim');
    expect(document.activeElement?.id).toBe('first');

    const last = [...dialog.querySelectorAll('button')].at(-1) as HTMLButtonElement;
    last.focus();
    key(last, 'Tab');
    expect(document.activeElement?.id).toBe('first');
    key($('#first'), 'Tab', true);
    expect(document.activeElement).toBe(last);

    key(dialog, 'Escape');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('ConfirmDialog names the action; Cancel sends nothing', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Archive Paye?"
        body="It disappears from ordering."
        confirmLabel="Archive Paye"
        tone="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect($('.pos-dialog').className).toBe('pos-dialog pos-dialog--form');
    expect($('.pos-dialog__body').textContent).toBe('It disappears from ordering.');
    const [cancel, confirm] = [...container.querySelectorAll<HTMLButtonElement>('.pos-dialog__footer button')];
    expect(cancel?.textContent).toBe(t('common.cancel'));
    expect(confirm?.className).toBe('pos-btn pos-btn--danger');
    expect(confirm?.textContent).toBe('Archive Paye');
    click(cancel as HTMLButtonElement);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    click(confirm as HTMLButtonElement);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('[01a S54 d] StaffTiles: the hub decides locked; the note rounds minutes up on the device clock', () => {
    const now = 1_000_000;
    render(
      <StaffTiles
        now={now}
        staff={[
          { staff_id: 'S1', display_name: 'Imran', locked_until: now + 13 * 60_000 + 1_000 },
          { staff_id: 'S2', display_name: 'Bilal', locked_until: now - 1 },
          { staff_id: 'S3', display_name: 'Sara', locked_until: null },
        ]}
        selectedId={null}
        onPick={() => {}}
      />,
    );
    const tiles = [...container.querySelectorAll<HTMLButtonElement>('.pos-staff__tile')];
    expect(tiles[0]?.disabled).toBe(true);
    expect(tiles[0]?.className).toBe('pos-staff__tile is-locked');
    expect(tiles[0]?.querySelector('small')?.textContent).toBe('Locked · 14 min');
    // A device clock past locked_until (wrong clock): still locked, no minutes.
    expect(tiles[1]?.disabled).toBe(true);
    expect(tiles[1]?.querySelector('small')?.textContent).toBe(t('staff.locked'));
    expect(tiles[2]?.disabled).toBe(false);
  });
});
