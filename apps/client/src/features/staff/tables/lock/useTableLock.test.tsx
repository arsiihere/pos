import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubResult } from '../../../../api/hub-admin';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { createPermissions } from '../../shell/permissions';
import { createLiveBus, type LiveBus } from '../../shell/live';
import { ShellContext, type Shell } from '../../shell/hooks';
import type { MapTile, SeatingRef, TableMapBody } from '../contracts';
import { useTableLock } from './useTableLock';

// 02a §8 Order screen, Banners (02a-B10; D61): the hook the 02b order screen mounts.

const ME = 'ST-BILAL';
const DEVICE = 'DEV-1';
const REF: SeatingRef = { table_id: 'TB-F7', seating_id: 'SE-1' };

const MAP: TableMapBody = {
  as_of_seq: 1,
  floors: [
    {
      floor_id: 'FL-1',
      name: 'Family hall',
      archived: false,
      zones: [{ zone_id: 'Z1', name: 'Round 1', tables: [tile('TB-F7', 'F7'), tile('TB-F2', 'F2'), tile('TB-F9', 'F9')] }],
    },
  ],
};

function tile(table_id: string, name: string, over: Partial<MapTile> = {}): MapTile {
  return {
    table_id,
    name,
    seats: 4,
    archived: false,
    state: 'ORDERED' as const,
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

const person = (staff_id: string, name: string) => ({ staff_id, name });
/** the map with F7 seated as SE-1 (holder, lock as given) */
function mapWith(f7: Partial<MapTile>): TableMapBody {
  return { ...MAP, floors: [{ ...MAP.floors[0]!, zones: [{ ...MAP.floors[0]!.zones[0]!, tables: [tile('TB-F7', 'F7', { seating_id: 'SE-1', ...f7 }), tile('TB-F2', 'F2'), tile('TB-F9', 'F9')] }] }] };
}

interface Calls {
  touch: SeatingRef[];
  release: SeatingRef[];
  roster: number;
}

function harness(o: { anywhere?: boolean; online?: boolean; ttlMs?: number | null; touch?: () => HubResult<{ touched: boolean }> | Promise<HubResult<{ touched: boolean }>> } = {}) {
  const live: LiveBus = createLiveBus();
  live.frame({ type: 'catch_up', as_of_seq: 10, state: { tables: MAP } });
  const calls: Calls = { touch: [], release: [], roster: 0 };
  let seq = 10;
  const shell = {
    device: { token: 'T', id: DEVICE, type: 'tablet' },
    me: { staff_id: ME, name: 'Bilal' },
    online: o.online ?? true,
    live,
    permissions: createPermissions(
      o.anywhere === true
        ? { 'take-order': { grant: 'allowed', scope: 'branch' }, 'take-order-anywhere': { grant: 'allowed', scope: 'branch' } }
        : { 'take-order': { grant: 'allowed', scope: 'branch' } },
    ),
    config: {
      config: () =>
        o.ttlMs === null
          ? null
          : {
              zone_undo_ms: 1,
              slow_item_threshold_ms: 1,
              comp_reason_chips: [],
              queue_auto_send_max_ms: 1,
              table_lock_ttl_ms: o.ttlMs ?? 15 * 60_000,
              order_abandon_ms: 1,
            },
    },
    api: {
      roster: async () => {
        calls.roster += 1;
        return {
          ok: true,
          data: {
            staff: [
              { staff_id: ME, display_name: 'Bilal', locked_until: null },
              { staff_id: 'ST-IMRAN', display_name: 'Imran', locked_until: null },
              { staff_id: 'ST-ALI', display_name: 'Ali', locked_until: null },
            ],
            active_session: null,
          },
        };
      },
    },
    tables: {
      touchTableLock: async (p: SeatingRef) => {
        calls.touch.push(p);
        return o.touch?.() ?? { ok: true, data: { touched: true } };
      },
      releaseTableLock: async (p: SeatingRef) => {
        calls.release.push(p);
        return { ok: true, data: { released: true } };
      },
      tableMap: async () => ({ ok: true, data: MAP }),
    },
  } as unknown as Shell;

  let latest: ReturnType<typeof useTableLock> | null = null;
  function Probe({ at }: { at: SeatingRef | null }) {
    latest = useTableLock(at);
    return <pre>{JSON.stringify({ banner: latest.banner, canSend: latest.canSend })}</pre>;
  }
  const m: Mounted = mount();
  let current: Shell = shell;
  const render = (at: SeatingRef | null = REF, strict = false) => {
    const tree = (
      <ShellContext.Provider value={current}>
        <Probe at={at} />
      </ShellContext.Provider>
    );
    m.render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  };
  return {
    m,
    calls,
    render,
    setOnline(up: boolean) {
      current = { ...current, online: up };
    },
    catchUp(tables: TableMapBody) {
      seq += 1;
      live.frame({ type: 'catch_up', as_of_seq: seq, state: { tables } });
    },
    frame(event_type: string, payload: Record<string, unknown>) {
      seq += 1;
      live.frame({ type: 'event', seq, event: { event_id: `EV-${seq}`, event_type, schema_version: 1, payload } });
    },
    state() {
      return JSON.parse(m.container.querySelector('pre')?.textContent ?? 'null') as { banner: unknown; canSend: boolean };
    },
    hook: () => latest!,
  };
}

let h: ReturnType<typeof harness> | null = null;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  h?.m.unmount();
  h = null;
  vi.useRealTimers();
});

const released = (reason: string, extra: Record<string, unknown> = {}) => ({ table_id: 'TB-F7', seating_id: 'SE-1', staff_id: ME, reason, ...extra });

describe('[02a §8] useTableLock', () => {
  it('[02a §8 Order screen] TouchTableLock once a minute while mounted (fake timers); ReleaseTableLock on unmount; both dropped offline', async () => {
    h = harness();
    h.render();
    await flush();
    expect(h.calls.touch).toEqual([]);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(h.calls.touch).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.calls.touch).toEqual([REF]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.calls.touch).toEqual([REF, REF]);
    // offline: the minute passes, nothing is sent (never queued)
    h.setOnline(false);
    h.render();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.calls.touch).toHaveLength(2);
    h.setOnline(true);
    h.render();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.calls.touch).toHaveLength(3);
    h.m.unmount();
    await flush();
    expect(h.calls.release).toEqual([REF]);
    // no Touch after unmount
    await vi.advanceTimersByTimeAsync(180_000);
    expect(h.calls.touch).toHaveLength(3);
    h = null;

    // offline unmount drops the Release
    const off = harness({ online: false });
    off.render();
    off.m.unmount();
    await flush();
    expect(off.calls.release).toEqual([]);
  });

  it('[02a §8 Banners] TableLockReleased force → "Your table F7 was released by Imran: Went home"; draft kept', async () => {
    h = harness();
    h.render();
    h.frame('TableLockReleased', released('force', { by_staff_id: 'ST-IMRAN', note: 'went_home' }));
    await flush();
    expect(h.state().banner).toEqual({ kind: 'released_by', table: 'F7', by_name: 'Imran', reason: 'went_home' });
    // the screen keeps its Send (a submit re-acquires a free lock, §3.4): only the holder change turns it off
    expect(h.state().canSend).toBe(true);
    // the lock is gone: no more Touch
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.calls.touch).toEqual([]);
  });

  it('[02a §8 Banners] TableLocked replaced_device_id = this device → "Opened on another device"', async () => {
    h = harness();
    h.render();
    // another person's lock elsewhere names another device: nothing
    h.frame('TableLocked', { table_id: 'TB-F9', seating_id: 'SE-9', staff_id: ME, replaced_device_id: 'DEV-9' });
    await flush();
    expect(h.state().banner).toBeNull();
    h.frame('TableLocked', { table_id: 'TB-F7', seating_id: 'SE-1', staff_id: ME, replaced_device_id: DEVICE });
    await flush();
    expect(h.state().banner).toEqual({ kind: 'other_device', table: 'F7' });
    expect(h.state().canSend).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.calls.touch).toEqual([]);
  });

  it('[02a §8 Banners] lock_ttl → "released after the branch lock time" (table_lock_ttl_ms from config)', async () => {
    h = harness({ ttlMs: 20 * 60_000 });
    h.render();
    h.frame('TableLockReleased', released('lock_ttl'));
    await flush();
    expect(h.state().banner).toEqual({ kind: 'released_ttl', table: 'F7', minutes: 20 });
  });

  it('[02a §8 Banners] TableHolderChanged away from me → "Ali now has this table. Keep as draft", then Release (the hub released it, T20; Keep as draft releases here too); canSend false', async () => {
    h = harness();
    h.render();
    h.frame('TableHolderChanged', { table_id: 'TB-F7', seating_id: 'SE-1', from_staff_id: ME, to_staff_id: 'ST-ALI', reason: 'handover', by_staff_id: ME });
    h.frame('TableLockReleased', released('holder_changed'));
    await flush();
    expect(h.state()).toEqual({ banner: { kind: 'holder_changed', table: 'F7', holder_name: 'Ali', can_send: false }, canSend: false });
    // Keep as draft → the screen releases and goes back; the hook never touches the lock again
    await h.hook().release();
    expect(h.calls.release).toEqual([REF]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.calls.touch).toEqual([]);
    h.m.unmount();
    await flush();
    expect(h.calls.release).toHaveLength(1);
    h = null;
  });

  it('[02a §8 Banners] with take-order-anywhere canSend stays true; the hook never takes the lock again', async () => {
    h = harness({ anywhere: true });
    h.render();
    h.frame('TableHolderChanged', { table_id: 'TB-F7', seating_id: 'SE-1', from_staff_id: ME, to_staff_id: 'ST-ALI', reason: 'take_over', by_staff_id: 'ST-ALI' });
    h.frame('TableLockReleased', released('holder_changed'));
    await flush();
    expect(h.state()).toEqual({ banner: { kind: 'holder_changed', table: 'F7', holder_name: 'Ali', can_send: true }, canSend: true });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(h.calls.touch).toEqual([]);
    // Ali locks it: still nobody on this device takes it back
    h.frame('TableLocked', { table_id: 'TB-F7', seating_id: 'SE-1', staff_id: 'ST-ALI' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.calls.touch).toEqual([]);
    expect(h.state().canSend).toBe(true);
  });

  it('[02a §8 Banners] a banner only when this device held the lock before the frame', async () => {
    // the lock is not this device's (Touch says TABLE_LOCK_NOT_HELD): later lock frames show nothing
    h = harness({ touch: () => ({ ok: false, error: { kind: 'api', status: 409, code: 'TABLE_LOCK_NOT_HELD', details: {} } }) });
    h.render();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.calls.touch).toHaveLength(1);
    h.frame('TableLockReleased', released('force', { by_staff_id: 'ST-IMRAN', note: 'went_home' }));
    h.frame('TableLocked', { table_id: 'TB-F7', seating_id: 'SE-1', staff_id: ME, replaced_device_id: DEVICE });
    h.frame('TableHolderChanged', { table_id: 'TB-F7', seating_id: 'SE-1', from_staff_id: ME, to_staff_id: 'ST-ALI', reason: 'handover', by_staff_id: ME });
    await flush();
    expect(h.state().banner).toBeNull();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.calls.touch).toHaveLength(1);
    h.m.unmount();
    h = null;

    // my own Release (Keep as draft) is not a banner either; another table's frames never are
    const own = harness();
    own.render();
    await own.hook().release();
    own.frame('TableLockReleased', released('released'));
    own.frame('TableLockReleased', { ...released('force', { by_staff_id: 'ST-IMRAN' }), table_id: 'TB-F9', seating_id: 'SE-9' });
    await flush();
    expect(own.state().banner).toBeNull();
    own.m.unmount();
  });

  it('[02a §8 Banners] ForceMovedToMe tells the new holder', async () => {
    // the map's listener (no seating): a force move of any table to me
    h = harness();
    h.render(null);
    h.frame('TableHolderChanged', { table_id: 'TB-F2', seating_id: 'SE-2', from_staff_id: 'ST-ALI', to_staff_id: ME, reason: 'force_move', by_staff_id: 'ST-IMRAN', note: 'shift_ended' });
    await flush();
    expect(h.state().banner).toEqual({ kind: 'force_moved_to_me', table: 'F2' });
    // a handover or a take-over to me is not a force move; with no seating nothing is touched or released
    h.frame('TableHolderChanged', { table_id: 'TB-F9', seating_id: 'SE-9', from_staff_id: 'ST-ALI', to_staff_id: ME, reason: 'handover', by_staff_id: 'ST-ALI' });
    await flush();
    expect(h.state().banner).toEqual({ kind: 'force_moved_to_me', table: 'F2' });
    await vi.advanceTimersByTimeAsync(120_000);
    h.m.unmount();
    await flush();
    expect(h.calls.touch).toEqual([]);
    expect(h.calls.release).toEqual([]);
    h = null;
  });

  it('[02a §8 Order screen] after MoveTable the hook touches and releases the new table', async () => {
    h = harness();
    h.render();
    h.frame('TableMoved', { seating_id: 'SE-1', from_table_id: 'TB-F7', to_table_id: 'TB-F9', by_staff_id: ME });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.calls.touch).toEqual([{ table_id: 'TB-F9', seating_id: 'SE-1' }]);
    h.frame('TableLockReleased', { ...released('force', { by_staff_id: 'ST-IMRAN' }), table_id: 'TB-F9' });
    await flush();
    expect(h.state().banner).toEqual({ kind: 'released_by', table: 'F9', by_name: 'Imran', reason: null });
  });
  it('[02a §8 Order screen] StrictMode\'s unmount + mount sends no Release; a real unmount does', async () => {
    h = harness();
    h.render(REF, true);
    await flush();
    expect(h.calls.release).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.calls.touch).toEqual([REF]);
    h.m.unmount();
    await flush();
    expect(h.calls.release).toEqual([REF]);
    h = null;
  });

  it('[02a §8 Banners] after a release, my TableLocked counts only once a Touch proves it is this device\'s', async () => {
    h = harness();
    h.render();
    h.frame('TableLockReleased', released('lock_ttl'));
    await flush();
    expect(h.state().banner).toEqual({ kind: 'released_ttl', table: 'F7', minutes: 15 });
    // Send re-acquired the free lock (02b): TableLocked for me, no device named → one Touch, ok → held again
    h.frame('TableLocked', { table_id: 'TB-F7', seating_id: 'SE-1', staff_id: ME });
    await flush();
    expect(h.calls.touch).toEqual([REF]);
    h.frame('TableLocked', { table_id: 'TB-F7', seating_id: 'SE-1', staff_id: ME, replaced_device_id: DEVICE });
    await flush();
    expect(h.state().banner).toEqual({ kind: 'other_device', table: 'F7' });
  });
  it('[02a §8 Banners] a holder change after my lock was already released (ttl, other device) still turns Send off and says why', async () => {
    for (const before of ['ttl', 'other'] as const) {
      const one = harness();
      one.render();
      if (before === 'ttl') one.frame('TableLockReleased', released('lock_ttl'));
      else one.frame('TableLocked', { table_id: 'TB-F7', seating_id: 'SE-1', staff_id: ME, replaced_device_id: DEVICE });
      await flush();
      expect(one.state().banner).not.toBeNull();
      one.frame('TableHolderChanged', { table_id: 'TB-F7', seating_id: 'SE-1', from_staff_id: ME, to_staff_id: 'ST-ALI', reason: 'take_over', by_staff_id: 'ST-ALI' });
      await flush();
      expect(one.state()).toEqual({ banner: { kind: 'holder_changed', table: 'F7', holder_name: 'Ali', can_send: false }, canSend: false });
      one.m.unmount();
    }
    // with take-order-anywhere Send stays
    h = harness({ anywhere: true });
    h.render();
    h.frame('TableLockReleased', released('lock_ttl'));
    h.frame('TableHolderChanged', { table_id: 'TB-F7', seating_id: 'SE-1', from_staff_id: ME, to_staff_id: 'ST-ALI', reason: 'take_over', by_staff_id: 'ST-ALI' });
    await flush();
    expect(h.state()).toEqual({ banner: { kind: 'holder_changed', table: 'F7', holder_name: 'Ali', can_send: true }, canSend: true });
  });

  it('[02a §3.3] the lock follows the seating: a re-render with the moved table releases nothing and touches the new table', async () => {
    h = harness();
    h.render();
    h.frame('TableMoved', { seating_id: 'SE-1', from_table_id: 'TB-F7', to_table_id: 'TB-F9', by_staff_id: ME });
    h.render({ table_id: 'TB-F9', seating_id: 'SE-1' });
    await flush();
    expect(h.calls.release).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.calls.touch).toEqual([{ table_id: 'TB-F9', seating_id: 'SE-1' }]);
    h.m.unmount();
    await flush();
    expect(h.calls.release).toEqual([{ table_id: 'TB-F9', seating_id: 'SE-1' }]);
    h = null;
  });

  it('[02a §8 Banners] catch_up (after a gap) reconciles: holder elsewhere → holder_changed; lock not mine → released; seating gone → quiet', async () => {
    h = harness();
    h.render();
    h.catchUp(mapWith({ holder: person('ST-ALI', 'Ali'), lock: { ...person('ST-ALI', 'Ali'), mine: false } }));
    await flush();
    expect(h.state()).toEqual({ banner: { kind: 'holder_changed', table: 'F7', holder_name: 'Ali', can_send: false }, canSend: false });
    h.m.unmount();

    h = harness();
    h.render();
    h.catchUp(mapWith({ holder: person(ME, 'Bilal'), lock: null }));
    await flush();
    expect(h.state()).toEqual({ banner: { kind: 'released_by', table: 'F7', by_name: null, reason: null }, canSend: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.calls.touch).toEqual([]);
    h.m.unmount();

    // still mine: nothing changes; the seating is gone (cleaned in the gap): no banner, no Touch
    h = harness();
    h.render();
    h.catchUp(mapWith({ holder: person(ME, 'Bilal'), lock: { ...person(ME, 'Bilal'), mine: true } }));
    await flush();
    expect(h.state()).toEqual({ banner: null, canSend: true });
    h.catchUp(MAP);
    await flush();
    expect(h.state()).toEqual({ banner: null, canSend: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.calls.touch).toEqual([]);
  });

  it('[02a §8 Banners] a Touch answering TABLE_LOCK_NOT_HELD after the lock was proven mine shows "Your table F7 was released"', async () => {
    let answer: HubResult<{ touched: boolean }> = { ok: true, data: { touched: true } };
    h = harness({ touch: () => answer });
    h.render();
    await vi.advanceTimersByTimeAsync(60_000);
    answer = { ok: false, error: { kind: 'api', status: 409, code: 'TABLE_LOCK_NOT_HELD', details: {} } };
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(h.state().banner).toEqual({ kind: 'released_by', table: 'F7', by_name: null, reason: null });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.calls.touch).toHaveLength(2);
  });

  it('[02a §8 Order screen] a Touch reply that lands after a release frame does not make the lock mine again', async () => {
    let resolveTouch: (a: HubResult<{ touched: boolean }>) => void = () => {};
    let first = true;
    h = harness({
      touch: () => {
        if (!first) return { ok: true, data: { touched: true } };
        first = false;
        return new Promise((r) => (resolveTouch = r));
      },
    });
    h.render();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.calls.touch).toHaveLength(1);
    h.frame('TableLockReleased', released('force', { by_staff_id: 'ST-IMRAN' }));
    resolveTouch({ ok: true, data: { touched: true } });
    await flush();
    // not held: a TableLocked for me needs a verifying Touch (it would be skipped if the stale reply had won)
    h.frame('TableLocked', { table_id: 'TB-F7', seating_id: 'SE-1', staff_id: ME });
    await flush();
    expect(h.calls.touch).toHaveLength(2);
  });
  it('[02a §8 Banners] a catch-up showing the lock as mine proves it: a later TABLE_LOCK_NOT_HELD Touch says "released"', async () => {
    h = harness({ touch: () => ({ ok: false, error: { kind: 'api', status: 409, code: 'TABLE_LOCK_NOT_HELD', details: {} } }) });
    h.render();
    h.catchUp(mapWith({ holder: person(ME, 'Bilal'), lock: { ...person(ME, 'Bilal'), mine: true } }));
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(h.state().banner).toEqual({ kind: 'released_by', table: 'F7', by_name: null, reason: null });
  });
});
