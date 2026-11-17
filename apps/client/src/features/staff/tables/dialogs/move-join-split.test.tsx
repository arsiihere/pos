import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import type { HubResult } from '../../../../api/hub-admin';
import type { Resolution } from '../../api';
import type { OrdersApi, SeatingOrder } from '../../orders/contracts';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { HandoverCandidate, MapTile, TableMapBody, TablesApi } from '../contracts';
import { createLocalFlags } from '../local-flags';
import { TableSheet } from '../sheet/TableSheet';

// 02a §8 Table sheet, Offline; §3.10–§3.12, §6.9–§6.11 (02-D09 Move, 02-D10 Join, 02-D11 Split, 02a-D25
// MoveOtherOwner; Q-25).

vi.mock('../../orders/table-view/OrdersPart', () => ({ OrdersPart: () => null }));

const ME = 'ST-ALI';
const NOW = 1_700_000_000_000;
const allow: Resolution = { grant: 'allowed', scope: 'branch' };
const SARA = { staff_id: 'ST-SAR', name: 'Sara' };

function tile(over: Partial<MapTile> & { table_id: string; name: string }): MapTile {
  return {
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
const seated = (table_id: string, name: string, seating_id: string, over: Partial<MapTile> = {}) =>
  tile({ table_id, name, state: 'ORDERED', seating_id, primary_table_id: table_id, joined_table_names: [name], holder: { staff_id: ME, name: 'Ali' }, opened_at: NOW - 60_000, live_order_count: 1, ...over });

const F2 = seated('TB2', 'F2', 'S2');
const F3 = seated('TB3', 'F3', 'S3', { state: 'FOOD_ON_TABLE' });
const F10 = seated('TB10', 'F10', 'S10', { state: 'FOOD_ON_TABLE', holder: SARA });
const F4 = seated('TB4', 'F4', 'S1', { joined_table_names: ['F4', 'F5'], live_order_count: 3 });
const F5 = seated('TB5', 'F5', 'S1', { primary_table_id: 'TB4', joined_table_names: ['F4', 'F5'], live_order_count: 3 });
const F8 = tile({ table_id: 'TB8', name: 'F8', state: 'NEEDS_CLEANING', seating_id: 'S8', primary_table_id: 'TB8', joined_table_names: ['F8'], holder: SARA });
const MAP: TableMapBody = {
  as_of_seq: 3,
  floors: [
    {
      floor_id: 'FL1',
      name: 'Family hall',
      archived: false,
      zones: [
        {
          zone_id: 'Z1',
          name: 'Hall',
          tables: [tile({ table_id: 'TB1', name: 'F1', seats: 6 }), F2, F3, F4, F5, F8, tile({ table_id: 'TB9', name: 'F9', assignee: SARA }), F10],
        },
      ],
    },
    { floor_id: 'FL2', name: 'Ground floor', archived: false, zones: [{ zone_id: null, name: null, tables: [tile({ table_id: 'TT4', name: 'T4', seats: 2, assignee: { staff_id: ME, name: 'Ali' } })] }] },
  ],
};

function order(order_id: string, name: string, at: number, totals: number[]): SeatingOrder {
  return {
    order_id,
    placed_by: { staff_id: ME, name },
    placed_at: at,
    follow_up: false,
    cancelled: false,
    billed: false,
    has_phone: false,
    promise_ms: null,
    lines: totals.map((billed_minor, i) => ({ order_item_id: `${order_id}-${i}`, parent_order_item_id: null, billed_minor }) as never),
  };
}

type Call = { name: string; payload: unknown };
function fakeShell(o: { perms?: string[]; online?: boolean; answers?: Record<string, Array<HubResult<unknown>>>; candidates?: HandoverCandidate[] }) {
  const calls: Call[] = [];
  const answers = o.answers ?? {};
  const tables = new Proxy({} as TablesApi, {
    get: (_t, name: string) => async (payload: unknown) => {
      calls.push({ name, payload });
      if (name === 'tableMap') return { ok: true, data: MAP };
      if (name === 'handoverCandidates') return { ok: true, data: { staff: o.candidates ?? [{ ...SARA, is_assignee: false, working: true, tables_held: 2 }] } };
      return answers[name]?.shift() ?? { ok: false, error: { kind: 'network' } };
    },
  });
  const orders = {
    seatingOrders: async (seating_id: string) => {
      calls.push({ name: 'seatingOrders', payload: seating_id });
      return {
        ok: true,
        data: {
          orders: [order('O1', 'Ali', NOW - 30 * 60_000, [200_000, 140_000]), order('O2', 'Bilal', NOW - 5 * 60_000, [264_000]), { ...order('O3', 'Ali', NOW, [1]), cancelled: true }],
          total_minor: 604_000,
        },
      };
    },
  } as unknown as OrdersApi;
  const shell: Shell = {
    device: { token: 'T', id: 'DEV1', type: 'tablet' },
    meta: { tenantId: 'TEN', branchId: 'BR', branchName: 'Gulberg', hubNowMs: NOW, utcOffsetMs: 0 },
    api: {} as never,
    tables,
    orders,
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
  window.location.hash = '/tables/TB2?seating_id=S2';
});
afterEach(() => m?.unmount());

async function render(shell: Shell, table_id = 'TB2', seating_id = 'S2') {
  m = mount();
  m.render(
    <ShellContext.Provider value={shell}>
      <TableSheet table_id={table_id} seating_id={seating_id} />
    </ShellContext.Provider>,
  );
  await flush();
}
const dlg = () => m.container.querySelector<HTMLElement>('.dlg');
const pick = (label: string) => [...dlg()!.querySelectorAll<HTMLElement>('.mt')].find((b) => b.querySelector('b')?.textContent === label)!;
const more = (label: string) => {
  m.click(m.button('More'));
  m.click(m.button(label));
};
const other = (sent: Call[]) => sent.filter((c) => !['tableMap', 'handoverCandidates', 'seatingOrders'].includes(c.name));

describe('[02a §8 Table sheet] move, join, split', () => {
  it('[02a §8 Table sheet] Move lists free tables; "Sara\'s" tag when the assignee is someone else', async () => {
    const { shell, calls } = fakeShell({ answers: { moveTable: [{ ok: true, data: { primary_table_id: 'TT4' } }] } });
    await render(shell);
    more('Move party');
    const box = dlg()!;
    expect(box.textContent).toContain('Move F2 to…');
    expect([...box.querySelectorAll('.grp__h')].map((h) => h.textContent)).toEqual(['Family hall', 'Ground floor']);
    expect([...box.querySelectorAll('.mt b')].map((b) => b.textContent)).toEqual(['F1', 'F9', 'T4']);
    expect(pick('F9').querySelector('.own')?.textContent).toBe("Sara's");
    expect(pick('T4').querySelector('.own')).toBeNull(); // my own assignment carries no tag
    expect(pick('F1').textContent).toContain('6');
    m.click(pick('T4'));
    m.click(m.button('Guest asked', box));
    m.click(m.button('Move to T4', box));
    await flush();
    expect(other(calls)).toEqual([{ name: 'moveTable', payload: { from_table_id: 'TB2', seating_id: 'S2', to_table_id: 'TT4', reason: 'guest_asked' } }]);
    expect(shell.toasts.current()?.text).toBe('Moved to T4');
    m.unmount();

    const plain = fakeShell({ answers: { moveTable: [{ ok: true, data: { primary_table_id: 'TB1' } }] } });
    await render(plain.shell);
    more('Move party');
    m.click(pick('F1'));
    m.click(m.button('Move to F1', dlg()!));
    await flush();
    expect(other(plain.calls)[0]?.payload).toEqual({ from_table_id: 'TB2', seating_id: 'S2', to_table_id: 'TB1' }); // reason optional
  });

  it('[02a §8 Table sheet] Move sends the seating the dialog showed, even after the map changed (review #161)', async () => {
    const { shell, calls } = fakeShell({ answers: { moveTable: [{ ok: false, error: { kind: 'api', status: 409, code: 'TABLE_SEATING_CHANGED', details: { table_id: 'TB2', seating_id: 'S20' } } }] } });
    await render(shell);
    more('Move party');
    const moved = { ...MAP, as_of_seq: 90, floors: MAP.floors.map((f) => ({ ...f, zones: f.zones.map((z) => ({ ...z, tables: z.tables.map((x) => (x.table_id === 'TB2' ? { ...x, seating_id: 'S20' } : x)) })) })) };
    act(() => shell.live.frame({ type: 'catch_up', as_of_seq: 90, state: { tables: moved } }));
    m.click(pick('F1'));
    m.click(m.button('Move to F1', dlg()!));
    await flush();
    expect(other(calls)[0]?.payload).toMatchObject({ seating_id: 'S2' });
    expect(shell.toasts.current()?.text).toBe('This table changed — refreshed');
    expect(dlg()).toBeNull();
  });

  it('[02a §8 Table sheet] 403 other_owner → "Hand it over to Sara; she moves it", Hand over preset to Sara', async () => {
    const { shell, calls } = fakeShell({
      answers: { moveTable: [{ ok: false, error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: { reason: 'other_owner', table_id: 'TB9', assigned_staff_id: 'ST-SAR', holder_staff_id: ME } } }] },
    });
    await render(shell);
    more('Move party');
    m.click(pick('F9'));
    m.click(m.button('Move to F9', dlg()!));
    await flush();
    const box = dlg()!;
    expect(box.textContent).toContain("F9 is Sara's table");
    expect(box.textContent).toContain('Hand F2 over to Sara; she can move it.');
    m.click(m.button('Hand over to Sara', box));
    await flush();
    expect(calls.some((c) => c.name === 'handoverCandidates')).toBe(true);
    const sara = [...dlg()!.querySelectorAll('[role="radio"]')].find((r) => r.textContent?.includes('Sara'));
    expect(sara?.getAttribute('aria-checked')).toBe('true');
  });

  it('[02a Q-25] other_owner preset only when assigned_staff_id is set and ≠ me; else the holder text + OK', async () => {
    for (const assigned of [null, ME]) {
      const { shell } = fakeShell({
        answers: { mergeTables: [{ ok: false, error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: { reason: 'other_owner', table_id: 'TB10', assigned_staff_id: assigned, holder_staff_id: 'ST-SAR' } } }] },
      });
      await render(shell);
      more('Join a table');
      m.click(pick('F10'));
      m.click(m.button('Join', dlg()!.querySelector('.acts')!));
      await flush();
      const box = dlg()!;
      expect(box.textContent).toContain('Sara has this table. Ask Sara to do it.');
      expect(() => m.button('Hand over to', box)).toThrow();
      m.click(m.button('OK', box));
      expect(dlg()).toBeNull();
      m.unmount();
    }
    m = mount();
  });

  it('[02a §8 Table sheet] Join: a free table or absorb another party (MergeTables table_seating_id)', async () => {
    const { shell, calls } = fakeShell({ answers: { mergeTables: [{ ok: true, data: { seating_id: 'S2', table_ids: ['TB2', 'TB1'] } }, { ok: true, data: { seating_id: 'S2', table_ids: ['TB2', 'TB3'] } }] } });
    await render(shell);
    more('Join a table');
    const box = dlg()!;
    expect(box.textContent).toContain('Join to F2');
    expect([...box.querySelectorAll('.grp__h')].map((h) => h.textContent)).toEqual(['Free tables', 'Other parties']);
    // parties: one tile per other seating, never my own or a table to clean
    expect([...box.querySelectorAll('.mt.party b')].map((b) => b.textContent)).toEqual(['F3', 'F4 + F5', 'F10']);
    expect(pick('F3').textContent).toContain('Yours · Eating · 1 order');
    expect(pick('F10').textContent).toContain('Sara · Eating');
    m.click(pick('F1'));
    m.click(m.button('Join', box.querySelector('.acts')!));
    await flush();
    expect(other(calls)[0]).toEqual({ name: 'mergeTables', payload: { into_table_id: 'TB2', into_seating_id: 'S2', table_id: 'TB1', table_seating_id: null } });
    more('Join a table');
    m.click(pick('F3'));
    expect(dlg()!.textContent).toContain("F3's party (1 order) joins F2. One bill.");
    m.click(m.button('Join', dlg()!.querySelector('.acts')!));
    await flush();
    expect(other(calls)[1]).toEqual({ name: 'mergeTables', payload: { into_table_id: 'TB2', into_seating_id: 'S2', table_id: 'TB3', table_seating_id: 'S3' } });
  });

  it('[02a §8 Table sheet] Split: tick whole orders from seating-orders (placed_by name, total) or free the joined table only', async () => {
    window.location.hash = '/tables/TB4?seating_id=S1';
    const { shell, calls } = fakeShell({
      answers: { splitSeating: [{ ok: true, data: { new_seating_id: 'S9' } }, { ok: true, data: { new_seating_id: null } }] },
    });
    await render(shell, 'TB4', 'S1');
    more('Split the party');
    let box = dlg()!;
    expect(box.textContent).toContain('Split F4 + F5');
    expect(box.textContent).toContain('Orders move whole. Splitting a bill is at the cashier.');
    // step 1: the target — a joined table of the party (not the primary) or a free table
    expect([...box.querySelectorAll('.mt b')].map((b) => b.textContent)).toEqual(['F5', 'F1', 'F9', 'T4']);
    m.click(pick('F5'));
    await flush();
    box = dlg()!;
    expect(calls.find((c) => c.name === 'seatingOrders')?.payload).toBe('S1');
    expect(box.textContent).toContain('Tick the orders that go to F5');
    const checks = () => [...box.querySelectorAll<HTMLElement>('[role="checkbox"]')];
    // live orders only, with the placer's name and the order total; then "just free F5"
    expect(checks().map((c) => c.querySelector('b')?.textContent)).toEqual(['Round 1', 'Round 2', 'No orders — just free F5']);
    expect(checks()[0]!.textContent).toContain('Ali');
    expect(checks()[0]!.textContent).toContain('Rs 3,400');
    expect(checks()[1]!.textContent).toContain('Bilal');
    expect(checks()[1]!.textContent).toContain('Rs 2,640');
    const go = m.button('Split', box.querySelector('.acts')!) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    m.click(checks()[0]!);
    m.click(checks()[1]!);
    expect(go.disabled).toBe(true); // every order cannot leave (SPLIT_INVALID all_orders)
    m.click(checks()[0]!);
    expect(box.textContent).toContain('1 order goes to F5. 1 stay on F4.');
    m.click(go);
    await flush();
    expect(other(calls)[0]).toEqual({ name: 'splitSeating', payload: { from_table_id: 'TB4', seating_id: 'S1', to_table_id: 'TB5', order_ids: ['O2'] } });
    expect(shell.toasts.current()?.text).toBe('1 orders moved to F5');

    more('Split the party');
    m.click(pick('F5'));
    await flush();
    box = dlg()!;
    m.click(checks()[2]!); // just free F5
    expect(checks()[0]!.getAttribute('aria-checked')).toBe('false');
    m.click(m.button('Split', box.querySelector('.acts')!));
    await flush();
    expect(other(calls)[1]).toEqual({ name: 'splitSeating', payload: { from_table_id: 'TB4', seating_id: 'S1', to_table_id: 'TB5', order_ids: [] } });
    expect(shell.toasts.current()?.text).toBe('F5 is free');

    // a free target has no "just free" row; Back returns to the target step
    more('Split the party');
    m.click(pick('F1'));
    await flush();
    box = dlg()!;
    expect(checks().map((c) => c.querySelector('b')?.textContent)).toEqual(['Round 1', 'Round 2']);
    m.click(m.button('Back', box));
    expect(dlg()!.querySelector('.mt')).not.toBeNull();
  });

  it('[02a §8 Offline] Hand over, Force move, Move, Join, Split disabled "Needs the hub"', async () => {
    const { shell, calls } = fakeShell({ online: false, perms: ['take-order', 'force-release-table-lock'] });
    await render(shell);
    for (const label of ['Hand over']) {
      const b = m.button(label);
      expect(b.getAttribute('aria-disabled')).toBe('true');
      m.click(b);
      expect(shell.toasts.current()?.text).toBe('Needs the hub');
      shell.toasts.clear();
    }
    m.click(m.button('More'));
    expect(shell.toasts.current()?.text).toBe('Needs the hub'); // every item under More needs the hub
    m.unmount();

    // Force move (a manager on someone else's table) and the items under More, opened while online then offline
    const manager = fakeShell({ online: false, perms: ['take-order', 'force-release-table-lock'] });
    const theirs = { ...manager.shell };
    await render(theirs, 'TB10', 'S10');
    const fm = m.button('Force move');
    expect(fm.getAttribute('aria-disabled')).toBe('true');
    m.click(fm);
    expect(theirs.toasts.current()?.text).toBe('Needs the hub');
    expect(dlg()).toBeNull();
    expect(other(calls.concat(manager.calls))).toEqual([]);
  });
});
