import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createHubClock } from '../../app/hub-clock';
import { navigate, useHashRoute } from '../../app/router';
import { language, t } from '../../i18n';
import { fill } from '../../i18n/en';
import { ALERT_CONSTANTS } from '@pos/domain';
import { createAnswerSender } from '../alerts/answer';
import { AnswerSheet, NoticeSheet, type Toast } from '../alerts/AnswerSheet';
import { Banners } from '../alerts/Banner';
import { BindingHeader } from '../alerts/BindingHeader';
import { Inbox } from '../alerts/Inbox';
import { badgeText, lockText, timeText } from '../alerts/labels';
import { Receipts } from '../alerts/Receipts';
import { RequestsToAnswer, requestViews, type RequestRow, type RequestView } from '../alerts/RequestsToAnswer';
import { createAlertConnection, hubSocketUrl, REPLACED_REASON, type SocketLike } from '../alerts/socket';
import { webAudioSink, type AudioSink, type ToneContext } from '../alerts/sounds';
import { createAlertStore, type AlertRow, type AlertStore, type Timers } from '../alerts/store';
import type { WsAlertClosed } from '@pos/events';
import { TestAlert } from '../alerts/TestAlert';
import { FamilyPill, Ico, initial, isRequest, type IconName } from '../alerts/ui';
import { createStaffApi, type Device, type PageMeta, type RosterPerson, type SignedIn } from './api';
import { SignIn } from './SignIn';

// 01d task 41: the hub-served staff entry /staff/ (spec §8.1; hand-off PROMPT "Staff entry shell"). Maroon 80 px
// top bar: brand block (mark, branch, device; the third line is the B05 slot, task 42), the segmented nav
// Inbox · Requests (approvers) · Test alert (manage-devices), then Live / Hub offline, the clock and the person
// chip (sign out). Portrait: the nav on its own row. Kiosk: no browser back, the nav is the way back. Phone: a
// bottom tab bar Inbox · Sign out, and no Requests screen. The page is 100dvh; only the lists scroll. Dialogs,
// banners and the toast render inside the .pu root.

const PORTRAIT = '(orientation: portrait) and (min-width: 761px)';
const PHONE = '(max-width: 760px)';
const TICK_MS = 15_000;
const SEEN_FLUSH_MS = 250;
const SEEN_BATCH = 50;
const TOAST_MS = 4_000;

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (fn) => {
      const list = typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
      list?.addEventListener('change', fn);
      return () => list?.removeEventListener('change', fn);
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
  );
}

const browserTimers: Timers = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
};

let audio: AudioContext | null = null;
const browserSink = webAudioSink(() => {
  try {
    audio ??= new AudioContext();
    return audio as unknown as ToneContext;
  } catch {
    return null;
  }
});

interface Me {
  staffId: string;
  name: string;
  allowed: ReadonlySet<string>;
}


export interface StaffAppProps {
  device: Device;
  meta: PageMeta;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  createSocket?: (url: string) => SocketLike;
  sink?: AudioSink;
  timers?: Timers;
}

export function StaffApp({ device, meta, fetch, createSocket, sink, timers }: StaffAppProps) {
  const phone = useMedia(PHONE);
  const portrait = useMedia(PORTRAIT);
  const route = useHashRoute();
  const [me, setMe] = useState<Me | null>(null);
  const meRef = useRef<Me | null>(null);
  meRef.current = me;
  const signOutRef = useRef<() => void>(() => {});
  // the hub counts every accepted command as session activity (commands/route.ts); queries never (§6.7–6.10)
  const activityRef = useRef<() => void>(() => {});
  const hubFetch = useMemo(() => {
    const base = fetch ?? ((input: string, init?: RequestInit) => window.fetch(input, init));
    return async (input: string, init?: RequestInit): Promise<Response> => {
      const response = await base(input, init);
      if (response.ok && input.includes('/commands/')) activityRef.current();
      return response;
    };
  }, [fetch]);
  // a session counter: replies still in flight from an earlier session are dropped
  const sessionGen = useRef(0);

  const api = useMemo(() => createStaffApi({ device, meta, fetch: hubFetch, onSignedOut: () => signOutRef.current() }), [device, meta, hubFetch]);
  const store = useMemo(() => createAlertStore({ sink: sink ?? browserSink, timers: timers ?? browserTimers, alwaysOn: device.type === 'cashier_kiosk' }), [sink, timers, device.type]);
  const [replaced, setReplaced] = useState(false);
  // every alert_closed frame, also for requests the store does not hold (seen only through requests-to-answer)
  const [closes, setCloses] = useState<ReadonlyMap<string, WsAlertClosed>>(new Map());
  const socketStore = useMemo<AlertStore>(
    () => ({
      ...store,
      onClosed(frame) {
        store.onClosed(frame);
        setCloses((m) => new Map(m).set(frame.alert_id, frame));
      },
    }),
    [store],
  );
  // 01d-B05, BF-5: the tablet's binding. The hub sends only the deadline (`alerts_open.binding_route_until`, `binding_route`;
  // null when the binding is not a route); the name is the person who last signed in on this page (AD-T42-1).
  const [bindingUntil, setBindingUntil] = useState<number | null>(null);
  const [boundName, setBoundName] = useState<string | null>(null);
  const conn = useMemo(
    () =>
      createAlertConnection({
        url: hubSocketUrl(),
        deviceType: device.type,
        deviceToken: device.token,
        store: socketStore,
        timers: timers ?? browserTimers,
        onBindingRoute: setBindingUntil,
        ...(createSocket === undefined ? {} : { createSocket }),
        onEnded: (code, reason) => {
          if (code === 4409 || reason === REPLACED_REASON) setReplaced(true);
          else if (code === 4401) signOutRef.current();
        },
      }),
    [device, socketStore, timers, createSocket],
  );
  useEffect(() => () => conn.dispose(), [conn]);
  useEffect(() => () => store.dispose(), [store]);

  const snap = useSyncExternalStore(store.subscribe, store.snapshot);
  const up = useSyncExternalStore(conn.subscribe, () => conn.isUp());
  const mode = useSyncExternalStore(conn.subscribe, () => conn.mode());

  // S47: the hub's clock from the page (no device zone)
  const [clock, setClock] = useState(() => createHubClock({ now_ms: meta.hubNowMs, utc_offset_ms: meta.utcOffsetMs }));
  const [nowMs, setNow] = useState(() => clock.nowMs());
  useEffect(() => {
    setNow(clock.nowMs());
    const timer = setInterval(() => setNow(clock.nowMs()), TICK_MS);
    return () => clearInterval(timer);
  }, [clock]);
  const offset = clock.utcOffsetMs;
  const binding = bindingUntil === null ? null : { name: boundName ?? t('bind.someone'), until: bindingUntil };
  // AD-T42-2 (unattended): approximate until 9b. Set at sign-in, moved to hub-now + 2 h by this page's activity
  // (an accepted command), replaced by any binding_route frame.
  activityRef.current = () => {
    if (meRef.current !== null && device.type === 'tablet') setBindingUntil(clock.nowMs() + ALERT_CONSTANTS.binding_route_idle_ms);
  };

  // B03: the list is from when the socket went down (signed in only)
  const [offlineAt, setOfflineAt] = useState<number | null>(null);
  useEffect(() => {
    if (me === null || up) setOfflineAt(null);
    else setOfflineAt((at) => at ?? clock.nowMs());
  }, [up, me, clock]);

  // --------------------------------------------------------------------------------------------- data
  const [inboxLoading, setInboxLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [roster, setRoster] = useState<RosterPerson[]>([]);

  const [inboxFailed, setInboxFailed] = useState(false);
  const loadInbox = useCallback(
    async (from: string | null) => {
      const gen = sessionGen.current;
      const answer = await api.inbox(from);
      if (gen !== sessionGen.current) return; // an earlier session's reply
      // a failed read stops the skeleton; the store's rows (socket) stay on screen and the read is retried
      setInboxLoading(false);
      setInboxFailed(!answer.ok);
      if (!answer.ok) return;
      store.onInbox(answer.data.alerts);
      setCursor(answer.data.next_cursor);
    },
    [api, store],
  );
  const loadRequests = useCallback(async () => {
    const gen = sessionGen.current;
    const answer = await api.requests();
    if (gen === sessionGen.current && answer.ok) setRequests(answer.data.requests);
  }, [api]);

  // re-read requests-to-answer when a request alert arrives, steps or closes (the list is computed by the hub)
  const requestKey = `${snap.rows
    .filter((r) => isRequest(r))
    .map((r) => `${r.alert_id}:${r.step}:${r.state}`)
    .join(',')}|${closes.size}`;
  useEffect(() => {
    if (me === null) return;
    void loadRequests();
  }, [me, requestKey, up, loadRequests]);

  // re-read the inbox when the hub is back (a reconnect after a drop, or after a failed read)
  const wasDown = useRef(false);
  const signedInNow = me !== null;
  useEffect(() => {
    if (!signedInNow) {
      wasDown.current = false;
      return;
    }
    if (!up) {
      wasDown.current = true;
      return;
    }
    if (wasDown.current || inboxFailed) {
      wasDown.current = false;
      void loadInbox(null);
    }
  }, [up, signedInNow, inboxFailed, loadInbox]);

  // MarkAlertsSeen, batched (§6.4: up to 50 ids)
  const seenQueue = useRef<string[]>([]);
  const seenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markSeen = (id: string) => {
    if (!seenQueue.current.includes(id)) seenQueue.current.push(id);
    if (seenTimer.current !== null) return;
    seenTimer.current = setTimeout(() => {
      seenTimer.current = null;
      const ids = seenQueue.current.splice(0);
      for (let i = 0; i < ids.length; i += SEEN_BATCH) void api.markSeen(ids.slice(i, i + SEEN_BATCH));
    }, SEEN_FLUSH_MS);
  };

  // ------------------------------------------------------------------------------------------ session
  const signedIn = async (who: SignedIn) => {
    sessionGen.current += 1;
    const gen = sessionGen.current;
    setReplaced(false);
    conn.setSession(who.session_token);
    setInboxLoading(true);
    setMe({ staffId: who.staff_id, name: who.display_name, allowed: new Set() });
    // §3.7: a sign-in refreshes the header; the hub's own deadline (session end + 2 h) replaces this one when it sends it
    setBoundName(who.display_name);
    setBindingUntil(clock.nowMs() + ALERT_CONSTANTS.binding_route_idle_ms);
    navigate('/inbox');
    const [info, time] = await Promise.all([api.session(), api.hubTime()]);
    if (gen !== sessionGen.current) return;
    // S47: re-sync the hub clock from branch-config hub_time (the page's clock is from when it loaded)
    if (time.ok && time.data !== null) setClock(createHubClock(time.data));
    if (info.ok) {
      const allowed = new Set(Object.entries(info.data.permissions).filter(([, r]) => r.grant === 'allowed').map(([p]) => p));
      setMe((m) => (m === null || m.staffId !== who.staff_id ? m : { ...m, allowed }));
    }
    void loadInbox(null);
    const people = await api.roster();
    if (gen === sessionGen.current && people.ok) setRoster(people.data.staff);
  };

  const signOut = useCallback(
    (callHub: boolean) => {
      sessionGen.current += 1;
      setOpened(null);
      setCloses(new Map());
      setRequests([]);
      setCursor(null);
      setMe(null);
      if (callHub) {
        void api.signOut();
        setBindingUntil(null); // a logout ends the binding (§3.7); an idle sign-out keeps it
      }
      else api.drop();
      conn.setSession(null);
    },
    [api, conn],
  );
  signOutRef.current = () => signOut(false);

  const sender = useMemo(
    () =>
      createAnswerSender({
        link: conn,
        fetch: hubFetch,
        // task 40's context(), filled from the staff sign-in and the page (H-10: memory only)
        context: () => {
          const token = api.sessionToken();
          const who = meRef.current;
          if (token === null || who === null) return null;
          return { deviceToken: device.token, sessionToken: token, tenantId: meta.tenantId, branchId: meta.branchId, deviceId: device.id, staffId: who.staffId };
        },
      }),
    [conn, hubFetch, api, device, meta],
  );

  // --------------------------------------------------------------------------------------------- ui state
  // only the id: the sheet reads the live row on every render (a close, an answer elsewhere, a lock view)
  const [opened, setOpened] = useState<string | null>(null);
  const lastOpened = useRef<AlertRow | RequestView | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  const [summaries] = useState(() => new Map<string, string>());

  const held = useMemo(() => new Map(snap.rows.map((r) => [r.alert_id, r])), [snap.rows]);
  const views = useMemo(() => requestViews(requests, held, closes), [requests, held, closes]);
  const answerable = views.filter((v) => v.can_answer && v.state === 'open').length;

  const allowed = me?.allowed ?? new Set<string>();
  // AD-T41-10 (review fix): from the hub's own list, never from a permission name
  const showRequests = !phone && requests.length > 0;
  const showTest = !phone && allowed.has('manage-devices');

  const open = (row: AlertRow | RequestView) => {
    store.open(row.alert_id);
    markSeen(row.alert_id);
    lastOpened.current = views.find((v) => v.alert_id === row.alert_id) ?? row;
    setOpened(row.alert_id);
  };

  // the open sheet's row, live: the requests view (latest view wins), else the store's row; a row that left both
  // lists was closed while the sheet was open (requests-to-answer lists open requests only)
  let sheetRow: AlertRow | RequestView | null = null;
  if (opened !== null) {
    const live = views.find((v) => v.alert_id === opened) ?? held.get(opened);
    const last = lastOpened.current;
    const c = closes.get(opened);
    sheetRow =
      live ??
      (last === null
        ? null
        : { ...last, state: 'closed' as const, close_reason: c?.reason ?? last.close_reason, decision: c?.decision ?? last.decision, by_name: c?.by_name ?? last.by_name });
    if (live !== undefined) lastOpened.current = live;
  }

  // --------------------------------------------------------------------------------------------- routes
  const receiptsMatch = /^\/receipts\/([^/]+)$/.exec(route);
  let page: ReactNode;
  let current: 'inbox' | 'requests' | 'test' = 'inbox';
  if (me === null) {
    const lockRows = device.type === 'cashier_kiosk' || device.type === 'phone' ? snap.rows.filter((r) => r.state === 'open').slice(0, 3) : [];
    page = (
      <SignIn
        api={api}
        phone={phone}
        lockPanel={lockRows.length === 0 ? null : <LockPanel rows={lockRows} utcOffsetMs={offset} />}
        onSignedIn={(who) => void signedIn(who)}
      />
    );
  } else if (route === '/requests' && showRequests) {
    current = 'requests';
    page = <RequestsToAnswer rows={views} nowMs={nowMs} utcOffsetMs={offset} onOpen={open} />;
  } else if (route === '/test-alert' && showTest) {
    current = 'test';
    page = (
      <TestAlert
        people={roster}
        device={{ device_id: device.id, device_type: device.type }}
        send={async (target) => {
          const answer = await api.sendTestAlert(target);
          if (answer.ok) return { ok: true, alert_id: answer.data.alert_id };
          return { ok: false, code: answer.error.kind === 'api' ? answer.error.code : 'NETWORK' };
        }}
        onSent={(id, to) => {
          summaries.set(id, fill(t('receipts.sent_by'), { time: timeText(clock.nowMs(), offset), name: me.name, target: to }));
          navigate(`/receipts/${encodeURIComponent(id)}`);
        }}
      />
    );
  } else if (receiptsMatch !== null && showTest) {
    current = 'test';
    const id = decodeURIComponent(receiptsMatch[1]!);
    page = <Receipts alertId={id} load={api.receipts} summary={summaries.get(id) ?? null} utcOffsetMs={offset} />;
  } else {
    page = (
      <Inbox
        rows={snap.rows}
        loading={inboxLoading}
        offlineAt={offlineAt}
        nowMs={nowMs}
        utcOffsetMs={offset}
        onOpen={open}
        hasMore={cursor !== null}
        onMore={() => void loadInbox(cursor)}
      />
    );
  }

  const nav: Array<{ id: typeof current; icon: IconName; label: string; count: string | null; to: string }> = [
    { id: 'inbox', icon: 'tray', label: t('alerts.nav.inbox'), count: badgeText(snap.unseen), to: '/inbox' },
    ...(showRequests ? [{ id: 'requests' as const, icon: 'shield' as const, label: t('alerts.nav.requests'), count: badgeText(answerable), to: '/requests' }] : []),
    ...(showTest ? [{ id: 'test' as const, icon: 'pulse' as const, label: t('alerts.nav.test'), count: null, to: '/test-alert' }] : []),
  ];
  const seg = (fill: boolean) => (
    <div className={`seg${fill ? ' seg--fill' : ''}`} role="tablist" aria-label={t('alerts.nav.inbox')}>
      {nav.map((n) => (
        <button key={n.id} type="button" role="tab" aria-pressed={current === n.id} aria-selected={current === n.id} onClick={() => navigate(n.to)}>
          <Ico name={n.icon} />
          {n.label}
          {n.count !== null && <span className="n num n--hot">{n.count}</span>}
        </button>
      ))}
    </div>
  );

  const noApprover = me !== null && snap.rows.some((r) => r.kind === 'no_approver' && r.state === 'open');
  const deviceWord = t(`alerts.device.${device.type}`);
  const live =
    mode === 'none' ? null : up ? (
      <span className="live">
        <Ico name="wifi" />
        {t('alerts.live')}
      </span>
    ) : (
      <span className="live live--off">
        <Ico name="wifioff" />
        {t('alerts.hub_offline')}
      </span>
    );
  const clockText = <span className="clock">{timeText(nowMs, offset)}</span>;
  const lang = language();

  return (
    <div className={`pu v-brand staff${phone ? ' phone' : ''}`} lang={lang} dir={lang === 'ur' ? 'rtl' : 'ltr'} data-theme="light">
      {phone ? (
        <header className="ph-top">
          <div>
            <h1>{me === null ? meta.branchName : t('alerts.nav.inbox')}</h1>
            <span className="sub">
              {me === null ? (
                `${meta.branchName} · ${deviceWord}`
              ) : (
                <>
                  <Ico name={up ? 'wifi' : 'wifioff'} className={`ico--15 ${up ? 'ico--ok' : 'ico--danger'}`} />
                  {t(up ? 'alerts.live' : 'alerts.hub_offline')} · <span className="num">{timeText(nowMs, offset)}</span>
                </>
              )}
            </span>
          </div>
          {me !== null && (
            <div className="end">
              <span className="av av--me av--48">{initial(me.name)}</span>
            </div>
          )}
        </header>
      ) : (
        <header className="top">
          <div className="brand">
            <div className="mark" aria-hidden="true">
              {initial(meta.branchName)}
            </div>
            <div>
              <b>{meta.branchName}</b>
              <span>
                {meta.branchName} · {deviceWord}
              </span>
              {device.type === 'tablet' && <BindingHeader binding={binding} nowMs={clock.nowMs} utcOffsetMs={offset} timers={timers ?? browserTimers} sink={sink ?? browserSink} />}
            </div>
          </div>
          {me !== null && <div className="staff__nav">{seg(false)}</div>}
          <div className="end">
            {live}
            {clockText}
            {me !== null && (
              <button type="button" className="me" aria-label={fill(t('alerts.sign_out'), { name: me.name })} onClick={() => signOut(true)}>
                <span className="av av--sm av--me">{initial(me.name)}</span>
                {me.name}
              </button>
            )}
          </div>
        </header>
      )}
      {!phone && me !== null && <div className="navrow staff__navrow">{seg(true)}</div>}
      {replaced && (
        <div className="staff__warn">
          <div className="warnbar" role="status">
            <Ico name="warn" />
            {t('alerts.replaced')}
            <button type="button" className="btn" onClick={() => (setReplaced(false), conn.setSession(api.sessionToken()))}>
              {t('alerts.use_here')}
            </button>
          </div>
        </div>
      )}
      {noApprover && (
        <div className="staff__warn">
          <div className="warnbar" role="status">
            <Ico name="warn" />
            {t('alert.no_approver.card')}
            <small>{t('alerts.no_approver_clears')}</small>
          </div>
        </div>
      )}
      {page}
      {phone && me !== null && (
        <nav className="tabbar tabbar--2">
          <a className="tab" href="#/inbox" aria-current="page">
            <Ico name="tray" />
            {t('alerts.nav.inbox')}
            {badgeText(snap.unseen) !== null && <span className="badge">{badgeText(snap.unseen)}</span>}
          </a>
          <button type="button" className="tab" onClick={() => signOut(true)}>
            <Ico name="signout" />
            {t('alerts.sign_out_short')}
          </button>
        </nav>
      )}
      {me !== null && opened === null && (
        <Banners banners={snap.banners} nowMs={nowMs} lockOnly={false} variant={phone ? 'phone' : portrait ? 'wide' : 'side'} onOpen={open} onOpenInbox={() => navigate('/inbox')} />
      )}
      {me !== null && sheetRow !== null &&
        (isRequest(sheetRow) ? (
          <AnswerSheet
            row={sheetRow}
            canAnswer={'can_answer' in sheetRow ? sheetRow.can_answer : sheetRow.set === 'answerer' && (sheetRow.answers?.length ?? 0) > 0}
            deviceId={device.id}
            me={{ staffId: me.staffId, name: me.name }}
            sender={sender}
            link={conn}
            loadApprovers={async () => {
              const answer = await api.roster();
              return answer.ok ? answer.data.staff.filter((s) => s.locked_until == null) : [];
            }}
            nowMs={nowMs}
            utcOffsetMs={offset}
            sheet={phone || portrait}
            onClose={() => setOpened(null)}
            onToast={setToast}
          />
        ) : (
          <NoticeSheet row={sheetRow} utcOffsetMs={offset} sheet={phone || portrait} onClose={() => setOpened(null)} />
        ))}
      {toast !== null && (
        <div className={`toast toast--${toast.tone ?? 'ok'}`} role="status">
          <Ico name={toast.tone === 'warn' ? 'warn' : toast.tone === 'info' ? 'info' : 'checkc'} />
          <div>
            {toast.text}
            {toast.sub !== undefined && <small>{toast.sub}</small>}
          </div>
        </div>
      )}
    </div>
  );
}

/** 01d F01 (frames LockKiosk, LockPhone): signed out on a kiosk or phone, up to 3 lock lines, never details. */
function LockPanel({ rows, utcOffsetMs }: { rows: readonly AlertRow[]; utcOffsetMs: number }) {
  return (
    <section className="lockp" aria-label={t('lock.title')}>
      <div className="lockp__h">
        <Ico name="bellring" />
        {t('lock.title')}
        <small>{t('lock.sign_in')}</small>
      </div>
      {rows.map((r) => (
        <div key={r.alert_id} className="lockp__r">
          <FamilyPill row={r} />
          <span>{lockText(r)}</span>
          <span className="ac__time num">{timeText(r.raised_at, utcOffsetMs)}</span>
        </div>
      ))}
    </section>
  );
}
