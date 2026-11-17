import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../../../../../test/dom';
import { createHubClock } from '../../../../app/hub-clock';
import { setLanguage } from '../../../../i18n';
import type { Resolution } from '../../api';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { Enqueue, MapTile, TableMapBody, TablesApi } from '../contracts';
import { createLocalFlags } from '../local-flags';
import type { MapAlertRow } from './filters';
import { TableMap } from './TableMap';

// 02a v1.1.6 §8 Table map (02-S03): zones, tiles, Mine, Needs you, the dock.

const ALI = { staff_id: 'ST-ALI', name: 'Ali' };
const BILAL = { staff_id: 'ST-BILAL', name: 'Bilal' };
const SARA = { staff_id: 'ST-SARA', name: 'Sara' };
const NOW = 5_000_000;
const OPENED = NOW - 32 * 60_000;

function tile(table_id: string, over: Partial<MapTile> = {}): MapTile {
  return {
    table_id,
    name: table_id,
    seats: 4,
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

const TAKE: Record<string, Resolution> = { 'take-order': { grant: 'allowed', scope: 'branch' } };

const MAP: TableMapBody = {
  as_of_seq: 5,
  floors: [
    {
      floor_id: 'FL1',
      name: 'Family hall',
      archived: false,
      zones: [
        {
          zone_id: 'Z1',
          name: 'Family hall',
          tables: [
            tile('F1', { assignee: ALI }),
            tile('F4', { name: 'F4', joined_table_names: ['F4', 'F5'], state: 'ORDERED', seating_id: 'S4', opened_at: OPENED, holder: ALI, assignee: ALI, party_size: 9 }),
            tile('F6', { state: 'BILL_REQUESTED', seating_id: 'S6', opened_at: OPENED, holder: ALI, assignee: ALI, bill_requested_at: NOW - 4 * 60_000 }),
            tile('F7', { state: 'SEATED', seating_id: 'S7', opened_at: NOW - 3 * 60_000, holder: BILAL, assignee: ALI, lock: { ...BILAL, mine: false } }),
          ],
        },
        { zone_id: 'Z2', name: 'Cabins', tables: [tile('F8', { state: 'NEEDS_CLEANING', seating_id: 'S8', assignee: SARA }), tile('F9', { assignee: ALI })] },
        { zone_id: null, name: null, tables: [tile('X1')] },
      ],
    },
    { floor_id: 'FL2', name: 'Rooftop', archived: false, zones: [{ zone_id: 'Z3', name: 'Roof', tables: [tile('R1')] }] },
    { floor_id: '', name: null, archived: true, zones: [{ zone_id: null, name: null, tables: [tile('OLD', { archived: true, state: 'FOOD_ON_TABLE', seating_id: 'S0', opened_at: OPENED, seats: null })] }] },
  ],
};

function setup(o: { map?: TableMapBody | null; perms?: Record<string, Resolution>; device?: 'tablet' | 'cashier_kiosk' | 'phone'; me?: { staff_id: string; name: string }; phone?: boolean; portrait?: boolean; pending?: Record<string, number>; online?: boolean } = {}) {
  const live = createLiveBus();
  if (o.map !== null) live.frame({ type: 'catch_up', as_of_seq: 5, state: { tables: o.map ?? MAP } });
  const enqueue = Object.assign(async () => ({ status: 'needs_hub' as const }), {
    pendingFor: (id: string) => o.pending?.[id] ?? 0,
    pendingCount: () => 0,
    subscribe: () => () => {},
  }) as unknown as Enqueue;
  const toasts = createToastBus();
  const localFlags = createLocalFlags();
  const shell = {
    device: { token: 'D', id: 'DEV', type: o.device ?? 'tablet' },
    tables: { tableMap: vi.fn(async () => ({ ok: true as const, data: MAP })) } as unknown as TablesApi,
    live,
    permissions: createPermissions(o.perms ?? TAKE),
    toasts,
    enqueue,
    localFlags,
    clock: createHubClock({ now_ms: NOW, utc_offset_ms: 0 }, () => 0),
    me: o.me ?? { staff_id: 'ST-ALI', name: 'Ali' },
    online: o.online ?? true,
    phone: o.phone ?? false,
    portrait: o.portrait ?? false,
  } as unknown as Shell;
  return { shell, live, toasts, localFlags };
}

let m: Mounted;
function show(s: ReturnType<typeof setup>, props: Parameters<typeof TableMap>[0] = {}) {
  m = mount();
  m.render(
    <ShellContext.Provider value={s.shell}>
      <TableMap {...props} />
    </ShellContext.Provider>,
  );
  return m.container;
}
async function hashTo(hash: string) {
  await act(async () => {
    window.location.hash = hash;
    await new Promise((r) => setTimeout(r, 0));
  });
}
const names = (c: Element) => [...c.querySelectorAll('.zones .tt__n')].map((e) => e.textContent);

beforeEach(() => {
  window.location.hash = '#/tables';
});
afterEach(() => {
  m.unmount();
  setLanguage('en');
});

describe('[02a §8 Table map] screen', () => {
  it('[02a §8 Table map] zones in setup order, then No zone, then Archived tables', async () => {
    const c = show(setup());
    expect([...c.querySelectorAll('.zone__h')].map((h) => h.firstChild?.textContent)).toEqual(['Family hall', 'Cabins', 'No zone', 'Roof', 'Archived tables']);
    expect(names(c)).toEqual(['F1', 'F4 + F5', 'F6', 'F7', 'F8', 'F9', 'X1', 'R1', 'OLD']);
    // a floor chosen in the top bar leaves that floor's zones and the archived group
    await hashTo('#/tables?floor=FL2');
    expect(names(c)).toEqual(['R1', 'OLD']);
  });

  it('[02a Q-25] zone heading names an assignee only when every tile of the zone has the same assignee', () => {
    const c = show(setup());
    const heads = [...c.querySelectorAll('.zone__h')];
    // Family hall: every tile is Ali's, and Ali is me -> "your zone"
    expect(heads[0]?.querySelector('.zw')?.textContent).toBe('Ayour zone');
    expect(heads[0]?.querySelector('.zw--me')).not.toBeNull();
    // Cabins: Sara's F8 and Ali's F9 -> no name in the heading
    expect(heads[1]?.querySelector('.zw')).toBeNull();
    expect(heads[1]?.querySelector('.end')?.textContent).toBe('2 tables');
    // the tile whose holder is someone else carries the hollow assignee avatar (F7: Bilal holds, Ali is assigned)
    const f7 = [...c.querySelectorAll('.tt')].find((e) => e.querySelector('.tt__n')?.textContent === 'F7');
    expect(f7?.querySelector('.tav--as')).not.toBeNull();
    // another person's zone names them
    m.unmount();
    const sara = show(setup({ map: { as_of_seq: 1, floors: [{ floor_id: 'F', name: 'F', archived: false, zones: [{ zone_id: 'Z', name: 'Cabins', tables: [tile('F8', { assignee: SARA })] }] }] } }));
    expect(sara.querySelector('.zw')?.textContent).toBe("SSara's zone");
    expect(sara.querySelector('.zw--me')).toBeNull();
  });

  it('[02a §8 Table map] Mine = tables I hold or am assigned', () => {
    const c = show(setup());
    m.click(m.button('Mine'));
    expect(names(c)).toEqual(['F1', 'F4 + F5', 'F6', 'F7', 'F9']);
    expect(m.button('Mine').textContent).toContain('5');
    // nobody's: the empty line
    m.unmount();
    const none = show(setup({ me: { staff_id: 'ST-NOBODY', name: 'Zed' } }));
    m.click(m.button('Mine'));
    expect(none.textContent).toContain('You have no tables right now.');
  });

  it('[02a Q-17] late flag from my own open slip_warning rows matched by table_code; no void-waiting or bill-paid flag', () => {
    const row: MapAlertRow = {
      alert_id: 'A1',
      kind: 'slip_warning',
      state: 'open',
      raised_at: NOW - 60_000,
      lock: { kind_label_key: 'alert.slip_warning.lock', table_code: 'F5', point_code: null, requester_name: null },
      card: { kind_label_key: 'alert.slip_warning.card', table_code: 'F5', point_code: null, requester_name: null, device_name: null, details: { minutes_late: 6 } },
    };
    const c = show(setup(), { alertRows: [row] });
    const f4 = [...c.querySelectorAll('.tt')].find((e) => e.querySelector('.tt__n')?.textContent === 'F4 + F5');
    expect(f4?.querySelector('.fl')?.textContent).toBe('6 min late');
    expect(f4?.classList.contains('urgent')).toBe(true);
    expect(c.textContent).not.toContain('Void waiting');
    expect(c.textContent).not.toContain('Bill paid');
    // Needs you lists it, after Bill asked
    expect([...c.querySelectorAll('.ny')].map((e) => e.querySelector('.ny__t')?.textContent)).toEqual(['Bill asked', '6 min late', 'Bilal is ordering']);
  });

  it('[02a Q-17] "Waiting to send" when Enqueue.pendingFor(table_id) > 0', () => {
    const c = show(setup({ pending: { F6: 1 } }));
    const f6 = [...c.querySelectorAll('.tt')].find((e) => e.querySelector('.tt__n')?.textContent === 'F6');
    expect(f6?.querySelector('.fl--q')?.textContent).toBe('Waiting to send');
    expect([...c.querySelectorAll('.fl--q')].map((e) => e.textContent)).toEqual(['Waiting to send', 'Archived']);
  });

  it('[02a Q-16] "Call sent · n min" only from this device\'s local flag', () => {
    const s = setup();
    const c = show(s);
    expect(c.textContent).not.toContain('Call sent');
    act(() => s.localFlags.markCallSent('F4', NOW - 2 * 60_000));
    const f4 = [...c.querySelectorAll('.tt')].find((e) => e.querySelector('.tt__n')?.textContent === 'F4 + F5');
    expect(f4?.querySelector('.fl')?.textContent).toBe('Call sent · 2 min');
  });

  it('[02a §8 Table map] a tile tap opens #/tables/<table_id> with the tile\'s seating_id', () => {
    const c = show(setup());
    const f6 = [...c.querySelectorAll<HTMLElement>('.tt')].find((e) => e.querySelector('.tt__n')?.textContent === 'F6');
    m.click(f6);
    expect(window.location.hash).toBe('#/tables/F6?seating_id=S6');
    // a free table has no seating
    m.click([...c.querySelectorAll<HTMLElement>('.tt')].find((e) => e.querySelector('.tt__n')?.textContent === 'F1'));
    expect(window.location.hash).toBe('#/tables/F1');
    // a Needs-you row opens the same sheet
    m.click(c.querySelector<HTMLElement>('.ny'));
    expect(window.location.hash).toBe('#/tables/F6?seating_id=S6');
  });

  it('[02a §8 Table map] waiter (no take-order): no New order; Needs you = calls and cleaning', () => {
    const call: MapAlertRow = { alert_id: 'C1', kind: 'call_waiter', state: 'open', raised_at: NOW - 2 * 60_000, lock: { kind_label_key: 'alert.call_waiter.lock', table_code: 'F5', point_code: null, requester_name: 'Ali' } };
    const s = setup({ perms: {}, me: { staff_id: 'ST-RASHID', name: 'Rashid' } });
    const c = show(s, { alertRows: [call] });
    expect(c.textContent).not.toContain('New order');
    expect(c.querySelector('.duo')).toBeNull();
    expect([...c.querySelectorAll('.ny')].map((e) => `${e.querySelector('.ny__c')?.textContent}|${e.querySelector('.ny__t')?.textContent}|${e.querySelector('.ny__s')?.textContent ?? ''}`)).toEqual([
      'F4+F5|Call|Ali · 2 min ago',
      'F8|To clean|',
    ]);
    // a free table: a toast, no sheet
    m.click([...c.querySelectorAll<HTMLElement>('.tt')].find((e) => e.querySelector('.tt__n')?.textContent === 'F1'));
    expect(s.toasts.current()?.text).toBe('F1 is free');
    expect(window.location.hash).toBe('#/tables');
  });

  it('[02a §8 Table map] takers get one New order, Open orders and Held', () => {
    const onNewOrder = vi.fn();
    const c = show(setup(), { onNewOrder });
    expect(c.querySelectorAll('.btn--primary')).toHaveLength(1);
    m.click(m.button('New order'));
    expect(onNewOrder).toHaveBeenCalledTimes(1);
    m.click(m.button('Open orders'));
    expect(window.location.hash).toBe('#/orders');
    m.click(m.button('Held'));
    expect(window.location.hash).toBe('#/held');
  });

  it('[02a §8 Table map] New order shows only when the shell gives onNewOrder (dock and phone bar)', () => {
    expect(show(setup()).textContent).not.toContain('New order');
    m.unmount();
    expect(show(setup({ phone: true })).querySelector('.phbar')).toBeNull();
    m.unmount();
    expect(show(setup({ portrait: true }), { onNewOrder: () => {} }).querySelector('.pdock')?.textContent).toContain('New order');
    m.unmount();
    expect(show(setup({ phone: true }), { onNewOrder: () => {} }).querySelector('.phbar')?.textContent).toContain('New order');
  });

  it('[02a Q-25] a tile whose assignee differs from the zone heading gets the hollow avatar, even without a holder', () => {
    const c = show(setup());
    const tileOf = (n: string) => [...c.querySelectorAll('.tt')].find((e) => e.querySelector('.tt__n')?.textContent === n);
    expect(tileOf('F8')?.querySelector('.tav--as')?.textContent).toBe('S'); // Cabins heading names nobody
    expect(tileOf('F1')?.querySelector('.tav--as')).toBeNull(); // = heading (Ali), no holder
    expect(tileOf('F4 + F5')?.querySelector('.tav--as')).toBeNull(); // holder = assignee = heading
  });

  it('[02a §8 Table map] loading skeleton before the first catch-up; empty state; offline desaturates the floor', () => {
    const c = show(setup({ map: null }));
    expect(c.querySelectorAll('.tt[aria-hidden="true"]').length).toBeGreaterThan(0);
    expect(c.querySelector('main')?.getAttribute('aria-busy')).toBe('true');
    m.unmount();
    const empty = show(setup({ map: { as_of_seq: 1, floors: [] } }));
    expect(empty.textContent).toContain('No tables yet');
    expect(empty.textContent).toContain('Ask the owner to add floors and tables.');
    m.unmount();
    const off = show(setup({ online: false }));
    expect(off.querySelector('.zones')?.classList.contains('stale')).toBe(true);
  });

  it('[02a §8 Table map] legend counts the six states of the floor; kiosk Needs you shows every Bill asked and To clean', () => {
    const c = show(setup({ perms: {}, device: 'cashier_kiosk', me: { staff_id: 'ST-SANA', name: 'Sana' } }));
    const counts = [...c.querySelectorAll('.lgd span')].map((e) => `${e.textContent}`);
    expect(counts).toEqual(['4Free', '1Seated', '1Ordered', '1Eating', '1Bill', '1To clean']);
    expect([...c.querySelectorAll('.ny')].map((e) => `${e.querySelector('.ny__c')?.textContent}|${e.querySelector('.ny__s')?.textContent ?? ''}`)).toEqual(['F6|Ali · 4 min ago', 'F8|']);
  });

  it('[02a §8 Rules] the tile grid stays LTR in Urdu', () => {
    setLanguage('ur');
    const c = show(setup());
    for (const grid of c.querySelectorAll('.tiles')) expect(grid.getAttribute('dir')).toBe('ltr');
    expect(names(c).slice(0, 3)).toEqual(['F1', 'F4 + F5', 'F6']);
    expect(c.querySelector('.zone__h')?.textContent).toContain('میزیں');
  });

  it('[02a §8 Table map] portrait puts Needs you in a strip and the buttons in a dock; phone has floor chips, Mine, and one New order bar', async () => {
    const p = show(setup({ portrait: true }), { onNewOrder: () => {} });
    expect(p.querySelector('.pdock .btn--primary')).not.toBeNull();
    expect(p.querySelector('.map > .col .needs')).not.toBeNull();
    m.unmount();
    const ph = show(setup({ phone: true }), { onNewOrder: () => {} });
    expect([...ph.querySelectorAll('.chipsx .chip')].map((e) => e.textContent)).toEqual(['Family hall 7', 'Rooftop 1']);
    expect(ph.querySelector('.phbar .btn--primary')?.textContent).toContain('New order');
    expect(names(ph)).toEqual(['F1', 'F4 + F5', 'F6', 'F7', 'F8', 'F9', 'X1', 'OLD']); // first floor only, archived group last
    m.click(ph.querySelectorAll<HTMLElement>('.chipsx .chip')[1]);
    await hashTo(window.location.hash);
    expect(names(ph)).toEqual(['R1', 'OLD']);
  });
});
