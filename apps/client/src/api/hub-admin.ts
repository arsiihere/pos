import type {
  AddPrecookedStockAnswer,
  AddPrecookedStockRequest,
  CloseBusinessDayAnswer,
  HubAdminLogin,
  HubAdminRoster,
  HubConfigStatus,
  HubStockAnswer,
  OpenBusinessDayAnswer,
  SetItemAvailabilityAnswer,
  SetItemAvailabilityRequest,
  SetPrecookedStockAnswer,
  SetPrecookedStockRequest,
} from '@pos/events';

// §8.2: the /admin/stock page's hub client. It calls the endpoints 00's admin pages call: the device
// token from IndexedDB `pos-device` / `device` as `Authorization: Bearer`, the admin session from
// sessionStorage `admin_session_token` as `X-Admin-Session`. D7: the command envelope's tenant_id and
// branch_id come from config-status (§6.21), read before the first command.
// D5, §7.7: the types come from the @pos/events hub admin schemas.

const SESSION_KEY = 'admin_session_token';
const STAFF_KEY = 'admin_staff_id';
// S54 g: the admin session is shared with 00's /admin page on this origin, so the stock page writes and
// clears the same keys it does (00 M89).
const NAME_KEY = 'admin_name';
const PERMISSIONS_KEY = 'admin_permissions';
const SESSION_KEYS = [SESSION_KEY, STAFF_KEY, NAME_KEY, PERMISSIONS_KEY, 'admin_bootstrap'];

export type HubError =
  | { kind: 'network' }
  | { kind: 'signed_out' }
  | { kind: 'api'; status: number; code: string; details: Record<string, unknown> };

export type HubResult<T> = { ok: true; data: T } | { ok: false; error: HubError };

export type { HubConfigStatus, HubStockAnswer };

export interface StockVersions {
  meta_version: string;
  stock_version: number;
}

export interface HubAdminOptions {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  baseUrl?: string;
  storage?: Storage;
  readDeviceToken?: () => Promise<string | null>;
  readDeviceId?: () => Promise<string | null>;
  onSignedOut: () => void;
}

type Reply = { status: number; body: unknown } | null;

// The admin session is gone (ended, idle or never valid): the page goes back to the roster.
const SIGNED_OUT = new Set(['ADMIN_SESSION_REQUIRED', 'SESSION_EXPIRED']);

function errorOf(reply: { status: number; body: unknown }): HubError {
  const error = (reply.body as { error?: { code?: unknown; details?: unknown } } | null)?.error;
  const code = typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR';
  const details = (typeof error?.details === 'object' && error.details !== null ? error.details : {}) as Record<
    string,
    unknown
  >;
  return { kind: 'api', status: reply.status, code, details };
}

// The same store as the pairing page (apps/hub/src/auth/pair-page.ts): database `pos-device`, store
// `device`, keys `token`, `device_id` and `device_type` (also read by the 01d staff entry).
export function readDeviceKey(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open('pos-device', 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('device')) request.result.createObjectStore('device');
    };
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('device').objectStore('device').get(key);
      read.onsuccess = () => {
        db.close();
        resolve(typeof read.result === 'string' ? read.result : null);
      };
      read.onerror = () => {
        db.close();
        resolve(null);
      };
    };
    request.onerror = () => resolve(null);
  });
}

/** The pairing keys of `pos-device` (apps/hub/src/auth/pair-page.ts); nothing else in that store is the pairing. */
const PAIRING_KEYS = ['token', 'device_id', 'device_type'] as const;

/**
 * 02a §8 Login (Q-13): the hub no longer knows this device (401 DEVICE_TOKEN_INVALID, 403 DEVICE_REVOKED, WS 4403):
 * forget the pairing so the device can be paired again. Only the three keys go; other keys of the store and every
 * other database (the command queue, drafts: "unsent orders stay on this screen") are not touched. Rejects when the
 * keys could not be deleted, so the caller never sends a still-paired device to the pair page (which would send it
 * straight back to /staff/).
 */
export function wipeDeviceKeys(): Promise<void> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open('pos-device', 1);
    } catch (e) {
      reject(e);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('device')) request.result.createObjectStore('device');
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('device', 'readwrite');
      const store = tx.objectStore('device');
      for (const key of PAIRING_KEYS) store.delete(key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      const failed = () => {
        db.close();
        reject(tx.error ?? new Error('wipe failed'));
      };
      tx.onerror = failed;
      tx.onabort = failed;
    };
    request.onerror = () => reject(request.error ?? new Error('wipe failed'));
  });
}

export function createHubAdmin(options: HubAdminOptions) {
  const fetchFn = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const base = options.baseUrl ?? '';
  const storage = options.storage ?? sessionStorage;
  const readDeviceToken = options.readDeviceToken ?? (() => readDeviceKey('token'));
  const readDeviceId = options.readDeviceId ?? (() => readDeviceKey('device_id'));
  let ids: { tenant_id: string; branch_id: string } | null = null;

  function clearSession(): void {
    for (const key of SESSION_KEYS) storage.removeItem(key);
  }

  async function send(method: 'GET' | 'POST', path: string, body: unknown, withSession: boolean): Promise<Reply> {
    const headers: Record<string, string> = {};
    const deviceToken = await readDeviceToken();
    if (deviceToken !== null) headers['Authorization'] = `Bearer ${deviceToken}`;
    const session = storage.getItem(SESSION_KEY);
    if (withSession && session !== null) headers['X-Admin-Session'] = session;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const response = await fetchFn(base + path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    } catch {
      return null;
    }
  }

  function result<T>(reply: Reply, signsOut: boolean): HubResult<T> {
    if (reply === null) return { ok: false, error: { kind: 'network' } };
    if (reply.status >= 200 && reply.status < 300) return { ok: true, data: (reply.body as { data: T }).data };
    const error = errorOf(reply);
    if (signsOut && error.kind === 'api' && SIGNED_OUT.has(error.code)) {
      clearSession();
      options.onSignedOut();
      return { ok: false, error: { kind: 'signed_out' } };
    }
    return { ok: false, error };
  }

  async function query<T>(path: string): Promise<HubResult<T>> {
    return result<T>(await send('GET', path, undefined, true), true);
  }

  async function configStatus(): Promise<HubResult<HubConfigStatus>> {
    const answer = await query<HubConfigStatus>('/admin/queries/config-status');
    if (answer.ok && answer.data.tenant_id !== null && answer.data.branch_id !== null) {
      ids = { tenant_id: answer.data.tenant_id, branch_id: answer.data.branch_id };
    }
    return answer;
  }

  // F §6.3: one envelope per command; the caller keeps command_id for retries (D32).
  async function command<T>(
    path: string,
    commandType: string,
    payload: Record<string, unknown>,
    commandId: string,
  ): Promise<HubResult<T>> {
    if (ids === null) {
      const status = await configStatus();
      if (!status.ok) return status;
      if (ids === null) {
        return { ok: false, error: { kind: 'api', status: 409, code: 'HUB_NOT_PROVISIONED', details: {} } };
      }
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
    const answer = result<{ result: T }>(await send('POST', `/admin/commands/${path}`, envelope, true), true);
    return answer.ok ? { ok: true, data: answer.data.result } : answer;
  }

  return {
    hasSession(): boolean {
      return storage.getItem(SESSION_KEY) !== null;
    },

    // 00 §8.2: the admin roster and PIN login.
    roster: async (): Promise<HubResult<HubAdminRoster>> =>
      result<HubAdminRoster>(await send('GET', '/admin/login-roster', undefined, false), false),

    async login(staffId: string, pin: string): Promise<HubResult<HubAdminLogin>> {
      const answer = result<HubAdminLogin>(await send('POST', '/admin/auth', { staff_id: staffId, pin }, false), false);
      if (answer.ok) {
        storage.setItem(SESSION_KEY, answer.data.admin_session_token);
        storage.setItem(STAFF_KEY, answer.data.staff_id);
        storage.setItem(NAME_KEY, answer.data.display_name);
        if (answer.data.permissions !== undefined) storage.setItem(PERMISSIONS_KEY, JSON.stringify(answer.data.permissions));
      }
      return answer;
    },

    adminName: (): string | null => storage.getItem(NAME_KEY),
    staffId: (): string | null => storage.getItem(STAFF_KEY),

    // Q3, S54 e: best effort; the keys go either way.
    async logout(): Promise<void> {
      if (storage.getItem(SESSION_KEY) !== null) await send('POST', '/admin/auth/logout', {}, true);
      clearSession();
    },

    // §6.21 (D7: with the ids) and §6.19 (with the last versions, so an unchanged poll is short).
    configStatus,
    stock(versions?: StockVersions): Promise<HubResult<HubStockAnswer>> {
      const params = new URLSearchParams();
      if (versions !== undefined) {
        params.set('meta_version', versions.meta_version);
        params.set('stock_version', String(versions.stock_version));
      }
      const search = params.toString();
      return query<HubStockAnswer>(`/admin/queries/stock${search === '' ? '' : `?${search}`}`);
    },

    // §6.17–§6.18b
    setPrecookedStock: (payload: SetPrecookedStockRequest, commandId: string) =>
      command<SetPrecookedStockAnswer>('set-precooked-stock', 'SetPrecookedStock', payload, commandId),
    addPrecookedStock: (payload: AddPrecookedStockRequest, commandId: string) =>
      command<AddPrecookedStockAnswer>('add-precooked-stock', 'AddPrecookedStock', payload, commandId),
    setItemAvailability: (payload: SetItemAvailabilityRequest, commandId: string) =>
      command<SetItemAvailabilityAnswer>('set-item-availability', 'SetItemAvailability', payload, commandId),
    openBusinessDay: (commandId: string) =>
      command<OpenBusinessDayAnswer>('open-business-day', 'OpenBusinessDay', {}, commandId),
    closeBusinessDay: (commandId: string) =>
      command<CloseBusinessDayAnswer>('close-business-day', 'CloseBusinessDay', {}, commandId),
  };
}

export type HubAdmin = ReturnType<typeof createHubAdmin>;
