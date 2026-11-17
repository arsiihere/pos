import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../../../../../test/dom';
import { setLanguage } from '../../../../i18n';
import type { MapTile } from '../contracts';
import { Tile } from './Tile';

// 02a-C01 (Tiles, TilesUrdu): one tile per table.

const ALI = { staff_id: 'ST-ALI', name: 'Ali' };
const BILAL = { staff_id: 'ST-BILAL', name: 'Bilal' };
const SARA = { staff_id: 'ST-SARA', name: 'Sara' };
const OPENED = 1_000_000;
const NOW = OPENED + 32 * 60_000;

function tile(over: Partial<MapTile> = {}): MapTile {
  return {
    table_id: 'TB1',
    name: 'F1',
    seats: 6,
    archived: false,
    state: 'FREE',
    seating_id: null,
    party_size: null,
    primary_table_id: null,
    joined_table_names: [],
    holder: null,
    assignee: null,
    lock: null,
    opened_at: null,
    bill_requested_at: null,
    live_order_count: 0,
    ...over,
  };
}

let m: Mounted;
afterEach(() => {
  m.unmount();
  setLanguage('en');
});

function show(t: MapTile, extra: Partial<Parameters<typeof Tile>[0]> = {}) {
  m = mount();
  const onTap = vi.fn();
  m.render(<Tile tile={t} staffId="ST-ALI" nowMs={NOW} onTap={onTap} {...extra} />);
  return { onTap, button: m.container.querySelector('button.tt') as HTMLElement };
}

describe('[02a §8 Table map] tile', () => {
  it('[02a §8 Table map] tile: icon + word per state, "T4 + T5", holder initials, hollow assignee only when ≠ holder, padlock + name, time open, party size', () => {
    const states = [
      ['FREE', 'Free', 's-free'],
      ['SEATED', 'Seated', 's-seated'],
      ['ORDERED', 'Ordered', 's-ordered'],
      ['FOOD_ON_TABLE', 'Eating', 's-eating'],
      ['BILL_REQUESTED', 'Bill', 's-bill'],
      ['NEEDS_CLEANING', 'To clean', 's-clean'],
    ] as const;
    for (const [state, word, cls] of states) {
      const { button } = show(tile({ state, seating_id: state === 'FREE' ? null : 'S1', opened_at: state === 'FREE' ? null : OPENED }));
      expect(button.classList.contains(cls), state).toBe(true);
      expect(button.querySelector('.tt__s')?.textContent, state).toContain(word);
      expect(button.querySelector('.tt__puck svg'), state).not.toBeNull(); // icon (the ring holds it)
      m.unmount();
    }
    // free: seats, no time; others: "· 32 min"
    expect(show(tile()).button.querySelector('.tt__seats')?.textContent).toBe('6');
    m.unmount();
    const joined = show(tile({ state: 'ORDERED', seating_id: 'S1', opened_at: OPENED, joined_table_names: ['F4', 'F5'], party_size: 9, holder: ALI }));
    expect(joined.button.querySelector('.tt__n')?.textContent).toBe('F4 + F5');
    expect(joined.button.querySelector('.tt__n')?.classList.contains('j')).toBe(true);
    expect(joined.button.querySelector('.tt__s .t')?.textContent).toBe('· 32 min');
    expect(joined.button.getAttribute('aria-label')).toBe('F4 + F5, Ordered, Ali, 32 min, 9');
    // holder initials; maroon (tav--me) only for me
    expect(joined.button.querySelector('.tav')?.textContent).toBe('A');
    expect(joined.button.querySelector('.tav--me')).not.toBeNull();
    m.unmount();
    const other = show(tile({ state: 'SEATED', seating_id: 'S2', opened_at: OPENED, holder: BILAL, assignee: ALI, lock: { ...BILAL, mine: false } }));
    expect(other.button.querySelector('.tav--me')).toBeNull();
    expect([...other.button.querySelectorAll('.tav')].map((e) => e.textContent)).toEqual(['A', 'B']); // hollow assignee first, then the holder
    expect(other.button.querySelector('.tav--as')?.textContent).toBe('A');
    expect(other.button.querySelector('.lk')?.textContent).toBe('Bilal');
    expect(other.button.querySelector('.lk--me')).toBeNull();
    m.unmount();
    // assignee = holder: no hollow avatar
    expect(show(tile({ state: 'SEATED', seating_id: 'S2', opened_at: OPENED, holder: ALI, assignee: ALI })).button.querySelector('.tav--as')).toBeNull();
    m.unmount();
    // my own lock says "You"
    const mine = show(tile({ state: 'SEATED', seating_id: 'S2', opened_at: OPENED, holder: ALI, lock: { ...ALI, mine: true } }));
    expect(mine.button.querySelector('.lk--me')?.textContent).toBe('You');
    m.unmount();
    // hollow avatar needs a holder
    expect(show(tile({ assignee: SARA })).button.querySelector('.tav')).toBeNull();
  });

  it('[02a §8 Table map] the puck ring fills over 60 min open; Bill and late tiles are urgent', () => {
    const ring = (min: number) => {
      const { button } = show(tile({ state: 'ORDERED', seating_id: 'S1', opened_at: NOW - min * 60_000 }));
      const dash = button.querySelector('circle[stroke-dasharray]')?.getAttribute('stroke-dasharray') ?? null;
      m.unmount();
      return dash;
    };
    expect(ring(30)).toBe('50 100');
    expect(ring(32)).toBe('53.3 100');
    expect(ring(90)).toBe('100 100');
    expect(show(tile({ state: 'BILL_REQUESTED', seating_id: 'S1', opened_at: OPENED })).button.classList.contains('urgent')).toBe(true);
    m.unmount();
    const late = show(tile({ state: 'ORDERED', seating_id: 'S1', opened_at: OPENED }), { late: 6 });
    expect(late.button.classList.contains('urgent')).toBe(true);
    expect(late.button.querySelector('.fl')?.textContent).toBe('6 min late');
    m.unmount();
    expect(show(tile({ state: 'ORDERED', seating_id: 'S1', opened_at: OPENED }), { late: null }).button.querySelector('.fl')?.textContent).toBe('Late');
  });

  it('[02a §8 Table map] one footer item: a flag wins over the padlock; archived marks the tile', () => {
    const lock = { ...BILAL, mine: false };
    const waiting = show(tile({ state: 'ORDERED', seating_id: 'S1', opened_at: OPENED, lock }), { waiting: true });
    expect(waiting.button.querySelectorAll('.tt__f > *')).toHaveLength(1);
    expect(waiting.button.querySelector('.fl--q')?.textContent).toBe('Waiting to send');
    m.unmount();
    const call = show(tile({ state: 'ORDERED', seating_id: 'S1', opened_at: OPENED }), { callSentAt: NOW - 2 * 60_000 });
    expect(call.button.querySelector('.fl')?.textContent).toBe('Call sent · 2 min');
    m.unmount();
    const arch = show(tile({ state: 'FOOD_ON_TABLE', archived: true, seating_id: 'S9', opened_at: OPENED - 38 * 60_000, seats: null }));
    expect(arch.button.classList.contains('arch')).toBe(true);
    expect(arch.button.querySelector('.fl')?.textContent).toBe('Archived');
  });

  it('[02a §8 Rules] Urdu: state words in Urdu, table name stays as it is', () => {
    setLanguage('ur');
    const { button } = show(tile({ state: 'BILL_REQUESTED', seating_id: 'S1', opened_at: OPENED, name: 'F6' }));
    expect(button.querySelector('.tt__s')?.textContent).toContain('بل');
    expect(button.querySelector('.tt__n')?.textContent).toBe('F6');
  });

  it('[02a §8 Table map] a tap reports the tile', () => {
    const t = tile({ state: 'ORDERED', seating_id: 'S1' });
    const { onTap, button } = show(t);
    m.click(button);
    expect(onTap).toHaveBeenCalledWith(t);
  });
});
