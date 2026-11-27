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
import { billQuery } from '../billing/api';
import { BillScreen, billRefOfSearch } from '../billing/BillScreen';
import { OpenBills } from '../billing/OpenBills';
import { ShiftScreen } from '../billing/ShiftScreen';
import { ReportsScreen } from '../billing/ReportsScreen';
import { DayCloseScreen } from '../billing/DayCloseScreen';
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
import { createStaffApi, type Device, type PageMeta, type Resolution, type RosterPerson, type SessionInfo, type SignedIn } from './api';
import { SignIn } from './SignIn';
import { createOrdersApi } from './orders/api';
import { CustomerDisplay } from './orders/customer-display/CustomerDisplay';
import { DISPLAY_CHANNEL, DISPLAY_ROUTE } from './orders/customer-display/channel';
import { pendingCompsOf } from './orders/actions/pending-comps';
import { unpaidRequestsOf } from './orders/unpaid/requests';
import { LateAlertsContext, type LateAlertRow } from './orders/late/late-groups';
import { IdleLock } from './orders/lock/IdleLock';
import { letLeavePass } from './orders/order-screen/leave-pass';
import { NewOrderSheet } from './orders/new-order/NewOrderSheet';
import { QueuedSentCard } from './orders/queue/QueuedSentCard';
import { createEnqueue } from './orders/queue/enqueue';
import { createShellHooks } from './orders/queue/shell-hooks';
import { createShellConfig, type BranchConfigReply } from './shell/config';
import { createContextSlot } from './shell/context-slot';
import { createRushSlot } from './shell/rush-slot';
import { createBarSlot } from './shell/bar-slot';
import { readOwnShift, shiftEvent, type OwnShift } from './shell/own-shift';
import { ShellBanners } from './shell/ShellBanners';
import { createDayWatch } from './orders/order-screen/day-open';
import { canStartDay } from './orders/order-screen/DayNotStarted';
import { money } from './orders/money';
import { ShellContext, type Shell } from './shell/hooks';
import { createLiveBus } from './shell/live';
import { createPermissions } from './shell/permissions';
import { pendingVoidsOf } from '../voids/pending';
import { PHONE_QUERY, PORTRAIT_QUERY } from './shell/layout';
import { ManagerScreen } from './shell/ManagerScreen';
import { fallbackScreens, homeOf, landingOf, rememberTab, screenOfPath, tabsOf, visibleScreens } from './shell/screens';
import { consumeFocus, matchStaffRoute, routePath, withoutFocus } from './shell/routes';
import { isSlotRoute, RouteSlot } from './shell/slots';
import { createToastBus, ToastView } from './shell/toast';
import { createTablesApi } from './tables/api';
import { HandoverLayer } from './tables/cards/HandoverLayer';
import { floorHref, floorOf } from './tables/map/filters';
import { sharedMapStore } from './tables/map/map-store';
import { PairAgain } from './tables/PairAgain';
import { createLocalFlags } from './tables/local-flags';
import { MeTab, PhoneTabs, type PhoneTab } from './tables/PhoneTabs';
import type { ScreenKey } from '@pos/domain';
import { TopBar } from './tables/TopBar';
import { createPrintSkipDismiss } from '../alerts/labels-03b';
import { AuditLog } from '../audit/AuditLog';
import { createDevicesApi } from '../devices/api';
import { DeviceList } from '../devices/DeviceList';
import { checkTarget } from '../alerts/deeplink-check';
import { tapAlert } from '../alerts/deeplink-tap';
import { dropHandover } from './orders/preload';
import type { OrdersCatchUp } from './orders/contracts';
import { LiveRegion } from '../alerts/LiveRegion';
import { PrintSkipContext, type PrintSkipCtx } from '../alerts/ui';
import { passLiveOf } from '../pass/live';
import { deviceContextOf, nativeBridge, needsAppUpdate, readStaffBuild, revokeNotice, staffBuildAction, type NativeBridge, type NativeState, type RevokeNoticeKey } from '../native/bridge';
import { DeviceHealth } from '../native/DeviceHealth';

// 01d task 41: the hub-served staff entry /staff/ (spec §8.1; hand-off PROMPT "Staff entry shell"). Maroon 80 px
// top bar: brand block (mark, branch, device; the third line is the B05 slot, task 42), the segmented nav
// Inbox · Requests (approvers) · Test alert (manage-devices), then Live / Hub offline, the clock and the person
// chip (sign out). Portrait: the nav on its own row. Kiosk: no browser back, the nav is the way back. Phone: a
// bottom tab bar Tables · Orders · Requests (approvers, Q-73) · Inbox · Me. The page is 100dvh; only the lists scroll. Dialogs,
// banners and the toast render inside the .pu root.
// 02a §8, 02b §8 (W0.6, Q-3): the 02 shell — hash routes to the lane slots (shell/routes.tsx, shell/slots.tsx), the
// socket's catch_up / event frames on the live bus (shell/live.ts), the branch settings (shell/config.ts), the full
// effective permissions (§3.15), one toast bus, the queue (25b); all handed down by ShellContext.
// 02 combined wiring (task 28; IR-5, IR-7, IR-11, IR-12): the queue takes the branch auto-send window and the shell's
// unpair path; the queued-and-sent token card sits at the root (also over the sign-in screen, so a sign-in drain is
// caught); the idle lock gets the login's TTL and signs the page out; the late cards get every alert row (open and
// closed); a request_result row is told to the pending-comp store; the map's New order opens 02b's New order sheet.
// 02b-TK A2 item 1 (frames ShellAnatomy, PersonMenu, DayNotStarted; MAPPING TK-SH01–03): the screen's context slot in
// the bar, the person chip's menu (Switch user = the name tiles + PIN with takeover, 00 HPA §6.9 M20; Lock = the idle
// lock now; My shift; Sign out — never one tap), the day / shift banners under the bar on the takeaway screens (the
// catch-up business day; 05 §6.16 own shift, 404 = none). Leaving the order screen holds its unsent cart (C1-5).

const TICK_MS = 15_000;
/** 05b M-13: the staff-build check besides every socket (re)connect */
const STAFF_BUILD_CHECK_MS = 600_000;
/** 05b M-18: the red bar after the alert service has been disconnected this long */
const ALERTS_DOWN_MS = 60_000;
/** 05b §3.5 (N-5): a kept device is checked again / its trigger retried after this */
const NATIVE_RETRY_MS = 5_000;
/** review B-client #1: after this many checks in a row the retry backs off to NATIVE_BACKOFF_MS */
const NATIVE_RETRY_TRIES = 5;
const NATIVE_BACKOFF_MS = 60_000;
/** 05b M-18: PosNative.health() is polled this often while the page is visible; no answer within the timeout = down */
const HEALTH_POLL_MS = 20_000;
const HEALTH_TIMEOUT_MS = 5_000;
/** 05b M-13: at sign-out the staff-build reload waits for the logout at most this long */
const SIGN_OUT_RELOAD_WAIT_MS = 3_000;
/** 05b M-21: the last device context this page sent (not a secret), so a page load can send it before sign-in */
const NATIVE_CONTEXT_KEY = 'pos-native-context';
/** 05b N-9: the page's token was offered to native through /pair once in this tab */
const NATIVE_OFFERED_KEY = 'pos-native-offered';

function storageGet(kind: 'local' | 'session', key: string): string | null {
  try {
    return (kind === 'local' ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}
function storageSet(kind: 'local' | 'session', key: string, value: string | null): void {
  try {
    const st = kind === 'local' ? window.localStorage : window.sessionStorage;
    if (value === null) st.removeItem(key);
    else st.setItem(key, value);
  } catch {
    // storage blocked: nothing kept
  }
}
type NativeContext = { always_on: boolean; language: string; lock_task: boolean };
function cachedContext(): NativeContext | null {
  try {
    const v = JSON.parse(storageGet('local', NATIVE_CONTEXT_KEY) ?? 'null') as Partial<NativeContext> | null;
    if (v === null || typeof v.always_on !== 'boolean' || typeof v.lock_task !== 'boolean') return null;
    return { always_on: v.always_on, lock_task: v.lock_task, language: typeof v.language === 'string' ? v.language : 'en' };
  } catch {
    return null;
  }
}
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

/** 05a §6.7: what `GET /queries/session` says of this device (null before sign-in, or on a hub that sends none) */
type DeviceView = NonNullable<SessionInfo['device']>;

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
  /** 05b §4.2: the tablet app's PosNative (tests inject a fake); default read from `window.Capacitor`; null = a browser */
  native?: NativeBridge | null;
  /** 05b M-13 (tests): this page's `pos-staff-build` meta; default read from the page */
  staffBuild?: string | null;
  /** 05b M-13 (tests): default `location.reload` */
  reload?: () => void;
}

export function StaffApp(props: StaffAppProps | { device?: undefined; utcOffsetMs?: number }) {
  const route = useHashRoute();
  if (route === DISPLAY_ROUTE) {
    return <CustomerDisplay utcOffsetMs={props.device === undefined ? props.utcOffsetMs ?? 0 : props.meta.utcOffsetMs} />;
  }
  return props.device === undefined ? null : <StaffSession {...props} />;
}

function StaffSession({ device, meta, fetch, createSocket, sink, timers, wipeKeys, goToPair, native: nativeProp, staffBuild: staffBuildProp, reload: reloadProp }: StaffAppProps) {
  // 05b §4.2: the bridge once per page (undefined → read from the window)
  const [native] = useState<NativeBridge | null>(() => (nativeProp === undefined ? nativeBridge() : nativeProp));
  const [pageBuild] = useState<string | null>(() => (staffBuildProp === undefined ? readStaffBuild() : staffBuildProp));
  const reloadPage = reloadProp ?? (() => window.location.reload());
  const nativeTimers = timers ?? browserTimers;
  const pairPath = goToPair ?? ((path: string) => window.location.assign(path));
  // 05b M-8: each (alert_id, step) the page shows is reported once
  const reported = useRef(new Set<string>());
  const phone = useMedia(PHONE_QUERY);
  const portrait = useMedia(PORTRAIT_QUERY);
  const route = useHashRoute();
  const [me, setMe] = useState<Me | null>(null);
  const [deviceView, setDeviceView] = useState<DeviceView | null>(null);
  const meRef = useRef<Me | null>(null);
  meRef.current = me;
  const signOutRef = useRef<() => void>(() => {});
  // 02a §8 Login (Q-13): the hub no longer knows this device (roster 401 / 403, socket close 4403)
  const unpairRef = useRef<() => void>(() => {});
  const wipeAndPairRef = useRef<() => void>(() => {});
  // 05b §3.5 (N-5, N-9): the confirmRevoked check (set below)
  const nativeCheckRef = useRef<() => void>(() => {});
  const [nativeNotice, setNativeNotice] = useState<RevokeNoticeKey | null>(null);
  // 05b M-13 / M-14 / M-18
  const [updateReady, setUpdateReady] = useState(false);
  const updateReadyRef = useRef(false);
  updateReadyRef.current = updateReady;
  const reloadRef = useRef(reloadPage);
  reloadRef.current = reloadPage;
  const [appUpdate, setAppUpdate] = useState(false);
  const [alertsDown, setAlertsDown] = useState(false);
  // a SignIn remount reads the roster again (a kept device's trigger retried, §3.5)
  const [signInKey, setSignInKey] = useState(0);
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
  // 01d v1.3.2 §3.13.3 (#253 review): every alert id seen closed by an alert_closed frame in this session, read
  // synchronously by a tap's state re-read (a request known only from requests-to-answer leaves that list on close)
  const closedSeen = useRef(new Set<string>());

  const api = useMemo(() => createStaffApi({ device, meta, fetch: hubFetch, onSignedOut: () => signOutRef.current() }), [device, meta, hubFetch]);
  // 02 shell services (W0.6)
  const liveBus = useMemo(() => createLiveBus(), []);
  // 03b W0.6 IR-17 / IR-17b: the page's one Pass live, made before the socket opens so it sees the first catch-up;
  // the socket's other frames (point_lines, station_takeover, station_notice, station_plan, printed_lines) reach it
  // through onFrame. Clock and api are read at call time (the clock is re-synced at sign-in).
  const apiRef = useRef(api);
  const landOnPass = useRef(false);
  apiRef.current = api;
  const pass = useMemo(() => passLiveOf({ live: liveBus, clock: { nowMs: () => clockRef.current.nowMs() }, api: { roster: () => apiRef.current.roster() } }), [liveBus]);
  const toasts = useMemo(() => createToastBus(), []);
  // 02b-TK TK-SH01: the context slot the screen on the route fills; the day watch for the banner under the bar
  const contextSlot = useMemo(() => createContextSlot(), []);
  const ctxValue = useSyncExternalStore(contextSlot.subscribe, contextSlot.get);
  // 02b-TK A2 item 4 (frame HomeRush): the takeaway screen's rush state; the Live pill is its toggle
  const rushSlot = useMemo(() => createRushSlot(), []);
  const rushValue = useSyncExternalStore(rushSlot.subscribe, rushSlot.get);
  // ⚠️ 03b v1.0.17 §8: the Pass's type tabs in the top bar
  const barSlot = useMemo(() => createBarSlot(), []);
  const barValue = useSyncExternalStore(barSlot.subscribe, barSlot.get);
  const dayWatch = useMemo(() => createDayWatch(liveBus), [liveBus]);
  useEffect(() => () => dayWatch.dispose(), [dayWatch]);
  const dayOpen = useSyncExternalStore(dayWatch.subscribe, dayWatch.state);
  // 02b-TK TK-SH02: Switch user (the name tiles over the signed-in page); Lock screen (each tap a new value)
  const [switching, setSwitching] = useState(false);
  const [lockTick, setLockTick] = useState(0);
  const tablesApi = useMemo(() => createTablesApi(api), [api]);
  const ordersApi = useMemo(() => createOrdersApi(api), [api]);
  const localFlags = useMemo(() => createLocalFlags(), []);
  const shellConfig = useMemo(() => createShellConfig({ load: () => api.query<BranchConfigReply | null>('/queries/branch-config'), live: liveBus }), [api, liveBus]);
  useEffect(() => () => shellConfig.dispose(), [shellConfig]);
  const store = useMemo(() => createAlertStore({ sink: sink ?? browserSink, timers: timers ?? browserTimers, alwaysOn: device.type === 'cashier_kiosk' }), [sink, timers, device.type]);
  const [replaced, setReplaced] = useState(false);
  // every alert_closed frame, also for requests the store does not hold (seen only through requests-to-answer)
  const [closes, setCloses] = useState<ReadonlyMap<string, WsAlertClosed>>(new Map());
  // 04 §8 Pending tag (ruling Q1 (a) on #232): a void request raised, answered, withdrawn or closed reaches this page as
  // an 01d `alert` / `alert_closed` frame; the pending-voids store reads its orders again (the page's latest shell)
  const voidShell = useRef<Shell | null>(null);
  const reloadVoids = () => {
    if (voidShell.current !== null) void pendingVoidsOf(voidShell.current).reload();
  };
  const socketStore = useMemo<AlertStore>(
    () => ({
      ...store,
      onAlert(view) {
        store.onAlert(view);
        if (view.kind === 'void_approval' || view.kind === 'request_result') reloadVoids();
      },
      onClosed(frame) {
        closedSeen.current.add(frame.alert_id);
        store.onClosed(frame);
        setCloses((m) => new Map(m).set(frame.alert_id, frame));
        reloadVoids();
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
        // 05b D-2: inside the app the page never opens alert mode (AlertService holds it)
        nativeShell: native !== null,
        onShown: (row) => {
          if (native === null) return;
          const key = `${row.alert_id}:${row.step}`;
          if (reported.current.has(key)) return;
          reported.current.add(key);
          void native.reportShown({ alert_id: row.alert_id, step: row.step });
        },
        onFrame: (frame) => {
          liveBus.frame(frame);
          pass.frame(frame);
          // 05a §6.4 step 6, C-1: the device's profile changed; the tabs redraw
          if (frame.type === 'device_profile') {
            setDeviceView((v) => ({ device_id: v?.device_id ?? device.id, screens: frame.screens, access: frame.access, point_id: frame.point_id }));
          }
          // AD-K12 / W-3: the landing is for arrival only; a first catch-up with no point_view ends it
          if (frame.type === 'catch_up' && pass.store.snapshot().view === null) landOnPass.current = false;
        },
        onEnded: (code, reason) => {
          if (code === 4409 || reason === REPLACED_REASON) setReplaced(true);
          else if (code === 4401) {
            signOutRef.current();
            // 05b §3.5 (N-5): a session-socket 4401 is an unpair trigger inside the app too
            if (native !== null) nativeCheckRef.current();
          } else if (code === 4403) unpairRef.current();
        },
      }),
    [device, socketStore, timers, createSocket, liveBus, pass, native],
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
  const inboxRefresh = useRef<() => void>(() => {});
  inboxRefresh.current = () => void loadInbox(null);
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
  // 01d v1.3 §3.13.2 rule 3 (m10, G-1): one MarkAlertsSeen per alert per session; a repeated tap (it navigates and
  // glows again) sends none while the first send is queued, in flight or answered ok. A failed send removes the id,
  // so the next tap sends it again. Cleared with the session (sign-in, sign-out, unpair), as store.reset
  const seenSent = useRef(new Set<string>());
  const markSeen = (id: string) => {
    if (seenSent.current.has(id)) return;
    seenSent.current.add(id);
    if (!seenQueue.current.includes(id)) seenQueue.current.push(id);
    if (seenTimer.current !== null) return;
    seenTimer.current = setTimeout(() => {
      seenTimer.current = null;
      const ids = seenQueue.current.splice(0);
      for (let i = 0; i < ids.length; i += SEEN_BATCH) {
        const batch = ids.slice(i, i + SEEN_BATCH);
        const gen = sessionGen.current;
        // a failed send leaves the set, so a later tap sends it again; an ok reply keeps it (once per alert)
        void api.markSeen(batch).then((answer) => {
          if (!answer.ok && gen === sessionGen.current) for (const id of batch) seenSent.current.delete(id);
        });
      }
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
    // ⚠️ 02b-TK L-CLIENT-2 item 4 (02b v1.0.25 §3.7a, 01d To 02b): the requester's unpaid hand-over result
    void unpaidRequestsOf({ live: liveBus, api }).resultSeen();
  }, [resultIds, ordersApi, liveBus, api]);

  // ------------------------------------------------------------------------------------------ session
  /** The session read's permissions (with `masked`) and device profile, for the person `staffId` (a stale reply is dropped). */
  const applySession = useCallback((staffId: string, info: SessionInfo) => {
    const allowed = new Set(Object.entries(info.permissions).filter(([, r]) => r.grant === 'allowed').map(([p]) => p));
    setMe((m) => (m === null || m.staffId !== staffId ? m : { ...m, allowed, permissions: info.permissions }));
    setDeviceView(info.device ?? null);
  }, []);
  // 05a §10 RF-5, C-1: a `device_profile` push missed while offline is not replayed; after a reconnect the session read
  // gives the current screens (and the masked permissions), so the tabs redraw without it
  useEffect(
    () =>
      liveBus.subscribe((msg) => {
        const who = meRef.current;
        if (msg.kind !== 'reconnect' || who === null) return;
        const gen = sessionGen.current;
        void api.session().then((info) => {
          if (gen === sessionGen.current && info.ok) applySession(who.staffId, info.data);
        });
      }),
    [liveBus, api, applySession],
  );

  const signedIn = async (who: SignedIn) => {
    sessionGen.current += 1;
    setSwitching(false);
    closedSeen.current.clear();
    seenSent.current.clear();
    dropHandover(); // dl cp6: a held tap read never outlives the session
    const gen = sessionGen.current;
    setReplaced(false);
    conn.setSession(who.session_token);
    setInboxLoading(true);
    setMe({ staffId: who.staff_id, name: who.display_name, allowed: new Set(), permissions: null, idleTtlMs: who.idle_ttl_ms });
    // §3.7: a sign-in refreshes the header; the hub's own deadline (session end + 2 h) replaces this one when it sends it
    setBoundName(who.display_name);
    setBindingUntil(clock.nowMs() + ALERT_CONSTANTS.binding_route_idle_ms);
    // 05a §3.6, §8 C-1: the landing is the last tab, else the first screen of the device's profile, known once the
    // session read answers (below). 03b W0.6 (handoff Q-6): with no profile, a Pass tablet (point_view in the catch-up)
    // lands on the Pass; the socket opens with the session, so its catch-up usually comes after this: the effect below
    // moves the landing then.
    // 01d v1.3.2 §3.13.4 (9b, test 91): only the 9b form, #/inbox?focus=alert:<id> (a notification tap while signed
    // out), is kept through the sign-in: no landing, so the Inbox glows that card. Any other focus lands as today.
    const landing = matchStaffRoute(window.location.hash.replace(/^#/, ''));
    const keepFocus = landing.name === 'inbox' && landing.focus?.kind === 'alert';
    landOnPass.current = false;
    const [info, time] = await Promise.all([api.session(), api.hubTime(), shellConfig.refresh()]);
    if (gen !== sessionGen.current) return;
    // S47: re-sync the hub clock from branch-config hub_time (the page's clock is from when it loaded)
    if (time.ok && time.data !== null) setClock(createHubClock(time.data));
    if (info.ok) {
      applySession(who.staff_id, info.data);
      if (!keepFocus) {
        const profile = info.data.device;
        if (profile === undefined || profile === null) {
          // a hub with no profile: today's landing (the Pass on a point tablet, once the catch-up says so)
          const fb = fallbackScreens(device.type, pass.store.snapshot().view !== null);
          landOnPass.current = !fb.includes('pass') && liveBus.lastSeq() < 0;
          navigate(landingOf(device.id, visibleScreens(fb, createPermissions(info.data.permissions))));
        } else {
          navigate(landingOf(device.id, visibleScreens(profile.screens, createPermissions(info.data.permissions))));
        }
      }
    } else if (!keepFocus) {
      navigate('/inbox');
    }
    void loadInbox(null);
    const people = await api.roster();
    if (gen === sessionGen.current && people.ok) setRoster(people.data.staff);
  };

  const signOut = useCallback(
    (callHub: boolean) => {
      sessionGen.current += 1;
      closedSeen.current.clear();
      seenSent.current.clear();
      dropHandover(); // dl cp6: a held tap read never outlives the session
      consumeFocus(); // §3.13.4 (#264 review): no focus of this person's carries into the next sign-in
      setOpened(null);
      setNewOrder(false);
      setSwitching(false);
      setCloses(new Map());
      setRequests([]);
      setCursor(null);
      setMe(null);
      setDeviceView(null);
      let loggedOut: Promise<unknown> = Promise.resolve();
      if (callHub) {
        loggedOut = api.signOut();
        setBindingUntil(null); // a logout ends the binding (§3.7); an idle sign-out keeps it
      }
      else api.drop();
      conn.setSession(null);
      // 05b M-13: a newer staff build waited for this sign-out; the logout reaches the hub first (at most 3 s), so a
      // reload never leaves the session open on the hub
      if (updateReadyRef.current) {
        let done = false;
        const go = () => {
          if (done) return;
          done = true;
          nativeTimers.clearTimeout(wait);
          reloadRef.current();
        };
        const wait = nativeTimers.setTimeout(go, SIGN_OUT_RELOAD_WAIT_MS);
        void loggedOut.then(go, go);
      }
    },
    [api, conn, nativeTimers],
  );
  signOutRef.current = () => signOut(false);
  // the pairing keys go (the command queue and the drafts stay), the session and the socket end, PairAgain shows
  // review #193: a ref, not the state — a queue revoke and a socket 4403 in the same tick wipe once
  const unpairedRef = useRef(false);
  // 05b §3.4 / §3.5: inside the app every way to /pair goes through here, once per page
  const pairedOnce = useRef(false);
  const goPairOnce = () => {
    if (pairedOnce.current) return;
    pairedOnce.current = true;
    pairPath('/pair');
  };
  // 05b §3.5 (N-5): inside the app every unpair trigger asks native first; only `revoked: true` wipes
  unpairRef.current = () => {
    if (native === null) wipeAndPair();
    else nativeCheckRef.current();
  };
  const wipeAndPair = () => {
    if (unpairedRef.current) return;
    unpairedRef.current = true;
    sessionGen.current += 1;
    closedSeen.current.clear();
    seenSent.current.clear();
    dropHandover(); // dl cp6: a held tap read never outlives the session
    consumeFocus(); // §3.13.4 (#264 review): no focus of this person's carries into the next sign-in
    setOpened(null);
    setNewOrder(false);
    setSwitching(false);
    setCloses(new Map());
    setRequests([]);
    setCursor(null);
    setMe(null);
    setBindingUntil(null);
    api.drop();
    conn.dispose();
    setUnpaired(true);
    setWipe('pending');
    // M-17 / M-21: the device context this page sent belongs to the old pairing
    storageSet('local', NATIVE_CONTEXT_KEY, null);
    (wipeKeys ?? wipeDeviceKeys)().then(
      () => {
        setWipe('done');
        // 05b §3.4: inside the app a confirmed revoke goes straight to /pair (no page keys left)
        if (native !== null) goPairOnce();
      },
      () => setWipe('failed'),
    );
  };
  wipeAndPairRef.current = wipeAndPair;
  const onUnpaired = useCallback(() => unpairRef.current(), []);

  // ------------------------------------------------------------------------------------- 05b native shell
  // M-21: setSession at load and on every change of the signed-in person (sign-in, sign-out, idle, takeover, 4401)
  const sessionMsg: { signed_in: boolean; staff_id?: string } = me === null ? { signed_in: false } : { signed_in: true, staff_id: me.staffId };
  const sessionRef = useRef(sessionMsg);
  sessionRef.current = sessionMsg;
  const meKey = me?.staffId ?? null;
  useEffect(() => {
    if (native !== null) void native.setSession(sessionRef.current);
  }, [native, meKey]);
  // M-21: setDeviceContext from the 05a device block (session read, /auth/pin, device_profile push); at a page load
  // before any sign-in, the last context this page sent (native keeps its own copy too, N-1)
  const lastCtx = useRef<NativeContext | null>(null);
  const sentCtx = useRef<string | null>(null);
  const [loadedCtx] = useState(() => cachedContext());
  if (lastCtx.current === null && loadedCtx !== null) lastCtx.current = { ...loadedCtx, language: language() };
  const sendCtx = useCallback(
    (force: boolean) => {
      const c = lastCtx.current;
      if (native === null || c === null) return;
      const key = JSON.stringify(c);
      if (!force && key === sentCtx.current) return;
      sentCtx.current = key;
      void native.setDeviceContext(c);
    },
    [native],
  );
  const deviceCtx = deviceView === null ? null : deviceContextOf(deviceView, language());
  const deviceCtxKey = deviceCtx === null ? null : JSON.stringify(deviceCtx);
  useEffect(() => {
    if (native === null) return;
    if (deviceCtxKey !== null) {
      lastCtx.current = JSON.parse(deviceCtxKey) as NativeContext;
      storageSet('local', NATIVE_CONTEXT_KEY, deviceCtxKey);
    }
    sendCtx(false);
  }, [native, deviceCtxKey, sendCtx]);

  // §3.5 (N-5, N-9): one confirmRevoked at a time; revoked → wipe + /pair; kept → the 00 §8.4 text, checked again
  const checking = useRef(false);
  const nativeRetry = useRef<unknown>(null);
  // checks in a row without a confirmed answer; reset once the session socket is up again (the device works)
  const nativeTries = useRef(0);
  useEffect(() => {
    if (!up || native === null) return;
    nativeTries.current = 0;
    setNativeNotice(null);
  }, [up, native]);
  nativeCheckRef.current = () => {
    if (native === null || checking.current || unpairedRef.current) return;
    checking.current = true;
    void native.confirmRevoked().then((r) => {
      checking.current = false;
      if (unpairedRef.current) return;
      if (r?.revoked === true) {
        setNativeNotice(null);
        wipeAndPairRef.current();
        return;
      }
      // N-9: native holds no token while the page still has its keys: offer them once (the pair page's resumePaired
      // calls setDeviceToken, which is allowed on /pair only); after that, the cannot-confirm notice
      if (r?.reason === 'NO_NATIVE_TOKEN' && storageGet('session', NATIVE_OFFERED_KEY) === null) {
        storageSet('session', NATIVE_OFFERED_KEY, '1');
        goPairOnce();
        return;
      }
      nativeTries.current += 1;
      const reasonNotice = revokeNotice(r === null ? 'no_answer' : r.reason);
      // the hub answered and native's token stands: the trigger is retried; a keep that lasts (the trigger keeps
      // coming back) is shown, never a silent loop
      const hubAnswered = reasonNotice === null;
      setNativeNotice(hubAnswered && nativeTries.current >= 2 ? 'native.notice.cannot_confirm' : reasonNotice);
      if (nativeRetry.current !== null) return;
      // review B-client #1: 5 s for the first tries, then 60 s
      const delay = nativeTries.current >= NATIVE_RETRY_TRIES ? NATIVE_BACKOFF_MS : NATIVE_RETRY_MS;
      nativeRetry.current = nativeTimers.setTimeout(() => {
        nativeRetry.current = null;
        if (!hubAnswered) nativeCheckRef.current();
        else {
          conn.retry();
          setSignInKey((k) => k + 1);
        }
      }, delay);
    });
  };
  useEffect(
    () => () => {
      if (nativeRetry.current !== null) nativeTimers.clearTimeout(nativeRetry.current);
    },
    [nativeTimers],
  );

  // §4.2 `state`: needs_context (N-1), paired: false (§3.5, N-9), the alert socket for the red bar (M-18)
  const [socketState, setSocketState] = useState<NativeState['alert_socket'] | null>(null);
  const gotState = useRef(false);
  const pairedFalseRef = useRef<() => void>(() => {});
  pairedFalseRef.current = () => {
    if (unpairedRef.current) {
      if (wipe === 'done') goPairOnce(); // no page keys left
      return;
    }
    nativeCheckRef.current();
  };
  useEffect(() => {
    if (native === null) return;
    const off = native.onState((st) => {
      gotState.current = true;
      if (st.needs_context === true) {
        void native.setSession(sessionRef.current);
        sendCtx(true);
      }
      if (st.alert_socket === 'up' || st.alert_socket === 'connecting' || st.alert_socket === 'down') setSocketState(st.alert_socket);
      if (st.paired === true) storageSet('session', NATIVE_OFFERED_KEY, null);
      if (st.paired === false) pairedFalseRef.current();
    });
    // M-18: until the first state event, the service's own answer
    void native.health().then((h) => {
      if (h === null || gotState.current) return;
      setSocketState(h.service_connected ? (h.alert_socket ?? 'down') : 'down');
    });
    // M-14: an app older than this page → "Update the app" and an update check
    void native.info().then((info) => {
      if (!needsAppUpdate(info)) return;
      setAppUpdate(true);
      void native.checkForUpdate();
    });
    return off;
  }, [native, sendCtx]);
  // M-18: health() every 20 s while the page is visible — the state event stops when :alerts dies, so the page asks;
  // service_connected false, a rejection (null) or no answer within 5 s is down
  const [healthDown, setHealthDown] = useState(false);
  useEffect(() => {
    if (native === null) return;
    let stopped = false;
    let gen = 0;
    let next: unknown = null;
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const poll = () => {
      gen += 1;
      const mine = gen;
      let settled = false;
      const settle = (down: boolean) => {
        if (settled || stopped || mine !== gen) return;
        settled = true;
        nativeTimers.clearTimeout(timeout);
        setHealthDown(down);
      };
      const timeout = nativeTimers.setTimeout(() => settle(true), HEALTH_TIMEOUT_MS);
      void native.health().then(
        (h) => settle(h === null || h.service_connected !== true),
        () => settle(true),
      );
    };
    const schedule = () => {
      next = nativeTimers.setTimeout(() => {
        next = null;
        if (!visible()) return;
        poll();
        schedule();
      }, HEALTH_POLL_MS);
    };
    const onVisibility = () => {
      if (next !== null) nativeTimers.clearTimeout(next);
      next = null;
      if (!visible()) return;
      poll();
      schedule();
    };
    if (visible()) schedule(); // the first answer is the load-time health() above
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      if (next !== null) nativeTimers.clearTimeout(next);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [native, nativeTimers]);
  const alertsNotUp = healthDown || (socketState !== null && socketState !== 'up');
  useEffect(() => {
    if (!alertsNotUp) {
      setAlertsDown(false);
      return;
    }
    const h = nativeTimers.setTimeout(() => setAlertsDown(true), ALERTS_DOWN_MS);
    return () => nativeTimers.clearTimeout(h);
  }, [alertsNotUp, nativeTimers]);

  // M-13 (O-17): tablets only — the page's build against the hub's, at load, on every socket (re)connect, every 10 min
  const checkBuild = useCallback(async () => {
    if (native === null || pageBuild === null) return;
    let hubBuild: unknown;
    try {
      const res = await (fetch ?? ((input: string) => window.fetch(input)))('/health');
      const body = (await res.json()) as { data?: { staff_build?: unknown } } | null;
      hubBuild = body?.data?.staff_build ?? null;
    } catch {
      return;
    }
    const action = staffBuildAction({ native: true, pageBuild, hubBuild: typeof hubBuild === 'string' ? hubBuild : null, signedIn: meRef.current !== null });
    if (action === 'reload') reloadRef.current();
    else if (action === 'banner') setUpdateReady(true);
  }, [native, pageBuild, fetch]);
  useEffect(() => {
    if (native === null || pageBuild === null) return;
    void checkBuild();
    let handle: unknown = null;
    const loop = () => {
      handle = nativeTimers.setTimeout(() => {
        void checkBuild();
        loop();
      }, STAFF_BUILD_CHECK_MS);
    };
    loop();
    return () => nativeTimers.clearTimeout(handle);
  }, [native, pageBuild, checkBuild, nativeTimers]);
  const buildWasUp = useRef(false);
  useEffect(() => {
    if (up && !buildWasUp.current) void checkBuild();
    buildWasUp.current = up;
  }, [up, checkBuild]);

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
  const showRequests = requests.length > 0;
  // 05a §3.6, C-1: items follow the profile's screens and the masked permissions, never the width or the device type
  const permissions = useMemo(() => createPermissions(me?.permissions ?? null), [me?.permissions]);
  const hasPoint = useSyncExternalStore(pass.store.subscribe, () => pass.store.snapshot().view !== null);
  const profileScreens = useMemo(
    () => (deviceView === null ? fallbackScreens(device.type, hasPoint) : deviceView.screens),
    [deviceView, device.type, hasPoint],
  );
  const screens: ScreenKey[] = useMemo(() => (me === null ? [] : visibleScreens(profileScreens, permissions)), [me, profileScreens, permissions]);
  const has = (k: ScreenKey) => screens.includes(k);
  const tabs = useMemo(() => tabsOf(screens), [screens]);
  const showTest = has('manager') && allowed.has('manage-devices');
  // 04 §8 (VU2, R5): the audit log with view-audit-log granted outright (the hub refuses anything else), laptop and tablet
  const showAudit = has('manager') && allowed.has('view-audit-log');
  // 05a §8 (task 31): the device list, manage-devices unmasked (a listed device); width never decides (C-1)
  const showDevices = has('manager') && allowed.has('manage-devices');
  const devicesApi = useMemo(() => createDevicesApi(api), [api]);
  // 05 §8 Cashier screen (task 34, R5): the open-bills list with take-payment, kiosk and tablet
  const showBills = has('cashier') && allowed.has('take-payment');
  // 05 §8 Shift (task 39, R5): My shift with manage-own-shift granted outright (the hub's registry grant), every device
  const showShift = allowed.has('manage-own-shift');
  // 05 §8 Reports (task 42, R5): X and the Z list with view-reports, kiosk and tablet (frames at 1920 and 1280)
  const showReports = has('manager') && allowed.has('view-reports');
  // 05 §8 Day close (task 41, R5): close-business-day, kiosk and tablet (frames at 1920 and 1280)
  const showDayClose = has('manager') && allowed.has('close-business-day');
  // 03b W0.6: Pass first in the nav on a device whose catch-up has a point_view
  // AD-K12 / W-3: leaving the landing route ends the landing too (a late catch-up never moves a person mid-task)
  useEffect(() => {
    if (route !== '/tables') landOnPass.current = false;
  }, [route]);
  useEffect(() => {
    if (!hasPoint || me === null || !landOnPass.current) return;
    landOnPass.current = false;
    if (route === '/tables') navigate('/pass'); // only from the landing, never away from a screen the person chose
  }, [hasPoint, me, route]);
  // 03c §6.12 (Q-66): ONE DismissPrintSkip sender per signed-in session (keyed on its token), never per render, so a
  // send with no answer keeps its command_id for the next tap and a double tap shares one send; a 404 / 409 / 403
  // re-reads the inbox (the card shows its new state).
  const sessionToken = me === null ? null : api.sessionToken();
  const printSkipDismiss = useMemo(
    () => (sessionToken === null ? null : createPrintSkipDismiss((type, payload, id) => api.command(type, payload, { commandId: id }), () => void inboxRefresh.current())),
    [api, sessionToken],
  );
  const grantRelease = me?.permissions?.['force-release-table-lock'];
  const printSkip = useMemo<PrintSkipCtx | null>(
    () => (printSkipDismiss === null ? null : { grant: grantRelease, dismiss: printSkipDismiss, toast: (text) => toasts.show({ text, tone: 'warn' }) }),
    [printSkipDismiss, grantRelease, toasts],
  );

  // 01d v1.3.1 §3.13.2: a tap is current until the next tap, a session change (sessionGen) or a route change; a
  // stale tap's late check does nothing. The rows as of the last render, for the state re-read after the check.
  const tapGen = useRef(0);
  const liveRows = useRef({ views, held });
  liveRows.current = { views, held };
  // the deep link's own navigation (and its consumeFocus) is not a route change that makes its tap stale: a dine-in
  // slip still opens AnswerSheet when no LateCard renders (dl cs10, M3)
  const ownRoute = useRef<string | null>(null);
  useEffect(() => {
    if (ownRoute.current !== null && withoutFocus(route) === withoutFocus(ownRoute.current)) return;
    ownRoute.current = null;
    tapGen.current += 1;
  }, [route]);
  const seenHere = (row: AlertRow | RequestView) => {
    store.open(row.alert_id);
    markSeen(row.alert_id);
  };
  // the sheet opens only through tap() (rule 1 or rules 4 / 5): a tap's generation guard (tapGen) already stops a
  // stale tap from opening one over a newer tap's sheet, so no second counter is needed (#255 review 2)
  const openSheet = (row: AlertRow | RequestView) => {
    lastOpened.current = views.find((v) => v.alert_id === row.alert_id) ?? row;
    setOpened(row.alert_id);
  };
  // 01d v1.3.3 §3.13.2 rule 6 "Close returns" (DL Q-K (c)): the return record of the last deep-link navigation, on
  // every device: `from` the route the tap started on, `to` the route it landed on (both without focus). It goes at the
  // next navigation of any kind, on a session change and on a close return. The kiosk shows the Back chip while it is
  // set. For a dine-in OrderScreen start, `seat` is that seating's table and the time (merge resolution on return).
  type ReturnRecord = { from: string; to: string; seat: { table_id: string; seating_id: string; at: number } | null };
  const [back, setBack] = useState<ReturnRecord | null>(null);
  const deepNavigate = (href: string) => {
    ownRoute.current = href;
    const from = withoutFocus(route);
    // no record when the tap lands on the screen the person is already on (#257 review)
    if (withoutFocus(href) !== from) {
      const start = matchStaffRoute(from, device.type);
      let seat: ReturnRecord['seat'] = null;
      if (start.name === 'order' && start.order_type === 'dine_in') {
        const tile = sharedMapStore(tablesApi, liveBus).current()?.floors.flatMap((f) => f.zones.flatMap((z) => z.tables)).find((x) => x.seating_id === start.id && x.primary_table_id === x.table_id);
        seat = { table_id: tile?.table_id ?? '', seating_id: start.id, at: clock.nowMs() };
      }
      setBack({ from, to: withoutFocus(href), seat });
    }
    // 02b-TK C1-5: a deep link leaves a takeaway cart without the leave guard (its Back returns to it, #105)
    letLeavePass(href);
    navigate(href);
  };
  const routeNow = withoutFocus(route);
  useEffect(() => {
    if (back !== null && routeNow !== back.to) setBack(null);
  }, [back, routeNow]);
  const meId = me?.staffId ?? null;
  useEffect(() => setBack(null), [meId]); // a session change (sign-in, sign-out, another person, unpair)

  /**
   * §3.13.7 "Where a return lands": the hash a close return and the Back chip go to, or null when the start route can
   * no longer be shown (rule 6): no staff route, or its gate is now false for this person.
   */
  const returnTarget = async (rec: ReturnRecord): Promise<string | null> => {
    const path = routePath(rec.from);
    if (path === '/audit') return showAudit ? rec.from : null;
    if (path === '/devices') return showDevices ? rec.from : null;
    if (path === '/bills' || path === '/bill') return showBills ? rec.from : null;
    if (path === '/shift') return showShift ? rec.from : null;
    if (path === '/reports') return showReports ? rec.from : null;
    if (path === '/day-close') return showDayClose ? rec.from : null;
    if (path === '/requests') return showRequests ? rec.from : null;
    if (path === '/test-alert') return showTest ? rec.from : null;
    if (/^\/receipts\/[^/]+$/.test(path)) return showTest ? rec.from : null;
    const start = matchStaffRoute(rec.from, device.type);
    if (start.name === 'pass') return hasPoint ? rec.from : null;
    if (start.name === 'inbox' && path !== '/inbox' && path !== '/' && path !== '') return null; // no staff route
    if (start.name === 'order' && start.order_type === 'dine_in') {
      // never back onto a dine-in OrderScreen without the lock: that table's sheet (Add items takes it again)
      const seat = rec.seat ?? { table_id: '', seating_id: start.id, at: clock.nowMs() };
      const r = await checkTarget(
        { alert_id: '', kind: 'call_waiter', raised_at: seat.at, target: { type: 'table', table_id: seat.table_id === '' ? '-' : seat.table_id, seating_id: seat.seating_id } },
        { orders: ordersApi, tables: tablesApi, heldMap: () => sharedMapStore(tablesApi, liveBus).current() },
      );
      return r.kind === 'open' ? withoutFocus(r.href) : '/tables';
    }
    return rec.from;
  };
  /**
   * A return waits for returnTarget (a dine-in start runs the open check): its result is dropped when the route
   * changed meanwhile (#273 review). A second close / Back tap always changes it: the first tap consumed the
   * record, so the second is the sheet's own close (an immediate navigate).
   */
  const landWhenStill = (target: Promise<string | null>, orElse: string) => {
    const at = withoutFocus(window.location.hash.replace(/^#/, ''));
    void target.then((to) => {
      if (withoutFocus(window.location.hash.replace(/^#/, '')) !== at) return;
      navigate(to ?? orElse);
    });
  };
  /** §3.13.2 rule 6: TableSheet / OrderView closed by the person (its close button, Escape on TableSheet). */
  const closeRouteSheet = (fallback: string) => {
    const rec = back;
    if (rec === null || routeNow !== rec.to) return navigate(fallback); // a sheet opened normally: today's close
    setBack(null);
    landWhenStill(returnTarget(rec), fallback);
  };
  /** The kiosk Back chip: the same returnTarget; a start that can no longer be shown → that sheet's own close. */
  const goBack = () => {
    const rec = back;
    if (rec === null) return;
    setBack(null);
    const here = matchStaffRoute(routeNow, device.type);
    const sheetFallback = here.name === 'table' ? '/tables' : here.name === 'order_view' ? (has('takeaway') ? '/takeaway' : '/orders') : null;
    landWhenStill(returnTarget(rec), sheetFallback ?? rec.from);
  };
  // 01d v1.3 §3.13.2: every tappable surface (Inbox cards, requests-to-answer rows, banners, the call banner) goes
  // through the one tap rule: no target → today's tap (seen, then the AnswerSheet / NoticeSheet over the current
  // screen, §8.1); a target → the open check, then the place or the toast
  const tap = (row: AlertRow | RequestView, source: 'banner' | 'list' = 'list') => {
    tapGen.current += 1;
    const gen = tapGen.current;
    const session = sessionGen.current;
    void tapAlert(row, {
      source,
      isCurrent: () => tapGen.current === gen && sessionGen.current === session,
      stateNow: () =>
        closedSeen.current.has(row.alert_id) ? 'closed' : (liveRows.current.views.find((v) => v.alert_id === row.alert_id) ?? liveRows.current.held.get(row.alert_id))?.state,
      orders: ordersApi,
      tables: tablesApi,
      heldMap: () => sharedMapStore(tablesApi, liveBus).current(),
      openSlips: () => (liveBus.part('orders') as OrdersCatchUp | undefined)?.open_slips,
      screens: () => deviceView?.screens, // 05a §8 (M-11): absent → today's route
      seen: () => seenHere(row),
      openSheet: () => openSheet(row),
      navigate: deepNavigate,
      settled: () => {
        // this tap's deep link is done: any later route change ends nothing of it. Only the current tap's: a stale
        // tap settling late (its arrival cancelled by a newer tap) must not clear the newer tap's own route (#263 review 2)
        if (tapGen.current === gen) ownRoute.current = null;
      },
      toast: (text) => toasts.show({ text, tone: 'warn' }),
    });
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
  // 01d v1.3 §3.13.5 (m11): the raw checks below take no `focus`; compare the path, so a stray query never unmatches them
  const path = routePath(route);
  const shiftQueryId = path === '/shift' ? new URLSearchParams(route.split('?')[1] ?? '').get('shift_id') || null : null;
  const receiptsMatch = /^\/receipts\/([^/]+)$/.exec(path);
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
        key={signInKey}
        api={api}
        phone={phone}
        lockPanel={lockRows.length === 0 ? null : <LockPanel rows={lockRows} utcOffsetMs={offset} />}
        hooks={shellHooks}
        onUnpaired={onUnpaired}
        onSignedIn={(who) => void signedIn(who)}
      />
    );
  } else if (switching) {
    // 02b-TK TK-SH02 Switch user: the route's screen goes (its unsent takeaway is held, C1-5); the PIN takes over
    page = <SignIn api={api} phone={phone} lockPanel={null} hooks={shellHooks} onUnpaired={onUnpaired} onSignedIn={(who) => void signedIn(who)} onBack={() => setSwitching(false)} />;
  } else if (staffRoute.name === 'me') {
    page = (
      <MeTab name={me.name} onSignOut={() => signOut(true)} {...(showShift ? { onShift: () => navigate('/shift') } : {})}>
        {native !== null && <DeviceHealth native={native} />}
      </MeTab>
    );
  } else if (isSlotRoute(staffRoute)) {
    page = <RouteSlot route={staffRoute} alertRows={snap.rows} onNewOrder={() => setNewOrder(true)} />;
  } else if (path === '/manager' && has('manager')) {
    page = <ManagerScreen permissions={permissions} onNavigate={navigate} />;
  } else if (path === '/audit' && showAudit) {
    page = <AuditLog />;
  } else if (path === '/devices' && showDevices) {
    // §8: the QR / link `#/devices?r=<request_id>` opens that request's approve form (code still typed)
    const devicesQuery = new URLSearchParams(route.split('?')[1] ?? '');
    page = <DeviceList key={route} api={devicesApi} openRequestId={devicesQuery.get('r')} openEditId={devicesQuery.get('edit')} />;
  } else if (path === '/shift' && (showShift || (shiftQueryId !== null && allowed.has('close-shift-for-others')))) {
    // task 41: #/shift?shift_id=… opens that shift (day close's Close this shift, close-shift-for-others)
    page = <ShiftScreen key={route} {...(shiftQueryId === null ? {} : { shiftId: shiftQueryId })} />;
  } else if (path === '/day-close' && showDayClose) {
    page = (
      <DayCloseScreen
        onNavigate={navigate}
        exits={{ closeShift: allowed.has('close-shift-for-others'), ownShift: showShift, bill: showBills, requests: showRequests, reports: showReports }}
      />
    );
  } else if (path === '/reports' && showReports) {
    page = <ReportsScreen />;
  } else if (path === '/bills' && showBills) {
    page = <OpenBills onOpen={(ref) => navigate(`/bill?${billQuery(ref)}`)} />;
  } else if (path === '/bill' && showBills && billRefOfSearch(route.split('?')[1] ?? '') !== null) {
    // 05 §8 Bill screen (task 35): #/bill?bill_id=…|seating_id=…|order_id=…
    page = <BillScreen key={route} billRef={billRefOfSearch(route.split('?')[1] ?? '')!} onBack={() => navigate('/bills')} />;
  } else if (path === '/requests' && showRequests) {
    page = <RequestsToAnswer rows={views} nowMs={nowMs} utcOffsetMs={offset} onOpen={tap} />;
  } else if (path === '/test-alert' && showTest) {
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
        onOpen={tap}
        hasMore={cursor !== null}
        onMore={() => void loadInbox(cursor)}
      />
    );
  }

  const noApprover = me !== null && snap.rows.some((r) => r.kind === 'no_approver' && r.state === 'open');
  const deviceWord = t(`alerts.device.${device.type}`);
  const live =
    mode === 'none' ? null : up && rushValue !== null ? (
      // 02b-TK A2 item 4 (frames HomeRush, ShellAnatomy): on the takeaway screen the pill switches rush mode by hand
      <button type="button" className={rushValue.on ? 'live tk-live tk-live--rush' : 'live tk-live'} aria-pressed={rushValue.on} title={t('shell.rush')} onClick={rushValue.toggle}>
        <Ico name="wifi" />
        {rushValue.on ? (
          <>
            {t('shell.rush')} ·{' '}
            <span className="num" dir="ltr">
              {rushValue.count}
            </span>
          </>
        ) : (
          t('alerts.live')
        )}
      </button>
    ) : up ? (
      <span className="live tk-live">
        <Ico name="wifi" />
        {t('alerts.live')}
      </span>
    ) : (
      <span className="live live--off tk-live--off">
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
  // C-1: the tab the route belongs to; a route shared by two screens (the order view, zones, held) keeps the last tab
  const orderTypeOf = staffRoute.name === 'order' ? staffRoute.order_type : undefined;
  const routeKey = staffRoute.name === 'me' ? 'me' : screenOfPath(path, orderTypeOf);
  const shared = staffRoute.name === 'order_view' || staffRoute.name === 'zones' || staffRoute.name === 'held' || staffRoute.name === 'queue';
  const [lastTab, setLastTab] = useState<ScreenKey | null>(null);
  const routeScreen = routeKey !== null && routeKey !== 'me' && screens.includes(routeKey) ? routeKey : null;
  const currentTab: PhoneTab | null = routeKey === 'me' ? 'me' : (routeScreen ?? (shared && lastTab !== null && screens.includes(lastTab) ? lastTab : null));
  useEffect(() => {
    // not before the session read: a hash left from before the sign-in is not a choice of this person
    if (me === null || me.permissions === null || routeScreen === null) return;
    setLastTab(routeScreen);
    rememberTab(device.id, routeScreen);
  }, [me, routeScreen, device.id]);
  // C-1: a screen taken off this device while the person is on it → the first remaining tab, and a toast
  const seenScreens = useRef<ScreenKey[]>([]);
  useEffect(() => {
    const before = seenScreens.current;
    seenScreens.current = screens;
    if (me === null) return;
    const here = screenOfPath(path, orderTypeOf);
    if (here !== null && before.includes(here) && !screens.includes(here)) {
      toasts.show({ text: t('shell.tab_removed'), tone: 'warn' });
      navigate(homeOf(screens));
    }
  }, [screens]);
  // 02b-TK TK-SH01, TK-SH02: the person's own shift (05 §6.16; 404 = none) for the shift banner and My shift's line,
  // read for a manage-own-shift holder on sign-in, on arriving at a takeaway screen, on a reconnect and a shift event
  const takeawayRoute = routeKey === 'takeaway';
  const shiftReadable = me !== null && allowed.has('manage-own-shift');
  const [ownShift, setOwnShift] = useState<OwnShift | null>(null);
  const readShift = useRef<() => void>(() => {});
  readShift.current = () => {
    if (!shiftReadable) return setOwnShift(null);
    const gen = sessionGen.current;
    void readOwnShift(() => api.query('/queries/shift')).then((v) => {
      if (gen === sessionGen.current) setOwnShift(v);
    });
  };
  useEffect(() => readShift.current(), [shiftReadable, meKey, takeawayRoute]);
  useEffect(
    () =>
      liveBus.subscribe((msg) => {
        if (msg.kind === 'reconnect' || (msg.kind === 'event' && shiftEvent(msg.event.event_type))) readShift.current();
      }),
    [liveBus],
  );
  const shiftSub =
    ownShift?.kind === 'open'
      ? fill(t('shell.me.shift_open'), { time: timeText(ownShift.opened_at, offset), money: money(ownShift.float_minor) })
      : ownShift?.kind === 'none'
        ? t('shell.shift.closed')
        : null;
  const phoneTitle = currentTab === 'me' ? t('tabs.me') : currentTab !== null ? t(`alerts.screen.${currentTab}`) : path === '/requests' && showRequests ? t('alerts.nav.requests') : t('alerts.nav.inbox');
  const body = (
    <div className={`pu v-brand staff${phone ? ' phone' : ''}`} lang={lang} dir={lang === 'ur' ? 'rtl' : 'ltr'} data-theme="light">
      <TopBar
        phone={phone}
        portrait={portrait}
        brandName={meta.branchName}
        deviceLine={`${meta.branchName} · ${deviceWord}`}
        bind={
          device.type === 'tablet' ? (
            <BindingHeader binding={binding} nowMs={clock.nowMs} utcOffsetMs={offset} timers={timers ?? browserTimers} sink={sink ?? browserSink} />
          ) : device.type === 'cashier_kiosk' && me !== null && !switching ? (
            <button type="button" className="tk-btn tk-btn--chrome cd-open" onClick={() => window.open(`/staff/#${DISPLAY_ROUTE}`, DISPLAY_CHANNEL)}>
              {t('cd.open')}
            </button>
          ) : null
        }
        floors={floors}
        live={live}
        clock={timeText(nowMs, offset)}
        person={me === null ? null : { name: me.name }}
        requests={showRequests ? answerable : null}
        inbox={snap.unseen}
        tabs={tabs}
        currentTab={currentTab}
        shift={showShift}
        context={me !== null && !switching && takeawayRoute ? ctxValue : null}
        extra={me !== null && !switching ? barValue : null}
        menu={{ onSwitch: () => setSwitching(true), onLock: () => setLockTick((n) => n + 1), shiftSub }}
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
      {/* 02b-TK TK-SH01, TK-SH03: the day / shift banners under the bar, on the takeaway screens */}
      {me !== null && !switching && takeawayRoute && (
        <ShellBanners
          day={dayOpen}
          canStartDay={canStartDay(permissions)}
          place={`${meta.branchName} · ${timeText(nowMs, offset)}`}
          shift={allowed.has('take-payment') ? ownShift : null}
          onOpenShift={showShift ? () => navigate('/shift') : null}
        />
      )}
      {/* 01d v1.3.3 §3.13.6a: the kiosk Back chip in the alert layer (top-start, above route sheets), not in the top bar */}
      {device.type === 'cashier_kiosk' && back !== null && me !== null && (
        <div className="abk">
          <button type="button" className="chip" onClick={goBack}>
            <Ico name="back" />
            {t('alerts.back')}
          </button>
        </div>
      )}
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
      {/* 05b §3.5 / 00 §8.4: a kept device's reason, while native checks again */}
      {nativeNotice !== null && (
        <div className="staff__warn">
          <div className="warnbar" role="status" data-native="notice">
            <Ico name="wifioff" />
            {t(nativeNotice)}
          </div>
        </div>
      )}
      {/* 05b M-18: the alert service disconnected for 60 s, on every staff screen */}
      {alertsDown && (
        <div className="staff__warn">
          {/* the kit's warnbar has no danger tone: the danger icon and a danger status chip */}
          <div className="warnbar c-danger" role="alert" data-native="alerts-down">
            <Ico name="warn" className="ico--danger" />
            <span className="st c-danger">{t('native.alerts_down')}</span>
          </div>
        </div>
      )}
      {/* 05b M-13 / M-14 */}
      {updateReady && (
        <div className="staff__warn">
          <div className="warnbar" role="status" data-native="update-ready">
            <Ico name="info" />
            {t('native.update_ready')}
          </div>
        </div>
      )}
      {appUpdate && (
        <div className="staff__warn">
          <div className="warnbar" role="status" data-native="update-app">
            <Ico name="info" />
            {t('native.update_app')}
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
      {phone && me !== null && <PhoneTabs tabs={tabs} current={currentTab} />}
      {me !== null && opened === null && (
        <Banners banners={snap.banners} nowMs={nowMs} lockOnly={false} variant={phone ? 'phone' : portrait ? 'wide' : 'side'} counterScreens={profileScreens} onOpen={(r) => tap(r, 'banner')} onOpenInbox={() => navigate('/inbox')} />
      )}
      {me !== null && sheetRow !== null &&
        (isRequest(sheetRow) ? (
          <AnswerSheet
            key={sheetRow.alert_id}
            row={sheetRow}
            canAnswer={'can_answer' in sheetRow ? sheetRow.can_answer : sheetRow.set === 'answerer' && (sheetRow.answers?.length ?? 0) > 0}
            access={deviceView?.access}
            me={{ staffId: me.staffId, name: me.name }}
            sender={sender}
            link={conn}
            nowMs={nowMs}
            utcOffsetMs={offset}
            sheet={phone || portrait}
            onClose={() => setOpened(null)}
            onToast={setToast}
          />
        ) : (
          <NoticeSheet key={sheetRow.alert_id} row={sheetRow} utcOffsetMs={offset} sheet={phone || portrait} onClose={() => setOpened(null)} />
        ))}
      {me !== null && (
        <>
          <HandoverLayer />
          <IdleLock key={me.staffId} lockNow={lockTick} {...(fetch === undefined ? {} : { fetch })} />
          {newOrder && <NewOrderSheet onClose={() => setNewOrder(false)} />}
        </>
      )}
      {/* IR-7: at the root, above the sign-in screen: a sign-in drain or a reconnect send shows its token here */}
      <QueuedSentCard />
      <ToastView bus={toasts} />
      {/* 01d v1.3 §3.13.6 (n4): the one polite live region of the staff shell ("Opened …"; not the toast) */}
      <LiveRegion />
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
    permissions,
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
    closeRouteSheet,
    contextSlot,
    rush: rushSlot,
    bar: barSlot,
  };
  voidShell.current = shell;
  // IR-11: the late cards read every alert row the page holds, open and closed (a slip closed without ItemsReleased)
  return (
    <ShellContext.Provider value={shell}>
      <LateAlertsContext.Provider value={snap.rows as readonly LateAlertRow[]}>
        <PrintSkipContext.Provider value={printSkip}>{body}</PrintSkipContext.Provider>
      </LateAlertsContext.Provider>
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
