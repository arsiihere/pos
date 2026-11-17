import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import type { HubResult } from '../../../../api/hub-admin';
import type { Resolution } from '../../api';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { MapTile, OrdersPartProps, TableMapBody, TablesApi } from '../contracts';
import { createLocalFlags } from '../local-flags';
import { TableSheet } from './TableSheet';

// 02a §8 Open, Table sheet, Offline (02-S06): the sheet of one table, for the seating the tile showed.

const parts: OrdersPartProps[] = [];
vi.mock('../../orders/table-view/OrdersPart', () => ({
  OrdersPart: (p: OrdersPartProps) => {
    parts.push(p);
    return null;
  },
}));

const ME = 'ST-ALI';
const NOW = 1_700_000_000_000;
const allow: Resolution = { grant: 'allowed', scope: 'branch' };

function tile(over: Partial<MapTile> = {}): MapTile {
  return {
    table_id: 'TB4',
    name: 'F4',
    seats: 6,
    archived: false,
    state: 'ORDERED',
    seating_id: 'S1',
    party_size: 9,
    primary_table_id: 'TB4',
    joined_table_names: ['F4', 'F5'],
    holder: { staff_id: ME, name: 'Ali' },
    assignee: null,
    lock: null,
    opened_at: NOW - 32 * 60_000,
    bill_requested_at: null,
    live_order_count: 3,
    ...over,
  };
}

const mapOf = (tiles: MapTile[], as_of_seq = 5): TableMapBody => ({
  as_of_seq,
  floors: [{ floor_id: 'FL1', name: 'Family hall', archived: false, zones: [{ zone_id: 'Z1', name: 'Hall', tables: tiles }] }],
});

type Call = { name: keyof TablesApi; payload: unknown };

function fakeShell(o: { perms?: string[]; online?: boolean; maps?: TableMapBody[]; answers?: Partial<Record<keyof TablesApi, Array<HubResult<unknown>>>> }) {
  const calls: Call[] = [];
  const maps = [...(o.maps ?? [mapOf([tile(), tile({ table_id: 'TB5', name: 'F5', seats: 6 })])])];
  const answers = o.answers ?? {};
  const tables = new Proxy({} as TablesApi, {
    get: (_t, name: keyof TablesApi) => async (payload: unknown) => {
      calls.push({ name, payload });
      if (name === 'tableMap') return { ok: true, data: maps.length > 1 ? maps.shift() : maps[0] };
      return answers[name]?.shift() ?? { ok: false, error: { kind: 'network' } };
    },
  });
  const shell: Shell = {
    device: { token: 'T', id: 'DEV1', type: 'tablet' },
    meta: { tenantId: 'TEN', branchId: 'BR', branchName: 'Gulberg', hubNowMs: NOW, utcOffsetMs: 0 },
    api: {} as never,
    tables,
    orders: {} as never,
    live: createLiveBus(),
    config: {} as never,
    permissions: createPermissions(Object.fromEntries((o.perms ?? ['take-order']).map((p) => [p, allow]))),
    toasts: createToastBus(),
    enqueue: {} as never,
    localFlags: createLocalFlags(),
    clock: { nowMs: () => NOW, utcOffsetMs: 0 },
    me: { staff_id: ME, name: 'Ali' },
    online: o.online ?? true,
    phone: false,
    portrait: false,
  };
  return { shell, calls };
}

let m: Mounted;
beforeEach(() => {
  parts.length = 0;
  window.location.hash = '/tables/TB4?seating_id=S1';
});
afterEach(() => m?.unmount());

async function render(shell: Shell, seating_id: string | null = 'S1', table_id = 'TB4') {
  m = mount();
  m.render(
    <ShellContext.Provider value={shell}>
      <TableSheet table_id={table_id} seating_id={seating_id} />
    </ShellContext.Provider>,
  );
  await flush();
}

const toast = (shell: Shell) => shell.toasts.current()?.text;

describe('[02a §8 Table sheet] table sheet', () => {
  it('[02a §8 Table sheet] header: joined names, state, open time, guests / seats; the holder\'s view', async () => {
    const { shell } = fakeShell({});
    await render(shell);
    const text = m.text();
    expect(text).toContain('F4 + F5');
    expect(text).toContain('Your table');
    expect(text).toContain('Ordered');
    expect(text).toContain('Open 32 min');
    expect(text).toContain('9 guests · 12 seats');
    expect(m.button('Add items · Round 4')).toBeTruthy();
    expect(m.container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('[02a §8 Open] Take order → OpenTable with the shown seating_id, then #/order/dine_in/<seating_id>', async () => {
    const { shell, calls } = fakeShell({
      maps: [mapOf([tile({ live_order_count: 0, state: 'SEATED' })])],
      answers: { openTable: [{ ok: true, data: { seating_id: 'S1', primary_table_id: 'TB4', opened: true, holder_staff_id: ME } }] },
    });
    await render(shell);
    m.click(m.button('Take order'));
    await flush();
    expect(calls.filter((c) => c.name === 'openTable')).toEqual([{ name: 'openTable', payload: { table_id: 'TB4', seating_id: 'S1' } }]);
    expect(window.location.hash).toBe('#/order/dine_in/S1');
  });

  it('[02a §8 Open] a free table opens without a seating_id', async () => {
    const free = tile({ state: 'FREE', seating_id: null, holder: null, live_order_count: 0, opened_at: null, joined_table_names: ['F4'], party_size: null });
    const { shell, calls } = fakeShell({
      maps: [mapOf([free])],
      answers: { openTable: [{ ok: true, data: { seating_id: 'S9', primary_table_id: 'TB4', opened: true, holder_staff_id: ME } }] },
    });
    await render(shell, null);
    expect(m.text()).toContain('Free');
    m.click(m.button('Take order'));
    await flush();
    expect(calls.find((c) => c.name === 'openTable')?.payload).toEqual({ table_id: 'TB4' });
    expect(window.location.hash).toBe('#/order/dine_in/S9');
  });

  it('[02a §8 Table sheet] the sheet acts on the seating it shows: a table freed since the tap opens a new seating (review #161)', async () => {
    const free = tile({ state: 'FREE', seating_id: null, holder: null, live_order_count: 0, opened_at: null, joined_table_names: ['F4'], party_size: null });
    const { shell, calls } = fakeShell({
      maps: [mapOf([free])],
      answers: { openTable: [{ ok: true, data: { seating_id: 'S9', primary_table_id: 'TB4', opened: true, holder_staff_id: ME } }] },
    });
    await render(shell, 'S1'); // the tap carried the old seating
    expect(toast(shell)).toBe('This table changed — refreshed');
    m.click(m.button('Take order'));
    await flush();
    expect(calls.find((c) => c.name === 'openTable')?.payload).toEqual({ table_id: 'TB4' });
    expect(window.location.hash).toBe('#/order/dine_in/S9');
  });

  it('[02a §8 Table sheet] Take over sends the seating the dialog showed; a later change answers 409 → toast + refresh (review #161)', async () => {
    const theirs = tile({ holder: { staff_id: 'ST-BIL', name: 'Bilal' }, assignee: { staff_id: ME, name: 'Ali' }, joined_table_names: ['F4'] });
    const { shell, calls } = fakeShell({
      maps: [mapOf([theirs])],
      answers: { takeOverTable: [{ ok: false, error: { kind: 'api', status: 409, code: 'TABLE_SEATING_CHANGED', details: { table_id: 'TB4', seating_id: 'S2' } } }] },
    });
    await render(shell);
    m.click(m.button('Take over from Bilal'));
    // the table is cleaned and reopened by someone else while the dialog is open
    act(() => shell.live.frame({ type: 'catch_up', as_of_seq: 50, state: { tables: mapOf([{ ...theirs, seating_id: 'S2', holder: { staff_id: 'ST-SAR', name: 'Sara' } }], 50) } }));
    m.click(m.button('Take over', m.container.querySelector('.dlg')!));
    await flush();
    expect(calls.find((c) => c.name === 'takeOverTable')?.payload).toEqual({ table_id: 'TB4', seating_id: 'S1' });
    expect(toast(shell)).toBe('This table changed — refreshed');
    expect(calls.some((c) => c.name === 'openTable')).toBe(false);
  });

  it('[02a §8 Table sheet] Take over done but OpenTable fails → the sheet reads the map again (review #161)', async () => {
    const theirs = tile({ holder: { staff_id: 'ST-BIL', name: 'Bilal' }, assignee: { staff_id: ME, name: 'Ali' }, joined_table_names: ['F4'] });
    const { shell, calls } = fakeShell({ maps: [mapOf([theirs])], answers: { takeOverTable: [{ ok: true, data: { changed: true } }] } });
    await render(shell);
    const before = calls.filter((c) => c.name === 'tableMap').length;
    m.click(m.button('Take over from Bilal'));
    m.click(m.button('Take over', m.container.querySelector('.dlg')!));
    await flush();
    expect(calls.some((c) => c.name === 'openTable')).toBe(true); // network: Needs the hub
    expect(toast(shell)).toBe('Needs the hub');
    expect(calls.filter((c) => c.name === 'tableMap').length).toBeGreaterThan(before);
  });

  it('[02a §8 Open] two quick taps send one OpenTable (review #161)', async () => {
    let release: (v: unknown) => void = () => {};
    const { shell, calls } = fakeShell({});
    const slow = new Promise((r) => (release = r));
    const orig = shell.tables;
    shell.tables = new Proxy(orig, { get: (t, name: keyof TablesApi) => (name === 'openTable' ? async (p: unknown) => (calls.push({ name, payload: p }), slow) : t[name]) });
    await render(shell);
    const b = m.button('Add items');
    act(() => {
      b.click();
      b.click();
    });
    expect(calls.filter((c) => c.name === 'openTable')).toHaveLength(1);
    release({ ok: false, error: { kind: 'network' } });
    await flush();
  });

  it('[02a Q-15] 403 PERMISSION_DENIED outside_scope → "This table is outside your floors"', async () => {
    const { shell } = fakeShell({
      answers: { openTable: [{ ok: false, error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['TB4'] } } }] },
    });
    await render(shell);
    m.click(m.button('Add items'));
    await flush();
    expect(toast(shell)).toBe('This table is outside your floors');
    expect(window.location.hash).toBe('#/tables/TB4?seating_id=S1');
  });

  it('[02a §8 Table sheet] 409 TABLE_SEATING_CHANGED → "This table changed — refreshed" + one map read', async () => {
    const { shell, calls } = fakeShell({
      answers: { openTable: [{ ok: false, error: { kind: 'api', status: 409, code: 'TABLE_SEATING_CHANGED', details: { table_id: 'TB4', seating_id: 'S2' } } }] },
    });
    await render(shell);
    const before = calls.filter((c) => c.name === 'tableMap').length;
    m.click(m.button('Add items'));
    await flush();
    expect(toast(shell)).toBe('This table changed — refreshed');
    expect(calls.filter((c) => c.name === 'tableMap').length).toBe(before + 1);
  });

  it('[02a §8 Table sheet] Take over → TakeOverTable then OpenTable; 403 not_assigned → toast', async () => {
    const theirs = tile({ holder: { staff_id: 'ST-BIL', name: 'Bilal' }, assignee: { staff_id: ME, name: 'Ali' }, joined_table_names: ['F4'] });
    const ok = fakeShell({
      maps: [mapOf([theirs])],
      answers: {
        takeOverTable: [{ ok: true, data: { changed: true } }],
        openTable: [{ ok: true, data: { seating_id: 'S1', primary_table_id: 'TB4', opened: true, holder_staff_id: ME } }],
      },
    });
    await render(ok.shell);
    m.click(m.button('Take over from Bilal'));
    expect(m.text()).toContain('Take over F4 from Bilal?');
    m.click(m.button('Take over', m.container.querySelector('.dlg')!));
    await flush();
    expect(ok.calls.filter((c) => c.name !== 'tableMap')).toEqual([
      { name: 'takeOverTable', payload: { table_id: 'TB4', seating_id: 'S1' } },
      { name: 'openTable', payload: { table_id: 'TB4', seating_id: 'S1' } },
    ]);
    expect(window.location.hash).toBe('#/order/dine_in/S1');
    m.unmount();

    window.location.hash = '/tables/TB4?seating_id=S1';
    const denied = fakeShell({
      maps: [mapOf([theirs])],
      answers: { takeOverTable: [{ ok: false, error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: { reason: 'not_assigned', assigned_staff_id: 'ST-SAR' } } }] },
    });
    await render(denied.shell);
    m.click(m.button('Take over from Bilal'));
    m.click(m.button('Take over', m.container.querySelector('.dlg')!));
    await flush();
    expect(toast(denied.shell)).toBe('This table is not assigned to you');
    expect(denied.calls.some((c) => c.name === 'openTable')).toBe(false);
    expect(m.container.querySelector('.dlg')).toBeNull();
  });

  it('[02a §8 Offline] offline: Open, Take over, Force release disabled "Needs the hub"', async () => {
    const theirs = tile({ holder: { staff_id: 'ST-BIL', name: 'Bilal' }, assignee: { staff_id: ME, name: 'Ali' }, lock: { staff_id: 'ST-BIL', name: 'Bilal', mine: false } });
    const { shell, calls } = fakeShell({ online: false, perms: ['take-order', 'force-release-table-lock'], maps: [mapOf([theirs])] });
    await render(shell);
    expect(m.text()).toContain("Hub offline. Ask for bill and Clean will be sent when it's back.");
    const takeOver = m.button('Take over from Bilal');
    expect(takeOver.getAttribute('aria-disabled')).toBe('true');
    m.click(takeOver);
    expect(toast(shell)).toBe('Needs the hub');
    const release = m.button("Release Bilal's lock");
    expect(release.getAttribute('aria-disabled')).toBe('true');
    shell.toasts.clear();
    m.click(release);
    expect(toast(shell)).toBe('Needs the hub');
    expect(m.container.querySelector('.dlg')).toBeNull();
    m.unmount();

    const mine = fakeShell({ online: false });
    await render(mine.shell);
    m.click(m.button('Add items'));
    expect(toast(mine.shell)).toBe('Needs the hub');
    expect(calls.concat(mine.calls).some((c) => c.name !== 'tableMap')).toBe(false);
  });

  it('[02a §8 Table sheet] the orders part mounts OrdersPart with seating_id, table_ids, holder, mine', async () => {
    const { shell } = fakeShell({});
    await render(shell);
    expect(parts.at(-1)).toEqual({ seating_id: 'S1', table_ids: ['TB4', 'TB5'], primary_table_id: 'TB4', holder_staff_id: ME, mine: true });
    m.unmount();
    parts.length = 0;
    const theirs = fakeShell({ maps: [mapOf([tile({ holder: { staff_id: 'ST-BIL', name: 'Bilal' }, joined_table_names: ['F4'] })])] });
    await render(theirs.shell);
    expect(parts.at(-1)).toMatchObject({ table_ids: ['TB4'], holder_staff_id: 'ST-BIL', mine: false });
    m.unmount();
    parts.length = 0;
    const free = fakeShell({ maps: [mapOf([tile({ state: 'FREE', seating_id: null, holder: null })])] });
    await render(free.shell, null);
    expect(parts).toEqual([]);
  });

  it('[02a §8 Table sheet] a shown button that cannot act now tells why on tap; Close goes back to the map', async () => {
    const { shell, calls } = fakeShell({ maps: [mapOf([tile({ state: 'SEATED', live_order_count: 0, joined_table_names: ['F4'] })])] });
    await render(shell);
    m.click(m.button('Ask for bill'));
    expect(toast(shell)).toBe('No orders on this table yet');
    expect(calls.some((c) => c.name !== 'tableMap')).toBe(false);
    m.click(m.button('Close'));
    expect(window.location.hash).toBe('#/tables');
  });

  it('[02a §8 Table sheet] More opens Move / Join / Split / Release my lock; Release my lock sends ReleaseTableLock', async () => {
    const { shell, calls } = fakeShell({
      maps: [mapOf([tile({ lock: { staff_id: ME, name: 'Ali', mine: true } }), tile({ table_id: 'TB5', name: 'F5' })])],
      answers: { releaseTableLock: [{ ok: true, data: { released: true } }] },
    });
    await render(shell);
    const more = m.button('More');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    m.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(m.text()).toContain('Split first — F4 + F5 is joined');
    expect(m.text()).toContain('Join a table');
    expect(m.text()).toContain('Split the party');
    m.click(m.button('Release my lock'));
    await flush();
    expect(calls.find((c) => c.name === 'releaseTableLock')?.payload).toEqual({ table_id: 'TB4', seating_id: 'S1' });
  });

  it('[02a §8 Table map] a table frame re-reads the map once (debounced); TableLockTouched does not', async () => {
    vi.useFakeTimers();
    try {
      const { shell, calls } = fakeShell({});
      await render(shell);
      const reads = () => calls.filter((c) => c.name === 'tableMap').length;
      const before = reads();
      const ev = (seq: number, event_type: string) => ({ type: 'event' as const, seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload: {} } });
      shell.live.frame(ev(10, 'TableLockTouched'));
      await vi.advanceTimersByTimeAsync(300);
      expect(reads()).toBe(before);
      shell.live.frame(ev(11, 'TableLocked'));
      shell.live.frame(ev(12, 'OrderPlaced'));
      await vi.advanceTimersByTimeAsync(300);
      expect(reads()).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});
