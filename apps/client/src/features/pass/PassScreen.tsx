import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { t } from '../../i18n';
import { Ring } from '../alerts/ui';
import type { KdsApi } from '../kds/contracts';
import { notifySlots } from '../kds/slots';
import { useShell, type Shell } from '../staff/shell/hooks';
import { PassCard } from './cards/PassCard';
import { StationStrip } from './cards/StationStrip';
import { registerPrintSlots, type PrintTransport } from '../print/register';
import { passLiveOf } from './live';

// 03b v1.0.8 §3.4, §8 Pass screen (`/staff/` `#/pass` on a device with a point; W0.6 mounts it; P2). The page's Pass
// live (P1, `passLiveOf`) holds the point's view; the screen draws the station strip and the cards oldest first
// (placed_at), one column in portrait (`pcards--1`, `pstrip--wrap`, IR-18), "No orders at the Pass" when empty.
// Buttons need `run-pass`. P3 adds Ready / Hand over / screenless Start / Done, P4 the takeover sections, P5 the
// states.
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

/** The station commands on the staff session (03b §3.9: `run-pass`), the same shape as the KDS's (KdsApi). */
export function staffKdsApi(api: Shell['api']): KdsApi {
  return {
    startItem: (p) => api.command('StartItem', p),
    doneItem: (p) => api.command('DoneItem', p),
    undoDone: (p) => api.command('UndoDone', p),
    giveMeMore: (p) => api.command('GiveMeMore', p),
    setLaneState: (p) => api.command('SetLaneState', p),
  };
}

export function PassScreen() {
  const shell = useShell();
  const pass = passLiveOf(shell);
  const snap = useSyncExternalStore(pass.store.subscribe, pass.store.snapshot);
  const kds = useMemo(() => staffKdsApi(shell.api), [shell.api]);
  // the shell object is new on every StaffApp render (its clock tick): only the ref follows it
  useEffect(() => {
    passShell.current = shell;
  });
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
  const view = snap.view;
  if (view === null) return null;
  const canRun = shell.permissions.allowed('run-pass');
  const orders = [...view.orders].sort((a, b) => a.placed_at - b.placed_at);
  const onToast = (text: string, tone: 'ok' | 'warn' = 'ok') => shell.toasts.show({ text, tone });

  return (
    <main className="pass">
      <StationStrip stations={view.stations} api={canRun ? kds : null} up={shell.online} wrap={shell.portrait} />
      <div className="pscroll">
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
            {orders.map((o) => (
              <PassCard key={o.order_id} order={o} stations={view.stations} pointId={view.point_id} utcOffsetMs={shell.clock.utcOffsetMs} up={shell.online} onToast={onToast} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
