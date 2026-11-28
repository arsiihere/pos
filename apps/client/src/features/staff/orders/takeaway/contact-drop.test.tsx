import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush } from '../../../../../test/dom';
import { contactGaps, tokenBookOf } from './book';
import { screenHarness } from './screen-harness';
import { aCaught, aLine, aRow, at } from './test-fixtures';

// BUG-5 (QA round 2, owner 2026-11-28 QA-R2; 02b v1.0.28 §8 "Contact on this device"): the kiosk dropped the
// customer's name and phone of tokens sent after the socket's catch-up (#8 / #7 / #5 → "Takeaway", the token view
// Phone "—") while another device still showed them; a reload + sign-in brought them back. Cause: each mount of the
// takeaway screen made a new token book seeded from the live bus's LAST CATCH-UP (taken when the socket connected),
// so leaving Takeaway (My shift, Cash desk, Pass…) and coming back lost every OrderContactSet heard since. The book
// is now the page's (one per live bus, fed by every frame while no screen is mounted), dropped with the session; and
// data the hub should have sent but the book lacks is re-read (a fresh catch-up), never shown masked.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: () => {} }));

const tick = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
};

const placed = (seq: number, order_id: string, token: number) => ({
  type: 'event' as const,
  seq,
  event: { event_id: `E${seq}`, event_type: 'OrderPlaced', schema_version: 1, payload: { order_id, order_type: 'takeaway', token, business_date: '2026-11-24', has_phone: true } },
});
const contact = (seq: number, order_id: string, customer_name: string, phone: string) => ({
  type: 'event' as const,
  seq,
  event: { event_id: `E${seq}`, event_type: 'OrderContactSet', schema_version: 1, payload: { order_id, customer_name, phone } },
});

describe('[BUG-5; 02b v1.0.28 §8] the kiosk keeps names and phones heard after the catch-up', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }));
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('a token sent after the catch-up keeps its name when the takeaway screen is left and opened again', async () => {
    const rows = [aRow({ order_id: 'O48', token: 48 }), aRow({ order_id: 'O8', token: 8, has_phone: true, placed_at: at(13, 10) })];
    const h = screenHarness({ rows });
    const first = h.render();
    await flush();
    act(() => {
      h.live.frame(placed(2, 'O8', 8));
      h.live.frame(contact(3, 'O8', 'Bilal', '03001234567'));
    });
    await tick(600);
    expect(first.container.textContent).toContain('Bilal');
    first.unmount(); // My shift, Cash desk, the Pass…
    const again = h.render();
    await flush();
    await tick(600);
    expect(again.container.textContent).toContain('Bilal');
    expect(again.container.textContent).toContain('Ali');
    again.unmount();
  });

  it('the book is the page’s: one per live bus, fed while no screen is mounted, emptied when the session ends', () => {
    const h = screenHarness();
    const book = tokenBookOf(h.live);
    expect(tokenBookOf(h.live)).toBe(book);
    h.live.frame(placed(2, 'O8', 8));
    h.live.frame(contact(3, 'O8', 'Bilal', '03001234567'));
    expect(book.get('O8')?.customer_name).toBe('Bilal');
    h.live.forget(); // BUG-12: signed out — nothing of this person's carries to the next
    expect(book.get('O8')).toBeUndefined();
    expect(book.get('O48')).toBeUndefined();
  });

  describe('contactGaps: what the hub should have sent this device but the book lacks (→ re-read)', () => {
    const book = (known: Record<string, { name?: string; phone?: string }>) => ({
      get: (id: string) => (id in known ? ({ customer_name: known[id]!.name ?? null, phone: known[id]!.phone ?? null } as never) : undefined),
    });
    const row = (order_id: string, placer: string, has_phone: boolean) => ({ ...aRow({ order_id, has_phone }), placed_by: { staff_id: placer, name: null } });

    it('kiosk: a row with a phone the book has not got, or a row the book never heard of → a gap', () => {
      const gaps = contactGaps([row('O1', 'sana', true), row('O2', 'sana', false), row('O3', 'ali', false), row('O4', 'ali', true)], book({ O1: {}, O2: {}, O4: { phone: '03001234567' } }), { kiosk: true, staffId: 'me' });
      expect(gaps).toEqual(['O1', 'O3']);
    });

    it('tablet: only the person’s own orders are sent with contact (O17) — others are no gap', () => {
      const gaps = contactGaps([row('O1', 'sana', true), row('O2', 'me', true), row('O3', 'me', false)], book({ O1: {}, O2: {} }), { kiosk: false, staffId: 'me' });
      expect(gaps).toEqual(['O2', 'O3']);
    });

    it('nobody signed in → no gap', () => {
      expect(contactGaps([row('O1', 'sana', true)], book({}), { kiosk: true, staffId: null })).toEqual([]);
    });
  });

  it('a gap that stays → the screen asks the shell to re-read once (a fresh catch-up), not again for the same orders', async () => {
    const rows = [aRow({ order_id: 'O48', token: 48 }), aRow({ order_id: 'O9', token: 9, has_phone: true, placed_at: at(13, 10) })];
    const h = screenHarness({ rows });
    const resync = vi.fn();
    h.shell.resync = resync;
    const m = h.render();
    await flush();
    await tick(3_000);
    expect(resync).toHaveBeenCalledTimes(1);
    await tick(30_000);
    expect(resync).toHaveBeenCalledTimes(1);
    m.unmount();
  });
});
