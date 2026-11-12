import type { DeviceType, Scope } from '@pos/domain';
import { AlertReceiptsResponse, AlertsInboxResponse, RequestsToAnswerResponse, type SendTestAlertPayload } from '@pos/events';
import type { HubError, HubResult } from '../../api/hub-admin';
import { newUlid } from '../../app/ulid';
import type { ReceiptsData } from '../alerts/Receipts';
import type { RequestRow } from '../alerts/RequestsToAnswer';

// 01d task 41: the staff entry's hub client on the device routes (00 §6.3): the device token as
// `Authorization: Bearer`, the staff session as `X-Session-Token`. Sign-in is 00's `POST /auth/pin` (the staff
// PIN flow the admin-stock page uses, on the device route), sign-out `POST /auth/logout`. The session token is
// held in memory only. The F §6.3 envelope ids come from the page (`PageMeta`, served by the hub).

export interface Device {
  token: string;
  id: string;
  type: DeviceType;
}

/** What the hub puts into /staff/index.html (apps/hub/src/server.ts, proposed AD). */
export interface PageMeta {
  tenantId: string;
  branchId: string;
  branchName: string;
  hubNowMs: number;
  utcOffsetMs: number;
}

export function readPageMeta(doc: Document = document): PageMeta | null {
  const get = (name: string) => doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? null;
  const tenantId = get('pos-tenant-id');
  const branchId = get('pos-branch-id');
  if (tenantId === null || branchId === null) return null;
  const num = (name: string) => {
    const v = Number(get(name));
    return Number.isFinite(v) ? v : 0;
  };
  return { tenantId, branchId, branchName: get('pos-branch-name') ?? '', hubNowMs: num('pos-hub-now-ms'), utcOffsetMs: num('pos-hub-utc-offset-ms') };
}

export interface RosterPerson {
  staff_id: string;
  display_name: string;
  locked_until: number | null;
}

export interface SignedIn {
  session_token: string;
  session_id: string;
  staff_id: string;
  display_name: string;
  role_ids: string[];
  idle_ttl_ms: number;
}

/**
 * 01b §3.3 effective permission, kept whole (02a §3.15, R5): `scope` on a granting result, the approver roles on
 * `requires_approval` (shape of apps/hub/src/auth/staff-directory.ts Resolution).
 */
export type Resolution =
  | { grant: 'allowed'; scope: Scope }
  | { grant: 'requires_approval'; approver_role_ids: string[]; scope: Scope }
  | { grant: 'not_granted' }
  | { grant: 'denied' };

export interface SessionInfo {
  permissions: Record<string, Resolution>;
}

/**
 * 02b §3.12 / 00 H-1: a queued command is replayed with its own id, its queue time and its person's session.
 * `sessionToken` and `actorId` go together: the hub refuses an envelope whose actor_id is not the session's staff
 * (commands/route.ts:106), so a replay as the person who queued it (Q-2) names both; without them, the signed-in
 * session and person.
 */
export type CommandOptions = {
  /** the queue entry's command_id (the same id on every replay, M19) */
  commandId?: string;
  /**
   * hub-clock ms the command was queued at → `X-Queued-At` (read by the hub on queueable commands only). Sent
   * rounded to whole ms; a value that is not a finite number ≥ 0 sends no header (the hub accepts /^\d{1,15}$/ only).
   */
  queuedAt?: number;
} & (
  | {
      /** the session of the person who queued it (memory only, Q-2) */
      sessionToken: string;
      /** that person's staff id (the entry's staff_id) */
      actorId: string;
    }
  | { sessionToken?: undefined; actorId?: undefined }
);

/** `X-Queued-At` value: Math.round of the hub-clock estimate, or null when it is not usable. */
export function queuedAtHeader(queuedAt: number): string | null {
  if (!Number.isFinite(queuedAt) || queuedAt < 0) return null;
  const whole = Math.round(queuedAt);
  return whole <= 999_999_999_999_999 ? String(whole) : null;
}

/** The hub's command route (apps/hub/src/commands/registry.ts toKebab): `OpenTable` → `open-table`. */
export function toKebab(commandType: string): string {
  return commandType
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

export type InboxPage = ReturnType<(typeof AlertsInboxResponse)['parse']>;

/** The session is gone (ended, idle, replaced): the page signs out. */
const SIGNED_OUT = new Set(['SESSION_INVALID', 'SESSION_EXPIRED']);

export interface StaffApiOptions {
  device: Device;
  meta: PageMeta;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  baseUrl?: string;
  newCommandId?: () => string;
  onSignedOut: () => void;
}

export function createStaffApi(o: StaffApiOptions) {
  const fetchFn = o.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const base = o.baseUrl ?? '';
  const newCommandId = o.newCommandId ?? (() => newUlid());
  let session: { token: string; staffId: string } | null = null;

  /** `schema`: the @pos/events Zod schema of the whole reply body; a reply that does not match is refused. */
  async function send<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    withSession = true,
    schema?: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
    extra?: { sessionToken?: string; queuedAt?: number },
  ): Promise<HubResult<T>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${o.device.token}` };
    // a queued command may carry its own person's token (Q-2); the signed-in person's own token counts as theirs
    const own = extra?.sessionToken === undefined || extra.sessionToken === session?.token;
    if (extra?.sessionToken !== undefined) headers['X-Session-Token'] = extra.sessionToken;
    else if (withSession && session !== null) headers['X-Session-Token'] = session.token;
    const queued = extra?.queuedAt === undefined ? null : queuedAtHeader(extra.queuedAt);
    if (queued !== null) headers['X-Queued-At'] = queued;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetchFn(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch {
      return { ok: false, error: { kind: 'network' } };
    }
    const parsed: unknown = await response.json().catch(() => null);
    if (response.status >= 200 && response.status < 300) {
      // a 2xx whose body was lost or cut: the outcome is unknown, so it reads as a lost reply (a queued command is
      // sent again with the same id and gets the hub's stored answer, M19)
      if (parsed === null || typeof parsed !== 'object') return { ok: false, error: { kind: 'network' } };
      if (schema === undefined) return { ok: true, data: (parsed as { data: T }).data };
      const checked = schema.safeParse(parsed);
      if (checked.success) return { ok: true, data: checked.data };
      return { ok: false, error: { kind: 'api', status: response.status, code: 'INVALID_RESPONSE', details: {} } };
    }
    const err = (parsed as { error?: { code?: unknown; details?: unknown } } | null)?.error;
    const code = typeof err?.code === 'string' ? err.code : 'INTERNAL_ERROR';
    const details = (typeof err?.details === 'object' && err.details !== null ? err.details : {}) as Record<string, unknown>;
    // another person's session (a queued command, Q-2) never signs the current person out: the caller sees the code
    if (own && withSession && session !== null && SIGNED_OUT.has(code)) {
      session = null;
      o.onSignedOut();
      return { ok: false, error: { kind: 'signed_out' } };
    }
    return { ok: false, error: { kind: 'api', status: response.status, code, details } satisfies HubError };
  }

  /** 00 §6.3 envelope to `POST /commands/<kebab(commandType)>`; `opts` for a queued replay (02b §3.12). */
  async function command<T>(commandType: string, payload: unknown, opts: CommandOptions = {}): Promise<HubResult<T>> {
    // a token without its person would be refused by the hub (actor_id ≠ session) and land in the queue log: refused
    // here, nothing sent
    if ((opts.sessionToken === undefined) !== (opts.actorId === undefined))
      return { ok: false, error: { kind: 'api', status: 0, code: 'CLIENT_SESSION_WITHOUT_ACTOR', details: { local: true } } };
    const extra: { sessionToken?: string; queuedAt?: number } = {};
    if (opts.sessionToken !== undefined) extra.sessionToken = opts.sessionToken;
    if (opts.queuedAt !== undefined) extra.queuedAt = opts.queuedAt;
    const answer = await send<{ result: T }>(
      'POST',
      `/commands/${toKebab(commandType)}`,
      {
        command_id: opts.commandId ?? newCommandId(),
        tenant_id: o.meta.tenantId,
        branch_id: o.meta.branchId,
        command_type: commandType,
        payload,
        occurred_at: Date.now(),
        actor_id: opts.actorId ?? session?.staffId ?? null,
        device_id: o.device.id,
      },
      true,
      undefined,
      extra,
    );
    if (!answer.ok) return answer;
    // 00 §6.3: `{ data: { command_id, event_ids, result } }`; anything else is a lost reply (as above)
    const data = answer.data as { result?: T } | null | undefined;
    if (data === null || typeof data !== 'object' || !('result' in data)) return { ok: false, error: { kind: 'network' } };
    return { ok: true, data: data.result as T };
  }

  /**
   * `GET <path>` with the session; the reply's `data`. `schema` (a Zod schema of `data`): a reply that does not
   * match is refused as INVALID_RESPONSE.
   */
  async function query<T>(path: string, schema?: { safeParse(v: unknown): { success: true; data: T } | { success: false } }): Promise<HubResult<T>> {
    const answer = await send<T>('GET', path);
    if (!answer.ok || schema === undefined) return answer;
    const checked = schema.safeParse(answer.data);
    return checked.success ? { ok: true, data: checked.data } : { ok: false, error: { kind: 'api', status: 200, code: 'INVALID_RESPONSE', details: {} } };
  }

  return {
    device: o.device,
    meta: o.meta,
    sessionToken: () => session?.token ?? null,
    /** the signed-in person's staff id (a queue entry remembers it with the token, Q-2) */
    staffId: () => session?.staffId ?? null,
    command,
    query,

    /** 00 staff-roster: people with a PIN (01b B3), no session; countsAsActivity false. */
    roster: () => send<{ staff: RosterPerson[]; active_session: { staff_id: string; display_name: string } | null }>('GET', '/queries/staff-roster', undefined, false),

    async signIn(staffId: string, pin: string, takeover: boolean): Promise<HubResult<SignedIn>> {
      const answer = await send<SignedIn>('POST', '/auth/pin', { staff_id: staffId, pin, takeover }, false);
      if (answer.ok) session = { token: answer.data.session_token, staffId: answer.data.staff_id };
      return answer;
    },

    async signOut(): Promise<void> {
      if (session !== null) await send('POST', '/auth/logout', {});
      session = null;
    },

    /** The session ended on the hub (4401, idle): forget it without a call. */
    drop(): void {
      session = null;
    },

    session: () => send<SessionInfo>('GET', '/queries/session'),
    /** §6.7: a page of the inbox (50), with the cursor of the next page. */
    async inbox(cursor: string | null): Promise<HubResult<{ alerts: InboxPage['data']['alerts']; next_cursor: string | null }>> {
      const query = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const answer = await send<InboxPage>('GET', `/queries/alerts-inbox?limit=50${query}`, undefined, true, AlertsInboxResponse);
      if (!answer.ok) return answer;
      return { ok: true, data: { alerts: answer.data.data.alerts, next_cursor: answer.data.meta.next_cursor } };
    },
    async requests(): Promise<HubResult<{ requests: RequestRow[] }>> {
      const answer = await send('GET', '/queries/requests-to-answer', undefined, true, RequestsToAnswerResponse);
      return answer.ok ? { ok: true, data: answer.data.data } : answer;
    },
    async receipts(alertId: string): Promise<HubResult<ReceiptsData>> {
      const answer = await send('GET', `/queries/alert-receipts?alert_id=${encodeURIComponent(alertId)}`, undefined, true, AlertReceiptsResponse);
      return answer.ok ? { ok: true, data: answer.data.data } : answer;
    },
    /** §6.23 hub_time (S47): the hub clock again after sign-in; null when the hub has no config yet. */
    async hubTime(): Promise<HubResult<{ now_ms: number; utc_offset_ms: number } | null>> {
      const answer = await send<{ hub_time?: { now_ms?: unknown; utc_offset_ms?: unknown } } | null>('GET', '/queries/branch-config');
      if (!answer.ok) return answer;
      const time = answer.data?.hub_time;
      const ok = typeof time?.now_ms === 'number' && typeof time.utc_offset_ms === 'number';
      return { ok: true, data: ok ? { now_ms: time.now_ms as number, utc_offset_ms: time.utc_offset_ms as number } : null };
    },
    markSeen: (alertIds: string[]) => command<{ seen: string[] }>('MarkAlertsSeen', { alert_ids: alertIds }),
    sendTestAlert: (target: SendTestAlertPayload['target']) => command<{ alert_id: string }>('SendTestAlert', { target }),
  };
}

export type StaffApi = ReturnType<typeof createStaffApi>;
