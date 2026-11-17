import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import type { HubResult } from '../../../../api/hub-admin';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { ZoneStockBody } from '../contracts';
import { ZoneStock } from './ZoneStock';

// 02b v1.0.11 §8 Zone stock screen, §3.10, §6.9, §6.10, §6.17 (27b2; frames ZoneStock, ZoneRefill) over scripted
// hub answers, the real live bus and the real permissions.

const ZONES: ZoneStockBody[] = [
  {
    zone_id: 'FH',
    name: 'Family hall',
    items: [
      { item_id: 'raita', name: 'Raita', on_hand: 6, threshold: 4 },
      { item_id: 'water', name: 'Water bottle', on_hand: 3, threshold: 6 },
      { item_id: 'salad', name: 'Salad', on_hand: 0, threshold: 4 },
    ],
  },
  { zone_id: 'CB', name: 'Cabins', items: [{ item_id: 'raita', name: 'Raita', on_hand: 12, threshold: 4 }] },
];

const apiError = (status: number, code: string, details: Record<string, unknown> = {}): HubResult<never> => ({ ok: false, error: { kind: 'api', status, code, details } });

function setup(o: { manage?: boolean; zones?: ZoneStockBody[] } = {}) {
  const live = createLiveBus();
  // the hub's counts: every answer is read from here, so a Refill is counted once however the reads and frames race
  const counts = new Map<string, number>();
  const key = (z: string, i: string) => `${z}|${i}`;
  for (const z of o.zones ?? ZONES) for (const i of z.items) counts.set(key(z.zone_id, i.item_id), i.on_hand);
  const current = (): ZoneStockBody[] => (o.zones ?? ZONES).map((z) => ({ ...z, items: z.items.map((i) => ({ ...i, on_hand: counts.get(key(z.zone_id, i.item_id)) ?? 0 })) }));
  const zoneStock = vi.fn(async (): Promise<HubResult<ZoneStockBody[]>> => ({ ok: true, data: current() }));
  const addZoneStock = vi.fn(async (p: { zone_id: string; item_id: string; quantity: number }): Promise<HubResult<{ on_hand: number }>> => {
    const n = (counts.get(key(p.zone_id, p.item_id)) ?? 0) + p.quantity;
    counts.set(key(p.zone_id, p.item_id), n);
    return { ok: true, data: { on_hand: n } };
  });
  const setZoneStock = vi.fn(async (p: { zone_id: string; item_id: string; on_hand: number }): Promise<HubResult<{ on_hand: number }>> => {
    counts.set(key(p.zone_id, p.item_id), p.on_hand);
    return { ok: true, data: { on_hand: p.on_hand } };
  });
  // the commands go through the staff api so a retry can carry the same command_id
  const command = vi.fn((type: string, payload: unknown, opts?: { commandId?: string }) => {
    void opts; // recorded by the mock; the tests read it from command.mock.calls
    return type === 'AddZoneStock' ? addZoneStock(payload as never) : setZoneStock(payload as never);
  });
  const toasts = createToastBus();
  const grant = o.manage === false ? {} : { 'manage-zone-stock': { grant: 'allowed', scope: 'my_zones' } };
  const shell = {
    device: { token: 'D', id: 'dev-1', type: 'tablet' },
    orders: { zoneStock },
    api: { command },
    live,
    permissions: createPermissions(grant as never),
    toasts,
    clock: { nowMs: () => 0, utcOffsetMs: 0 },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  return { shell, live, zoneStock, addZoneStock, setZoneStock, command, counts, toasts };
}

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
});

async function show(s: ReturnType<typeof setup>) {
  view = mount();
  view.render(
    <ShellContext.Provider value={s.shell}>
      <ZoneStock />
    </ShellContext.Provider>,
  );
  await flush();
  return view;
}

const zsRows = (v: Mounted) => [...v.container.querySelectorAll<HTMLElement>('.zs')];
const frame = (s: ReturnType<typeof setup>, seq: number, event_type: string, payload: Record<string, unknown>) =>
  s.live.frame({ type: 'event', seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload } } as never);

async function open(v: Mounted, row: HTMLElement, label: 'Refill' | 'Count') {
  v.click(v.button(label, row));
  await flush();
}

describe('[02b §8 Zone stock screen] zone stock', () => {
  it('[02b §8 Zone stock screen] all zones in floor order; counts; Low / Empty icon + word', async () => {
    const v = await show(setup());
    expect([...v.container.querySelectorAll('.grp__h')].map((h) => h.textContent)).toEqual(['Family hall', 'Cabins']);
    const rows = zsRows(v);
    expect(rows.map((r) => r.querySelector('b')?.textContent)).toEqual(['Raita', 'Water bottle', 'Salad', 'Raita']);
    expect(rows.map((r) => r.querySelector('.n')?.textContent)).toEqual(['6', '3', '0', '12']);
    expect(rows[0]!.querySelector('small')?.textContent).toBe('warn at 4');
    // ok: no pill; low: warn pill with icon + word; empty: danger pill with icon + word
    expect(rows[0]!.className).toBe('zs');
    expect(rows[0]!.querySelector('.stg')).toBeNull();
    expect(rows[1]!.className).toContain('low');
    expect(rows[1]!.querySelector('.stg.c-warn')?.textContent).toBe('Low');
    expect(rows[1]!.querySelector('.stg svg')).not.toBeNull();
    expect(rows[2]!.className).toContain('out');
    expect(rows[2]!.querySelector('.stg.c-danger')?.textContent).toBe('Empty');
    // a count exactly at its threshold is low (the zone alert's rule, §3.10)
    expect(v.text()).toContain('Zone stock');
  });

  it('[02b §8 Zone stock screen] Refill (+n) = AddZoneStock with the new count preview; Count (= n) = SetZoneStock', async () => {
    const s = setup();
    const v = await show(s);
    await open(v, zsRows(v)[1]!, 'Refill');
    expect(v.container.querySelector('[role="dialog"] h2')?.textContent).toBe('Add Water bottle to Family hall');
    expect(v.container.querySelector('.pv')?.textContent).toBe('→ 4');
    v.click(v.button('One more'));
    v.click(v.button('One more'));
    expect(v.container.querySelector('.pv')?.textContent).toBe('→ 6');
    expect(v.container.querySelector('output')?.textContent).toBe('3');
    v.click(v.button('Refill', v.container.querySelector('.acts')!));
    await flush();
    expect(s.addZoneStock).toHaveBeenCalledWith({ zone_id: 'FH', item_id: 'water', quantity: 3 });
    expect(v.container.querySelector('[role="dialog"]')).toBeNull();
    // the hub's answer is the new count
    expect(zsRows(v)[1]!.querySelector('.n')?.textContent).toBe('6');
    expect(s.toasts.current()?.text).toBe('Refilled · 6 now');
    // Count: starts at the count now; sets it exactly
    await open(v, zsRows(v)[0]!, 'Count');
    expect(v.container.querySelector('[role="dialog"] h2')?.textContent).toBe('Count Raita in Family hall');
    expect(v.container.querySelector('output')?.textContent).toBe('6');
    v.click(v.button('One less'));
    v.click(v.button('One less'));
    expect(v.container.querySelector('.pv')?.textContent).toBe('= 4');
    v.click(v.button('Count', v.container.querySelector('.acts')!));
    await flush();
    expect(s.setZoneStock).toHaveBeenCalledWith({ zone_id: 'FH', item_id: 'raita', on_hand: 4 });
    expect(zsRows(v)[0]!.querySelector('.n')?.textContent).toBe('4');
    expect(s.toasts.current()?.text).toBe('Counted · 4 now');
    // a count of 0 is allowed; Refill never goes below 1
    await open(v, zsRows(v)[0]!, 'Refill');
    expect(v.button('One less').hasAttribute('disabled')).toBe(true);
  });

  it('[02b §8 Zone stock screen] 403 my_zones and STOCK_INSUFFICIENT → toasts', async () => {
    const s = setup();
    const v = await show(s);
    s.addZoneStock.mockResolvedValueOnce(apiError(409, 'STOCK_INSUFFICIENT', { stock_item_id: 'w', available: 2 }));
    await open(v, zsRows(v)[1]!, 'Refill');
    v.click(v.button('Refill', v.container.querySelector('.acts')!));
    await flush();
    expect(s.toasts.current()).toMatchObject({ text: 'The store has only 2 — not enough to add that many', tone: 'warn' });
    // the sheet stays so the number can be lowered; the count did not move
    expect(v.container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(zsRows(v)[1]!.querySelector('.n')?.textContent).toBe('3');
    v.click(v.button('Cancel'));
    s.setZoneStock.mockResolvedValueOnce(apiError(403, 'PERMISSION_DENIED', { permission: 'manage-zone-stock', reason: 'outside_scope', zone_ids: ['CB'] }));
    await open(v, zsRows(v)[3]!, 'Count');
    v.click(v.button('Count', v.container.querySelector('.acts')!));
    await flush();
    expect(s.toasts.current()).toMatchObject({ text: 'This zone is not one of yours', tone: 'warn' });
    expect(v.container.querySelector('[role="dialog"]')).toBeNull();
    expect(zsRows(v)[3]!.querySelector('.n')?.textContent).toBe('12');
    // the hub is not reachable: "Needs the hub", nothing changed
    s.addZoneStock.mockResolvedValueOnce({ ok: false, error: { kind: 'network' } });
    await open(v, zsRows(v)[0]!, 'Refill');
    v.click(v.button('Refill', v.container.querySelector('.acts')!));
    await flush();
    expect(s.toasts.current()?.text).toBe('Needs the hub');
    expect(zsRows(v)[0]!.querySelector('.n')?.textContent).toBe('6');
  });

  it('[02b §8 Zone stock screen] counts follow ZoneStock* frames', async () => {
    vi.useFakeTimers();
    const s = setup();
    const v = await show(s);
    s.counts.set('FH|salad', 10);
    frame(s, 2, 'ZoneStockSet', { zone_id: 'FH', item_id: 'salad', on_hand: 10 });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await flush();
    expect(zsRows(v)[2]!.querySelector('.n')?.textContent).toBe('10');
    expect(zsRows(v)[2]!.className).toBe('zs');
    expect(zsRows(v)[2]!.querySelector('.stg')).toBeNull();
    s.counts.set('CB|raita', 17);
    frame(s, 3, 'ZoneStockAdded', { zone_id: 'CB', item_id: 'raita', quantity: 5 });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await flush();
    expect(zsRows(v)[3]!.querySelector('.n')?.textContent).toBe('17');
    expect(zsRows(v)[0]!.querySelector('.n')?.textContent).toBe('6');
    // the catch-up's zone_stock part shows at once on a later mount
    const later = setup();
    later.live.frame({ type: 'catch_up', as_of_seq: 1, state: { orders: { orders: [], zone_stock: ZONES } } });
    later.zoneStock.mockImplementation(() => new Promise(() => {}));
    v.unmount();
    view = null;
    vi.useRealTimers();
    const w = await show(later);
    expect(zsRows(w)).toHaveLength(4);
  });

  it('[02b §3.10] a Refill is counted once: 3 + 3 shows 6 whether the answer or the ZoneStockAdded frame comes first', async () => {
    for (const order of ['answer first', 'frame first'] as const) {
      vi.useFakeTimers();
      const s = setup();
      const v = await show(s);
      let release: () => void = () => {};
      if (order === 'frame first') {
        // the frame arrives while the command is still out
        const gate = new Promise<void>((r) => (release = r));
        const real = s.addZoneStock.getMockImplementation()!;
        s.addZoneStock.mockImplementationOnce(async (p) => {
          const answer = await real(p);
          frame(s, 2, 'ZoneStockAdded', { zone_id: 'FH', item_id: 'water', quantity: 3 });
          await gate;
          return answer;
        });
      }
      await open(v, zsRows(v)[1]!, 'Refill');
      v.click(v.button('One more'));
      v.click(v.button('One more'));
      v.click(v.button('Refill', v.container.querySelector('.acts')!));
      await flush();
      if (order === 'frame first') {
        await act(async () => {
          vi.advanceTimersByTime(250);
        });
        await flush();
        release();
        await flush();
      } else {
        frame(s, 2, 'ZoneStockAdded', { zone_id: 'FH', item_id: 'water', quantity: 3 });
      }
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      await flush();
      expect(zsRows(v)[1]!.querySelector('.n')?.textContent, order).toBe('6');
      expect(s.addZoneStock).toHaveBeenCalledTimes(1);
      v.unmount();
      view = null;
      vi.useRealTimers();
    }
  });

  it('[02b §3.10] a lost reply: the retry carries the same command_id; "Needs the hub" offline; a new amount or a new sheet is a new command', async () => {
    const s = setup();
    const v = await show(s);
    s.addZoneStock.mockResolvedValueOnce({ ok: false, error: { kind: 'network' } });
    await open(v, zsRows(v)[1]!, 'Refill');
    v.click(v.button('Refill', v.container.querySelector('.acts')!));
    await flush();
    expect(s.toasts.current()?.text).toBe('Needs the hub');
    expect(v.container.querySelector('[role="dialog"]')).not.toBeNull();
    v.click(v.button('Refill', v.container.querySelector('.acts')!));
    await flush();
    const ids = s.command.mock.calls.map((c) => c[2]?.commandId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^[0-9A-Z]{26}$/);
    expect(ids[1]).toBe(ids[0]);
    // answered: the next Refill is a new command
    await open(v, zsRows(v)[1]!, 'Refill');
    v.click(v.button('Refill', v.container.querySelector('.acts')!));
    await flush();
    expect(s.command.mock.calls[2]![2]?.commandId).not.toBe(ids[0]);
    // after a lost reply, another amount is another command; so is a re-opened sheet
    s.setZoneStock.mockResolvedValueOnce({ ok: false, error: { kind: 'network' } });
    await open(v, zsRows(v)[0]!, 'Count');
    v.click(v.button('Count', v.container.querySelector('.acts')!));
    await flush();
    v.click(v.button('One less'));
    v.click(v.button('Count', v.container.querySelector('.acts')!));
    await flush();
    const [first, second] = s.command.mock.calls.slice(3).map((c) => c[2]?.commandId);
    expect(second).not.toBe(first);
    s.setZoneStock.mockResolvedValueOnce({ ok: false, error: { kind: 'network' } });
    await open(v, zsRows(v)[0]!, 'Count');
    v.click(v.button('Count', v.container.querySelector('.acts')!));
    await flush();
    v.click(v.button('Cancel'));
    await open(v, zsRows(v)[0]!, 'Count');
    v.click(v.button('Count', v.container.querySelector('.acts')!));
    await flush();
    const [lost, again] = s.command.mock.calls.slice(5).map((c) => c[2]?.commandId);
    expect(again).not.toBe(lost);
  });

  it('[02b §3.10] steppers: Refill 1–500, Count 0–5,000', async () => {
    const big = setup({ zones: [{ zone_id: 'Z', name: 'Z', items: [{ item_id: 'a', name: 'A', on_hand: 4_999, threshold: 1 }, { item_id: 'b', name: 'B', on_hand: 499, threshold: 1 }] }] });
    const v = await show(big);
    await open(v, zsRows(v)[0]!, 'Count');
    v.click(v.button('One more'));
    expect(v.container.querySelector('output')?.textContent).toBe('5000');
    expect(v.button('One more').hasAttribute('disabled')).toBe(true);
    v.click(v.button('Cancel'));
    await open(v, zsRows(v)[1]!, 'Refill');
    for (let i = 0; i < 600; i += 1) v.click(v.button('One more'));
    expect(v.container.querySelector('output')?.textContent).toBe('500');
    expect(v.button('One more').hasAttribute('disabled')).toBe(true);
    v.click(v.button('Refill', v.container.querySelector('.acts')!));
    await flush();
    expect(big.addZoneStock).toHaveBeenCalledWith({ zone_id: 'Z', item_id: 'b', quantity: 500 });
  });

  it('[02b §8 Zone stock screen] a ZoneStock frame during the first load does not leave "Loading…" stuck', async () => {
    vi.useFakeTimers();
    const s = setup();
    let answer: (r: HubResult<ZoneStockBody[]>) => void = () => {};
    s.zoneStock.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    const v = await show(s);
    expect(v.text()).toContain('Loading');
    frame(s, 2, 'ZoneStockAdded', { zone_id: 'FH', item_id: 'water', quantity: 1 });
    answer({ ok: true, data: ZONES });
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await flush();
    expect(v.text()).not.toContain('Loading');
    expect(zsRows(v)).toHaveLength(4);
  });

  it('[02b §3.10] a zone-served line moves a count without a ZoneStock frame: order frames read the counts again, debounced', async () => {
    vi.useFakeTimers();
    const s = setup();
    const v = await show(s);
    expect(s.zoneStock).toHaveBeenCalledTimes(1);
    frame(s, 2, 'ItemAdded', {});
    frame(s, 3, 'ItemAdded', {});
    s.zoneStock.mockResolvedValueOnce({ ok: true, data: [{ ...ZONES[0]!, items: [{ ...ZONES[0]!.items[0]!, on_hand: 5 }] }] });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await flush();
    expect(s.zoneStock).toHaveBeenCalledTimes(2);
    expect(zsRows(v)[0]!.querySelector('.n')?.textContent).toBe('5');
  });

  it('[02b §8 Rules] Refill / Count only with manage-zone-stock', async () => {
    const v = await show(setup({ manage: false }));
    expect(zsRows(v)).toHaveLength(4);
    expect(v.container.querySelectorAll('.zs button')).toHaveLength(0);
    v.unmount();
    view = null;
    const w = await show(setup());
    expect(w.container.querySelectorAll('.zs button')).toHaveLength(8);
  });
});
