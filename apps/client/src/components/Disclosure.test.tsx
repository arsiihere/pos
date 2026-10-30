import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Disclosure } from './Disclosure';

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

const toggle = (selector: string) => container.querySelector<HTMLButtonElement>(selector);

describe('Disclosure (Pulse 01b)', () => {
  it('a row toggles its section with aria-expanded and aria-controls', () => {
    act(() =>
      root.render(
        <Disclosure title="Advanced" summary="Nothing blocked.">
          <button type="button">Add</button>
        </Disclosure>,
      ),
    );
    const row = toggle('button.pos-disclosure');
    expect(row?.getAttribute('aria-expanded')).toBe('false');
    expect(row?.textContent).toBe('Advanced · Nothing blocked.');
    expect(container.textContent).not.toContain('Add');
    act(() => row?.click());
    expect(row?.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(row?.getAttribute('aria-controls') ?? '')?.textContent).toBe('Add');
  });

  it('inPlace: the open section replaces the row and takes focus; defaultOpen starts open', () => {
    act(() =>
      root.render(
        <Disclosure title="Advanced" inPlace>
          <button type="button">Add</button>
        </Disclosure>,
      ),
    );
    act(() => toggle('button.pos-disclosure')?.click());
    expect(toggle('button.pos-disclosure')).toBeNull();
    expect(document.activeElement?.textContent).toBe('Add');

    act(() => root.unmount());
    root = createRoot(container);
    act(() =>
      root.render(
        <Disclosure title="Advanced" inPlace defaultOpen>
          <button type="button">Add</button>
        </Disclosure>,
      ),
    );
    expect(toggle('button.pos-disclosure')).toBeNull();
    expect(document.activeElement).not.toBe(container.querySelector('.pos-disclosure__body button'));
  });

  it('a group shows its summary under the name and closes on Escape, focus back on the toggle', () => {
    act(() =>
      root.render(
        <Disclosure variant="group" title="Orders and tables" summary="3 allowed" defaultOpen>
          <button type="button">Allowed</button>
        </Disclosure>,
      ),
    );
    const head = toggle('button.pos-group__toggle');
    expect(head?.querySelector('.pos-group__name small')?.textContent).toBe('3 allowed');
    expect(head?.getAttribute('aria-expanded')).toBe('true');
    const inner = container.querySelector<HTMLButtonElement>('.pos-group__body button');
    act(() => {
      inner?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(head?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(head);
  });

  it('Escape from a control inside a group leaves the group open', () => {
    act(() =>
      root.render(
        <Disclosure variant="group" title="Orders and tables" defaultOpen>
          <select aria-label="Where">
            <option>Branch</option>
          </select>
        </Disclosure>,
      ),
    );
    const select = container.querySelector('select');
    act(() => {
      select?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('.pos-group__toggle')?.getAttribute('aria-expanded')).toBe('true');
  });
});
