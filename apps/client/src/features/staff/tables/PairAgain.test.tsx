import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../../../../test/dom';
import { PairAgain } from './PairAgain';

// 02a §8 Login (frame 02a-S00 PairAgain): "This screen must be paired again" with a button to the 00 pair page.

let m: Mounted;
afterEach(() => m?.unmount());

describe('[02a §8 Login] PairAgain', () => {
  it('[02a §8 Login] not paired (no token) → PairAgain with a /pair button', () => {
    const go = vi.fn();
    m = mount();
    m.render(<PairAgain go={go} />);
    expect(m.text()).toContain('This screen must be paired again');
    expect(m.text()).toContain('Unsent orders stay on this screen.');
    expect(go).not.toHaveBeenCalled();
    m.click(m.button('Show pairing code'));
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith('/pair');
  });

  it('[02a §8 Login] one primary button, no error code or server text', () => {
    m = mount();
    m.render(<PairAgain go={() => {}} />);
    expect(m.container.querySelectorAll('.btn--primary').length).toBe(1);
    expect(m.text()).not.toMatch(/DEVICE_|401|403|4403/);
  });

  it('[02a §8 Login] the button waits for the key wipe; a failed wipe shows an error and keeps it off', () => {
    const go = vi.fn();
    m = mount();
    m.render(<PairAgain go={go} wipe="pending" />);
    expect((m.button('Show pairing code') as HTMLButtonElement).disabled).toBe(true);
    m.render(<PairAgain go={go} wipe="failed" />);
    expect((m.button('Show pairing code') as HTMLButtonElement).disabled).toBe(true);
    expect(m.container.querySelector('[role="alert"]')?.textContent).toContain('Could not reset this screen');
    m.click(m.button('Show pairing code'));
    expect(go).not.toHaveBeenCalled();
    m.render(<PairAgain go={go} wipe="done" />);
    expect((m.button('Show pairing code') as HTMLButtonElement).disabled).toBe(false);
  });
});
