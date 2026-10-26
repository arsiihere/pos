import type {
  AdminBranch,
  AdminCategory,
  AdminFloor,
  AdminMenuItem,
  AdminMenuPage,
  AdminProgram,
  AdminRoute,
  AdminStation,
  AdminTable,
  AdminTaxClass,
  AdminWindow,
  CreateCategoryRequest,
  CreateFloorRequest,
  CreateMenuItemRequest,
  CreateProgramRequest,
  CreateStationRequest,
  CreateTableRequest,
  CreateTaxClassRequest,
  OwnerLogin,
  OwnerUser,
  PatchCategoryRequest,
  PatchFloorRequest,
  PatchMenuItemRequest,
  PatchProgramRequest,
  PatchStationRequest,
  PatchTableRequest,
  PatchTaxClassRequest,
  PutItemRouteRequest,
} from '@pos/events';

// §8.1: the owner app's cloud client for §6.2–§6.16 and the 00 owner login. Tokens live in
// sessionStorage (cleared when the tab closes). On 401 JWT_INVALID it refreshes once and repeats the
// request with the same headers (so the same Idempotency-Key); a second refusal logs out.
// D5, §7.7: the types come from the @pos/events schemas the cloud routes use.

const ACCESS_KEY = 'owner_access_token';
const REFRESH_KEY = 'owner_refresh_token';
const USER_KEY = 'owner_user';

export type { OwnerUser };

export type CloudError =
  | { kind: 'network' }
  | { kind: 'logged_out' }
  | { kind: 'permission_denied'; reason: string | null }
  | { kind: 'api'; status: number; code: string; details: Record<string, unknown> };

export type CloudResult<T> = { ok: true; data: T } | { ok: false; error: CloudError };

export type Branch = AdminBranch;
export type AvailabilityWindow = AdminWindow;
export type Table = AdminTable;
export type Floor = AdminFloor;
export type Station = AdminStation;
export type StationType = Station['station_type'];
export type CompletionMode = Station['completion_mode'];
export type Program = AdminProgram;
export type TaxClass = AdminTaxClass;
export type Category = AdminCategory;
export type Route = AdminRoute;
export type MenuItem = AdminMenuItem;
export type ServeMode = MenuItem['serve_mode'];
export type OutOfStockBehaviour = MenuItem['out_of_stock_behaviour'];
export type MenuPage = AdminMenuPage;

// The §6.11 query string (not a body; the cloud's MenuQuery coerces limit from text).
export interface MenuQuery {
  q?: string;
  category_id?: string;
  status?: 'active' | 'archived';
  cursor?: string;
  limit?: number;
}

export type CreateFloorBody = CreateFloorRequest;
export type PatchFloorBody = PatchFloorRequest;
export type CreateTableBody = CreateTableRequest;
export type PatchTableBody = PatchTableRequest;
export type CreateStationBody = CreateStationRequest;
export type PatchStationBody = PatchStationRequest;
export type CreateProgramBody = CreateProgramRequest;
export type PatchProgramBody = PatchProgramRequest;
export type CreateTaxClassBody = CreateTaxClassRequest;
export type PatchTaxClassBody = PatchTaxClassRequest;
export type CreateCategoryBody = CreateCategoryRequest;
export type PatchCategoryBody = PatchCategoryRequest;
export type CreateMenuItemBody = CreateMenuItemRequest;
export type PatchMenuItemBody = PatchMenuItemRequest;
export type PutItemRouteBody = PutItemRouteRequest;

type LoginData = OwnerLogin;

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';

export interface CloudAdminOptions {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  baseUrl?: string;
  storage?: Storage;
  onLoggedOut: () => void;
}

type Reply = { status: number; body: unknown } | null;

function errorOf(reply: { status: number; body: unknown }): CloudError {
  const error = (reply.body as { error?: { code?: unknown; details?: unknown } } | null)?.error;
  const code = typeof error?.code === 'string' ? error.code : 'INTERNAL';
  const details = (typeof error?.details === 'object' && error.details !== null ? error.details : {}) as Record<
    string,
    unknown
  >;
  if (code === 'PERMISSION_DENIED') {
    return { kind: 'permission_denied', reason: typeof details['reason'] === 'string' ? details['reason'] : null };
  }
  return { kind: 'api', status: reply.status, code, details };
}

// S53: after a network failure the client probes with a read on this backoff until the cloud answers.
export function probeDelayMs(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 5_000);
}

function isJwtInvalid(reply: Reply): boolean {
  if (reply === null || reply.status !== 401) return false;
  const error = errorOf(reply);
  return error.kind === 'api' && error.code === 'JWT_INVALID';
}

export function createCloudAdmin(options: CloudAdminOptions) {
  const fetchFn = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const base = options.baseUrl ?? '';
  const storage = options.storage ?? sessionStorage;
  let refreshing: Promise<boolean> | null = null;
  // S53: the cloud is down after a network failure until any call (a probe or the user's) gets an answer.
  // The probe re-reads the last GET path; its answer is thrown away, so it never replaces an open form.
  let down = false;
  let lastRead: string | null = null;
  let probeTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(down: boolean) => void>();

  function setDown(next: boolean): void {
    if (next === down) return;
    down = next;
    if (!next && probeTimer !== null) {
      clearTimeout(probeTimer);
      probeTimer = null;
    }
    for (const listener of listeners) listener(next);
  }

  function scheduleProbe(attempt: number): void {
    if (probeTimer !== null || lastRead === null) return;
    const path = lastRead;
    probeTimer = setTimeout(() => {
      probeTimer = null;
      void send('GET', path, undefined, {}).then((reply) => {
        if (reply !== null) setDown(false);
        else if (down) scheduleProbe(attempt + 1);
      });
    }, probeDelayMs(attempt));
  }

  function storeLogin(data: LoginData): void {
    storage.setItem(ACCESS_KEY, data.access_token);
    storage.setItem(REFRESH_KEY, data.refresh_token);
    storage.setItem(USER_KEY, JSON.stringify(data.user));
  }

  function clearLogin(): void {
    storage.removeItem(ACCESS_KEY);
    storage.removeItem(REFRESH_KEY);
    storage.removeItem(USER_KEY);
  }

  async function send(method: Method, path: string, body: unknown, headers: Record<string, string>): Promise<Reply> {
    const access = storage.getItem(ACCESS_KEY);
    const all: Record<string, string> = { ...headers };
    if (access !== null) all['Authorization'] = `Bearer ${access}`;
    if (body !== undefined) all['Content-Type'] = 'application/json';
    try {
      const response = await fetchFn(base + path, {
        method,
        headers: all,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const reply = { status: response.status, body: await response.json() };
      setDown(false);
      return reply;
    } catch {
      return null;
    }
  }

  async function refreshOnce(): Promise<boolean> {
    const token = storage.getItem(REFRESH_KEY);
    if (token === null) return false;
    const reply = await send('POST', '/v1/auth/refresh', { refresh_token: token }, {});
    if (reply === null || reply.status !== 200) return false;
    storeLogin((reply.body as { data: LoginData }).data);
    return true;
  }

  function logOut(): void {
    clearLogin();
    options.onLoggedOut();
  }

  function loggedOut<T>(): CloudResult<T> {
    logOut();
    return { ok: false, error: { kind: 'logged_out' } };
  }

  async function call<T>(method: Method, path: string, body?: unknown, idempotencyKey?: string): Promise<CloudResult<T>> {
    if (method === 'GET') lastRead = path;
    const headers: Record<string, string> = idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey };
    let reply = await send(method, path, body, headers);
    if (isJwtInvalid(reply)) {
      // Concurrent calls share one refresh; a refused refresh logs out once, not once per waiting call.
      refreshing ??= refreshOnce()
        .then((ok) => {
          if (!ok) logOut();
          return ok;
        })
        .finally(() => {
          refreshing = null;
        });
      if (!(await refreshing)) return { ok: false, error: { kind: 'logged_out' } };
      reply = await send(method, path, body, headers);
      if (isJwtInvalid(reply)) return loggedOut();
    }
    if (reply === null) {
      setDown(true);
      scheduleProbe(0);
      return { ok: false, error: { kind: 'network' } };
    }
    if (reply.status >= 200 && reply.status < 300) return { ok: true, data: (reply.body as { data: T }).data };
    return { ok: false, error: errorOf(reply) };
  }

  const branch = (branchId: string) => `/v1/admin/branches/${encodeURIComponent(branchId)}`;
  const id = encodeURIComponent;

  return {
    currentUser(): OwnerUser | null {
      const raw = storage.getItem(USER_KEY);
      return raw === null || storage.getItem(ACCESS_KEY) === null ? null : (JSON.parse(raw) as OwnerUser);
    },

    async login(email: string, password: string): Promise<CloudResult<OwnerUser>> {
      const reply = await send('POST', '/v1/auth/login', { email, password }, {});
      if (reply === null) return { ok: false, error: { kind: 'network' } };
      if (reply.status !== 200) return { ok: false, error: errorOf(reply) };
      const data = (reply.body as { data: LoginData }).data;
      storeLogin(data);
      return { ok: true, data: data.user };
    },

    cloudDown: (): boolean => down,
    onCloudDown(listener: (down: boolean) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    // S50 a: best effort. The body is read when each request is sent, so after a refresh (which rotates
    // the refresh token, 00 M49) the repeated logout carries the new one. Storage is cleared either way.
    async logout(): Promise<void> {
      const body = () => ({ refresh_token: storage.getItem(REFRESH_KEY) ?? '' });
      if (storage.getItem(REFRESH_KEY) !== null) {
        const reply = await send('POST', '/v1/auth/logout', body(), {});
        if (isJwtInvalid(reply) && (await refreshOnce())) await send('POST', '/v1/auth/logout', body(), {});
      }
      clearLogin();
      lastRead = null;
      setDown(false);
    },

    // §6.7b (S58) the owner's branches, for their names
    listBranches: () => call<{ branches: Branch[] }>('GET', '/v1/admin/branches'),

    // §6.2–§6.6 floors and tables
    listFloors: (branchId: string) =>
      call<{ floors: (Floor & { tables: Table[] })[] }>('GET', `${branch(branchId)}/floors`),
    createFloor: (branchId: string, body: CreateFloorBody, key: string) =>
      call<{ floor: Floor }>('POST', `${branch(branchId)}/floors`, body, key),
    patchFloor: (branchId: string, floorId: string, body: PatchFloorBody) =>
      call<{ floor: Floor }>('PATCH', `${branch(branchId)}/floors/${id(floorId)}`, body),
    createTable: (branchId: string, body: CreateTableBody, key: string) =>
      call<{ table: Table & { floor_id: string } }>('POST', `${branch(branchId)}/tables`, body, key),
    patchTable: (branchId: string, tableId: string, body: PatchTableBody) =>
      call<{ table: Table & { floor_id: string } }>('PATCH', `${branch(branchId)}/tables/${id(tableId)}`, body),

    // §6.8–§6.10 stations and programs
    listStations: (branchId: string) =>
      call<{ stations: (Station & { programs: Program[] })[] }>('GET', `${branch(branchId)}/stations`),
    createStation: (branchId: string, body: CreateStationBody, key: string) =>
      call<{ station: Station }>('POST', `${branch(branchId)}/stations`, body, key),
    patchStation: (branchId: string, stationId: string, body: PatchStationBody) =>
      call<{ station: Station }>('PATCH', `${branch(branchId)}/stations/${id(stationId)}`, body),
    createProgram: (branchId: string, stationId: string, body: CreateProgramBody, key: string) =>
      call<{ program: Program & { station_id: string } }>(
        'POST',
        `${branch(branchId)}/stations/${id(stationId)}/programs`,
        body,
        key,
      ),
    patchProgram: (branchId: string, stationId: string, programId: string, body: PatchProgramBody) =>
      call<{ program: Program & { station_id: string } }>(
        'PATCH',
        `${branch(branchId)}/stations/${id(stationId)}/programs/${id(programId)}`,
        body,
      ),

    // §6.11–§6.16 menu
    getMenu: (query: MenuQuery) => {
      const params = new URLSearchParams();
      if (query.q !== undefined) params.set('q', query.q);
      if (query.category_id !== undefined) params.set('category_id', query.category_id);
      if (query.status !== undefined) params.set('status', query.status);
      if (query.cursor !== undefined) params.set('cursor', query.cursor);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      const search = params.toString();
      return call<MenuPage>('GET', `/v1/admin/menu${search === '' ? '' : `?${search}`}`);
    },
    createTaxClass: (body: CreateTaxClassBody, key: string) =>
      call<{ tax_class: TaxClass }>('POST', '/v1/admin/tax-classes', body, key),
    patchTaxClass: (taxClassId: string, body: PatchTaxClassBody) =>
      call<{ tax_class: TaxClass }>('PATCH', `/v1/admin/tax-classes/${id(taxClassId)}`, body),
    createCategory: (body: CreateCategoryBody, key: string) =>
      call<{ category: Category }>('POST', '/v1/admin/categories', body, key),
    patchCategory: (categoryId: string, body: PatchCategoryBody) =>
      call<{ category: Category }>('PATCH', `/v1/admin/categories/${id(categoryId)}`, body),
    createMenuItem: (body: CreateMenuItemBody, key: string) =>
      call<{ item: MenuItem }>('POST', '/v1/admin/menu-items', body, key),
    patchMenuItem: (itemId: string, body: PatchMenuItemBody) =>
      call<{ item: MenuItem }>('PATCH', `/v1/admin/menu-items/${id(itemId)}`, body),
    putItemRoute: (itemId: string, branchId: string, body: PutItemRouteBody) =>
      call<{ route: Route | null }>('PUT', `/v1/admin/menu-items/${id(itemId)}/routes/${id(branchId)}`, body),
  };
}

export type CloudAdmin = ReturnType<typeof createCloudAdmin>;
