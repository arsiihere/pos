import { createHubClock, type HubClock } from '../../app/hub-clock';
import { readPageMeta, type PageMeta } from '../staff/api';

// 03b v1.0.8 §8 (Q-42), 00 v1.9.2 §6.11, §8.2, §8.4 (K1): the /kds/ page owns the station session (M53). It sends the
// device token of the pairing store (IndexedDB `pos-device`, read by the caller through hub-admin readDeviceKey) to
// `POST /auth/station`; the session token it gets back lives in memory only (never in a store). The reply decides:
// - 401 DEVICE_TOKEN_INVALID / 403 DEVICE_REVOKED → `unpaired` (the caller wipes the pairing keys → /pair, §8.4);
// - 403 DEVICE_TYPE_NOT_ALLOWED → `not_kds`: the keys stay (the device is paired, as another type);
// - no reply → `network`; any other error → `error` (with its details, e.g. retry_after_ms): the keys stay and the
//   caller follows 00 §8.4 (KdsApp stateForAuth).

export interface StationSession {
  session_token: string;
  session_id: string;
  station_id: string;
}

export type StationAuth =
  | { kind: 'ok'; session: StationSession }
  | { kind: 'unpaired' }
  | { kind: 'not_kds' }
  | { kind: 'network' }
  | { kind: 'error'; status: number; code: string; details: Record<string, unknown> };

/** 00 §8.4: the hub no longer knows this device */
export const UNPAIR_CODES: ReadonlySet<string> = new Set(['DEVICE_TOKEN_INVALID', 'DEVICE_REVOKED']);

export async function startStationSession(o: {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  deviceToken: string;
  baseUrl?: string;
}): Promise<StationAuth> {
  let status: number;
  let body: unknown;
  try {
    const response = await o.fetch(`${o.baseUrl ?? ''}/auth/station`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${o.deviceToken}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    status = response.status;
    body = await response.json().catch(() => null);
  } catch {
    return { kind: 'network' };
  }
  if (status >= 200 && status < 300) {
    const data = (body as { data?: Partial<Record<keyof StationSession, unknown>> } | null)?.data;
    if (typeof data?.session_token === 'string' && typeof data.session_id === 'string' && typeof data.station_id === 'string') {
      return { kind: 'ok', session: { session_token: data.session_token, session_id: data.session_id, station_id: data.station_id } };
    }
    return { kind: 'error', status, code: 'INTERNAL_ERROR', details: {} };
  }
  const error = (body as { error?: { code?: unknown; details?: unknown } } | null)?.error;
  const c = typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR';
  const details = typeof error?.details === 'object' && error.details !== null ? (error.details as Record<string, unknown>) : {};
  if (UNPAIR_CODES.has(c)) return { kind: 'unpaired' };
  if (c === 'DEVICE_TYPE_NOT_ALLOWED') return { kind: 'not_kds' };
  return { kind: 'error', status, code: c, details };
}

/** §8 (Q-42): /kds/ is served with the /staff/ page meta: envelope ids and the hub clock (S47, never the device's). */
export interface KdsPage {
  meta: PageMeta;
  clock: HubClock;
}

export function readKdsPage(doc: Document = document, perfNow?: () => number): KdsPage | null {
  const meta = readPageMeta(doc);
  if (meta === null) return null;
  return { meta, clock: createHubClock({ now_ms: meta.hubNowMs, utc_offset_ms: meta.utcOffsetMs }, perfNow) };
}
