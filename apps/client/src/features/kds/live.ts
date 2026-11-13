import type { WsServerMessage } from '@pos/events';
import { createAlertConnection, hubSocketUrl, type AlertConnection, type SocketLike } from '../alerts/socket';
import type { AlertStore, Timers } from '../alerts/store';
import type { KdsStore } from './contracts';
import { publishFrame } from './slots';

// 03b v1.0.8 §8 (K1): the KDS socket is 01d's hub connection (alerts/socket.ts) opened with the station session
// (`auth` with device token + session token; the KDS never opens alert mode). Alert frames go to the alert store (lock
// lines, K5); every other frame — catch-up parts and frames — goes to the KDS store and then to the slots' frame feed
// (`publishFrame`, Q-50), in arrival order, so 03c reads `kds_printed` / `printed_lines` / `station_notice` here.
// Reconnects (backoff ≤ 5 s) re-send `auth`; the hub answers with a full catch-up, which replaces the store.

export interface KdsLiveDeps {
  deviceToken: string;
  sessionToken: string;
  store: KdsStore;
  alerts: AlertStore;
  timers: Timers;
  url?: string;
  createSocket?: (url: string) => SocketLike;
  /** a `DeviceRevoked` event came on this socket (the hub sends it to the device's sockets, then closes 4403) */
  onRevoked?: () => void;
  /** final closes (no reconnect): 4401 (+ reason, `replaced` = M53), 4403, 4409, 4426 */
  onEnded(code: number, reason: string): void;
}

export function createKdsLive(deps: KdsLiveDeps): AlertConnection {
  return createAlertConnection({
    url: deps.url ?? hubSocketUrl(),
    deviceType: 'kds',
    deviceToken: deps.deviceToken,
    sessionToken: deps.sessionToken,
    store: deps.alerts,
    timers: deps.timers,
    ...(deps.createSocket === undefined ? {} : { createSocket: deps.createSocket }),
    onEnded: deps.onEnded,
    onFrame: (frame: WsServerMessage) => {
      if (frame.type === 'event' && frame.event.event_type === 'DeviceRevoked') deps.onRevoked?.();
      deps.store.apply(frame);
      publishFrame(frame);
    },
  });
}
