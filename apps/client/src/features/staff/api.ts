import type { DeviceType } from '@pos/domain';
import type { AlertsInboxResponse, SendTestAlertPayload } from '@pos/events';
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

type Resolution = { grant: 'allowed' | 'requires_approval' | 'not_granted' | 'denied' };

export interface SessionInfo {
  permissions: Record<string, Resolution>;
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

  async function send<T>(method: 'GET' | 'POST', path: string, body?: unknown, withSession = true, whole = false): Promise<HubResult<T>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${o.device.token}` };
    if (withSession && session !== null) headers['X-Session-Token'] = session.token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetchFn(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch {
      return { ok: false, error: { kind: 'network' } };
    }
    const parsed: unknown = await response.json().catch(() => null);
    if (response.status >= 200 && response.status < 300) return { ok: true, data: whole ? (parsed as T) : (parsed as { data: T }).data };
    const err = (parsed as { error?: { code?: unknown; details?: unknown } } | null)?.error;
    const code = typeof err?.code === 'string' ? err.code : 'INTERNAL_ERROR';
    const details = (typeof err?.details === 'object' && err.details !== null ? err.details : {}) as Record<string, unknown>;
    if (withSession && session !== null && SIGNED_OUT.has(code)) {
      session = null;
      o.onSignedOut();
      return { ok: false, error: { kind: 'signed_out' } };
    }
    return { ok: false, error: { kind: 'api', status: response.status, code, details } satisfies HubError };
  }

  async function command<T>(path: string, commandType: string, payload: unknown): Promise<HubResult<T>> {
    const answer = await send<{ result: T }>('POST', `/commands/${path}`, {
      command_id: newCommandId(),
      tenant_id: o.meta.tenantId,
      branch_id: o.meta.branchId,
      command_type: commandType,
      payload,
      occurred_at: Date.now(),
      actor_id: session?.staffId ?? null,
      device_id: o.device.id,
    });
    return answer.ok ? { ok: true, data: answer.data.result } : answer;
  }

  return {
    device: o.device,
    meta: o.meta,
    sessionToken: () => session?.token ?? null,

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
      const answer = await send<InboxPage>('GET', `/queries/alerts-inbox?limit=50${query}`, undefined, true, true);
      if (!answer.ok) return answer;
      return { ok: true, data: { alerts: answer.data.data.alerts, next_cursor: answer.data.meta.next_cursor } };
    },
    requests: () => send<{ requests: RequestRow[] }>('GET', '/queries/requests-to-answer'),
    receipts: (alertId: string) => send<ReceiptsData>('GET', `/queries/alert-receipts?alert_id=${encodeURIComponent(alertId)}`),
    markSeen: (alertIds: string[]) => command<{ seen: string[] }>('mark-alerts-seen', 'MarkAlertsSeen', { alert_ids: alertIds }),
    sendTestAlert: (target: SendTestAlertPayload['target']) => command<{ alert_id: string }>('send-test-alert', 'SendTestAlert', { target }),
  };
}

export type StaffApi = ReturnType<typeof createStaffApi>;
