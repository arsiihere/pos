import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, type Mounted } from '../features/owner/test-api';
import { BranchRow } from './BranchRow';
import { ErrorSummary } from './ErrorSummary';
import { Gone } from './Gone';
import { InUseDialog } from './InUseDialog';
import { RemovedRows } from './RemovedRows';
import { StaleBanner } from './StaleBanner';

let m: Mounted;
beforeEach(() => {
  m = mount();
});
afterEach(() => m.unmount());

describe('[01c §8] shared 01c patterns', () => {
  it('[01c-B03] StaleBanner: "Changed elsewhere", the body and Reload (primary on a form, row-styled in a row)', async () => {
    const onReload = vi.fn();
    await m.render(<StaleBanner onReload={onReload} />);
    const banner = m.container.querySelector('.pos-banner--warn')!;
    expect(banner.querySelector('p')?.firstChild?.textContent).toBe('Changed elsewhere');
    expect(banner.querySelector('small')?.textContent).toBe(
      'Someone saved this after you opened it. What you typed is still here — copy it, then reload.',
    );
    const reload = button(banner, 'Reload');
    expect(reload.className).toContain('pos-btn--primary');
    await click(reload);
    expect(onReload).toHaveBeenCalledOnce();
    await m.render(<StaleBanner row onReload={onReload} />);
    expect(button(m.container, 'Reload').className).toContain('pos-btn--row');
    expect(m.container.querySelector('.pos-btn--primary')).toBeNull();
  });

  it('[01c Q17] Gone: the title, the line and Back to {list} as the one primary', async () => {
    const onBack = vi.fn();
    await m.render(<Gone title="This deal isn't here any more" body="It may have been deleted on another device." back="Back to Deals" onBack={onBack} />);
    const gone = m.container.querySelector('.pos-gone')!;
    expect(gone.querySelector('h2')?.textContent).toBe("This deal isn't here any more");
    expect(gone.querySelector('.pos-gone__icon svg')).not.toBeNull();
    await click(button(gone, 'Back to Deals'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('[01c-B01] ErrorSummary: one danger banner "{n} things to fix before saving" whose links focus the field', async () => {
    await m.render(
      <>
        <ErrorSummary entries={[{ target: 'f-name', label: 'Name' }, { target: 'f-unit', label: 'Counted in' }]} />
        <input id="f-name" />
        <div id="f-unit">
          <button type="button">piece</button>
        </div>
      </>,
    );
    const banners = m.container.querySelectorAll('.pos-banner--danger');
    expect(banners).toHaveLength(1);
    expect(banners[0]?.querySelector('p')?.firstChild?.textContent).toBe('2 things to fix before saving');
    const links = [...banners[0]!.querySelectorAll('a')];
    expect(links.map((a) => a.textContent)).toEqual(['Name', 'Counted in']);
    act(() => links[1]!.click());
    expect(document.activeElement?.textContent).toBe('piece');
    act(() => links[0]!.click());
    expect(document.activeElement?.id).toBe('f-name');
    await m.render(<ErrorSummary entries={[{ target: 'f-name', label: 'Name' }]} />);
    expect(m.container.querySelector('.pos-banner p')?.firstChild?.textContent).toBe('1 thing to fix before saving');
    await m.render(<ErrorSummary entries={[]} />);
    expect(m.container.querySelector('.pos-banner')).toBeNull();
  });

  it('[01c-B06] RemovedRows: "Removed" rows with Restore by id; nothing when none', async () => {
    const onRestore = vi.fn();
    await m.render(<RemovedRows rows={[{ id: 'O9', label: 'Kulcha' }]} onRestore={onRestore} />);
    const removed = m.container.querySelector('.pos-removed')!;
    expect(removed.querySelector('.pos-removed__head')?.textContent).toBe('Removed');
    expect(removed.querySelector('.pos-removed__row span')?.textContent).toBe('Kulcha');
    await click(button(removed, 'Restore'));
    expect(onRestore).toHaveBeenCalledWith('O9');
    await m.render(<RemovedRows rows={[]} onRestore={onRestore} />);
    expect(m.container.querySelector('.pos-removed')).toBeNull();
  });

  it('[01c-D04] InUseDialog: title, body, each user with Open, "and N more", Close is the one primary; Escape closes', async () => {
    const onClose = vi.fn();
    await m.render(
      <InUseDialog
        name="Karahi pot"
        body="These dishes take from it."
        rows={[{ name: 'Chicken Karahi — Half', href: '#/menu?item=I1' }, { name: 'Chicken Karahi — Full', href: '#/menu?item=I2' }]}
        unnamed={1}
        onClose={onClose}
      />,
    );
    const dialog = m.container.querySelector('[role="alertdialog"]')!;
    expect(dialog.querySelector('.pos-dialog__title')?.textContent).toBe("Karahi pot can't be archived yet");
    expect(dialog.querySelector('.pos-dialog__body')?.textContent).toBe('These dishes take from it.');
    expect([...dialog.querySelectorAll('a.pos-btn')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Open', '#/menu?item=I1'],
      ['Open', '#/menu?item=I2'],
    ]);
    expect(dialog.querySelector('.pos-note')?.textContent).toBe('and 1 more');
    expect([...dialog.querySelectorAll('.pos-btn--primary')].map((b) => b.textContent)).toEqual(['Close']);
    act(() => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
    await m.render(<InUseDialog name="Naan" rows={[]} onClose={onClose} />);
    expect(m.container.querySelector('.pos-dialog__body')?.textContent).toBe('Still in use. Archive or move what uses it first.');
  });

  it('[01c Q15] BranchRow: collapsed to name + chips; row Save (.pos-btn--row) only when dirty; stale shows in the row only', async () => {
    const onSave = vi.fn();
    const onReload = vi.fn();
    const row = (props: { dirty: boolean; stale?: boolean }) => (
      <BranchRow name="Johar Town" chips={<span className="pos-chip">Counted</span>} onSave={onSave} onReload={onReload} {...props}>
        <input name="inside" />
      </BranchRow>
    );
    await m.render(row({ dirty: false }));
    const toggle = m.container.querySelector<HTMLButtonElement>('.pos-brow__toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Johar Town');
    expect(m.container.querySelector('input[name="inside"]')).toBeNull();
    expect(m.container.querySelector('.pos-btn--row')).toBeNull();
    await click(toggle);
    expect(m.container.querySelector('input[name="inside"]')).not.toBeNull();
    await m.render(row({ dirty: true }));
    const brow = m.container.querySelector('.pos-brow')!;
    expect(brow.classList.contains('is-dirty')).toBe(true);
    const save = brow.querySelector<HTMLButtonElement>('.pos-brow__head .pos-btn--row')!;
    expect(save.textContent).toBe('Save');
    expect(save.getAttribute('aria-label')).toBe('Save Johar Town');
    expect(save.classList.contains('pos-btn--primary')).toBe(false);
    await click(save);
    expect(onSave).toHaveBeenCalledOnce();
    await m.render(row({ dirty: true, stale: true }));
    const body = m.container.querySelector('.pos-brow__body')!;
    expect(body.querySelector('[data-stale]')).not.toBeNull();
    expect(m.container.querySelector('.pos-brow__head .pos-btn--row')).toBeNull();
    await click(button(body, 'Reload'));
    expect(onReload).toHaveBeenCalledOnce();
    expect(body.querySelector('input[name="inside"]')).not.toBeNull();
  });
});
