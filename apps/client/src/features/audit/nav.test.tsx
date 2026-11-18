import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import type { SocketLike } from '../alerts/socket';
import { fakeTimers, recordingSink } from '../alerts/test-fakes';
import type { Device, PageMeta } from '../staff/api';
import { StaffApp } from '../staff/StaffApp';

// 04 §8 (VU2a; handoff 04 CHANGES 16): the staff nav's "Audit log" entry, shown only with `view-audit-log` granted
// outright (R5, from the session's permissions, never a role); it opens #/audit, which reads §6.5 audit-log.

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
}

const META: PageMeta = { tenantId: 'TEN-1', branchId: 'BR-1', branchName: 'Gulberg', hubNowMs: NOW, utcOffsetMs: 0 };
const TABLET: Device = { token: 'DEV-TOK', id: 'D-T3', type: 'tablet' };

let m: Mounted;
beforeEach(() => {
  window.location.hash = '';
});
afterEach(() => {
  m?.unmount();
});

function hub(permissions: Record<string, unknown>) {
  const paths: string[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0]!;
    paths.push(url);
    switch (`${init?.method ?? 'GET'} ${path}`) {
      case 'GET /queries/staff-roster':
        return reply(200, { data: { staff: [{ staff_id: 'S-IMRAN', display_name: 'Imran', locked_until: null }], active_session: null } });
      case 'POST /auth/pin':
        return reply(200, { data: { session_token: 'SESS-1', session_id: 'X1', staff_id: 'S-IMRAN', display_name: 'Imran', role_ids: [], idle_ttl_ms: 600_000 } });
      case 'GET /queries/session':
        return reply(200, { data: { permissions } });
      case 'GET /queries/alerts-inbox':
        return reply(200, { data: { alerts: [] }, meta: { next_cursor: null } });
      case 'GET /queries/branch-config':
        return reply(200, { data: { config_version: 1, snapshot_hash: 'h', snapshot: {}, hub_time: { now_ms: NOW, utc_offset_ms: 0 } } });
      case 'GET /queries/requests-to-answer':
        return reply(200, { data: { requests: [] } });
      case 'GET /queries/audit-log':
        return reply(200, { data: { entries: [] }, meta: { next_cursor: null } });
      default:
        return reply(404, { error: { code: 'NOT_FOUND' } });
    }
  });
  return { fetch, paths };
}

async function signIn(fetch: (u: string, i?: RequestInit) => Promise<Response>) {
  const timers = fakeTimers();
  m = mount();
  m.render(<StaffApp device={TABLET} meta={META} fetch={fetch} createSocket={() => new FakeSocket()} sink={recordingSink(timers)} timers={timers} />);
  await flush();
  m.click(m.button('Imran'));
  const keys = m.container.querySelector('.pin__keys')!;
  for (const d of '1234') m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
  m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === 'Sign in'));
  await flush(8);
}

const auditButton = () => m.buttons().find((b) => b.textContent === 'Audit log') ?? null;

describe('[04 §8; R5] staff nav: Audit log', () => {
  it('shows "Audit log" only with view-audit-log allowed; it opens the audit screen, which reads audit-log', async () => {
    await signIn(hub({}).fetch);
    expect(auditButton()).toBeNull();
    m.unmount();

    await signIn(hub({ 'view-audit-log': { grant: 'requires_approval', approver_role_ids: [], scope: 'branch' } }).fetch);
    expect(auditButton()).toBeNull();
    // the route alone shows nothing without the permission
    window.location.hash = '#/audit';
    await flush();
    expect(m.container.querySelector('.au')).toBeNull();
    m.unmount();
    window.location.hash = '';

    const h = hub({ 'view-audit-log': { grant: 'allowed', scope: 'branch' } });
    await signIn(h.fetch);
    m.click(auditButton());
    await flush(6);
    expect(window.location.hash).toBe('#/audit');
    expect(m.container.querySelector('main.au')).not.toBeNull();
    // through the page's own fetch (StaffApp's hubFetch) with the device token and the session
    expect(h.paths.some((p) => p.startsWith('/queries/audit-log?from='))).toBe(true);
    const call = h.fetch.mock.calls.find(([u]) => u.startsWith('/queries/audit-log'))!;
    expect(call[1]?.headers).toMatchObject({ Authorization: 'Bearer DEV-TOK', 'X-Session-Token': 'SESS-1' });
  });
});
