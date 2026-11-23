import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { navigate } from '../../../../app/router';
import { createHubClock } from '../../../../app/hub-clock';
import { tapAlert, type TapDeps, type TapRow } from '../../../alerts/deeplink-tap';
import type { Resolution } from '../../api';
import { ShellContext, type Shell } from '../../shell/hooks';
import { PHONE_QUERY, PORTRAIT_QUERY } from '../../shell/layout';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import { screenOfPath } from '../../shell/screens';
import { routePath } from '../../shell/routes';
import type { Enqueue, MapTile, TableMapBody, TablesApi } from '../contracts';
import { createLocalFlags } from '../local-flags';
import { TableMap } from './TableMap';

// 01d v1.3 §3.13.5 "The map floor and the tile (m7)", devices table; 02a v1.1.7 §8 (L-4a); G-4; test 79. Integrator
// ruling (a), cp5: the tap's arrival helper asks table-place.ts which element a `table` place is: the tile on a
// landscape tablet (on its floor, clear of the side panel), else the sheet header. Each case runs the real tapAlert
// over a real TableMap; the side panel / bottom sheet header is a fixture (the real sheet's header carries
// data-seating, cp3; TableSheet.test.tsx).

const NOW = 5_000_000;
const OPENED = NOW - 32 * 60_000;
const ALI = { staff_id: 'ST-ALI', name: 'Ali' };

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
            tile('F4', { joined_table_names: ['F4', 'F5'], state: 'ORDERED', seating_id: 'S4', primary_table_id: 'F4', opened_at: OPENED, holder: ALI }),
            tile('F5', { state: 'ORDERED', seating_id: 'S4', primary_table_id: 'F4', opened_at: OPENED, holder: ALI }),
          ],
        },
      ],
    },
    { floor_id: 'FL2', name: 'Rooftop', archived: false, zones: [{ zone_id: 'Z3', name: 'Roof', tables: [tile('R1', { state: 'SEATED', seating_id: 'S9', primary_table_id: 'R1', opened_at: OPENED })] }] },
    { floor_id: '', name: null, archived: true, zones: [{ zone_id: null, name: null, tables: [tile('OLD', { archived: true, state: 'FOOD_ON_TABLE', seating_id: 'S0', primary_table_id: 'OLD', opened_at: OPENED, seats: null })] }] },
  ],
};

type Layout = 'landscape' | 'portrait' | 'phone';
let layout: Layout = 'landscape';
const rects = new Map<string, { left: number; top: number; right: number; bottom: number }>();
let views: Mounted[] = [];
let scrolls: Element[] = [];
/** what a scroll into view does to an element's rect, by data-table */
const onScroll = new Map<string, () => void>();

beforeEach(() => {
  layout = 'landscape';
  rects.clear();
  onScroll.clear();
  scrolls = [];
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: (query === PHONE_QUERY && layout === 'phone') || (query === PORTRAIT_QUERY && layout === 'portrait'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolls.push(this);
    onScroll.get((this as HTMLElement).dataset?.table ?? '')?.();
  };
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const key = (this as HTMLElement).dataset?.table ?? ((this as HTMLElement).classList?.contains('tv') ? 'panel' : '');
    const r = rects.get(key) ?? { left: 0, top: 0, right: 0, bottom: 0 };
    return { ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => r } as DOMRect;
  };
});
afterEach(async () => {
  for (const v of views) v.unmount();
  views = [];
  document.body.querySelectorAll('.scrim').forEach((e) => e.remove());
  vi.unstubAllGlobals();
  window.location.hash = '';
  await settle();
});

const settle = async (ms = 30) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
  await flush();
};

function shellFor(o: { phone?: boolean; portrait?: boolean } = {}) {
  const live = createLiveBus();
  live.frame({ type: 'catch_up', as_of_seq: 5, state: { tables: MAP } });
  const enqueue = Object.assign(async () => ({ status: 'needs_hub' as const }), { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} }) as unknown as Enqueue;
  const tableMap = vi.fn(async () => ({ ok: true as const, data: MAP }));
  const shell = {
    device: { token: 'D', id: 'DEV', type: 'tablet' },
    tables: { tableMap } as unknown as TablesApi,
    live,
    permissions: createPermissions({ 'take-order': { grant: 'allowed', scope: 'branch' } } as Record<string, Resolution>),
    toasts: createToastBus(),
    enqueue,
    localFlags: createLocalFlags(),
    clock: createHubClock({ now_ms: NOW, utc_offset_ms: 0 }, () => 0),
    me: ALI,
    online: true,
    phone: o.phone ?? false,
    portrait: o.portrait ?? false,
  } as unknown as Shell;
  return { shell, tableMap };
}

function showMap(shell: Shell) {
  const m = mount();
  views.push(m);
  m.render(
    <ShellContext.Provider value={shell}>
      <TableMap />
    </ShellContext.Provider>,
  );
  return m;
}

/** The open table sheet's header, as its side panel (landscape) or bottom sheet (portrait / phone). */
function sheetHeader(seating_id: string, side: boolean) {
  const scrim = document.createElement('div');
  scrim.className = side ? 'scrim scrim--side' : 'scrim scrim--sheet';
  scrim.innerHTML = `<section class="tv" role="dialog" aria-modal="true"><div class="tv__h" data-seating="${seating_id}"></div></section>`;
  document.body.appendChild(scrim);
  return scrim.querySelector<HTMLElement>('[data-seating]')!;
}

function deps(shell: Shell, tableMap: ReturnType<typeof vi.fn>, extra: Partial<TapDeps> = {}) {
  return {
    orders: { orderView: vi.fn(), zoneStock: vi.fn() } as never,
    tables: { tableMap } as never,
    heldMap: () => MAP,
    seen: vi.fn<() => void>(),
    openSheet: vi.fn<() => void>(),
    navigate: vi.fn((href: string) => navigate(href)),
    toast: vi.fn<(text: string) => void>(),
    ...extra,
  } satisfies TapDeps;
}

const call = (table_id: string, seating_id: string): TapRow => ({
  alert_id: 'CW1',
  kind: 'call_waiter',
  raised_at: NOW - 60_000,
  state: 'open',
  lock: { kind_label_key: 'alert.call_waiter.lock', table_code: table_id, point_code: null, requester_name: null } as never,
  target: { type: 'table', table_id, seating_id },
});

const glowing = () => [...document.querySelectorAll('.pos-glow')];

describe('[01d #79] map places per device', () => {
  it('[01d #79] landscape tablet: a table target glows the tile, clear of the side panel', async () => {
    window.location.hash = '/tables';
    const { shell, tableMap } = shellFor();
    const m = showMap(shell);
    await flush();
    const header = sheetHeader('S4', true);
    rects.set('F4', { left: 100, top: 100, right: 200, bottom: 200 });
    rects.set('panel', { left: 600, top: 0, right: 1200, bottom: 800 });
    const d = deps(shell, tableMap);
    expect(await tapAlert(call('F4', 'S4'), d)).toBe('navigated');
    await settle();
    const tileEl = m.container.querySelector('[data-table="F4"]');
    expect(glowing()).toEqual([tileEl]);
    expect(header.classList.contains('pos-glow')).toBe(false);
    expect(tableMap).not.toHaveBeenCalled(); // the held map (cs5)
  });

  it('[01d #79] landscape tablet: a tile the panel still covers → the sheet header glows', async () => {
    window.location.hash = '/tables';
    const { shell, tableMap } = shellFor();
    showMap(shell);
    await flush();
    const header = sheetHeader('S4', true);
    rects.set('F4', { left: 700, top: 100, right: 800, bottom: 200 });
    rects.set('panel', { left: 600, top: 0, right: 1200, bottom: 800 });
    await tapAlert(call('F4', 'S4'), deps(shell, tableMap));
    await settle();
    expect(glowing()).toEqual([header]);
  });

  it('[01d #79] tablet portrait: the sheet header glows, not the tile', async () => {
    layout = 'portrait';
    window.location.hash = '/tables';
    const { shell, tableMap } = shellFor({ portrait: true });
    showMap(shell);
    await flush();
    const header = sheetHeader('S4', false);
    await tapAlert(call('F4', 'S4'), deps(shell, tableMap));
    await settle();
    expect(glowing()).toEqual([header]);
  });

  it('[01d #79] phone: a table target glows the sheet header; a dine-in line route marks the Dine in tab', async () => {
    layout = 'phone';
    window.location.hash = '/tables';
    const { shell, tableMap } = shellFor({ phone: true });
    showMap(shell);
    await flush();
    const header = sheetHeader('S4', false);
    await tapAlert(call('F4', 'S4'), deps(shell, tableMap));
    await settle();
    expect(glowing()).toEqual([header]);
    expect(screenOfPath(routePath('/tables/F4?seating_id=S4&focus=line:L1'))).toBe('dine_in');
  });

  it('[01d #79 G-4] a seating whose primary table is archived: the sheet header glows, no tile glow', async () => {
    window.location.hash = '/tables';
    const { shell, tableMap } = shellFor();
    const m = showMap(shell);
    await flush();
    expect(m.container.querySelector('[data-table="OLD"]')).not.toBeNull(); // the archived group is drawn
    const header = sheetHeader('S0', true);
    expect(await tapAlert(call('OLD', 'S0'), deps(shell, tableMap))).toBe('navigated');
    await settle();
    expect(window.location.hash).toBe('#/tables/OLD?seating_id=S0');
    expect(glowing()).toEqual([header]);
  });

  it('[01d #79] a merged table: the target on a joined table opens and glows its primary tile', async () => {
    window.location.hash = '/tables';
    const { shell, tableMap } = shellFor();
    const m = showMap(shell);
    await flush();
    sheetHeader('S4', true);
    await tapAlert(call('F5', 'S4'), deps(shell, tableMap));
    await settle();
    expect(window.location.hash).toBe('#/tables/F4?seating_id=S4');
    expect(glowing()).toEqual([m.container.querySelector('[data-table="F4"]')]);
  });

  it('[01d #79 m7] the map shows the tile\'s floor, as the floor control would; the place is judged on that floor', async () => {
    // phone, looking at the Rooftop: the target is in the Family hall
    layout = 'phone';
    window.location.hash = '/tables?floor=FL2';
    const { shell, tableMap } = shellFor({ phone: true });
    const m = showMap(shell);
    await flush();
    expect(m.container.querySelector('[data-table="F4"]')).toBeNull();
    sheetHeader('S4', false);
    await tapAlert(call('F4', 'S4'), deps(shell, tableMap));
    await settle();
    expect(m.container.querySelector('[data-table="F4"]')).not.toBeNull();
    expect(m.container.querySelector('[data-table="R1"]')).toBeNull();
    // the chip of that floor is pressed, and it stays picked once focus is dropped
    expect(m.container.querySelector('.chip[aria-pressed="true"]')?.textContent).toContain('Family hall');
    expect(window.location.hash).toBe('#/tables/F4?seating_id=S4');
  });

  it('[01d #79 m7] landscape on another floor: the tile is waited for on its floor, then glows (never the header first)', async () => {
    window.location.hash = '/tables?floor=FL2';
    const { shell, tableMap } = shellFor();
    const m = showMap(shell);
    await flush();
    expect(m.container.querySelector('[data-table="F4"]')).toBeNull();
    const header = sheetHeader('S4', true);
    await tapAlert(call('F4', 'S4'), deps(shell, tableMap));
    await settle();
    expect(glowing()).toEqual([m.container.querySelector('[data-table="F4"]')]);
    expect(header.classList.contains('pos-glow')).toBe(false);
  });

  it('[01d #79] kiosk: a lock-only void_approval row navigates and glows its line, with no AnswerSheet', async () => {
    window.location.hash = '/';
    const { shell, tableMap } = shellFor();
    // the line in the table sheet's orders part (cp4): a fixture of its round
    const scrim = document.createElement('div');
    scrim.className = 'scrim scrim--side';
    scrim.innerHTML = '<section class="tv"><div class="tv__h" data-seating="S4"></div><div class="rnd" data-order="O4"><div class="ol" data-line="L1"></div></div></section>';
    document.body.appendChild(scrim);
    const orderView = vi.fn(async () => ({
      ok: true as const,
      data: { kind: 'order' as const, order: { order_id: 'O4', order_type: 'dine_in', seating_id: 'S4', cancelled: false, billed: false, lines: [{ order_item_id: 'L1', live_units: 1 }] } },
    }));
    const d = deps(shell, tableMap, { orders: { orderView, zoneStock: vi.fn() } as never });
    const lockOnly: TapRow = { ...call('F4', 'S4'), alert_id: 'V1', kind: 'void_approval', target: { type: 'order_line', order_id: 'O4', order_item_id: 'L1' } };
    expect(await tapAlert(lockOnly, d)).toBe('navigated');
    await settle();
    expect(d.openSheet).not.toHaveBeenCalled();
    expect(glowing()).toEqual([scrim.querySelector('[data-line="L1"]')]);
  });

  it('[01d #79 m7] landscape: the tile is scrolled into view first, then judged: a tile the panel covers before the scroll but not after glows', async () => {
    window.location.hash = '/tables';
    const { shell, tableMap } = shellFor();
    const m = showMap(shell);
    await flush();
    const header = sheetHeader('S4', true);
    const panel = { left: 600, top: 0, right: 1200, bottom: 800 };
    rects.set('panel', panel);
    // under the panel where it is; beside it once scrolled into view
    rects.set('F4', { left: 700, top: 100, right: 800, bottom: 200 });
    onScroll.set('F4', () => rects.set('F4', { left: 300, top: 300, right: 400, bottom: 400 }));
    await tapAlert(call('F4', 'S4'), deps(shell, tableMap));
    await settle();
    const tileEl = m.container.querySelector('[data-table="F4"]');
    expect(scrolls[0]).toBe(tileEl);
    expect(glowing()).toEqual([tileEl]);
    expect(header.classList.contains('pos-glow')).toBe(false);
  });

  it('[01d #79] landscape: a tile the "Mine" filter hides falls back to the sheet header at once (no wait)', async () => {
    window.location.hash = '/tables';
    const { shell, tableMap } = shellFor();
    const m = showMap(shell);
    await flush();
    m.click(m.button('Mine'));
    await flush();
    expect(m.container.querySelector('[data-table="R1"]')).toBeNull(); // R1 is nobody's
    const header = sheetHeader('S9', true);
    await tapAlert(call('R1', 'S9'), deps(shell, tableMap));
    await settle(60); // well inside the 4 s arrival window
    expect(glowing()).toEqual([header]);
  });

  it('[01d #79] phone: a dine-in line target glows the line in the bottom sheet, through the real tap', async () => {
    layout = 'phone';
    window.location.hash = '/tables';
    const { shell, tableMap } = shellFor({ phone: true });
    showMap(shell);
    await flush();
    const scrim = document.createElement('div');
    scrim.className = 'scrim scrim--sheet';
    scrim.innerHTML = '<section class="tv" role="dialog" aria-modal="true"><div class="tv__h" data-seating="S4"></div><div class="rnd" data-order="O4"><div class="ol" data-line="L1"></div></div></section>';
    document.body.appendChild(scrim);
    const orderView = vi.fn(async () => ({
      ok: true as const,
      data: { kind: 'order' as const, order: { order_id: 'O4', order_type: 'dine_in', seating_id: 'S4', cancelled: false, billed: false, lines: [{ order_item_id: 'L1', live_units: 1 }] } },
    }));
    const d = deps(shell, tableMap, { orders: { orderView, zoneStock: vi.fn() } as never });
    const comp: TapRow = { ...call('F4', 'S4'), alert_id: 'E1', kind: 'engine_line_dropped', target: { type: 'order_line', order_id: 'O4', order_item_id: 'L1' } };
    expect(await tapAlert(comp, d)).toBe('navigated');
    await settle();
    expect(window.location.hash).toBe('#/tables/F4?seating_id=S4');
    expect(screenOfPath(routePath('/tables/F4?seating_id=S4'))).toBe('dine_in');
    expect(glowing()).toEqual([scrim.querySelector('[data-line="L1"]')]);
  });
});
