import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIN, NOW, VOID_CARD, row } from '../../../test/alert-rows';
import { mount, type Mounted } from '../../../test/dom';
import { Banners } from './Banner';

// 01d §8.1 (B01), DQ3: at most 2 banners, newest on top, then "{n} more new · Open inbox"; Open is the tinted
// button; no close and no snooze; lock text only on an always-on screen with nobody signed in.

let m: Mounted;
afterEach(() => m?.unmount());

const a = row({ alert_id: 'A', card: VOID_CARD, raised_at: NOW - 2 * MIN });
const b = row({ alert_id: 'B', raised_at: NOW - 3 * MIN });
const c = row({ alert_id: 'C', raised_at: NOW - 4 * MIN });
const d = row({ alert_id: 'D', raised_at: NOW - 5 * MIN });

describe('[01d §8.1 B01] Banners', () => {
  it('shows two, then the more-new bar; Open and Open inbox call back', () => {
    const onOpen = vi.fn();
    const onOpenInbox = vi.fn();
    m = mount();
    m.render(<Banners banners={[a, b, c, d]} nowMs={NOW} lockOnly={false} onOpen={onOpen} onOpenInbox={onOpenInbox} />);
    const shown = m.container.querySelectorAll('.abn');
    expect(shown.length).toBe(2);
    expect(shown[0]!.getAttribute('role')).toBe('alert');
    expect(shown[0]!.textContent).toContain('Chicken Karahi — Full ×1 · Rs 2,200');
    expect(m.text()).toContain('2 more new');
    const open = m.button('Open', shown[0]!);
    expect(open.className).toContain('btn--tone');
    m.click(open);
    expect(onOpen).toHaveBeenCalledWith(a);
    m.click(m.button('Open inbox'));
    expect(onOpenInbox).toHaveBeenCalledOnce();
    expect(m.text()).not.toMatch(/Later|Snooze/);
    expect(m.container.querySelector('[aria-label="Close"]')).toBeNull();
  });

  it('lock text only when the screen shows lock text (always-on, signed out)', () => {
    m = mount();
    m.render(<Banners banners={[a]} nowMs={NOW} lockOnly onOpen={() => {}} onOpenInbox={() => {}} />);
    expect(m.text()).not.toMatch(/2,200|Karahi/);
    expect(m.text()).toContain('T12');
  });

  it('nothing when there are no banners', () => {
    m = mount();
    m.render(<Banners banners={[]} nowMs={NOW} lockOnly={false} onOpen={() => {}} onOpenInbox={() => {}} />);
    expect(m.container.querySelector('.abns')).toBeNull();
  });
});
