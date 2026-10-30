import { scriptJson } from './page.js';

// §8.4, 00-F01…F08 (docs/design/handoff/00/00-design.md §1): one mapping from an error code or a WebSocket close
// code to the global state a hub page shows. globalStateFor and reconnectDelayMs run in page scripts too (toString,
// like encodeCrockford128), so they stay plain functions with no inner functions and no imports.

export type GlobalStateId = 'F01' | 'F02' | 'F03' | 'F04' | 'F05' | 'F06' | 'F07' | 'F08';

export type GlobalSignal =
  | { kind: 'network' }
  | { kind: 'close'; code: number; reason?: string }
  | { kind: 'error'; code: string; details?: Record<string, unknown> };

export interface GlobalCtx {
  // Something is already on screen: a lost hub shows a banner over it, not a full screen.
  loaded: boolean;
  // A personal phone re-pairs through a manager's QR; screens re-pair by code.
  device: 'screen' | 'phone';
  // Capacitor app (update from the Play Store) or a hub-served browser (reload).
  app: boolean;
  // The socket passed `auth`: 4403 before auth is the guest network, after it the device token.
  authed: boolean;
  // A DeviceTokenRotated for this device arrived on the socket before the 4401.
  tokenRotated: boolean;
  // The call already had its one silent retry after SERVICE_UNAVAILABLE.
  busyRetried: boolean;
}

export interface GlobalState {
  id: GlobalStateId;
  // 'retry': no UI yet, retry the call once after retryAfterMs.
  mode: 'banner' | 'screen' | 'retry';
  variant?: 'phone' | 'screen' | 'app' | 'browser';
  ssid?: string | null;
  address?: string | null;
  retryAfterMs?: number;
}

export function globalStateFor(signal: GlobalSignal, ctx: GlobalCtx): GlobalState | null {
  const details: Record<string, unknown> = (signal.kind === 'error' && signal.details) || {};
  let key = signal.kind === 'network' ? 'network' : signal.kind === 'close' ? 'close:' + signal.code : signal.code;

  if (key === 'network' || key === 'close:1012') return { id: 'F01', mode: ctx.loaded ? 'banner' : 'screen' };
  if (key === 'close:4403' && !ctx.authed) key = 'GUEST_NETWORK_FORBIDDEN';
  if (key === 'DEVICE_TOKEN_INVALID' || key === 'DEVICE_REVOKED' || key === 'close:4403') {
    return { id: 'F02', mode: 'screen', variant: ctx.device };
  }
  if (key === 'GUEST_NETWORK_FORBIDDEN') {
    const ssid = typeof details.staff_wifi_name === 'string' && details.staff_wifi_name.trim() !== '' ? details.staff_wifi_name.trim() : null;
    return { id: 'F03', mode: 'screen', ssid };
  }
  if (key === 'CLIENT_UPGRADE_REQUIRED' || key === 'close:4426') {
    return { id: 'F04', mode: 'screen', variant: ctx.app ? 'app' : 'browser' };
  }
  if (key === 'SERVICE_UNAVAILABLE') {
    if (ctx.busyRetried) return { id: 'F05', mode: 'banner' };
    const wait = typeof details.retry_after_ms === 'number' && details.retry_after_ms > 0 ? details.retry_after_ms : 1000;
    return { id: 'F05', mode: 'retry', retryAfterMs: Math.min(wait, 5000) };
  }
  if (key === 'HUB_NOT_PROVISIONED') return { id: 'F06', mode: 'screen' };
  if (key === 'HOST_NOT_ALLOWED') {
    const address = typeof details.advertised_host === 'string' && details.advertised_host !== '' ? details.advertised_host : null;
    return { id: 'F07', mode: 'screen', address };
  }
  // §8.4: 4401 after DeviceTokenRotated → pair again; any other 4401 (expiry, KDS 'replaced') is the page's own.
  if (key === 'close:4401' && ctx.tokenRotated && (signal.kind !== 'close' || signal.reason !== 'replaced')) {
    return { id: 'F08', mode: 'screen' };
  }
  return null;
}

// §8.4 / §5.4: reconnect backoff 0.5 s, 1 s, 2 s, 4 s, then 5 s.
export function reconnectDelayMs(attempt: number): number {
  return Math.min(500 * 2 ** Math.max(0, attempt), 5000);
}

const ICON: Record<GlobalStateId, string> = {
  F01: 'sync',
  F02: 'screen',
  F03: 'wifi',
  F04: 'download',
  F05: 'clock',
  F06: 'sync',
  F07: 'link',
  F08: 'screen',
};

const KIND: Record<GlobalStateId, 'ok' | 'warn' | 'danger' | 'info'> = {
  F01: 'warn',
  F02: 'danger',
  F03: 'warn',
  F04: 'info',
  F05: 'warn',
  F06: 'info',
  F07: 'info',
  F08: 'danger',
};

// Page-script half: needs clientPrelude's T, t(), node(), icon(), banner(). Pages pass the actions that need their
// own storage (pairAgain wipes the device token, §8.4) and decide where the returned element goes.
export function globalStateClient(): string {
  return `${globalStateFor.toString()}
${reconnectDelayMs.toString()}
const GLOBAL_ICON = ${scriptJson(ICON)};
const GLOBAL_KIND = ${scriptJson(KIND)};
function globalAction(iconName, text, onClick) {
  const row = node('div', 'pos-row');
  row.style.justifyContent = 'center';
  const button = node('button', 'pos-btn pos-btn--primary pos-btn--lg');
  button.type = 'button';
  button.appendChild(icon(iconName));
  button.appendChild(document.createTextNode(text));
  button.addEventListener('click', onClick);
  row.appendChild(button);
  return row;
}
function globalWifiBody(ssid) {
  const body = node('p', 'pos-screen__body');
  if (ssid === null || ssid === undefined) {
    body.textContent = t('global.wifi_body_unknown');
    return body;
  }
  const parts = T['global.wifi_body'].split('{ssid}');
  body.appendChild(document.createTextNode(parts[0]));
  const name = node('span', 'pos-ltr');
  name.appendChild(node('strong', '', ssid));
  body.appendChild(name);
  body.appendChild(document.createTextNode(parts[1] || ''));
  return body;
}
// 00-F01 banner / 00-F05 banner; every other state is a full .pos-screen.
function renderGlobalState(state, actions) {
  const act = actions || {};
  if (state.id === 'F01' && state.mode === 'banner') {
    const box = node('div', 'pos-banner pos-banner--warn pos-banner--pulse');
    box.setAttribute('role', 'status');
    box.appendChild(icon('sync'));
    const words = node('p', '', t('global.hub_down_title'));
    words.appendChild(node('small', '', t('global.hub_down_small')));
    box.appendChild(words);
    return box;
  }
  if (state.id === 'F05') {
    const box = banner('warn', t('global.busy'), t('global.busy_small'));
    if (act.retry) {
      const again = node('button', 'pos-btn', t('global.try_again'));
      again.type = 'button';
      again.style.marginInlineStart = 'auto';
      again.addEventListener('click', act.retry);
      box.appendChild(again);
    }
    return box;
  }
  const screen = node('main', 'pos-screen pos-screen--' + GLOBAL_KIND[state.id]);
  screen.setAttribute('role', state.id === 'F02' || state.id === 'F08' ? 'alert' : 'status');
  // 00-F06: the sync icon turns while setup runs (frame GlobalNotSetUp; stops under reduced motion).
  const badge = node('div', state.id === 'F06' ? 'pos-screen__icon pos-screen__icon--spin' : 'pos-screen__icon');
  badge.appendChild(icon(state.id === 'F02' && state.variant === 'phone' ? 'phone' : GLOBAL_ICON[state.id]));
  screen.appendChild(badge);
  const title = {
    F01: 'global.hub_down_title',
    F02: state.variant === 'phone' ? 'global.repair_phone_title' : 'global.repair_title',
    F03: 'global.wifi_title',
    F04: 'global.update_title',
    F06: 'global.not_set_up_title',
    F07: 'global.wrong_host_title',
    F08: 'global.rotated_title',
  }[state.id];
  screen.appendChild(node('h1', 'pos-screen__title', t(title)));
  if (state.id === 'F03') {
    screen.appendChild(globalWifiBody(state.ssid));
    return screen;
  }
  const body = {
    F01: 'global.hub_down_body',
    F02: state.variant === 'phone' ? 'global.repair_phone_body' : 'global.repair_body',
    F04: state.variant === 'app' ? 'global.update_app_body' : 'global.update_browser_body',
    F06: 'global.not_set_up_body',
    F07: 'global.wrong_host_body',
    F08: 'global.rotated_body',
  }[state.id];
  screen.appendChild(node('p', 'pos-screen__body', t(body)));
  if (state.id === 'F07' && state.address) {
    screen.appendChild(node('p', 'pos-mono-wrap pos-mono-wrap--lg', 'http://' + state.address));
  }
  if ((state.id === 'F02' || state.id === 'F08') && act.pairAgain) {
    screen.appendChild(globalAction('link', t('global.pair_again'), act.pairAgain));
  }
  if (state.id === 'F04') {
    screen.appendChild(globalAction('reload', t('global.reload'), act.reload || (() => location.reload())));
  }
  return screen;
}
// A full-screen global state for an error replaces the page; returns true when it did.
function globalScreen(error, ctx, actions) {
  const base = { loaded: true, device: 'screen', app: false, authed: true, tokenRotated: false, busyRetried: true };
  const state = globalStateFor({ kind: 'error', code: error && error.code, details: (error && error.details) || {} }, Object.assign(base, ctx || {}));
  if (!state || state.mode !== 'screen') return false;
  document.body.replaceChildren(renderGlobalState(state, actions || {}));
  return true;
}
// 00-F01: probe the hub with backoff until it answers, then call onUp once. Returns stop().
function startReconnect(probe, onUp) {
  let attempt = 0;
  let timer = 0;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    let up = false;
    try { up = await probe(); } catch { up = false; }
    if (stopped) return;
    if (up) { onUp(); return; }
    timer = setTimeout(tick, reconnectDelayMs(attempt++));
  };
  timer = setTimeout(tick, reconnectDelayMs(attempt++));
  return () => { stopped = true; clearTimeout(timer); };
}
`;
}
