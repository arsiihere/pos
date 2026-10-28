import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { Banner } from './Banner';
import { BusyButton } from './BusyButton';
import { PinPad } from './PinPad';
import { QuantityInput } from './QuantityInput';
import { StaffTiles } from './StaffTiles';

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

function click(el: Element | null): void {
  if (!el) throw new Error('element missing');
  act(() => {
    (el as HTMLElement).click();
  });
}

function typeInto(input: HTMLInputElement, text: string): void {
  // React tracks the value through the native setter; set it there, then fire input.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function key(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>('.pos-pin__key')].find(
    (b) => b.textContent === label,
  );
  if (!found) throw new Error(`key ${label} missing`);
  return found;
}

describe('shared components', () => {
  it('[01a S35 i] PinPad calls onSubmit with the typed digits and clears', () => {
    const onSubmit = vi.fn();
    act(() => root.render(<PinPad onSubmit={onSubmit} />));

    for (const d of ['1', '2', '3', '4']) click(key(d));
    expect(container.querySelectorAll('.pos-pin__dot.is-filled')).toHaveLength(4);
    click(key(t('pin.delete')));
    click(key('9'));
    click(key(t('pin.submit')));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('1239');
    expect(container.querySelectorAll('.pos-pin__dot.is-filled')).toHaveLength(0);
    expect(container.textContent).not.toContain('1239');
  });

  it('[01a S35 i] StaffTiles calls onPick', () => {
    const onPick = vi.fn();
    const staff = [
      { staff_id: 'S1', display_name: 'Ali' },
      { staff_id: 'S2', display_name: 'Sara' },
    ];
    act(() => root.render(<StaffTiles staff={staff} selectedId="S1" onPick={onPick} />));

    const tiles = [...container.querySelectorAll<HTMLButtonElement>('.pos-staff__tile')];
    expect(tiles.map((b) => b.textContent)).toEqual(['Ali', 'Sara']);
    expect(tiles.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    click(tiles[1] ?? null);
    expect(onPick).toHaveBeenCalledWith('S2');
  });

  it('[01a §8.1] BusyButton disabled while busy, slow text after 3 s', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    act(() =>
      root.render(
        <BusyButton busy={false} onClick={onClick}>
          Save
        </BusyButton>,
      ),
    );
    const button = container.querySelector('button');
    expect(button?.disabled).toBe(false);
    click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    act(() =>
      root.render(
        <BusyButton busy onClick={onClick}>
          Save
        </BusyButton>,
      ),
    );
    expect(button?.disabled).toBe(true);
    expect(button?.classList.contains('is-busy')).toBe(true);
    expect(container.textContent).not.toContain(t('common.slow'));

    act(() => vi.advanceTimersByTime(2_999));
    expect(container.textContent).not.toContain(t('common.slow'));
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('.pos-banner--warn')?.textContent).toContain(t('common.slow'));

    act(() =>
      root.render(
        <BusyButton busy={false} onClick={onClick}>
          Save
        </BusyButton>,
      ),
    );
    expect(button?.disabled).toBe(false);
    expect(container.textContent).not.toContain(t('common.slow'));
  });

  it('[01a §8.1] Banner tone class', () => {
    act(() => root.render(<Banner tone="danger" text="Menu update refused" detail="Call support" />));
    const box = container.querySelector('.pos-banner');
    expect(box?.className).toBe('pos-banner pos-banner--danger');
    expect(box?.getAttribute('role')).toBe('alert');
    expect(box?.querySelector('svg.pos-icon')).not.toBeNull();
    expect(box?.textContent).toContain('Menu update refused');
    expect(box?.querySelector('small')?.textContent).toBe('Call support');

    act(() => root.render(<Banner tone="info" text="Waiting" />));
    expect(container.querySelector('.pos-banner')?.className).toBe('pos-banner pos-banner--info');
    expect(container.querySelector('.pos-banner')?.getAttribute('role')).toBe('status');
  });

  it('[01a S44] QuantityInput shows 1500 g as "1.5" with "kg" and emits 1500 for "1.5"; rejects "1.2345"', () => {
    const onChange = vi.fn();
    act(() => root.render(<QuantityInput unit="g" value={1500} onChange={onChange} />));
    const input = container.querySelector('input');
    if (!input) throw new Error('input missing');
    expect(input.value).toBe('1.5');
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(container.textContent).toContain('kg');

    typeInto(input, '2');
    expect(onChange).toHaveBeenLastCalledWith(2000);
    typeInto(input, '1.5');
    expect(onChange).toHaveBeenLastCalledWith(1500);

    onChange.mockClear();
    typeInto(input, '1.2345');
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('.pos-field--error')).not.toBeNull();
    expect(container.textContent).toContain(t('quantity.invalid'));

    typeInto(input, '');
    expect(onChange).toHaveBeenLastCalledWith(null);

    act(() => root.render(<QuantityInput unit="piece" value={12} onChange={onChange} />));
    expect(input.value).toBe('12');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(container.textContent).toContain(t('quantity.pieces'));
    act(() => root.render(<QuantityInput unit="ml" value={250} onChange={onChange} />));
    expect(input.value).toBe('0.25');
    expect(container.querySelector('.pos-row span')?.textContent).toBe('L');
  });
});
