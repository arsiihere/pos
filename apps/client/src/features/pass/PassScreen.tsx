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
import { ScreenlessActions } from './actions/ScreenlessActions';
import { PassCard } from './cards/PassCard';
import { readiness } from './cards/readiness';
import { TakeoverSection } from './takeover/TakeoverSection';
import { StationStrip } from './cards/StationStrip';
import { registerPrintSlots, type PrintTransport } from '../print/register';
import { passLiveOf } from './live';

// 03b v1.0.8 §3.4, §8 Pass screen (`/staff/` `#/pass` on a device with a point; W0.6 mounts it; P2). The page's Pass
// live (P1, `passLiveOf`) holds the point's view; the screen draws the station strip and the cards oldest first
// (placed_at), one column in portrait (`pcards--1`, `pstrip--wrap`, IR-18), "No orders at the Pass" when empty.
// Buttons need `run-pass`. P3: per card Hand over (a done line here) and Ready to serve (no open Ready), the Ready
// band ("Ready · time · name", count-up, Undo for 30 s), the card's line (B13, hand-over results), the Hand over sheet,
// Start / Done / Undo on screenless lines (Q-45). P4: the takeover sections above the cards (§3.6) and the
// "{Station} screen is back" toast (Q-56). P5 the states.
// IR-15 (03c §3.5, Q-50, Q-52): 03c's `printed` tag is registered when this module loads (the staff page imports it
// with its routes, before the socket's first catch-up). Its Pass card Reprint runs on ONE transport for the page's
// whole life (`PASS_TRANSPORT`), forwarding to the shell of the mounted Pass (`passShell`, a ref). Leaving the Pass
// or a new staff session (sign-out / sign-in, a new api) never drops it, so 03c's reprinter keeps the command_id of a
// send whose reply was lost and the retry prints once (00 M19). With no Pass mounted it answers like a lost reply and
// `canReprint` is false (no Reprint shown).
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
  const { kds, pass: passApi } = sendersOf(shell.api);
  // the shell object is new on every StaffApp render (its clock tick): only the ref follows it
  useEffect(() => {
    passShell.current = shell;
  });
  const me = useRef(shell.me);
  const ready = useMemo(() => createReadyActions({ api: passApi, store: pass.store, names: pass.names, me: () => me.current }), [passApi, pass]);
  const doneAt = useRef(new Map<string, number>()).current;
  const [nowMs, setNow] = useState(() => shell.clock.nowMs());
  const [msgs, setMsgs] = useState<ReadonlyMap<string, CardMessage>>(new Map());
  const [handed, setHanded] = useState<ReadonlyMap<string, Handed>>(new Map());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<string | null>(null);
  const toastRef = useRef((text: string) => shell.toasts.show({ text, tone: 'ok' }));
  toastRef.current = (text: string) => shell.toasts.show({ text, tone: 'ok' });

  useEffect(() => {
    me.current = shell.me;
  }, [shell.me]);
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

  const view = snap.view;
  if (view === null) return null;
  const canRun = shell.permissions.allowed('run-pass');
  const up = shell.online;
  const orders = [...view.orders].sort((a, b) => a.placed_at - b.placed_at);
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

  const markReady = async (order_id: string) => {
    if (ready.busy(order_id)) return;
    flag(order_id, true);
    const r = await ready.markReady(order_id, view.point_id);
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
  const screenless = new Set(view.stations.filter((st) => st.screenless === true).map((st) => st.station_id));
  const open = sheet === null ? undefined : orders.find((o) => o.order_id === sheet);

  return (
    <main className="pass">
      <StationStrip stations={view.stations} api={canRun ? kds : null} up={up} wrap={shell.portrait} />
      <div className="pscroll">
        {[...pass.takeovers.stores()].map(([station_id, store]) => (
          <TakeoverSection
            key={station_id}
            store={store}
            name={view.stations.find((st) => st.station_id === station_id)?.name ?? ''}
            api={kds}
            canRun={canRun}
            up={up}
            nowMs={nowMs}
            utcOffsetMs={shell.clock.utcOffsetMs}
            timers={BROWSER_TIMERS}
            onToast={onToast}
          />
        ))}
        {orders.length === 0 ? (
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
            <b>{t('pass.empty')}</b>
            <span>{t('pass.empty_sub')}</span>
          </div>
        ) : (
          <div className={shell.portrait ? 'pcards pcards--1' : 'pcards'}>
            {orders.map((o) => {
              const state = readiness(o).state;
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
              if (canRun && o.ready === null && state !== 'none') {
                const b = busy.has(o.order_id);
                buttons.push(
                  <button key="ready" type="button" className={b ? 'btn btn--ready busy' : 'btn btn--ready'} aria-busy={b} disabled={!up} onClick={() => void markReady(o.order_id)}>
                    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                    {t('pass.mark_ready')}
                  </button>,
                );
              }
              const band = o.ready === null ? null : readyBand(o.ready, nowMs, shell.clock.utcOffsetMs, pass.names);
              const h = handed.get(o.order_id);
              const msg = msgs.get(o.order_id) ?? (h === undefined ? null : handedLine(h, o));
              return (
                <PassCard
                  key={o.order_id}
                  order={o}
                  stations={view.stations}
                  pointId={view.point_id}
                  utcOffsetMs={shell.clock.utcOffsetMs}
                  up={up}
                  onToast={onToast}
                  buttons={buttons}
                  lineActions={
                    canRun
                      ? (l) =>
                          screenless.has(l.station_id) ? (
                            <ScreenlessActions line={l} api={kds} up={up} nowMs={nowMs} clock={() => shell.clock.nowMs()} doneAt={doneAt} onMessage={(m) => setMsg(o.order_id, m)} />
                          ) : null
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
                    </>
                  }
                />
              );
            })}
          </div>
        )}
      </div>
      {open !== undefined && (
        <HandOverSheet order={open} pointId={view.point_id} api={passApi} up={up} onClose={() => setSheet(null)} onHanded={(h) => onHanded(open.order_id, h)} onGone={(msg) => setMsg(open.order_id, msg)} />
      )}
    </main>
  );
}
