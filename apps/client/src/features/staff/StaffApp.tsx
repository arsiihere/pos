import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { wipeDeviceKeys } from '../../api/hub-admin';
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
import { lockText, timeText } from '../alerts/labels';
import { Receipts } from '../alerts/Receipts';
import { RequestsToAnswer, requestViews, type RequestRow, type RequestView } from '../alerts/RequestsToAnswer';
import { createAlertConnection, hubSocketUrl, REPLACED_REASON, type SocketLike } from '../alerts/socket';
import { webAudioSink, type AudioSink, type ToneContext } from '../alerts/sounds';
import { createAlertStore, type AlertRow, type AlertStore, type Timers } from '../alerts/store';
import type { WsAlertClosed } from '@pos/events';
import { TestAlert } from '../alerts/TestAlert';
import { FamilyPill, Ico, isRequest } from '../alerts/ui';
import { createStaffApi, type Device, type PageMeta, type Resolution, type RosterPerson, type SignedIn } from './api';
import { SignIn } from './SignIn';
import { createOrdersApi } from './orders/api';
import { pendingCompsOf } from './orders/actions/pending-comps';
import { LateAlertsContext, type LateAlertRow } from './orders/late/late-groups';
import { IdleLock } from './orders/lock/IdleLock';
import { NewOrderSheet } from './orders/new-order/NewOrderSheet';
import { QueuedSentCard } from './orders/queue/QueuedSentCard';
import { createEnqueue } from './orders/queue/enqueue';
import { createShellHooks } from './orders/queue/shell-hooks';
import { createShellConfig, type BranchConfigReply } from './shell/config';
import { ShellContext, type Shell } from './shell/hooks';
import { createLiveBus } from './shell/live';
import { createPermissions } from './shell/permissions';
import { matchStaffRoute } from './shell/routes';
import { isSlotRoute, RouteSlot } from './shell/slots';
import { createToastBus, ToastView } from './shell/toast';
import { createTablesApi } from './tables/api';
import { HandoverLayer } from './tables/cards/HandoverLayer';
import { floorHref, floorOf } from './tables/map/filters';
import { sharedMapStore } from './tables/map/map-store';
import { PairAgain } from './tables/PairAgain';
import { createLocalFlags } from './tables/local-flags';
import { MeTab, PhoneTabs, type PhoneTab } from './tables/PhoneTabs';
import { TopBar } from './tables/TopBar';

// 01d task 41: the hub-served staff entry /staff/ (spec §8.1; hand-off PROMPT "Staff entry shell"). Maroon 80 px
// top bar: brand block (mark, branch, device; the third line is the B05 slot, task 42), the segmented nav
// Inbox · Requests (approvers) · Test alert (manage-devices), then Live / Hub offline, the clock and the person
// chip (sign out). Portrait: the nav on its own row. Kiosk: no browser back, the nav is the way back. Phone: a
// bottom tab bar Inbox · Sign out, and no Requests screen. The page is 100dvh; only the lists scroll. Dialogs,
// banners and the toast render inside the .pu root.
// 02a §8, 02b §8 (W0.6, Q-3): the 02 shell — hash routes to the lane slots (shell/routes.tsx, shell/slots.tsx), the
// socket's catch_up / event frames on the live bus (shell/live.ts), the branch settings (shell/config.ts), the full
// effective permissions (§3.15), one toast bus, the queue (25b); all handed down by ShellContext.
// 02 combined wiring (task 28; IR-5, IR-7, IR-11, IR-12): the queue takes the branch auto-send window and the shell's
// unpair path; the queued-and-sent token card sits at the root (also over the sign-in screen, so a sign-in drain is
// caught); the idle lock gets the login's TTL and signs the page out; the late cards get every alert row (open and
// closed); a request_result row is told to the pending-comp store; the map's New order opens 02b's New order sheet.

const PORTRAIT = '(orientation: portrait) and (min-width: 761px)';
const PHONE = '(max-width: 760px)';
const TICK_MS = 15_000;
const SEEN_FLUSH_MS = 250;
const SEEN_BATCH = 50;

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
  /** 02a §3.15: the whole Resolution per permission (grant + scope), from /queries/session */
  permissions: Record<string, Resolution> | null;
  /** 02b §8 Device idle lock: the login reply's idle_ttl_ms */
  idleTtlMs: number;
}


export interface StaffAppProps {
  device: Device;
  meta: PageMeta;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  createSocket?: (url: string) => SocketLike;
  sink?: AudioSink;
  timers?: Timers;
  /** 02a §8 Login (tests): forget the pairing keys; default `wipeDeviceKeys` of the pairing store */
  wipeKeys?: () => Promise<void>;
  /** 02a §8 Login (tests): where PairAgain's button goes; default `location.assign` */
  goToPair?: (path: string) => void;
}

export function StaffApp({ device, meta, fetch, createSocket, sink, timers, wipeKeys, goToPair }: StaffAppProps) {
  const phone = useMedia(PHONE);
  const portrait = useMedia(PORTRAIT);
  const route = useHashRoute();
  const [me, setMe] = useState<Me | null>(null);
  const meRef = useRef<Me | null>(null);
  meRef.current = me;
  const signOutRef = useRef<() => void>(() => {});
  // 02a §8 Login (Q-13): the hub no longer knows this device (roster 401 / 403, socket close 4403)
  const unpairRef = useRef<() => void>(() => {});
  const [unpaired, setUnpaired] = useState(false);
  const [wipe, setWipe] = useState<'pending' | 'done' | 'failed'>('pending');
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
  // 02 shell services (W0.6)
  const liveBus = useMemo(() => createLiveBus(), []);
  const toasts = useMemo(() => createToastBus(), []);
  const tablesApi = useMemo(() => createTablesApi(api), [api]);
  const ordersApi = useMemo(() => createOrdersApi(api), [api]);
  const localFlags = useMemo(() => createLocalFlags(), []);
  const shellConfig = useMemo(() => createShellConfig({ load: () => api.query<BranchConfigReply | null>('/queries/branch-config'), live: liveBus }), [api, liveBus]);
  useEffect(() => () => shellConfig.dispose(), [shellConfig]);
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
        onFrame: (frame) => liveBus.frame(frame),
        onEnded: (code, reason) => {
          if (code === 4409 || reason === REPLACED_REASON) setReplaced(true);
          else if (code === 4401) signOutRef.current();
          else if (code === 4403) unpairRef.current();
        },
      }),
    [device, socketStore, timers, createSocket, liveBus],
  );
  useEffect(() => () => conn.dispose(), [conn]);
  useEffect(() => () => store.dispose(), [store]);

  const snap = useSyncExternalStore(store.subscribe, store.snapshot);
  const up = useSyncExternalStore(conn.subscribe, () => conn.isUp());
  const mode = useSyncExternalStore(conn.subscribe, () => conn.mode());
  // the live bus hears the socket go down and come back (reconnect) and the page become visible again
  useEffect(() => liveBus.connection(up), [up, liveBus]);
  useEffect(() => {
    const onVisibility = () => liveBus.visibility(document.visibilityState);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [liveBus]);

  // S47: the hub's clock from the page (no device zone)
  const [clock, setClock] = useState(() => createHubClock({ now_ms: meta.hubNowMs, utc_offset_ms: meta.utcOffsetMs }));
  const [nowMs, setNow] = useState(() => clock.nowMs());
  useEffect(() => {
    setNow(clock.nowMs());
    const timer = setInterval(() => setNow(clock.nowMs()), TICK_MS);
    return () => clearInterval(timer);
  }, [clock]);
  const offset = clock.utcOffsetMs;
  const clockRef = useRef(clock);
  clockRef.current = clock;
  // 02b §3.12 (task 28 wiring): the branch auto-send window from the shell config (null until read → the 01a default);
  // 403 DEVICE_REVOKED → the shell's unpair path (hub-admin wipeDeviceKeys, PairAgain; the queue is kept)
  const enqueue = useMemo(
    () =>
      createEnqueue({
        api,
        device,
        clock: () => clockRef.current,
        live: liveBus,
        maxAgeMs: () => shellConfig.config()?.queue_auto_send_max_ms ?? null,
        onDeviceRevoked: () => unpairRef.current(),
      }),
    [api, device, liveBus, shellConfig],
  );
  const shellHooks = useMemo(() => createShellHooks(enqueue), [enqueue]);
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

  // 02b §8 Table view (task 28 wiring, as 23b's handovers): a request_result row reaching the page makes the pending-comp
  // store read my-requests once per alert (a comp answered elsewhere leaves its waiting card)
  const resultIds = me === null ? '' : snap.rows.filter((r) => r.kind === 'request_result').map((r) => r.alert_id).join(',');
  const resultsTold = useRef(new Set<string>());
  useEffect(() => {
    if (resultIds === '') return;
    const fresh = resultIds.split(',').filter((id) => !resultsTold.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) resultsTold.current.add(id);
    void pendingCompsOf({ orders: ordersApi, live: liveBus }).resultSeen();
  }, [resultIds, ordersApi, liveBus]);

  // ------------------------------------------------------------------------------------------ session
  const signedIn = async (who: SignedIn) => {
    sessionGen.current += 1;
    const gen = sessionGen.current;
    setReplaced(false);
    conn.setSession(who.session_token);
    setInboxLoading(true);
    setMe({ staffId: who.staff_id, name: who.display_name, allowed: new Set(), permissions: null, idleTtlMs: who.idle_ttl_ms });
    // §3.7: a sign-in refreshes the header; the hub's own deadline (session end + 2 h) replaces this one when it sends it
    setBoundName(who.display_name);
    setBindingUntil(clock.nowMs() + ALERT_CONSTANTS.binding_route_idle_ms);
    // 02a §8 / handoff 02-S03: the staff app lands on the table map; the cashier kiosk on its home (#/ = KioskHome)
    navigate(device.type === 'cashier_kiosk' ? '/' : '/tables');
    const [info, time] = await Promise.all([api.session(), api.hubTime(), shellConfig.refresh()]);
    if (gen !== sessionGen.current) return;
    // S47: re-sync the hub clock from branch-config hub_time (the page's clock is from when it loaded)
    if (time.ok && time.data !== null) setClock(createHubClock(time.data));
    if (info.ok) {
      const allowed = new Set(Object.entries(info.data.permissions).filter(([, r]) => r.grant === 'allowed').map(([p]) => p));
      setMe((m) => (m === null || m.staffId !== who.staff_id ? m : { ...m, allowed, permissions: info.data.permissions }));
    }
    void loadInbox(null);
    const people = await api.roster();
    if (gen === sessionGen.current && people.ok) setRoster(people.data.staff);
  };

  const signOut = useCallback(
    (callHub: boolean) => {
      sessionGen.current += 1;
      setOpened(null);
      setNewOrder(false);
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
  // the pairing keys go (the command queue and the drafts stay), the session and the socket end, PairAgain shows
  unpairRef.current = () => {
    if (unpaired) return;
    sessionGen.current += 1;
    setOpened(null);
    setCloses(new Map());
    setRequests([]);
    setCursor(null);
    setMe(null);
    setBindingUntil(null);
    api.drop();
    conn.dispose();
    setUnpaired(true);
    setWipe('pending');
    (wipeKeys ?? wipeDeviceKeys)().then(
      () => setWipe('done'),
      () => setWipe('failed'),
    );
  };
  const onUnpaired = useCallback(() => unpairRef.current(), []);

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
  // 02a §8 Table map (IR-5): the map's New order opens 02b's New order sheet (Takeaway · Parking)
  const [newOrder, setNewOrder] = useState(false);
  const lastOpened = useRef<AlertRow | RequestView | null>(null);
  const setToast = useCallback((t: Toast) => toasts.show(t), [toasts]);
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
  const staffRoute = matchStaffRoute(route, device.type);
  let page: ReactNode;
  if (unpaired) {
    page = <PairAgain wipe={wipe} {...(goToPair === undefined ? {} : { go: goToPair })} />;
  } else if (me === null) {
    // F01 (frames LockKiosk, LockPhone): urgent lines first, then newest first (the store's order); up to 3
    const openRows = snap.rows.filter((r) => r.state === 'open');
    const lockRows =
      device.type === 'cashier_kiosk' || device.type === 'phone'
        ? [...openRows.filter((r) => r.family === 'urgent'), ...openRows.filter((r) => r.family !== 'urgent')].slice(0, 3)
        : [];
    page = (
      <SignIn
        api={api}
        phone={phone}
        lockPanel={lockRows.length === 0 ? null : <LockPanel rows={lockRows} utcOffsetMs={offset} />}
        hooks={shellHooks}
        onUnpaired={onUnpaired}
        onSignedIn={(who) => void signedIn(who)}
      />
    );
  } else if (staffRoute.name === 'me') {
    page = <MeTab name={me.name} onSignOut={() => signOut(true)} />;
  } else if (isSlotRoute(staffRoute)) {
    page = <RouteSlot route={staffRoute} alertRows={snap.rows} onNewOrder={() => setNewOrder(true)} />;
  } else if (route === '/requests' && showRequests) {
    page = <RequestsToAnswer rows={views} nowMs={nowMs} utcOffsetMs={offset} onOpen={open} />;
  } else if (route === '/test-alert' && showTest) {
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
  const lang = language();

  // 02a §8 Top bar (IR-3): the floor control lists the map store's floors with their table counts; the choice is the hash
  // query #/tables?floor=<id> (absent = all). Shown on the map and its sheet (phone: the map draws floor chips itself).
  const mapStore = useMemo(() => sharedMapStore(tablesApi, liveBus), [tablesApi, liveBus]);
  const mapNow = useSyncExternalStore(mapStore.subscribe, mapStore.current);
  const lastFloor = useRef<string | null>(null);
  if (route.startsWith('/tables') && !route.startsWith('/tables/')) lastFloor.current = floorOf(route);
  const floors =
    me !== null && !phone && (staffRoute.name === 'tables' || staffRoute.name === 'table')
      ? {
          choices: (mapNow?.floors ?? []).filter((f) => !f.archived).map((f) => ({ floor_id: f.floor_id, name: f.name ?? '', count: f.zones.reduce((n, z) => n + z.tables.length, 0) })),
          selected: lastFloor.current,
          onSelect: (floor_id: string) => navigate(floorHref(floor_id)),
        }
      : null;
  const phoneTab = phoneTabOf(staffRoute);
  const phoneTitle = phoneTab === 'tables' ? t('tabs.tables') : phoneTab === 'orders' ? t('tabs.orders') : phoneTab === 'me' ? t('tabs.me') : t('alerts.nav.inbox');
  const body = (
    <div className={`pu v-brand staff${phone ? ' phone' : ''}`} lang={lang} dir={lang === 'ur' ? 'rtl' : 'ltr'} data-theme="light">
      <TopBar
        phone={phone}
        portrait={portrait}
        brandName={meta.branchName}
        deviceLine={`${meta.branchName} · ${deviceWord}`}
        bind={device.type === 'tablet' ? <BindingHeader binding={binding} nowMs={clock.nowMs} utcOffsetMs={offset} timers={timers ?? browserTimers} sink={sink ?? browserSink} /> : null}
        floors={floors}
        live={live}
        clock={timeText(nowMs, offset)}
        person={me === null ? null : { name: me.name }}
        requests={showRequests ? answerable : null}
        inbox={snap.unseen}
        testAlert={showTest}
        title={me === null ? meta.branchName : phoneTitle}
        phoneSub={
          me === null ? (
            `${meta.branchName} · ${deviceWord}`
          ) : (
            <>
              <Ico name={up ? 'wifi' : 'wifioff'} className={`ico--15 ${up ? 'ico--ok' : 'ico--danger'}`} />
              {t(up ? 'alerts.live' : 'alerts.hub_offline')} · <span className="num">{timeText(nowMs, offset)}</span>
            </>
          )
        }
        onNavigate={navigate}
        onSignOut={() => signOut(true)}
      />
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
      {phone && me !== null && <PhoneTabs current={phoneTab} inbox={snap.unseen} />}
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
      {me !== null && (
        <>
          <HandoverLayer />
          <IdleLock {...(fetch === undefined ? {} : { fetch })} />
          {newOrder && <NewOrderSheet onClose={() => setNewOrder(false)} />}
        </>
      )}
      {/* IR-7: at the root, above the sign-in screen: a sign-in drain or a reconnect send shows its token here */}
      <QueuedSentCard />
      <ToastView bus={toasts} />
    </div>
  );
  const shell: Shell = {
    device,
    meta,
    api,
    tables: tablesApi,
    orders: ordersApi,
    live: liveBus,
    config: shellConfig,
    permissions: createPermissions(me?.permissions ?? null),
    toasts,
    enqueue,
    localFlags,
    clock,
    me: me === null ? null : { staff_id: me.staffId, name: me.name },
    online: up,
    phone,
    portrait,
    idleTtlMs: me?.idleTtlMs ?? null,
    signOut: () => signOut(false),
  };
  // IR-11: the late cards read every alert row the page holds, open and closed (a slip closed without ItemsReleased)
  return (
    <ShellContext.Provider value={shell}>
      <LateAlertsContext.Provider value={snap.rows as readonly LateAlertRow[]}>{body}</LateAlertsContext.Provider>
    </ShellContext.Provider>
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

/** 02a §8 Top bar, phone: which tab a route belongs to. */
function phoneTabOf(route: ReturnType<typeof matchStaffRoute>): PhoneTab {
  switch (route.name) {
    case 'tables':
    case 'table':
      return 'tables';
    case 'order':
      return route.order_type === 'dine_in' ? 'tables' : 'orders';
    case 'orders':
    case 'order_view':
    case 'held':
    case 'zones':
    case 'queue':
    case 'kiosk_home':
      return 'orders';
    case 'me':
      return 'me';
    default:
      return 'inbox';
  }
}
