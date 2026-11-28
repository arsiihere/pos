import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '../../../../../test/dom';
import { CustomerRow } from './CustomerRow';

// BUG-24 (02b v1.0.30 §8 QK-7): the takeaway name field shows the hub's 40-character limit as typed ("n/40") and takes
// no more.

describe('[BUG-24; 02b v1.0.30 QK-7] the name counter', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });
  it('shows n/40 and the field is capped at 40', () => {
    const m = mount();
    act(() => m.render(<CustomerRow value={{ customer_name: 'Usman' }} disabled={false} onChange={() => {}} />));
    expect(m.container.querySelector('[data-count]')?.textContent).toBe('5/40');
    expect(m.container.querySelector<HTMLInputElement>('input[name="customer_name"]')?.maxLength).toBe(40);
    act(() => m.render(<CustomerRow value={undefined} disabled={false} onChange={() => {}} />));
    expect(m.container.querySelector('[data-count]')?.textContent).toBe('0/40');
    m.unmount();
  });
});
