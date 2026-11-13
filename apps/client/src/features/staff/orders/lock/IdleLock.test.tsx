import 'fake-indexeddb/auto';
import { act, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { createStaffApi, type Device, type PageMeta } from '../../api';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createToastBus } from '../../shell/toast';
import { createIdbDraftStore } from '../drafts/idb-drafts';
import { createEnqueue } from '../queue/enqueue';
import { createMemoryQueueStore, type MemoryQueueBacking } from '../queue/memory-store';
import { createShellHooks } from '../queue/shell-hooks';
import { IdleLock, SIGN_IN_WAIT_MS } from './IdleLock';
import type { IdleTimers } from './idle-lock';
import { peekPendingLogout } from './pending-logout';

// 02b v1.0.11 §8 Device idle lock (02-B09), #35 (m-9, S-4), owner Q-21, Q-2 (25d): the lock screen over the real
// queue (memory store), staff api and sign-in hooks; a scripted hub fetch; the wall clock and timers by hand (a
// suspended WebView never fires a timer).

const device: Device = { token: 'DEV', id: 'dev-1', type: 'tablet' };
const meta: PageMeta = { tenantId: 'ten', branchId: 'br', branchName: 'Gulberg', hubNowMs: 0, utcOffsetMs: 0 };
const TTL = 60_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const noTimers: IdleTimers = { setTimeout: () => 0, clearTimeout: () => {} };

function setup(o: { backing?: MemoryQueueBacking } = {}) {
  const calls: Array<{ path: string; token: string | undefined }> = [];
  const hub = { up: true };
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (input === '/auth/pin') return json(200, { data: { session_token: 'TOK-ali', session_id: 'S', staff_id: 'ali', display_name: 'Ali', role_ids: [], idle_ttl_ms: TTL } });
    if (input === '/queries/session') return json(200, { data: { session_id: 'S', idle_ttl_ms: TTL, permissions: {} } });
    calls.push({ path: input, token: headers['X-Session-Token'] });
    if (!hub.up) throw new TypeError('Failed to fetch');
    if (input === '/auth/logout') return json(200, { data: {} });
    return json(200, { data: { command_id: 'x', event_ids: [], result: { order_id: 'O1', token: 5, groups: [], lines: [] } } });
  });
  const api = createStaffApi({ device, meta, fetch, onSignedOut: () => {} });
  const live = createLiveBus();
  const backing = o.backing ?? new Map();
  const enqueue = createEnqueue({
    api,
    device,
    clock: () => ({ nowMs: () => 1_000, utcOffsetMs: 0 }),
    live,
    store: createMemoryQueueStore(backing),
    onDeviceRevoked: () => {},
    presence: () => ({ ownedElsewhere: async () => new Set<string>(), announceRemoved: () => {}, onRemoved: () => () => {}, dispose: () => {} }),
  });
  const shell = { device, meta, api, live, enqueue, toasts: createToastBus(), clock: { nowMs: () => 1_000, utcOffsetMs: 0 }, me: { staff_id: 'ali', name: 'Ali' }, online: true } as unknown as Shell;
  const wall = { ms: 5_000_000 };
  return { api, live, enqueue, shell, calls, hub, fetch, backing, wall, now: () => wall.ms };
}

type Rig = ReturnType<typeof setup>;

let view: Mounted | null = null;
let visibility: DocumentVisibilityState = 'visible';
beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});
afterEach(() => {
  view?.unmount();
  view = null;
  visibility = 'visible';
});

async function render(s: Rig, onTap = vi.fn()) {
  view = mount();
  view.render(
    <ShellContext.Provider value={s.shell}>
      <button type="button" onClick={onTap}>
        Send to kitchen
      </button>
      <IdleLock now={s.now} timers={noTimers} fetch={s.fetch} />
    </ShellContext.Provider>,
  );
  await flush();
  return onTap;
}

function resume() {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function reconnect(live: Rig['live']) {
  live.connection(true);
  live.connection(false);
  live.connection(true);
}

describe('[02b §8 Device idle lock] lock screen', () => {
  it('[02b #35] idle lock fires offline after the TTL, drains first, then POST /auth/logout', async () => {
    const s = setup();
    await s.api.signIn('ali', '1', false);
    s.hub.up = false;
    await s.enqueue('SubmitOrder', { order_id: 'O1', order_type: 'takeaway', lines: [] }, { label: 'Takeaway' });
    await render(s);
    expect(view!.container.querySelector('.idle')).toBeNull();
    s.wall.ms += TTL;
    visibility = 'hidden';
    resume();
    expect(view!.container.querySelector('.idle')).toBeNull();
    visibility = 'visible';
    resume();
    await flush(8);
    const lock = view!.container.querySelector('.idle');
    expect(lock?.getAttribute('role')).toBe('alert');
    expect(lock?.textContent).toContain('Signed out after 1 min idle');
    expect(lock?.textContent).toContain('Your order is kept.');
    // offline: the drain and the logout were tried, in that order, and both wait; the api forgot the token
    expect(s.calls.map((c) => c.path)).toEqual(['/commands/submit-order', '/commands/submit-order', '/auth/logout']);
    expect(s.api.sessionToken()).toBeNull();
    // back: the queue drains first (as Ali), then the owed logout
    s.hub.up = true;
    s.calls.length = 0;
    reconnect(s.live);
    await flush(10);
    expect(s.calls).toEqual([
      { path: '/commands/submit-order', token: 'TOK-ali' },
      { path: '/auth/logout', token: 'TOK-ali' },
    ]);
    expect(s.enqueue.pendingCount()).toBe(0);
    expect(view!.container.querySelector('.idle')?.textContent).toContain('1 waiting item was sent first.');
  });

  it('[02b #35 m-9] TTL elapsed while suspended → the first tap after resume shows the lock; nothing sent as the old person', async () => {
    const s = setup();
    await s.api.signIn('ali', '1', false);
    const onTap = await render(s);
    // awake and used: the tap goes through
    view!.click(view!.button('Send to kitchen'));
    expect(onTap).toHaveBeenCalledTimes(1);
    // suspended (no timer, no visibilitychange) past the TTL; the first tap after resume
    s.wall.ms += TTL + 1;
    view!.click(view!.button('Send to kitchen'));
    expect(onTap).toHaveBeenCalledTimes(1);
    await flush(6);
    expect(view!.container.querySelector('.idle')).not.toBeNull();
    expect(s.calls.filter((c) => c.path.startsWith('/commands/'))).toEqual([]);
    expect(s.calls.map((c) => c.path)).toEqual(['/auth/logout']);
    // still locked: more taps are swallowed, the lock's own Sign in works
    view!.click(view!.button('Send to kitchen'));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('[02b Q-21] idle_ttl_ms ≤ 0 → lock at once', async () => {
    const s = setup();
    await s.api.signIn('ali', '1', false);
    s.fetch.mockImplementation(async (input: string) => {
      if (input === '/queries/session') return json(200, { data: { idle_ttl_ms: 0, permissions: {} } });
      return json(200, { data: {} });
    });
    await render(s);
    expect(view!.container.querySelector('.idle')?.textContent).toContain('Signed out after 0 min idle');
  });

  it('[02b #35 S-4] offline: a pending logout (memory, not a queue entry) is sent before the next login', async () => {
    const backing: MemoryQueueBacking = new Map();
    const s = setup({ backing });
    await s.api.signIn('ali', '1', false);
    s.hub.up = false;
    await render(s);
    s.wall.ms += TTL;
    resume();
    await flush(6);
    expect(peekPendingLogout(s.enqueue)?.count()).toBe(1);
    // not a queue entry
    expect(backing.size).toBe(0);
    expect(s.enqueue.pendingCount()).toBe(0);
    // the page was signed out another way (the shell unmounts the lock); the next login sends it first
    view!.unmount();
    view = null;
    s.hub.up = true;
    s.calls.length = 0;
    await createShellHooks(s.enqueue).beforeSignIn();
    expect(s.calls).toEqual([{ path: '/auth/logout', token: 'TOK-ali' }]);
    expect(peekPendingLogout(s.enqueue)?.count()).toBe(0);
  });

  it('[02b Q-2] after reload the pending logout is gone', async () => {
    const s = setup();
    await s.api.signIn('ali', '1', false);
    s.hub.up = false;
    await render(s);
    s.wall.ms += TTL;
    resume();
    await flush(6);
    expect(peekPendingLogout(s.enqueue)?.count()).toBe(1);
    // nothing of it at rest
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    // a reload: a new page, a new queue — no pending logout, nothing sent before the login
    const reloaded = setup();
    s.hub.up = true;
    expect(peekPendingLogout(reloaded.enqueue)).toBeNull();
    await createShellHooks(reloaded.enqueue).beforeSignIn();
    expect(reloaded.calls).toEqual([]);
  });

  it('[02b §8 Device idle lock] the draft is kept', async () => {
    // the device's real draft store (IndexedDB pos-queue): the lock, its drain and its logout leave it alone
    const drafts = createIdbDraftStore();
    await drafts.put({ draft_id: 'D1', device_id: 'dev-1', staff_id: 'ali', order_type: 'dine_in', table_id: 'F4', seating_id: 'S1', cart: { lines: [1] }, updated_at: 1, held: true });
    const s = setup();
    await s.api.signIn('ali', '1', false);
    await s.enqueue('SubmitOrder', { order_id: 'O1', order_type: 'takeaway', lines: [] }, { label: 'Takeaway' });
    await render(s);
    s.wall.ms += TTL;
    resume();
    await flush(10);
    expect(view!.container.querySelector('.idle')).not.toBeNull();
    expect(s.calls.map((c) => c.path)).toContain('/auth/logout');
    expect(await createIdbDraftStore().list('dev-1', 'ali')).toEqual([
      { draft_id: 'D1', device_id: 'dev-1', staff_id: 'ali', order_type: 'dine_in', table_id: 'F4', seating_id: 'S1', cart: { lines: [1] }, updated_at: 1, held: true },
    ]);
    await drafts.remove('D1');
  });

  it('[02b §8 Device idle lock review #171] StrictMode: one lock — the discarded copy never logs the person out', async () => {
    const s = setup();
    await s.api.signIn('ali', '1', false);
    const fired: Array<() => void> = [];
    const timers: IdleTimers = {
      setTimeout: (fn) => fired.push(fn),
      clearTimeout: (h) => {
        if (typeof h === 'number') fired[h - 1] = () => {};
      },
    };
    view = mount();
    view.render(
      <StrictMode>
        <ShellContext.Provider value={s.shell}>
          <IdleLock now={s.now} timers={timers} fetch={s.fetch} />
        </ShellContext.Provider>
      </StrictMode>,
    );
    await flush(6);
    // the person keeps working: a tap just before the TTL
    s.wall.ms += TTL - 1;
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    // past the first TTL but not idle: whatever timer fires (a discarded copy's too) logs nobody out
    s.wall.ms += 10;
    for (const f of [...fired]) act(() => f());
    await flush(6);
    expect(s.calls).toEqual([]);
    expect(s.api.sessionToken()).toBe('TOK-ali');
    expect(view.container.querySelector('.idle')).toBeNull();
    // idle for a whole TTL after the last tap: the lock screen and one logout
    s.wall.ms += TTL;
    for (const f of [...fired]) act(() => f());
    await flush(6);
    expect(view.container.querySelector('.idle')).not.toBeNull();
    expect(s.calls.filter((c) => c.path === '/auth/logout')).toHaveLength(1);
  });

  it('[02b §8 Device idle lock review #171] the first TTL read fails: a later read (reconnect) still locks, counting from the mount', async () => {
    const s = setup();
    await s.api.signIn('ali', '1', false);
    let sessionReads = 0;
    const base = s.fetch.getMockImplementation()!;
    s.fetch.mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === '/queries/session' && ++sessionReads === 1) throw new TypeError('Failed to fetch');
      return base(input, init);
    });
    await render(s);
    expect(sessionReads).toBe(1);
    s.wall.ms += TTL;
    await flush(6);
    // no TTL yet: no lock
    expect(view!.container.querySelector('.idle')).toBeNull();
    reconnect(s.live);
    await flush(8);
    expect(sessionReads).toBeGreaterThanOrEqual(2);
    expect(view!.container.querySelector('.idle')).not.toBeNull();
  });

  it('[02b §8 Device idle lock] Sign in on the lock retries the owed logout; offline it says it needs the hub', async () => {
    const s = setup();
    await s.api.signIn('ali', '1', false);
    s.hub.up = false;
    await render(s);
    s.wall.ms += TTL;
    resume();
    await flush(6);
    expect(view!.container.querySelector('.idle')?.textContent).toContain('Needs the hub');
    s.hub.up = true;
    view!.click(view!.button('Sign in'));
    await flush(6);
    expect(s.calls.at(-1)).toEqual({ path: '/auth/logout', token: 'TOK-ali' });
    expect(view!.container.querySelector('.idle')?.textContent).not.toContain('Needs the hub');
  });

  it('[02b §8 Device idle lock; review #193] Sign in signs the page out even when the logout stalls: busy, then out after SIGN_IN_WAIT_MS', async () => {
    const s = setup();
    await s.api.signIn('ali', '1', false);
    const signOut = vi.fn();
    (s.shell as { signOut?: () => void }).signOut = signOut;
    // the hub takes the logout and never answers
    const base = s.fetch.getMockImplementation()!;
    s.fetch.mockImplementation((input: string, init?: RequestInit) => (input === '/auth/logout' ? new Promise<Response>(() => {}) : base(input, init)));
    const waits: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
    const timers: IdleTimers = {
      setTimeout: (fn, ms) => waits.push({ fn, ms, cleared: false }),
      clearTimeout: (h) => {
        if (typeof h === 'number' && waits[h - 1] !== undefined) waits[h - 1]!.cleared = true;
      },
    };
    view = mount();
    view.render(
      <ShellContext.Provider value={s.shell}>
        <IdleLock now={s.now} timers={timers} fetch={s.fetch} />
      </ShellContext.Provider>,
    );
    await flush(6);
    s.wall.ms += TTL;
    resume();
    await flush(6);
    const button = view.button('Sign in') as HTMLButtonElement;
    view.click(button);
    await flush(6);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(signOut).not.toHaveBeenCalled();
    const wait = waits.find((w) => w.ms === SIGN_IN_WAIT_MS && !w.cleared)!;
    expect(wait).toBeDefined();
    act(() => wait.fn());
    await flush(4);
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
