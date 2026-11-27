import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, type Mounted } from '../../../../../test/dom';
import { offChip, offToast, placeholderOf } from '../order-screen/MenuTiles';
import { forgetTakeawayDrafts } from './current-draft';
import { screenHarness } from './screen-harness';

// 02b-TK A2 item 3 (frame TileStates; MAPPING TK-C01; CHANGES §3 Menu, §4 #6): the takeaway menu tile — Half / Full
// on a variant tile (one tap adds that variant; a variant that needs a choice opens its sheet with it chosen), the
// ×2 ×4 ×6 ×8 chips on the open cart line, and an off tile with its reason chip (sold out / from 7 PM / Tandoor
// paused / not counted …), the price never struck through, a tap telling why in a toast (never silent).

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

const tile = (m: Mounted, name: string) => m.container.querySelector<HTMLElement>(`.mi[aria-label="${name}"]`)!;
const cartLines = (m: Mounted) => [...m.container.querySelectorAll('.cart .ln')];
const sides = (m: Mounted) => m.click(m.button('Sides', m.container.querySelector('.pills')!));

beforeEach(() => {
  forgetTakeawayDrafts();
  window.history.replaceState(null, '', '#/takeaway');
});
afterEach(() => {
  document.body.innerHTML = '';
  nav.to = [];
  window.history.replaceState(null, '', '#');
});

describe('[02b-TK TK-C01] takeaway menu tiles', () => {
  it('[frame TileStates "half/full on tile"] a variant tile shows Half / Full with their prices; one tap adds that variant, no sheet', async () => {
    const h = screenHarness();
    const m = h.render();
    await flush();
    const split = [...tile(m, 'Chicken Karahi').querySelectorAll('.tk-split button')];
    expect(split.map((b) => b.textContent)).toEqual(['HalfRs 1,200', 'FullRs 1,200']);
    m.click(split[1]!);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(cartLines(m)).toHaveLength(1);
    expect(cartLines(m)[0]!.textContent).toContain('Chicken Karahi — Full');
    m.click(tile(m, 'Chicken Karahi').querySelectorAll('.tk-split button')[1]!);
    expect(cartLines(m)).toHaveLength(1);
    expect(cartLines(m)[0]!.querySelector('.ln__q')!.textContent).toBe('2×');
    m.unmount();
  });

  it('[frame TileStates; 01c §3.4.6] a variant with a required choice opens its sheet with that variant chosen', async () => {
    const h = screenHarness({
      config: (c) => ({
        ...c,
        modifier_groups: [
          { modifier_group_id: 'G1', name: 'Spice', min_choices: 1, max_choices: 1, sort_order: 1, has_plain_options: true, options: [{ option_id: 'OP1', name: 'Mild', price_minor: 0, max_quantity: 1, is_default: false, linked_item_id: null, sort_order: 1 }] },
        ],
        items: c.items.map((i) => (i.item_id === 'I3' ? { ...i, modifier_group_ids: ['G1'] } : i)),
      }),
    });
    const m = h.render();
    await flush();
    m.click(tile(m, 'Chicken Karahi').querySelectorAll('.tk-split button')[1]!);
    const sheet = document.querySelector('[role="dialog"]');
    expect(sheet).not.toBeNull();
    expect(sheet!.querySelector('.seg--opt button[aria-pressed="true"]')!.textContent).toContain('Full');
    expect(cartLines(m)).toHaveLength(0);
    m.unmount();
  });

  it('[frame HomeRush "×2 ×4 ×6 ×8"; CHANGES §4 #6] the open cart line shows the quantity chips; a chip sets the quantity', async () => {
    const h = screenHarness();
    const m = h.render();
    await flush();
    sides(m);
    m.click(tile(m, 'Naan'));
    expect(m.container.querySelector('.tk-qchips')).toBeNull();
    m.click(cartLines(m)[0]!.querySelector('.ln__m'));
    const chips = [...m.container.querySelectorAll('.cart .ln .tk-qchips button')];
    expect(chips.map((b) => b.textContent)).toEqual(['×2', '×4', '×6', '×8']);
    m.click(chips[2]!);
    expect(cartLines(m)[0]!.querySelector('.ln__q')!.textContent).toBe('6×');
    m.unmount();
  });

  it('[frame TileStates "Station paused"; 03a §6.5] a paused home station: "Karahi paused" chip, the price not struck, a tap toasts why and adds nothing', async () => {
    const h = screenHarness();
    const m = h.render();
    await flush();
    h.live.frame({ type: 'catch_up', as_of_seq: 2, state: { stations_live: { stations: [{ station_id: 'S1', paused: true, band: 'green', wait_ms: 0 }] } } });
    await flush();
    const mutton = tile(m, 'Mutton Karahi');
    expect(mutton.getAttribute('aria-disabled')).toBe('true');
    expect(mutton.classList.contains('mi--tk')).toBe(true);
    expect(mutton.querySelector('.tag')!.textContent).toBe('Karahi paused');
    m.click(mutton);
    expect(cartLines(m)).toHaveLength(0);
    expect(h.toasts.at(-1)).toEqual({ text: 'Mutton Karahi — Karahi paused', tone: 'warn' });
    m.unmount();
  });

  it('[frame TileStates "Sold out"] an item switched Off shows "Not available"; a tap says so in a toast', async () => {
    const h = screenHarness();
    const m = h.render();
    await flush();
    h.live.frame({ type: 'catch_up', as_of_seq: 2, state: { availability: { unavailable_item_ids: ['I5'] } } });
    await flush();
    sides(m);
    expect(tile(m, 'Naan').querySelector('.tag')!.textContent).toBe('Not available');
    m.click(tile(m, 'Naan'));
    expect(cartLines(m)).toHaveLength(0);
    expect(h.toasts.at(-1)).toEqual({ text: 'Naan — Not available', tone: 'warn' });
    m.unmount();
  });

  it('[frame TileStates] the reason chips and toasts: sold out (danger, "ask the kitchen"), from 7 PM, paused, not counted', () => {
    expect(offChip({ kind: 'sold_out' }, null)).toMatchObject({ tone: 'danger', text: 'Sold out' });
    expect(offChip({ kind: 'not_now', windows: [{ start_ms: 19 * 3_600_000, end_ms: 23 * 3_600_000 }] }, null)).toMatchObject({ tone: 'warn', text: 'From 7 PM' });
    expect(offChip({ kind: 'paused', station_id: 'S1' }, 'Tandoor')).toMatchObject({ tone: 'warn', text: 'Tandoor paused' });
    expect(offChip({ kind: 'not_counted' }, null)).toMatchObject({ tone: 'warn', text: 'Not counted today' });
    expect(offToast('Chicken Tikka', { kind: 'sold_out' }, null)).toBe('Chicken Tikka is sold out — ask the kitchen');
    expect(offToast('Anda Tikki', { kind: 'not_now', windows: [{ start_ms: 19 * 3_600_000, end_ms: 23 * 3_600_000 }] }, null)).toBe('Anda Tikki — From 7 PM');
  });
});

describe('[02b-TK L-CLIENT-6a item 2] the takeaway tile (frames HomeKiosk, TileStates)', () => {
  it('[owner: photos after the pilot] the image slot is the category placeholder — an icon in its colour, never initials', async () => {
    const h = screenHarness();
    const m = h.render();
    await flush();
    sides(m);
    const naan = tile(m, 'Naan');
    expect(naan.querySelector('.tk-ph .ico')).not.toBeNull();
    expect(naan.querySelector('.photo')).toBeNull();
    expect(naan.querySelector('.tk-ph')!.textContent).toBe('');
    expect(placeholderOf({ name: 'Tandoor', index: 4 })).toEqual({ icon: 'bread', tone: 4 });
    expect(placeholderOf({ name: 'Drinks', index: 7 })).toEqual({ icon: 'cup', tone: 1 });
    expect(placeholderOf(null)).toEqual({ icon: 'bowl', tone: 0 });
  });

  it('[02b §8 Tile wait estimate] offline, every takeaway wait reads "—" on the kiosk too', async () => {
    const h = screenHarness({ online: false });
    const m = h.render();
    await flush();
    sides(m);
    expect(tile(m, 'Naan').querySelector('.tag')!.textContent).toBe('—');
  });
});
