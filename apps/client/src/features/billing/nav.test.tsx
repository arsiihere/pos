import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import type { SocketLike } from '../alerts/socket';
import { fakeTimers, recordingSink } from '../alerts/test-fakes';
import type { Device, PageMeta } from '../staff/api';
import { StaffApp } from '../staff/StaffApp';

// 05 §8 "Cashier screen" (plan §3.1 task 34; brief §3.1.1 Entry): the staff nav's "Bills" (R5: shown with
// `take-payment`) and #/bills mount the open-bills list; without the grant neither shows. The list is a probe here.

vi.mock('./OpenBills', () => ({ OpenBills: () => <div data-probe="bills" /> }));

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
const KIOSK: Device = { token: 'DEV-TOK', id: 'D-K1', type: 'cashier_kiosk' };

let PERMS: Record<string, unknown> = {};
const fetch = vi.fn(async (url: string, init?: RequestInit) => {
  const path = url.split('?')[0]!;
  switch (`${init?.method ?? 'GET'} ${path}`) {
    case 'GET /queries/staff-roster':
      return reply(200, { data: { staff: [{ staff_id: 'S-IMRAN', display_name: 'Imran', locked_until: null }], active_session: null } });
    case 'POST /auth/pin':
      return reply(200, { data: { session_token: 'SESS-1', session_id: 'X1', staff_id: 'S-IMRAN', display_name: 'Imran', role_ids: [], idle_ttl_ms: 600_000 } });
    case 'GET /queries/session':
      return reply(200, { data: { permissions: { ...PERMS } } });
    case 'GET /queries/alerts-inbox':
      return reply(200, { data: { alerts: [] }, meta: { next_cursor: null } });
    case 'GET /queries/branch-config':
      return reply(200, { data: { config_version: 1, snapshot_hash: 'h', snapshot: {}, hub_time: { now_ms: NOW, utc_offset_ms: 0 } } });
    case 'GET /queries/requests-to-answer':
      return reply(200, { data: { requests: [] } });
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
      device={KIOSK}
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

describe('[05 §8 Cashier screen] Bills in the staff nav (R5)', () => {
  it('with take-payment: the Bills button opens #/bills, which mounts the open-bills list', async () => {
    PERMS = { 'take-payment': { grant: 'allowed', scope: 'branch' } };
    await signedIn();
    m.click(m.button('Bills'));
    await flush(6);
    expect(window.location.hash).toBe('#/bills');
    expect(m.container.querySelector('[data-probe]')?.getAttribute('data-probe')).toBe('bills');
  });

  it('without take-payment: no Bills button, and #/bills mounts no list', async () => {
    PERMS = {};
    await signedIn();
    expect(m.buttons().some((b) => b.getAttribute('aria-label') === 'Bills' || b.textContent === 'Bills')).toBe(false);
    expect(await at('#/bills')).toBeNull();
  });
});
