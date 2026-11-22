import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../../../../../test/dom';
import { ServeSwitch } from './ServeSwitch';

// 02b v1.0.21 §8 (STAB-5, owner option C, test 44): the order switch next to Send.
let m: Mounted;
afterEach(() => m?.unmount());

describe('[02b v1.0.21 §8] ServeSwitch', () => {
  it('[02b #44] Together / As ready, the state pressed; mixed → neither pressed and "Mixed"; a tap sets the order choice', () => {
    const onSet = vi.fn();
    m = mount();
    m.render(<ServeSwitch state="sync" onSet={onSet} />);
    expect(m.button('Together').getAttribute('aria-pressed')).toBe('true');
    expect(m.button('As ready').getAttribute('aria-pressed')).toBe('false');
    m.click(m.button('As ready'));
    expect(onSet).toHaveBeenCalledWith('immediate');
    m.render(<ServeSwitch state="mixed" onSet={onSet} />);
    expect(m.container.textContent).toContain('Mixed');
    expect(m.button('Together').getAttribute('aria-pressed')).toBe('false');
    expect(m.button('As ready').getAttribute('aria-pressed')).toBe('false');
  });
});
