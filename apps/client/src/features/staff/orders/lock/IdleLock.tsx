// owned by lane Q, task 25d (was the W0.6 stub)
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico, Ring } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import { queueOf } from '../queue/enqueue';
import { createIdleLock, type DeviceIdleLock, type IdleTimers } from './idle-lock';
import { createPendingLogout, pendingLogoutOf } from './pending-logout';

// 02b v1.0.11 §8 Device idle lock (02-B09), 00 H-1, #35 (m-9, S-4), owner Q-21, Q-2 (25d). Mounted by the shell while
// someone is signed in. It takes the idle TTL from the login reply (`Shell.idleTtlMs`), else reads it from the
// session (`GET /queries/session`, not activity), then:
// - every tap / key is checked first (capture phase, before any screen sees it): past the TTL on the wall clock the
//   tap is swallowed and the lock shows — nothing is sent as the old person (m-9); `visibilitychange` checks too;
// - at the lock: the queue drains first (as the person who queued, within this page's life), then the logout. The
//   session token moves to the page's pending logout (memory only) and the staff api forgets it; the logout is sent
//   now, else on reconnect, on the lock's Sign in, or by the sign-in hooks before the next login (S-4). The hub ends
//   the session and closes the staff socket (4401): the shell signs the page out and offers the login. The lock's
//   Sign in tries the drain + logout once more and then signs the page out itself (`Shell.signOut`), offline too.
// - the draft is kept: the lock never touches the draft store ("Your order is kept").

export interface IdleLockProps {
  /** wall clock (Q-21); default Date.now */
  now?: () => number;
  timers?: IdleTimers;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export function IdleLock({ now, timers, fetch }: IdleLockProps = {}) {
  const shell = useShell();
  const { api, enqueue, device, live } = shell;
  const wall = useMemo(() => now ?? (() => Date.now()), [now]);
  // idle time counts from the mount and every tap, also before the TTL is known (review #171)
  const lastTap = useRef<number | null>(null);
  if (lastTap.current === null) lastTap.current = wall();
  const lockRef = useRef<DeviceIdleLock | null>(null);
  const [lock, setLock] = useState<DeviceIdleLock | null>(null);
  const [ttlMs, setTtl] = useState<number | null>(typeof shell.idleTtlMs === 'number' ? shell.idleTtlMs : null);

  // fallback (IR-9) when the shell has no login TTL: the session's idle TTL (`GET /queries/session`, not activity),
  // read again on reconnect and on resume until a read succeeds.
  useEffect(() => {
    if (ttlMs !== null) return;
    let alive = true;
    let inFlight = false;
    const load = () => {
      if (inFlight) return;
      inFlight = true;
      void api.query<{ idle_ttl_ms?: unknown }>('/queries/session').then((r) => {
        inFlight = false;
        if (alive && r.ok && typeof r.data?.idle_ttl_ms === 'number') setTtl(r.data.idle_ttl_ms);
      });
    };
    load();
    const off = live.subscribe((m) => {
      if (m.kind === 'reconnect' || m.kind === 'catch_up' || m.kind === 'visible') load();
    });
    const onShow = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('pageshow', onShow);
    return () => {
      alive = false;
      off();
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('pageshow', onShow);
    };
  }, [api, live, ttlMs]);

  const pending = useMemo(() => pendingLogoutOf(enqueue, () => createPendingLogout({ device, ...(fetch === undefined ? {} : { fetch }) })), [enqueue, device, fetch]);
  const [sentFirst, setSentFirst] = useState(0);
  const [failed, setFailed] = useState(false);

  // drain first, then the logout(s) owed
  const settle = useMemo(
    () => async () => {
      const queue = queueOf(enqueue);
      if (queue !== null) await queue.drain().catch(() => {});
      const done = await pending.flush();
      setFailed(!done);
      return done;
    },
    [enqueue, pending],
  );

  // counts what the queue sent from the lock on ("{n} waiting item was sent first"), until the lock goes away
  const offSent = useRef<() => void>(() => {});
  useEffect(() => () => offSent.current(), []);

  // review #171: the lock lives in an effect (created, started, disposed there) — StrictMode's discarded copy never
  // runs a timer or logs anyone out
  useEffect(() => {
    if (ttlMs === null) return;
    let cancelled = false;
    const created = createIdleLock({
      ttlMs,
      now: wall,
      lastTapAt: lastTap.current ?? wall(),
      autoStart: false,
      ...(timers === undefined ? {} : { timers }),
      onLock: () => {
        if (cancelled) return;
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        offSent.current();
        offSent.current = queueOf(enqueue)?.onSent(() => setSentFirst((n) => n + 1)) ?? (() => {});
        // the token leaves the api now: no screen can send as this person any more
        const token = api.sessionToken();
        if (token !== null) pending.add(token);
        api.drop();
        void settle();
      },
    });
    lockRef.current = created;
    setLock(created);
    // started after the commit (a StrictMode re-run cancels this one first); ttl ≤ 0 locks here, never in render
    void Promise.resolve().then(() => {
      if (!cancelled) created.start();
    });
    return () => {
      cancelled = true;
      created.dispose();
      if (lockRef.current === created) lockRef.current = null;
    };
  }, [ttlMs, wall, timers, enqueue, api, pending, settle]);

  const locked = useSyncExternalStore(lock?.subscribe ?? noSubscribe, () => lock?.locked() ?? false);
  const overlay = useRef<HTMLDivElement | null>(null);

  // before acting on any tap (capture on window runs before React's root listeners)
  useEffect(() => {
    const gate = (e: Event) => {
      if (overlay.current !== null && e.target instanceof Node && overlay.current.contains(e.target)) return;
      const current = lockRef.current;
      if (current === null) {
        lastTap.current = wall();
        return;
      }
      if (current.touch()) {
        lastTap.current = wall();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const resume = () => {
      if (document.visibilityState === 'visible') lockRef.current?.check();
    };
    const kinds = ['pointerdown', 'click', 'keydown', 'touchstart'] as const;
    const options: AddEventListenerOptions = { capture: true, passive: false };
    for (const k of kinds) window.addEventListener(k, gate, options);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      for (const k of kinds) window.removeEventListener(k, gate, options);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, [wall]);

  // offline at the lock: the owed logout goes out when the hub is back (the queue drains first, as it subscribed first)
  useEffect(() => {
    if (!locked) return;
    return live.subscribe((m) => {
      if (m.kind === 'reconnect' || m.kind === 'catch_up') void settle();
    });
  }, [locked, live, settle]);

  if (!locked || ttlMs === null) return null;
  const minutes = Math.max(0, Math.round(ttlMs / 60_000));
  return (
    <div className="idle" role="alert" ref={overlay}>
      <Ring size={110} pct={null} tone="brand">
        <Ico name="lock" />
      </Ring>
      <h1>{fill(t('idle.title'), { n: String(minutes) })}</h1>
      <p>{sentFirst > 0 ? fill(t('idle.sub'), { n: String(sentFirst) }) : t('idle.sub_none')}</p>
      {failed && <p>{t('tables.toast.needs_hub')}</p>}
      <button type="button" className="btn btn--primary btn--lg" onClick={() => void settle().finally(() => shell.signOut?.())}>
        <Ico name="user" />
        {t('alerts.signin.submit')}
      </button>
    </div>
  );
}

const noSubscribe = () => () => {};
