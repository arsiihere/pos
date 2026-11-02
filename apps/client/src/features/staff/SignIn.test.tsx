import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../../../test/dom';
import { SignIn } from './SignIn';

// 01d S00: the sign-in PIN is dropped when its dialog closes (never kept).

let m: Mounted;
afterEach(() => m?.unmount());

describe('[01d S00] SignIn', () => {
  it('closing the PIN dialog clears the typed digits', async () => {
    const api = {
      roster: vi.fn(async () => ({ ok: true as const, data: { staff: [{ staff_id: 'S1', display_name: 'Imran', locked_until: null }], active_session: null } })),
      signIn: vi.fn(),
    };
    m = mount();
    m.render(<SignIn api={api} phone={false} lockPanel={null} onSignedIn={() => {}} />);
    await Promise.resolve();
    await Promise.resolve();
    m.render(<SignIn api={api} phone={false} lockPanel={null} onSignedIn={() => {}} />);
    m.click(m.button('Imran'));
    const press = (d: string) => m.click([...m.container.querySelectorAll('.pin__keys button')].find((b) => b.textContent === d));
    press('1');
    press('2');
    expect(m.container.querySelectorAll('.pin__dots i.f').length).toBe(2);
    m.click(m.button('Close'));
    m.click(m.button('Imran'));
    expect(m.container.querySelectorAll('.pin__dots i.f').length).toBe(0);
    expect(api.signIn).not.toHaveBeenCalled();
  });
});
