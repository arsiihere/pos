import type { WsServerMessage } from '@pos/events';
import type { HubResult } from '../../api/hub-admin';
import type { HubTime } from '../../app/hub-clock';

// 03b v1.0.8 §3.3, §3.10, #75 (K4): what the KDS needs from the branch config — its station's name, completion mode,
// type (batch stations draw four compact columns) and archived flag — from `GET /queries/branch-config` (station
// sessions may read it, 01a §6.23), and the hub clock it carries (`hub_time`, S47). Read once on open, again on every
// catch-up (a reconnect may have missed a frame) and on `BranchConfigApplied` (01a; 03b §3.10). No timer (Q-54).

export interface KdsStationConfig {
  name: string;
  completion_mode: 'two_tap' | 'single_tap' | 'auto_done';
  station_type: 'slot' | 'batch';
  is_archived: boolean;
}

export interface KdsConfigState {
  station: KdsStationConfig | null;
  hub_time: HubTime | null;
}

export interface KdsConfig {
  state(): KdsConfigState;
  /** every socket frame; a catch-up or a BranchConfigApplied event reads the config again */
  onFrame(frame: WsServerMessage): void;
  subscribe(fn: () => void): () => void;
  dispose(): void;
}

type Reply = { snapshot?: { stations?: unknown }; hub_time?: { now_ms?: unknown; utc_offset_ms?: unknown } } | null;

function stationOf(reply: Reply, stationId: string): KdsStationConfig | null {
  const list = Array.isArray(reply?.snapshot?.stations) ? (reply!.snapshot!.stations as Array<Record<string, unknown>>) : [];
  const s = list.find((x) => x['station_id'] === stationId);
  if (s === undefined) return null;
  const mode = s['completion_mode'];
  return {
    name: typeof s['name'] === 'string' ? s['name'] : '',
    completion_mode: mode === 'single_tap' || mode === 'auto_done' ? mode : 'two_tap',
    station_type: s['station_type'] === 'batch' ? 'batch' : 'slot',
    is_archived: s['is_archived'] === true,
  };
}

export function createKdsConfig(o: { stationId: string; load: () => Promise<HubResult<Reply>> }): KdsConfig {
  let current: KdsConfigState = { station: null, hub_time: null };
  let disposed = false;
  /** a read in flight; a trigger during it asks for one more read after it (the newest config wins) */
  let inFlight = false;
  let again = false;
  const listeners = new Set<() => void>();

  async function read(): Promise<void> {
    if (disposed) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    const r = await o.load();
    inFlight = false;
    if (disposed) return;
    if (r.ok) {
      const t = r.data?.hub_time;
      const hub_time = typeof t?.now_ms === 'number' && typeof t.utc_offset_ms === 'number' ? { now_ms: t.now_ms, utc_offset_ms: t.utc_offset_ms } : current.hub_time;
      current = { station: stationOf(r.data, o.stationId) ?? current.station, hub_time };
      for (const fn of [...listeners]) fn();
    }
    if (again) {
      again = false;
      void read();
    }
  }

  void read();
  return {
    state: () => current,
    onFrame(frame) {
      if (frame.type === 'catch_up' || (frame.type === 'event' && frame.event.event_type === 'BranchConfigApplied')) void read();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}

/** `GET /queries/branch-config` on the station session (device token + session token) */
export function branchConfigLoader(o: { fetch: (input: string, init?: RequestInit) => Promise<Response>; deviceToken: string; sessionToken: string }) {
  return async (): Promise<HubResult<Reply>> => {
    try {
      const response = await o.fetch('/queries/branch-config', { method: 'GET', headers: { Authorization: `Bearer ${o.deviceToken}`, 'X-Session-Token': o.sessionToken } });
      const body = (await response.json().catch(() => null)) as { data?: Reply; error?: { code?: unknown } } | null;
      if (response.ok) return { ok: true, data: body?.data ?? null };
      const code = typeof body?.error?.code === 'string' ? body.error.code : 'INTERNAL_ERROR';
      return { ok: false, error: { kind: 'api', status: response.status, code, details: {} } };
    } catch {
      return { ok: false, error: { kind: 'network' } };
    }
  };
}
