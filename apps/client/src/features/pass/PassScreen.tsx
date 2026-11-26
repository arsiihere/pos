import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { t } from '../../i18n';
import { Ring } from '../alerts/ui';
import { fill } from '../../i18n/en';
import type { KdsApi } from '../kds/contracts';
import type { PassApi } from './contracts';
import { notifySlots } from '../kds/slots';
import { useShell, type Shell } from '../staff/shell/hooks';
import { HandOverSheet } from './actions/HandOverSheet';
import { doneToHand, handedLine, type Handed } from './actions/handover';
import { createPassApi, createReadyActions, readyBand, retrying, type CardMessage } from './actions/ready';
import { ReadySheet, pendingLines } from './actions/ReadySheet';
import { ScreenlessActions } from './actions/ScreenlessActions';
import { PassCard } from './cards/PassCard';
import { passRounds } from './cards/parts';
import { readiness } from './cards/readiness';
import { Loading, Offline } from './states/Offline';
import { PointArchived, watchPoint } from './states/PointArchived';
import { ReadOnly } from './states/ReadOnly';
import { TakeoverSection } from './takeover/TakeoverSection';
import { StationStrip } from './cards/StationStrip';
import { registerPrintSlots, type PrintTransport } from '../print/register';
import { passLiveOf } from './live';
import { glowOnArrival } from '../alerts/deeplink-tap';
import { identifierText } from '../kds/station/Identifier';
import { matchStaffRoute } from '../staff/shell/routes';
import { passOpenedText } from './pass-place';
import { PASS_FILTERS, ordersFor, orderTypeOf, typeCounts, type PassFilter } from './order-filter';
import { createTakeawayPromises } from './takeaway-promises';
import { createBillEligibility, createCustomerHandover, customerButton, customerIdent, eligibilityOf } from './actions/customer';
import { isPickup, pickupReady } from './cards/readiness';
import { createHandovers } from '../staff/orders/takeaway/handover';
import '../staff/orders/takeaway/styles';

// 03b v1.0.8 §3.4, §8 Pass screen (`/staff/` `#/pass` on a device with a point; W0.6 mounts it; P2). The page's Pass
// live (P1, `passLiveOf`) holds the point's view; the screen draws the station strip and the cards oldest first
// (placed_at), one column in portrait (`pcards--1`, `pstrip--wrap`, IR-18), "No orders at the Pass" when empty.
// Buttons need `run-pass`. P3: per card Hand over (a done line here) and Ready to serve (no open Ready), the Ready
// band ("Ready · time · name", count-up, Undo for 30 s), the card's line (B13, hand-over results), the Hand over sheet,
// Start / Done / Undo on screenless lines (Q-45). P4: the takeover sections above the cards (§3.6) and the
// "{Station} screen is back" toast (Q-56). 02b-tk C3-4 (frame PackerPass): the filter chip by order type (All /
// Dine-in / Takeaway / Parking, order-filter.ts); Takeaway sorted by promise (open-orders, read only while that filter
// is on, takeaway-promises.ts), its first card "Pack next", "Ready by {time}"; a takeaway card's ready button reads
// "Bag ready" (the same MarkReadyToServe and pick sheet, §6.6). P5: the offline warn bar (buttons off), the read-only line (no run-pass),
// the archived point (404 POINT_NOT_FOUND → actions hidden until the next catch-up), the loading skeleton.
// IR-15 (03c §3.5, Q-50, Q-52): 03c's `printed` tag is registered when this module loads (the staff page imports it
// with its routes, before the socket's first catch-up). Its Pass card Reprint runs on ONE transport for the page's
// whole life (`PASS_TRANSPORT`), forwarding to the shell of the mounted Pass (`passShell`, a ref). Leaving the Pass
// or a new staff session (sign-out / sign-in, a new api) never drops it, so 03c's reprinter keeps the command_id of a
// send whose reply was lost and the retry prints once (00 M19). With no Pass mounted it answers like a lost reply and
// `canReprint` is false (no Reprint shown).
// 02b-TK L-CLIENT-1 item 1 (03b v1.0.16 §3.4 R3-B-1, R3-M-5, R3-B-2, R3-M-4, R3-M-10; frames PackerPass, HandoverUndo):
// a pickup card shows its pickup time and station-less lines and follows the hub's whole-order readiness (Bag ready
// only when the whole bag is ready). "Handed to customer" on takeaway / parking cards for a person holding run-pass
// and mark-served: greyed until billing eligibility is known (one open-orders?order_type=all read while such a card
// is visible, actions/customer.ts), "Due — customer pays at counter" on a Due card; the tap checks the whole order
// afresh, then "{identifier} handed to customer · Undo" for 5 s (createHandovers) before one queued MarkServed.
registerPrintSlots();

/** The print transport on the staff session of the current shell (read through `ref` at call time). */
export function passPrintTransport(ref: { current: Pick<Shell, 'api' | 'permissions' | 'me'> | null }): PrintTransport {
  return {
    command: (type, payload, commandId) =>
      ref.current === null ? Promise.resolve({ ok: false, error: { kind: 'network' } }) : ref.current.api.command(type, payload, commandId === undefined ? {} : { commandId }),
    orderTickets: (order_id) =>
      ref.current === null ? Promise.resolve({ ok: false, error: { kind: 'network' } }) : ref.current.api.query(`/queries/order-tickets?order_id=${encodeURIComponent(order_id)}`),
    canReprint: () => ref.current?.permissions.allowed('reprint-ticket') ?? false,
    // IR-19: a 403 hides Reprint for the person it was for, not for the next one on this tablet
    session: () => ref.current?.me?.staff_id ?? null,
  };
}

const passShell: { current: Pick<Shell, 'api' | 'permissions' | 'me'> | null } = { current: null };
const PASS_TRANSPORT = passPrintTransport(passShell);

/**
 * The station commands on the staff session (03b §3.9: `run-pass`), the same shape as the KDS's (KdsApi); a lost reply
 * is sent again with the same command_id (`retrying`, 00 M19).
 */
export function staffKdsApi(api: Shell['api']): KdsApi {
  const send = retrying((type, payload, opts) => api.command(type, payload, opts));
  return {
    startItem: (p) => send('StartItem', p),
    doneItem: (p) => send('DoneItem', p),
    undoDone: (p) => send('UndoDone', p),
    giveMeMore: (p) => send('GiveMeMore', p),
    setLaneState: (p) => send('SetLaneState', p),
  };
}

/**
 * The page's senders (00 M19): one per staff api for the page's whole life, like the print transport and the Pass live,
 * so a command whose reply was lost keeps its command_id across leaving the Pass and opening it again.
 */
const senders = new WeakMap<Shell['api'], { kds: KdsApi; pass: PassApi }>();
export function sendersOf(api: Shell['api']): { kds: KdsApi; pass: PassApi } {
  let s = senders.get(api);
  if (s === undefined) {
    s = { kds: staffKdsApi(api), pass: createPassApi({ command: (type, payload, opts) => api.command(type, payload, opts), query: (path) => api.query(path) }) };
    senders.set(api, s);
  }
  return s;
}

/** a display tick for the Ready count-up and the Undo times (no hub read) */
const TICK_MS = 1_000;

/** K3's inline row lines and Give me more's line fade on these (display only) */
const BROWSER_TIMERS = { setTimeout: (fn: () => void, ms: number): unknown => setTimeout(fn, ms), clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export function PassScreen() {
  const shell = useShell();
  const pass = passLiveOf(shell);
  const snap = useSyncExternalStore(pass.store.subscribe, pass.store.snapshot);
  useSyncExternalStore(pass.names.subscribe, () => pass.names);
  const { kds, pass: pageApi } = sendersOf(shell.api);
  // the shell object is new on every StaffApp render (its clock tick): only the ref follows it
  useEffect(() => {
    passShell.current = shell;
  });
  // P5: a Pass command answered 404 POINT_NOT_FOUND → the point is archived (until the next catch-up)
  const [archived, setArchived] = useState(false);
  const passApi = useMemo(() => watchPoint(pageApi, () => setArchived(true)), [pageApi]);
  const me = useRef(shell.me);
  const ready = useMemo(() => createReadyActions({ api: passApi, store: pass.store, names: pass.names, me: () => me.current }), [passApi, pass]);
  const doneAt = useRef(new Map<string, number>()).current;
  const [nowMs, setNow] = useState(() => shell.clock.nowMs());
  const [msgs, setMsgs] = useState<ReadonlyMap<string, CardMessage>>(new Map());
  const [handed, setHanded] = useState<ReadonlyMap<string, Handed>>(new Map());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<string | null>(null);
  // 03b v1.0.10 §3.4: the order whose Ready pick sheet is open
  const [picking, setPicking] = useState<string | null>(null);
  // 02b-tk C3-4: the filter chip and, while Takeaway is on, the takeaway promises
  const [filter, setFilter] = useState<PassFilter>('all');
  const apiRef = useRef(shell.api);
  apiRef.current = shell.api;
  const takeaway = useMemo(() => createTakeawayPromises({ live: shell.live, read: () => apiRef.current.query('/queries/open-orders?order_type=takeaway') }), [shell.live]);
  useEffect(() => {
    if (filter !== 'takeaway') return;
    takeaway.start();
    return () => takeaway.stop();
  }, [filter, takeaway]);
  const promises = useSyncExternalStore(takeaway.subscribe, takeaway.promises);
  // 02b-TK L-CLIENT-1 item 1: the customer hand-over (03b v1.0.16 §3.4)
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const bills = useMemo(
    () => createBillEligibility({ live: shell.live, read: () => apiRef.current.query('/queries/open-orders?order_type=all'), now: () => shellRef.current.clock.nowMs() }),
    [shell.live],
  );
  const billRead = useSyncExternalStore(bills.subscribe, bills.current);
  const sendRef = useRef<(h: Parameters<Parameters<typeof createHandovers>[0]['send']>[0]) => void>(() => undefined);
  const handovers = useMemo(() => createHandovers({ send: (h) => sendRef.current(h) }), []);
  useEffect(() => handovers.attach(), [handovers]);
  useSyncExternalStore(handovers.subscribe, handovers.version);
  const customer = useMemo(
    () =>
      createCustomerHandover({
        orderView: (id) => shellRef.current.orders.orderView(id),
        bills,
        handovers,
        enqueue: (payload, label) => shellRef.current.enqueue('MarkServed', payload, { label }),
        now: () => shellRef.current.clock.nowMs(),
        utcOffsetMs: shell.clock.utcOffsetMs,
        toast: (text, tone) => shellRef.current.toasts.show({ text, tone }),
      }),
    [bills, handovers, shell.clock.utcOffsetMs],
  );
  sendRef.current = (h) => void customer.send(h);
  const toastRef = useRef((text: string) => shell.toasts.show({ text, tone: 'ok' }));
  toastRef.current = (text: string) => shell.toasts.show({ text, tone: 'ok' });

  useEffect(() => {
    me.current = shell.me;
  }, [shell.me]);
  // 01d v1.3 §3.13.5 (dl cp7): `#/pass?focus=order:<id>` comes only through the URL, with no tap behind it (a tap on
  // #/pass glows the card in place, pass-place.ts). It glows that card through the tap's own arrival helper
  // (integrator ruling (a): the one glow path; it drops `focus`).
  useEffect(() => {
    const ask = () => {
      const hash = window.location.hash.replace(/^#/, '');
      const route = matchStaffRoute(hash, shell.device.type);
      if (route.name !== 'pass' || route.focus?.kind !== 'order') return;
      const id = route.focus.order_id;
      const card = pass.store.snapshot().view?.orders.find((o) => o.order_id === id);
      void glowOnArrival(hash, route.focus, passOpenedText(id, card === undefined ? '' : identifierText(card.identifier)));
    };
    ask();
    window.addEventListener('hashchange', ask);
    return () => window.removeEventListener('hashchange', ask);
  }, [pass, shell.device.type]);
  // IR-6: a newer Handover of another tablet (or a catch-up) wins over this tablet's older hand-over reply
  useEffect(
    () =>
      shell.live.subscribe((msg) => {
        if (msg.kind === 'catch_up') setHanded(new Map());
        if (msg.kind !== 'event' || msg.event.event_type !== 'Handover') return;
        const p = msg.event.payload;
        const order_id = p['order_id'];
        if (typeof order_id !== 'string') return;
        setHanded((m) => {
          const own = m.get(order_id);
          if (own === undefined || own.handover_id === p['handover_id']) return m;
          const next = new Map(m);
          next.delete(order_id);
          return next;
        });
      }),
    [shell.live],
  );
  useEffect(() => {
    setNow(shell.clock.nowMs());
    const timer = setInterval(() => {
      setNow(shell.clock.nowMs());
      pass.takeovers.prune();
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [shell.clock, pass]);
  useEffect(() => {
    passShell.current = shell;
    // the same transport object every time: 03c keeps its reprinter and open command ids (register.ts); the cards
    // drawn before this ran asked 03c with no shell, so they ask again
    registerPrintSlots(PASS_TRANSPORT);
    notifySlots();
    return () => {
      passShell.current = null;
    };
    // mount only: re-registering on each new shell object would churn the slots (shell is read through the ref)
  }, []);

  useSyncExternalStore(pass.takeovers.subscribe, pass.takeovers.version);
  // Q-56: "{Station} screen is back" only when the section still held rows (else the takeover ended quietly)
  useEffect(
    () =>
      pass.takeovers.onEnded((e) => {
        if (e.rows === 0) return;
        const name = pass.store.snapshot().view?.stations.find((st) => st.station_id === e.station_id)?.name ?? '';
        toastRef.current(fill(t('pass.screen_back'), { station: name }));
      }),
    [pass],
  );

  useEffect(() => shell.live.subscribe((msg) => msg.kind === 'catch_up' && setArchived(false)), [shell.live]);

  // §3.4 Bill freshness: one open-orders read while a takeaway / parking card with the action is visible
  const canCustomer = shell.permissions.allowed('run-pass') && shell.permissions.allowed('mark-served') && shell.me !== null && !archived;
  const counterCards = snap.view === null ? [] : ordersFor(snap.view.orders, filter, promises).filter((o) => orderTypeOf(o) !== 'dine_in');
  const wantBills = canCustomer && counterCards.length > 0;
  useEffect(() => {
    if (!wantBills) return;
    bills.start();
    return () => bills.stop();
  }, [wantBills, bills]);
  // a card placed after the last read needs a read issued after it (an absent parking row)
  const newest = counterCards.reduce((n, o) => Math.max(n, o.placed_at), Number.NEGATIVE_INFINITY);
  useEffect(() => {
    if (wantBills && billRead !== null && newest > billRead.at) bills.schedule();
  }, [wantBills, billRead, newest, bills]);

  const view = snap.view;
  if (view === null) return <Loading />;
  const allowed = shell.permissions.allowed('run-pass');
  const canRun = allowed && !archived;
  const up = shell.online;
  const orders = [...view.orders].sort((a, b) => a.placed_at - b.placed_at);
  const rounds = passRounds(orders); // ⚠️ 03b v1.0.13 §3.4 (STAB-6): the point's round tags, oldest card first
  const counts = typeCounts(orders);
  const shown = ordersFor(orders, filter, promises);
  const onToast = (text: string, tone: 'ok' | 'warn' = 'ok') => shell.toasts.show({ text, tone });
  const setMsg = (order_id: string, msg: CardMessage | null | undefined) =>
    setMsgs((m) => {
      const next = new Map(m);
      if (msg == null) next.delete(order_id);
      else next.set(order_id, msg);
      return next;
    });
  const flag = (order_id: string, on: boolean) =>
    setBusy((b) => {
      const next = new Set(b);
      if (on) next.add(order_id);
      else next.delete(order_id);
      return next;
    });

  const markReady = async (order_id: string, order_item_ids?: string[]) => {
    if (ready.busy(order_id)) return;
    flag(order_id, true);
    const r = await ready.markReady(order_id, view.point_id, order_item_ids);
    flag(order_id, false);
    if (r.busy === true) return;
    setMsg(order_id, r.message ?? null);
  };
  const undoReady = async (order_id: string) => {
    const r = await ready.undoReady(order_id, view.point_id);
    if (r.busy === true) return;
    if (r.toast !== undefined) onToast(r.toast, 'warn');
    setMsg(order_id, r.message ?? null);
  };
  const onHanded = (order_id: string, h: Handed) => {
    // Q-55: a Ready this Handover made shows this tablet's person
    const person = me.current;
    if (person !== null) {
      pass.names.remember(person.staff_id, person.name);
      pass.store.claimHandover(h.handover_id, person.staff_id);
    }
    setHanded((m) => new Map(m).set(order_id, h));
    setMsg(order_id, null);
    if (h.left === 0) onToast(fill(t('pass.handed'), { name: h.name }));
  };
  const open = sheet === null ? undefined : orders.find((o) => o.order_id === sheet);
  const pickOrder = picking === null ? undefined : orders.find((o) => o.order_id === picking);
  // 03b v1.0.10 §3.4 (STAB-2): every pending line done → one tap; else the pick sheet
  const tapCustomer = async (o: (typeof orders)[number]) => {
    const type = orderTypeOf(o);
    if (type === 'dine_in' || busy.has(`c:${o.order_id}`)) return;
    flag(`c:${o.order_id}`, true);
    const r = await customer.tap(o, type, customerIdent(o));
    flag(`c:${o.order_id}`, false);
    if (r.kind === 'refused') setMsg(o.order_id, { text: r.text, tone: 'warn' });
    else if (r.kind === 'offline') setMsg(o.order_id, { text: t('pass.offline_counter'), tone: 'warn' });
    else if (r.kind === 'gone') setMsg(o.order_id, { text: t('pass.gone'), tone: 'mute' });
    else setMsg(o.order_id, null);
  };
  const lastCustomer = handovers.pending().at(-1) ?? null;
  const pendingCustomer = new Set(handovers.pending().map((h) => h.token_key));
  const tapReady = (o: (typeof orders)[number]) => {
    const pending = pendingLines(o);
    if (pending.every((l) => l.stage === 'done')) void markReady(o.order_id);
    else setPicking(o.order_id);
  };

  return (
    <main className="pass">
      {!up && <Offline />}
      {archived ? <PointArchived /> : !allowed && <ReadOnly />}
      <StationStrip stations={view.stations} api={canRun ? kds : null} up={up} wrap={shell.portrait} />
      <div className="seg pfilter" role="group" aria-label={t('pass.filter.label')}>
        {PASS_FILTERS.map((f) => (
          <button key={f} type="button" data-filter={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {t(`pass.filter.${f}`)}
            {f !== 'all' && counts[f] > 0 && <span className="n num">{counts[f]}</span>}
          </button>
        ))}
      </div>
      <div className="pscroll">
        {[...pass.takeovers.stores()].map(([station_id, store]) => (
          <TakeoverSection
            key={station_id}
            store={store}
            name={view.stations.find((st) => st.station_id === station_id)?.name ?? ''}
            api={kds}
            canRun={canRun}
            archived={archived || snap.archived.has(station_id)}
            up={up}
            nowMs={nowMs}
            utcOffsetMs={shell.clock.utcOffsetMs}
            timers={BROWSER_TIMERS}
            onToast={onToast}
          />
        ))}
        {shown.length === 0 ? (
          <div className="empty empty--pass">
            <Ring size={96} pct={100} tone="ok">
              <svg className="ico ico--36" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 11h18" />
                <path d="M5 11V7a7 7 0 0 1 14 0v4" />
                <path d="M12 3v1" />
                <path d="M4 15h16" />
                <path d="M6 15v5" />
                <path d="M18 15v5" />
              </svg>
            </Ring>
            <b>{filter === 'all' ? t('pass.empty') : t(`pass.empty.${filter}`)}</b>
            <span>{t('pass.empty_sub')}</span>
          </div>
        ) : (
          <div className={shell.portrait ? 'pcards pcards--1' : 'pcards'}>
            {shown.map((o, i) => {
              const state = readiness(o, nowMs).state;
              const type = orderTypeOf(o);
              const isTakeaway = type === 'takeaway';
              // ⚠️ 03b v1.0.16 §3.4 (R3-M-5): a pickup card's Bag ready follows the whole-order summary
              const bagOk = !isPickup(o) || pickupReady(o, nowMs);
              const buttons = [];
              if (canRun && doneToHand(o).length > 0)
                buttons.push(
                  <button key="hand" type="button" className="btn btn--hand" disabled={!up} onClick={() => setSheet(o.order_id)}>
                    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="8" cy="8" r="3.5" />
                      <path d="M2.5 20a5.5 5.5 0 0 1 11 0" />
                      <path d="M15 12h6" />
                      <path d="M18.5 9l3 3-3 3" />
                    </svg>
                    {t('pass.hand_over')}
                  </button>,
                );
              // ⚠️ 03b v1.0.10 §3.4: also with an open Ready while lines not in it are left (they finished later)
              if (canRun && bagOk && pendingLines(o).length > 0 && (o.ready !== null || state !== 'none')) {
                const b = busy.has(o.order_id);
                buttons.push(
                  <button key="ready" type="button" className={b ? 'btn btn--ready busy' : 'btn btn--ready'} aria-busy={b} disabled={!up} onClick={() => tapReady(o)}>
                    {isTakeaway ? (
                      <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 8h14l-1.2 12.5H6.2z" />
                        <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
                      </svg>
                    ) : (
                      <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    )}
                    {t(isTakeaway ? 'pass.bag_ready' : 'pass.mark_ready')}
                  </button>,
                );
              }
              const cust =
                canCustomer && type !== 'dine_in'
                  ? customerButton({
                      up,
                      localDone: o.lines.every((l) => l.handed_over || l.stage === 'done'),
                      pickupOk: bagOk,
                      eligibility: eligibilityOf(billRead, { order_id: o.order_id, order_type: type, placed_at: o.placed_at }),
                      pending: pendingCustomer.has(o.order_id) || busy.has(`c:${o.order_id}`),
                    })
                  : null;
              if (cust !== null)
                buttons.push(
                  <button key="customer" type="button" className="btn btn--customer" disabled={!cust.enabled} onClick={() => void tapCustomer(o)}>
                    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 8h14l-1.2 12.5H6.2z" />
                      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
                      <path d="M9.5 14l2 2 3.5-3.5" />
                    </svg>
                    {t('pass.handed_to_customer')}
                  </button>,
                );
              const band = o.ready === null ? null : readyBand(o.ready, nowMs, shell.clock.utcOffsetMs, pass.names);
              const h = handed.get(o.order_id);
              const msg = msgs.get(o.order_id) ?? (h === undefined ? null : handedLine(h, o));
              return (
                <PassCard
                  key={o.order_id}
                  order={o}
                  stations={view.stations}
                  pointId={view.point_id}
                  rounds={rounds}
                  next={filter === 'takeaway' && i === 0}
                  readyBy={filter === 'takeaway' ? (promises.get(o.order_id) ?? null) : null}
                  nowMs={nowMs}
                  utcOffsetMs={shell.clock.utcOffsetMs}
                  up={up}
                  onToast={onToast}
                  buttons={buttons}
                  lineActions={
                    canRun
                      ? // ⚠️ 03b v1.0.10 §3.4 (STAB-3): Start / Done / Undo on every station's lines (a tandoor's distributor)
                        (l, parts) => <ScreenlessActions line={l} parts={parts} api={kds} up={up} nowMs={nowMs} clock={() => shell.clock.nowMs()} doneAt={doneAt} onMessage={(m) => setMsg(o.order_id, m)} />
                      : undefined
                  }
                  band={
                    <>
                      {band !== null && (
                        <div className="pc__rdy">
                          <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M5 12.5l4.5 4.5L19 7.5" />
                          </svg>
                          <span>{band.text}</span>
                          <span className="t num">{band.since}</span>
                          {/* B10, §3.5: Undo goes after 30 s or after any hand-over of this order here */}
                          {canRun && band.undoLeft !== null && !o.lines.some((l) => l.handed_over) && (
                            <button type="button" className="btn" disabled={!up} onClick={() => void undoReady(o.order_id)}>
                              <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M9 14.5L4 9.5l5-5" />
                                <path d="M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11" />
                              </svg>
                              {fill(t('pass.undo_ready'), { time: band.undoLeft })}
                            </button>
                          )}
                        </div>
                      )}
                      {msg !== null && (
                        <div className={`pc__msg c-${msg.tone}`}>
                          <span>{msg.text}</span>
                        </div>
                      )}
                      {/* ⚠️ 03b v1.0.16 §3.4: a known Due row; the greyed customer action says why */}
                      {cust?.due === true && (
                        <div className="pc__msg c-danger pc__due">
                          <span>{t('pass.due')}</span>
                        </div>
                      )}
                      {cust !== null && !cust.enabled && cust.hint !== null && (
                        <div className="pc__msg c-mute pc__hint">
                          <span>{t(cust.hint)}</span>
                        </div>
                      )}
                    </>
                  }
                />
              );
            })}
          </div>
        )}
      </div>
      {pickOrder !== undefined && (
        <ReadySheet
          order={pickOrder}
          up={up}
          onClose={() => setPicking(null)}
          onConfirm={(ids) => {
            setPicking(null);
            void markReady(pickOrder.order_id, ids);
          }}
        />
      )}
      {lastCustomer !== null && (
        <div className="tk-toast tk-toast--ok tk-toast--bottom pass-undo" role="status">
          <span>{fill(t('pass.handed_undo'), { identifier: lastCustomer.ident }).split(' · ')[0]}</span>
          <button type="button" className="tk-btn" onClick={() => handovers.undo(lastCustomer.id)}>
            {fill(t('pass.handed_undo'), { identifier: lastCustomer.ident }).split(' · ')[1] ?? t('t.undo')}
          </button>
        </div>
      )}
      {open !== undefined && (
        <HandOverSheet order={open} pointId={view.point_id} api={passApi} up={up} onClose={() => setSheet(null)} onHanded={(h) => onHanded(open.order_id, h)} onGone={(msg) => setMsg(open.order_id, msg)} />
      )}
    </main>
  );
}
