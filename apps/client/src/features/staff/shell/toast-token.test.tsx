import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mount } from '../../../../test/dom';
import { createToastBus, ToastView } from './toast';

// 02b-TK L-CLIENT-6a item 9 (frame SentToast): a toast may carry the token, shown big, and one button (Print again).
describe('[02b-TK L-CLIENT-6a item 9] the token toast', () => {
  it('shows the token big, the rest of the text after it, and runs its one action then closes', () => {
    const bus = createToastBus();
    const run = vi.fn();
    const m = mount();
    m.render(<ToastView bus={bus} />);
    act(() => bus.show({ text: '57 · Usman · sent · ready 1:42 PM', token: '57', tone: 'ok', action: { label: 'Print again', run } }));
    const toast = m.container.querySelector('.toast.toast--token')!;
    expect(toast.querySelector('.toast__tok')?.textContent).toBe('57');
    expect(toast.textContent).toContain('Usman · sent · ready 1:42 PM');
    expect(toast.textContent).not.toContain('57 · Usman');
    m.click(m.button('Print again'));
    expect(run).toHaveBeenCalledTimes(1);
    expect(m.container.querySelector('.toast')).toBeNull();
    m.unmount();
  });
});
