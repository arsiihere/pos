import type { Unit } from '@pos/domain';

// §8.1: the owner app's cloud client for §6.2–§6.16 and the 00 owner login. Tokens live in
// sessionStorage (cleared when the tab closes). On 401 JWT_INVALID it refreshes once and repeats the
// request with the same headers (so the same Idempotency-Key); a second refusal logs out.

const ACCESS_KEY = 'owner_access_token';
const REFRESH_KEY = 'owner_refresh_token';
const USER_KEY = 'owner_user';

export interface OwnerUser {
  user_id: string;
  display_name: string;
  tenant_id: string;
  allowed_branch_ids: string[];
}

export type CloudError =
  | { kind: 'network' }
  | { kind: 'logged_out' }
  | { kind: 'permission_denied'; reason: string | null }
  | { kind: 'api'; status: number; code: string; details: Record<string, unknown> };

export type CloudResult<T> = { ok: true; data: T } | { ok: false; error: CloudError };

export interface AvailabilityWindow {
  start_ms: number;
  end_ms: number;
}

export interface Table {
  table_id: string;
  name: string;
  seats: number | null;
  sort_order: number;
  archived_at: number | null;
}

export interface Floor {
  floor_id: string;
  name: string;
  sort_order: number;
  archived_at: number | null;
}

export type StationType = 'slot' | 'batch';
export type CompletionMode = 'two_tap' | 'single_tap' | 'auto_done';

export interface Station {
  station_id: string;
  name: string;
  location_label: string | null;
  station_type: StationType;
  capacity: number;
  freshness_window_ms: number | null;
  completion_mode: CompletionMode;
  archived_at: number | null;
}

export interface Program {
  program_id: string;
  name: string;
  cook_time_ms: number;
  archived_at: number | null;
}

export interface TaxClass {
  tax_class_id: string;
  name: string;
  rate_bp: number;
  archived_at: number | null;
}

export interface Category {
  category_id: string;
  name: string;
  sort_order: number;
  archived_at: number | null;
  availability_windows: AvailabilityWindow[];
}

export interface Route {
  branch_id: string;
  station_id: string;
  program_id: string | null;
  stock_program_id: string | null;
}

export type ServeMode = 'immediate' | 'sync';
export type OutOfStockBehaviour = 'cook_fresh' | 'sold_out';

export interface MenuItemFields {
  category_id: string;
  tax_class_id: string | null;
  name: string;
  group_label: string | null;
  description: string | null;
  sort_order: number;
  price_minor: number;
  serve_mode: ServeMode;
  prep_buffer_ms: number;
  cook_time_ms: number;
  stock_time_ms: number | null;
  out_of_stock_behaviour: OutOfStockBehaviour;
  stock_unit: Unit;
  sale_unit: Unit;
  stock_per_sale_unit: number;
  low_stock_threshold: number | null;
  carries_over: boolean;
  availability_windows: AvailabilityWindow[];
}

export interface MenuItem extends MenuItemFields {
  item_id: string;
  archived_at: number | null;
  routes: Route[];
}

export interface MenuPage {
  can_edit_tenant: boolean;
  tax_classes: TaxClass[];
  categories: Category[];
  items: MenuItem[];
  next_cursor: string | null;
}

export interface MenuQuery {
  q?: string;
  category_id?: string;
  status?: 'active' | 'archived';
  cursor?: string;
  limit?: number;
}

type Archivable = { archived?: boolean };

export type CreateFloorBody = { name: string; sort_order?: number };
export type PatchFloorBody = Partial<CreateFloorBody> & Archivable;
export type CreateTableBody = { floor_id: string; name: string; seats?: number | null; sort_order?: number };
export type PatchTableBody = Partial<CreateTableBody> & Archivable;
export type CreateStationBody = {
  name: string;
  location_label?: string | null;
  station_type: StationType;
  capacity: number;
  freshness_window_ms?: number;
  completion_mode?: CompletionMode;
};
export type PatchStationBody = Partial<CreateStationBody> & Archivable;
export type CreateProgramBody = { name: string; cook_time_ms: number };
export type PatchProgramBody = Partial<CreateProgramBody> & Archivable;
export type CreateTaxClassBody = { name: string; rate_bp: number };
export type PatchTaxClassBody = Partial<CreateTaxClassBody> & Archivable;
export type CreateCategoryBody = { name: string; sort_order?: number; availability_windows?: AvailabilityWindow[] };
export type PatchCategoryBody = Partial<CreateCategoryBody> & Archivable;
export type CreateMenuItemBody = Pick<
  MenuItemFields,
  'category_id' | 'tax_class_id' | 'name' | 'price_minor' | 'serve_mode' | 'cook_time_ms'
> &
  Partial<MenuItemFields> & {
    routes?: { branch_id: string; station_id: string; program_id?: string | null; stock_program_id?: string | null }[];
  };
export type PatchMenuItemBody = Partial<MenuItemFields> & Archivable;
export type PutItemRouteBody =
  | { station_id: string; program_id?: string | null; stock_program_id?: string | null }
  | { station_id: null };

interface LoginData {
  access_token: string;
  refresh_token: string;
  user: OwnerUser;
}

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
      return { status: response.status, body: await response.json() };
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

  function loggedOut<T>(): CloudResult<T> {
    clearLogin();
    options.onLoggedOut();
    return { ok: false, error: { kind: 'logged_out' } };
  }

  async function call<T>(method: Method, path: string, body?: unknown, idempotencyKey?: string): Promise<CloudResult<T>> {
    const headers: Record<string, string> = idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey };
    let reply = await send(method, path, body, headers);
    if (isJwtInvalid(reply)) {
      // Concurrent calls share one refresh.
      refreshing ??= refreshOnce().finally(() => {
        refreshing = null;
      });
      if (!(await refreshing)) return loggedOut();
      reply = await send(method, path, body, headers);
      if (isJwtInvalid(reply)) return loggedOut();
    }
    if (reply === null) return { ok: false, error: { kind: 'network' } };
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

    logout(): void {
      clearLogin();
    },

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
