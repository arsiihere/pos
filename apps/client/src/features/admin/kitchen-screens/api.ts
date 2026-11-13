import { createHubAdmin, readDeviceKey, type HubAdminOptions, type HubError, type HubResult } from '../../../api/hub-admin';

// 03b §3.8, §6.9, §6.10, §6.12 (task A1): the hub client of /admin/kitchen-screens/ (and, through
// createAdminPageApi, of /admin/printers/). Sign-in, roster, logout and the envelope ids come from 00's admin
// client (apps/client/src/api/hub-admin.ts, the same sessionStorage keys, shared with /admin and /admin/stock/);
// the page's own reads and commands go through the same headers: the device token as `Authorization: Bearer`,
// the admin session as `X-Admin-Session`. Q-54: nothing here repeats a read on its own.

export type { HubError, HubResult };

const SESSION_KEY = 'admin_session_token';
const STAFF_KEY = 'admin_staff_id';
// The keys hub-admin.ts clears on a signed-out answer (00 M89: shared with /admin).
const SESSION_KEYS = [SESSION_KEY, STAFF_KEY, 'admin_name', 'admin_permissions', 'admin_bootstrap'];
const SIGNED_OUT = new Set(['ADMIN_SESSION_REQUIRED', 'SESSION_EXPIRED']);

export type ScreenState = 'connected' | 'signed_out' | 'offline';

/** 03b §6.12; `points` and the warnings' `name` are Q-48 (hub task HK6): absent before it lands. */
export interface KdsConfig {
  stations: Array<{
    station_id: string;
    name: string;
    point_id: string;
    sound_volume: number;
    lanes: { lanes_on: number | null; lane_count: number };
    screens: Array<{ device_id: string; name: string; lane_label: string | null; state: ScreenState }>;
    dark: boolean;
  }>;
  pass_tablets: Array<{ device_id: string; name: string; point_id: string; state: ScreenState }>;
  points?: Array<{ point_id: string; name: string; is_archived: boolean }>;
  warnings: Array<{ station_id: string; kind: 'archived_open_lines' | 'dark'; name?: string }>;
}

export type KdsStation = KdsConfig['stations'][number];
export type KdsScreen = KdsStation['screens'][number];
export type PassTablet = KdsConfig['pass_tablets'][number];
export type KdsPoint = NonNullable<KdsConfig['points']>[number];
export type KdsWarning = KdsConfig['warnings'][number];

/** 00 §6.14 `GET /admin/queries/devices` (only the fields this page reads). */
export interface HubDevice {
  device_id: string;
  device_name: string;
  device_type: string;
  revoked_at: number | null;
}

export interface DeviceRole {
  device_id: string;
  point_id: string | null;
  lane_label: string | null;
}

// apps/hub/src/commands/registry.ts toKebab: SetStationScreen → set-station-screen.
function kebab(commandType: string): string {
  return commandType
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function errorOf(status: number, body: unknown): HubError {
  const error = (body as { error?: { code?: unknown; details?: unknown } } | null)?.error;
  const code = typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR';
  const details = (typeof error?.details === 'object' && error.details !== null ? error.details : {}) as Record<string, unknown>;
  return { kind: 'api', status, code, details };
}

/** The admin-session part both 03 admin pages share (sign-in from hub-admin.ts + reads, commands, posts). */
export function createAdminPageApi(options: HubAdminOptions) {
  const admin = createHubAdmin(options);
  const fetchFn = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const base = options.baseUrl ?? '';
  const storage = options.storage ?? sessionStorage;
  const readDeviceToken = options.readDeviceToken ?? (() => readDeviceKey('token'));
  const readDeviceId = options.readDeviceId ?? (() => readDeviceKey('device_id'));
  let ids: { tenant_id: string; branch_id: string } | null = null;

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<HubResult<T>> {
    const headers: Record<string, string> = {};
    const token = await readDeviceToken();
    if (token !== null) headers['Authorization'] = `Bearer ${token}`;
    const session = storage.getItem(SESSION_KEY);
    if (session !== null) headers['X-Admin-Session'] = session;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let status: number;
    let json: unknown;
    try {
      const response = await fetchFn(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      status = response.status;
      json = await response.json();
    } catch {
      return { ok: false, error: { kind: 'network' } };
    }
    if (status >= 200 && status < 300) return { ok: true, data: (json as { data: T }).data };
    const error = errorOf(status, json);
    if (error.kind === 'api' && SIGNED_OUT.has(error.code)) {
      for (const key of SESSION_KEYS) storage.removeItem(key);
      options.onSignedOut();
      return { ok: false, error: { kind: 'signed_out' } };
    }
    return { ok: false, error };
  }

  // F §6.3: one envelope per command; the ids come from config-status (00 D7), read once before the first command.
  async function command<T>(commandType: string, payload: Record<string, unknown>, commandId: string): Promise<HubResult<T>> {
    if (ids === null) {
      const status = await admin.configStatus();
      if (!status.ok) return status;
      if (status.data.tenant_id === null || status.data.branch_id === null) {
        return { ok: false, error: { kind: 'api', status: 409, code: 'HUB_NOT_PROVISIONED', details: {} } };
      }
      ids = { tenant_id: status.data.tenant_id, branch_id: status.data.branch_id };
    }
    const envelope = {
      command_id: commandId,
      tenant_id: ids.tenant_id,
      branch_id: ids.branch_id,
      command_type: commandType,
      payload,
      occurred_at: Date.now(),
      actor_id: storage.getItem(STAFF_KEY),
      device_id: (await readDeviceId()) ?? '',
    };
    const answer = await request<{ result: T }>('POST', `/admin/commands/${kebab(commandType)}`, envelope);
    return answer.ok ? { ok: true, data: answer.data.result } : answer;
  }

  return {
    hasSession: admin.hasSession,
    roster: admin.roster,
    login: admin.login,
    logout: admin.logout,
    adminName: admin.adminName,
    /** 00 M89: the admin's stored permissions (shared with /admin); null when not stored. */
    permission(key: 'manage-devices' | 'manage-staff'): boolean | null {
      try {
        const value = (JSON.parse(storage.getItem('admin_permissions') ?? '{}') as Record<string, unknown>)[key];
        return typeof value === 'boolean' ? value : null;
      } catch {
        return null;
      }
    },
    query: <T>(resource: string) => request<T>('GET', `/admin/queries/${resource}`),
    post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
    command,
  };
}

export type AdminPageApi = ReturnType<typeof createAdminPageApi>;

export function createKitchenScreensApi(options: HubAdminOptions) {
  const page = createAdminPageApi(options);
  return {
    ...page,
    // §6.12
    kdsConfig: () => page.query<KdsConfig>('kds-config'),
    // 00 §6.14: the bind picker's tablets (Q-16).
    devices: () => page.query<{ devices: HubDevice[] }>('devices'),
    // §6.9
    setStationScreen: (payload: { station_id: string; sound_volume: number }, commandId: string) =>
      page.command<{ station_id: string; sound_volume: number }>('SetStationScreen', payload, commandId),
    // §6.10: an omitted field keeps the device's value.
    setDeviceRole: (payload: { device_id: string; point_id?: string | null; lane_label?: string | null }, commandId: string) =>
      page.command<DeviceRole>('SetDeviceRole', payload, commandId),
  };
}

export type KitchenScreensApi = ReturnType<typeof createKitchenScreensApi>;
