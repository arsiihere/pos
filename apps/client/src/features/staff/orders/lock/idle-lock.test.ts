import { describe, expect, it, vi } from 'vitest';
import { createIdleLock } from './idle-lock';
import { createPendingLogout } from './pending-logout';

// 02b v1.0.11 §8 Device idle lock; 00 H-1; owner Q-21, Q-2 (25d): the device's own idle timer (wall clock since the
// last tap) and the pending logout (memory only).

function clock(start = 1_000_000) {
  const c = { ms: start };
  return { c, now: () => c.ms };
}

/** timers the test fires by hand (a suspended WebView never fires them) */
function manualTimers() {
  const pending: Array<{ fn: () => void; at: number; id: number }> = [];
  let id = 0;
  return {
    pending,
    timers: {
      setTimeout: (fn: () => void, ms: number) => {
        pending.push({ fn, at: ms, id: ++id });
        return id;
      },
      clearTimeout: (h: unknown) => {
        const i = pending.findIndex((p) => p.id === h);
        if (i >= 0) pending.splice(i, 1);
      },
    },
    fireAll() {
      for (const p of pending.splice(0)) p.fn();
    },
  };
}

describe('[02b §8 Device idle lock] idle lock', () => {
  it('[02b Q-21] wall-clock since the last tap, checked on visibilitychange and before every tap', () => {
    const { c, now } = clock();
    const t = manualTimers();
    const onLock = vi.fn();
    const lock = createIdleLock({ ttlMs: 60_000, now, timers: t.timers, onLock });
    c.ms += 59_999;
    expect(lock.touch()).toBe(true); // a tap moves the last tap
    c.ms += 59_999;
    expect(lock.check()).toBe(false);
    expect(lock.locked()).toBe(false);
    // the page was hidden and the timer never fired: the resume check (visibilitychange) sees the wall clock
    c.ms += 2;
    expect(lock.check()).toBe(true);
    expect(lock.locked()).toBe(true);
    expect(onLock).toHaveBeenCalledTimes(1);
    // locked: every later tap is refused, onLock not again
    expect(lock.touch()).toBe(false);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('[02b #35 m-9] TTL elapsed while suspended → the first tap after resume shows the lock; nothing sent as the old person', () => {
    const { c, now } = clock();
    const t = manualTimers();
    const onLock = vi.fn();
    const lock = createIdleLock({ ttlMs: 60_000, now, timers: t.timers, onLock });
    const heard = vi.fn();
    lock.subscribe(heard);
    // suspended: no timer fired, 2 min passed on the wall clock
    c.ms += 120_000;
    expect(lock.locked()).toBe(false);
    expect(lock.touch()).toBe(false); // the tap is swallowed
    expect(lock.locked()).toBe(true);
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalled();
  });

  it('[02b Q-21] the timer locks an idle screen that stays awake', () => {
    const { c, now } = clock();
    const t = manualTimers();
    const lock = createIdleLock({ ttlMs: 60_000, now, timers: t.timers, onLock: () => {} });
    expect(t.pending.map((p) => p.at)).toEqual([60_000]);
    c.ms += 30_000;
    lock.touch();
    expect(t.pending.map((p) => p.at)).toEqual([60_000]);
    c.ms += 60_000;
    t.fireAll();
    expect(lock.locked()).toBe(true);
    lock.dispose();
    expect(t.pending).toEqual([]);
  });

  it('[02b Q-21] idle_ttl_ms ≤ 0 → lock at once', () => {
    for (const ttlMs of [0, -5]) {
      const onLock = vi.fn();
      const lock = createIdleLock({ ttlMs, now: () => 5, timers: manualTimers().timers, onLock });
      expect(lock.locked()).toBe(true);
      expect(onLock).toHaveBeenCalledTimes(1);
      expect(lock.touch()).toBe(false);
    }
  });
});

describe('[02b §8 Device idle lock] pending logout', () => {
  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }

  it('[02b #35 S-4] offline: a pending logout (memory, not a queue entry) is kept until the hub takes it', async () => {
    const calls: Array<{ path: string; headers: Record<string, string> }> = [];
    let up = false;
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, headers: init?.headers as Record<string, string> });
      if (!up) throw new TypeError('Failed to fetch');
      return json(200, { data: {} });
    });
    const pending = createPendingLogout({ device: { token: 'DEV', id: 'd', type: 'tablet' }, fetch });
    pending.add('TOK-ali');
    expect(await pending.flush()).toBe(false);
    expect(pending.count()).toBe(1);
    up = true;
    expect(await pending.flush()).toBe(true);
    expect(pending.count()).toBe(0);
    expect(calls.at(-1)).toEqual({ path: '/auth/logout', headers: { Authorization: 'Bearer DEV', 'X-Session-Token': 'TOK-ali', 'Content-Type': 'application/json' } });
    // nothing left: no call
    expect(await pending.flush()).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('[02b §8 Device idle lock] a session the hub already ended (401) is done too; a 5xx keeps it', async () => {
    const answers = [json(503, { error: { code: 'HUB_BUSY' } }), json(401, { error: { code: 'SESSION_EXPIRED' } })];
    const pending = createPendingLogout({ device: { token: 'DEV', id: 'd', type: 'tablet' }, fetch: async () => answers.shift()! });
    pending.add('TOK');
    expect(await pending.flush()).toBe(false);
    expect(await pending.flush()).toBe(true);
    expect(pending.count()).toBe(0);
  });
});
