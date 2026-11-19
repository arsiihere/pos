import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, requestRow } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import type { SocketLike } from '../alerts/socket';
import { fakeTimers, recordingSink } from '../alerts/test-fakes';
import type { Device, PageMeta } from './api';
import { StaffApp } from './StaffApp';

// 01d v1.3 §3.13.5 (m11), test 94: `focus` is valid only on the deep-link places. The shell's raw route checks
// (#/audit, #/requests, #/test-alert, #/receipts/<id>) never take one, and a stray `?focus=…` must not unmatch them.
// The four pages are probes here: the test is about which page the shell mounts, and with what id.

vi.mock('../audit/AuditLog', () => ({ AuditLog: () => <div data-probe="audit" /> }));
vi.mock('../alerts/TestAlert', () => ({ TestAlert: () => <div data-probe="test-alert" /> }));
vi.mock('../alerts/Receipts', () => ({ Receipts: ({ alertId }: { alertId: string }) => <div data-probe="receipts" data-id={alertId} /> }));
vi.mock('../alerts/RequestsToAnswer', async (orig) => ({
  ...(await orig<object>()),
  RequestsToAnswer: () => <div data-probe="requests" />,
}));

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
  frame(obj: unknown): void {
    this.readyState = 1;
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

const META: PageMeta = { tenantId: 'TEN-1', branchId: 'BR-1', branchName: 'Gulberg', hubNowMs: NOW, utcOffsetMs: 0 };
const TABLET: Device = { token: 'DEV-TOK', id: 'D-T3', type: 'tablet' };

const fetch = vi.fn(async (url: string, init?: RequestInit) => {
  const path = url.split('?')[0]!;
  switch (`${init?.method ?? 'GET'} ${path}`) {
    case 'GET /queries/staff-roster':
      return reply(200, { data: { staff: [{ staff_id: 'S-IMRAN', display_name: 'Imran', locked_until: null }], active_session: null } });
    case 'POST /auth/pin':
      return reply(200, { data: { session_token: 'SESS-1', session_id: 'X1', staff_id: 'S-IMRAN', display_name: 'Imran', role_ids: [], idle_ttl_ms: 600_000 } });
    case 'GET /queries/session':
      return reply(200, { data: { permissions: { 'view-audit-log': { grant: 'allowed' }, 'manage-devices': { grant: 'allowed' } } } });
    case 'GET /queries/alerts-inbox':
      return reply(200, { data: { alerts: [] }, meta: { next_cursor: null } });
    case 'GET /queries/branch-config':
      return reply(200, { data: { config_version: 1, snapshot_hash: 'h', snapshot: {}, hub_time: { now_ms: NOW, utc_offset_ms: 0 } } });
    case 'GET /queries/requests-to-answer':
      return reply(200, { data: { requests: [requestRow({ alert_id: 'R1' })] } });
    default:
      return reply(404, { error: { code: 'NOT_FOUND', message: path, details: {} } });
  }
});

let m: Mounted;
beforeEach(() => {
  window.location.hash = '';
});
afterEach(() => m?.unmount());

async function signedIn(): Promise<void> {
  const sockets: FakeSocket[] = [];
  const timers = fakeTimers();
  m = mount();
  m.render(
    <StaffApp
      device={TABLET}
      meta={META}
      fetch={fetch}
      createSocket={() => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      }}
      sink={recordingSink(timers)}
      timers={timers}
    />,
  );
  await flush();
  m.click(m.button('Imran'));
  const keys = m.container.querySelector('.pin__keys')!;
  for (const d of '1234') m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
  m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === 'Sign in'));
  await flush(8);
  for (const s of sockets) s.frame({ type: 'catch_up', as_of_seq: 0, state: {} });
  await flush(4);
}

async function at(hash: string): Promise<Element | null> {
  window.location.hash = hash;
  await flush(6);
  return m.container.querySelector('[data-probe]');
}

describe('[01d v1.3 §3.13.5] the shell\'s raw routes ignore a stray focus', () => {
  it('[01d #94] #/audit, #/requests, #/test-alert and #/receipts/<id> with ?focus=… still mount their pages (and the receipt id is the path\'s)', async () => {
    await signedIn();
    for (const [hash, probe] of [
      ['#/audit', 'audit'],
      ['#/audit?focus=table', 'audit'],
      ['#/requests', 'requests'],
      ['#/requests?focus=alert:R1', 'requests'],
      ['#/test-alert', 'test-alert'],
      ['#/test-alert?focus=table', 'test-alert'],
      ['#/receipts/A%201', 'receipts'],
      ['#/receipts/A%201?focus=alert:A1', 'receipts'],
    ] as const) {
      const page = await at(hash);
      expect(page?.getAttribute('data-probe'), hash).toBe(probe);
      if (probe === 'receipts') expect(page?.getAttribute('data-id'), hash).toBe('A 1');
    }
  });
});
