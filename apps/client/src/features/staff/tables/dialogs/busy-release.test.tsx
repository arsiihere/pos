import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import type { HubResult } from '../../../../api/hub-admin';
import type { Resolution } from '../../api';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { MapTile, TableMapBody, TablesApi } from '../contracts';
import { createLocalFlags } from '../local-flags';
import { TableSheet } from '../sheet/TableSheet';

// 02a §8 Open (02-B01 TableBusy, TableBusyOwn; 02-D12 ForceRelease): someone else's lock, my own lock on another
// screen, and the manager's force release with a reason token (Q-18).

vi.mock('../../orders/table-view/OrdersPart', () => ({ OrdersPart: () => null }));

const ME = 'ST-ALI';
const NOW = 1_700_000_000_000;
const allow: Resolution = { grant: 'allowed', scope: 'branch' };
const BILAL = { staff_id: 'ST-BIL', name: 'Bilal' };

function tile(over: Partial<MapTile> = {}): MapTile {
  return {
    table_id: 'TB7',
    name: 'F7',
    seats: 4,
    archived: false,
    state: 'SEATED',
    seating_id: 'S7',
    party_size: null,
    primary_table_id: 'TB7',
    joined_table_names: ['F7'],
    holder: { staff_id: ME, name: 'Ali' },
    assignee: null,
    lock: null,
    opened_at: NOW - 3 * 60_000,
    bill_requested_at: null,
    live_order_count: 0,
    ...over,
  };
}
const mapOf = (t: MapTile): TableMapBody => ({ as_of_seq: 1, floors: [{ floor_id: 'FL1', name: 'Hall', archived: false, zones: [{ zone_id: 'Z1', name: 'Z', tables: [t] }] }] });

type Call = { name: keyof TablesApi; payload: unknown };
function fakeShell(o: { perms: string[]; tile: MapTile; answers?: Partial<Record<keyof TablesApi, Array<HubResult<unknown>>>> }) {
  const calls: Call[] = [];
  const answers = o.answers ?? {};
  const tables = new Proxy({} as TablesApi, {
    get: (_t, name: keyof TablesApi) => async (payload: unknown) => {
      calls.push({ name, payload });
      if (name === 'tableMap') return { ok: true, data: mapOf(o.tile) };
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
    permissions: createPermissions(Object.fromEntries(o.perms.map((p) => [p, allow]))),
    toasts: createToastBus(),
    enqueue: {} as never,
    localFlags: createLocalFlags(),
    clock: { nowMs: () => NOW, utcOffsetMs: 0 },
    me: { staff_id: ME, name: 'Ali' },
    online: true,
    phone: false,
    portrait: false,
  };
  return { shell, calls };
}

let m: Mounted;
beforeEach(() => {
  window.location.hash = '/tables/TB7?seating_id=S7';
});
afterEach(() => m?.unmount());

async function render(shell: Shell) {
  m = mount();
  m.render(
    <ShellContext.Provider value={shell}>
      <TableSheet table_id="TB7" seating_id="S7" />
    </ShellContext.Provider>,
  );
  await flush();
}
const dlg = () => m.container.querySelector<HTMLElement>('.dlg');
const LOCKED: HubResult<unknown> = { ok: false, error: { kind: 'api', status: 409, code: 'TABLE_ALREADY_LOCKED', details: { table_id: 'TB7', locked_by_staff_id: 'ST-BIL', locked_by_name: 'Bilal' } } };

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('[02a §8 Open] busy and force release', () => {
  it('[02a §8 Open] 409 TABLE_ALREADY_LOCKED → "Bilal is taking an order here"; Release only with force-release-table-lock', async () => {
    const plain = fakeShell({ perms: ['take-order'], tile: tile(), answers: { openTable: [LOCKED] } });
    await render(plain.shell);
    m.click(m.button('Take order'));
    await flush();
    expect(dlg()?.textContent).toContain('Bilal is taking an order here');
    expect(dlg()?.textContent).toContain('You can still ask for the bill, call a waiter or clean.');
    expect(() => m.button("Release Bilal's lock", dlg()!)).toThrow();
    m.click(m.button('See the table', dlg()!));
    expect(dlg()).toBeNull();
    expect(window.location.hash).toBe('#/tables/TB7?seating_id=S7');
    m.unmount();

    const manager = fakeShell({ perms: ['take-order', 'force-release-table-lock'], tile: tile(), answers: { openTable: [LOCKED] } });
    await render(manager.shell);
    m.click(m.button('Take order'));
    await flush();
    m.click(m.button("Release Bilal's lock", dlg()!));
    expect(dlg()?.textContent).toContain("Release Bilal's lock on F7?");
  });

  it('[02a §8 Open] a tile already locked by someone else opens TableBusy on tap, without a command', async () => {
    const { shell, calls } = fakeShell({ perms: ['take-order', 'take-order-anywhere'], tile: tile({ holder: BILAL, lock: { ...BILAL, mine: false } }) });
    await render(shell);
    const primary = m.button('Take order — Bilal is ordering');
    expect(primary.getAttribute('aria-disabled')).toBe('true');
    m.click(primary);
    expect(dlg()?.textContent).toContain('Bilal is taking an order here');
    expect(calls.some((c) => c.name !== 'tableMap')).toBe(false);
  });

  it('[02a Q-25] own lock on another screen → TableBusyOwn without a device name; Open here = OpenTable', async () => {
    const { shell, calls } = fakeShell({
      perms: ['take-order'],
      tile: tile({ lock: { staff_id: ME, name: 'Ali', mine: false } }),
      answers: { openTable: [{ ok: true, data: { seating_id: 'S7', primary_table_id: 'TB7', opened: true, holder_staff_id: ME } }] },
    });
    await render(shell);
    m.click(m.button('Take order'));
    const text = dlg()?.textContent ?? '';
    expect(text).toContain("You're ordering on F7 on another screen");
    expect(text).toContain('Your order on F7 is open on another screen. Open it here? That screen keeps its draft.');
    expect(text).not.toMatch(/Tablet|DEV1/);
    expect(calls.some((c) => c.name === 'openTable')).toBe(false);
    m.click(m.button('Open here', dlg()!));
    await flush();
    expect(calls.find((c) => c.name === 'openTable')?.payload).toEqual({ table_id: 'TB7', seating_id: 'S7' });
    expect(window.location.hash).toBe('#/order/dine_in/S7');
  });

  it('[02a Q-18] Force release sends "went_home: <note>" cut to 120; known tokens shown localised, other text raw', async () => {
    const { shell, calls } = fakeShell({
      perms: ['take-order', 'force-release-table-lock'],
      tile: tile({ holder: BILAL, lock: { ...BILAL, mine: false } }),
      answers: { forceReleaseTableLock: [{ ok: true, data: { released: true } }] },
    });
    await render(shell);
    m.click(m.button("Release Bilal's lock"));
    const box = dlg()!;
    expect(box.textContent).toContain("Release Bilal's lock on F7?");
    expect(box.textContent).toContain("Anything he hasn't sent stays on his screen.");
    for (const chip of ['Went home', 'Tablet dead', 'Left the table', 'Other']) expect(m.button(chip, box)).toBeTruthy();
    const go = [...box.querySelectorAll('button')].find((b) => b.textContent === 'Release')!;
    expect(go.disabled).toBe(true); // the reason is required
    m.click(m.button('Went home', box));
    expect(m.button('Went home', box).getAttribute('aria-pressed')).toBe('true');
    const input = box.querySelector<HTMLInputElement>('input')!;
    type(input, `left early ${'z'.repeat(150)}`);
    expect(box.textContent).toContain('120/120');
    m.click(go);
    await flush();
    const sent = calls.find((c) => c.name === 'forceReleaseTableLock')?.payload as { table_id: string; seating_id: string; reason: string };
    expect(sent.table_id).toBe('TB7');
    expect(sent.seating_id).toBe('S7');
    expect(sent.reason.startsWith('went_home: left early zzz')).toBe(true);
    expect(sent.reason).toHaveLength(120);
    expect(shell.toasts.current()?.text).toBe('Lock released');
    expect(dlg()).toBeNull();
  });

  it('[02a §8 Open] Force release sends the seating the dialog showed; a later change answers 409 → toast (review #161)', async () => {
    const t7 = tile({ holder: BILAL, lock: { ...BILAL, mine: false } });
    const { shell, calls } = fakeShell({
      perms: ['take-order', 'force-release-table-lock'],
      tile: t7,
      answers: { forceReleaseTableLock: [{ ok: false, error: { kind: 'api', status: 409, code: 'TABLE_SEATING_CHANGED', details: { table_id: 'TB7', seating_id: 'S8' } } }] },
    });
    await render(shell);
    m.click(m.button("Release Bilal's lock"));
    act(() => shell.live.frame({ type: 'catch_up', as_of_seq: 40, state: { tables: { ...mapOf({ ...t7, seating_id: 'S8', lock: { staff_id: 'ST-SAR', name: 'Sara', mine: false } }), as_of_seq: 40 } } }));
    m.click(m.button('Went home', dlg()!));
    m.click([...dlg()!.querySelectorAll('button')].find((b) => b.textContent === 'Release')!);
    await flush();
    expect(calls.find((c) => c.name === 'forceReleaseTableLock')?.payload).toMatchObject({ seating_id: 'S7' });
    expect(shell.toasts.current()?.text).toBe('This table changed — refreshed');
  });

  it('[02a §8 Open] TableBusy → Release sends the seating TableBusy opened on, not a newer one (review #161 round 2)', async () => {
    const t7 = tile({ holder: BILAL, lock: { ...BILAL, mine: false } });
    const s8 = { ...mapOf({ ...t7, seating_id: 'S8', holder: { staff_id: 'ST-SAR', name: 'Sara' }, lock: { staff_id: 'ST-SAR', name: 'Sara', mine: false } }), as_of_seq: 60 };
    // the tap path: the tile is drawn locked by Bilal on S7
    const tap = fakeShell({ perms: ['take-order', 'take-order-anywhere', 'force-release-table-lock'], tile: t7, answers: { forceReleaseTableLock: [{ ok: true, data: { released: true } }] } });
    await render(tap.shell);
    m.click(m.button('Take order — Bilal is ordering'));
    act(() => tap.shell.live.frame({ type: 'catch_up', as_of_seq: 60, state: { tables: s8 } }));
    m.click(m.button("Release Bilal's lock", dlg()!));
    m.click(m.button('Went home', dlg()!));
    m.click([...dlg()!.querySelectorAll('button')].find((b) => b.textContent === 'Release')!);
    await flush();
    expect(tap.calls.find((c) => c.name === 'forceReleaseTableLock')?.payload).toMatchObject({ table_id: 'TB7', seating_id: 'S7' });
    m.unmount();

    // the 409 path: the seating the failed OpenTable sent
    const sent = fakeShell({ perms: ['take-order', 'force-release-table-lock'], tile: tile(), answers: { openTable: [LOCKED], forceReleaseTableLock: [{ ok: true, data: { released: true } }] } });
    await render(sent.shell);
    m.click(m.button('Take order'));
    await flush();
    act(() => sent.shell.live.frame({ type: 'catch_up', as_of_seq: 60, state: { tables: s8 } }));
    m.click(m.button("Release Bilal's lock", dlg()!));
    m.click(m.button('Went home', dlg()!));
    m.click([...dlg()!.querySelectorAll('button')].find((b) => b.textContent === 'Release')!);
    await flush();
    expect(sent.calls.find((c) => c.name === 'forceReleaseTableLock')?.payload).toMatchObject({ seating_id: 'S7' });
    m.unmount();

    // a 409 on a table drawn free (no seating sent): Release only re-reads, never guesses a seating
    const free = tile({ state: 'FREE', seating_id: null, holder: null, opened_at: null });
    const none = fakeShell({ perms: ['take-order', 'force-release-table-lock'], tile: free, answers: { openTable: [LOCKED] } });
    await render(none.shell);
    m.click(m.button('Take order'));
    await flush();
    m.click(m.button("Release Bilal's lock", dlg()!));
    expect(none.shell.toasts.current()?.text).toBe('This table changed — refreshed');
    expect(dlg()).toBeNull();
    expect(none.calls.some((c) => c.name === 'forceReleaseTableLock')).toBe(false);
  });

  it('[02a §8 Open] two quick taps on Release send one ForceReleaseTableLock (review #161 round 2)', async () => {
    const { shell, calls } = fakeShell({ perms: ['take-order', 'force-release-table-lock'], tile: tile({ holder: BILAL, lock: { ...BILAL, mine: false } }) });
    let done: (v: unknown) => void = () => {};
    const slow = new Promise((r) => (done = r));
    const orig = shell.tables;
    shell.tables = new Proxy(orig, {
      get: (t, name: keyof TablesApi) => (name === 'forceReleaseTableLock' ? async (p: unknown) => (calls.push({ name, payload: p }), slow) : t[name]),
    });
    await render(shell);
    m.click(m.button("Release Bilal's lock"));
    m.click(m.button('Other', dlg()!));
    const go = [...dlg()!.querySelectorAll('button')].find((b) => b.textContent === 'Release')!;
    act(() => {
      go.click();
      go.click();
    });
    expect(calls.filter((c) => c.name === 'forceReleaseTableLock')).toHaveLength(1);
    done({ ok: true, data: { released: true } });
    await flush();
  });

  it('[02a §6.4] released: false (the lock was already gone) → no "Lock released" toast (review #161)', async () => {
    const { shell } = fakeShell({
      perms: ['take-order', 'force-release-table-lock'],
      tile: tile({ holder: BILAL, lock: { ...BILAL, mine: false } }),
      answers: { forceReleaseTableLock: [{ ok: true, data: { released: false } }] },
    });
    await render(shell);
    m.click(m.button("Release Bilal's lock"));
    m.click(m.button('Other', dlg()!));
    m.click([...dlg()!.querySelectorAll('button')].find((b) => b.textContent === 'Release')!);
    await flush();
    expect(shell.toasts.current()).toBeNull();
    expect(dlg()).toBeNull();
  });

  it('[02a §8 Open] Force release refused → toast, the dialog closes; Cancel sends nothing', async () => {
    const { shell, calls } = fakeShell({
      perms: ['take-order', 'force-release-table-lock'],
      tile: tile({ holder: BILAL, lock: { ...BILAL, mine: false } }),
      answers: { forceReleaseTableLock: [{ ok: false, error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: { reason: 'outside_scope' } } }] },
    });
    await render(shell);
    m.click(m.button("Release Bilal's lock"));
    m.click(m.button('Cancel', dlg()!));
    expect(dlg()).toBeNull();
    m.click(m.button("Release Bilal's lock"));
    m.click(m.button('Other', dlg()!));
    m.click([...dlg()!.querySelectorAll('button')].find((b) => b.textContent === 'Release')!);
    await flush();
    expect(calls.find((c) => c.name === 'forceReleaseTableLock')?.payload).toMatchObject({ reason: 'other' });
    expect(shell.toasts.current()?.text).toBe('This table is outside your floors');
    expect(dlg()).toBeNull();
  });
});
