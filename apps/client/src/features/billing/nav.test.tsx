import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import type { SocketLike } from '../alerts/socket';
import { fakeTimers, recordingSink } from '../alerts/test-fakes';
import type { Device, PageMeta } from '../staff/api';
import { StaffApp } from '../staff/StaffApp';

// 02b-TK C2-1: the kiosk lands on #/takeaway, now the takeaway order screen; these tests are about the shell, so
// it is a probe
vi.mock('../staff/orders/takeaway/TakeawayHome', () => ({ TakeawayHome: () => <div data-probe="takeaway-home" /> }));

// 05 §8 "Cashier screen" (plan §3.1 task 34; brief §3.1.1 Entry): the staff nav's "Bills" (R5: shown with
// `take-payment`) and #/bills mount the open-bills list; without the grant neither shows. The list is a probe here.

vi.mock('./OpenBills', () => ({
  OpenBills: ({ onOpen }: { onOpen?: (ref: unknown) => void }) => (
    <div data-probe="bills">
      <button type="button" onClick={() => onOpen?.({ seating_id: 'S 7' })}>
        open T7
      </button>
    </div>
  ),
}));
vi.mock('./BillScreen', async (orig) => ({
  ...(await orig<object>()),
  BillScreen: ({ billRef }: { billRef: unknown }) => <div data-probe="bill" data-ref={JSON.stringify(billRef)} />,
}));

vi.mock('./ShiftScreen', () => ({ ShiftScreen: ({ shiftId }: { shiftId?: string }) => <div data-probe="shift" data-id={shiftId ?? ''} /> }));
vi.mock('./ReportsScreen', () => ({ ReportsScreen: () => <div data-probe="reports" /> }));
vi.mock('./DayCloseScreen', () => ({ DayCloseScreen: () => <div data-probe="dayclose" /> }));

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

/** 05a C-1: the cash desk is a tab of the kiosk's screens (fallback profile: no `device` in the reply) */
async function openCashDesk(): Promise<void> {
  const tab = [...m.container.querySelectorAll('header.top nav.tabs-top a')].find((a) => a.textContent === 'Cash desk');
  m.click(tab);
  await flush(6);
}

async function atManager(label: string): Promise<void> {
  window.location.hash = '#/manager';
  await flush(6);
  m.click(m.button(label));
  await flush(6);
}

async function at(hash: string): Promise<Element | null> {
  window.location.hash = hash;
  await flush(6);
  return m.container.querySelector('[data-probe]');
}

describe('[05 §8 Cashier screen] Bills in the staff nav (R5)', () => {
  it('with take-payment: the Cash desk tab opens #/bills, which mounts the open-bills list', async () => {
    PERMS = { 'take-payment': { grant: 'allowed', scope: 'branch' } };
    await signedIn();
    await openCashDesk();
    expect(window.location.hash).toBe('#/bills');
    expect(m.container.querySelector('[data-probe]')?.getAttribute('data-probe')).toBe('bills');
  });

  it('without take-payment: no Bills button, and #/bills mounts no list', async () => {
    PERMS = {};
    await signedIn();
    expect(m.buttons().some((b) => b.getAttribute('aria-label') === 'Bills' || b.textContent === 'Bills')).toBe(false);
    expect(await at('#/bills')).toBeNull();
  });

  it('[task 35] a row opens #/bill?<ref>, which mounts the bill screen with that ref; a bad ref mounts nothing', async () => {
    PERMS = { 'take-payment': { grant: 'allowed', scope: 'branch' } };
    await signedIn();
    await openCashDesk();
    m.click(m.button('open T7'));
    await flush(6);
    expect(window.location.hash).toBe('#/bill?seating_id=S%207');
    const page = m.container.querySelector('[data-probe]');
    expect(page?.getAttribute('data-probe')).toBe('bill');
    expect(page?.getAttribute('data-ref')).toBe(JSON.stringify({ seating_id: 'S 7' }));
    expect(await at('#/bill?bill_id=B1&order_id=O1')).toBeNull();
  });
});

describe('[05 §8 Shift; task 39] My shift in the staff nav (R5)', () => {
  it('with manage-own-shift: the My shift button opens #/shift, which mounts the shift screen', async () => {
    PERMS = { 'manage-own-shift': { grant: 'allowed', scope: 'branch' } };
    await signedIn();
    m.click(m.button('My shift'));
    await flush(6);
    expect(window.location.hash).toBe('#/shift');
    expect(m.container.querySelector('[data-probe]')?.getAttribute('data-probe')).toBe('shift');
  });

  it('without manage-own-shift: no My shift button, and #/shift mounts nothing', async () => {
    PERMS = { 'take-payment': { grant: 'allowed', scope: 'branch' } };
    await signedIn();
    expect(m.buttons().some((b) => b.textContent === 'My shift')).toBe(false);
    expect(await at('#/shift')).toBeNull();
  });
});

describe('[05 §8 Reports; task 42] Reports in the staff nav (R5)', () => {
  it('with view-reports: the manager screen Reports button opens #/reports, which mounts the reports screen', async () => {
    PERMS = { 'view-reports': { grant: 'allowed', scope: 'branch' } };
    await signedIn();
    await atManager('Reports');
    expect(window.location.hash).toBe('#/reports');
    expect(m.container.querySelector('[data-probe]')?.getAttribute('data-probe')).toBe('reports');
  });

  it('without view-reports: no Reports button, and #/reports mounts nothing', async () => {
    PERMS = { 'take-payment': { grant: 'allowed', scope: 'branch' } };
    await signedIn();
    expect(m.buttons().some((b) => b.textContent === 'Reports')).toBe(false);
    expect(await at('#/reports')).toBeNull();
  });
});

describe('[05 §8 Day close; task 41] Close day in the staff nav (R5)', () => {
  it('with close-business-day: the manager screen Close day button opens #/day-close, which mounts the day-close screen', async () => {
    PERMS = { 'close-business-day': { grant: 'allowed', scope: 'branch' } };
    await signedIn();
    await atManager('Close day');
    expect(window.location.hash).toBe('#/day-close');
    expect(m.container.querySelector('[data-probe]')?.getAttribute('data-probe')).toBe('dayclose');
  });

  it('without close-business-day: no Close day button, and #/day-close mounts nothing', async () => {
    PERMS = { 'take-payment': { grant: 'allowed', scope: 'branch' } };
    await signedIn();
    expect(m.buttons().some((b) => b.textContent === 'Close day')).toBe(false);
    expect(await at('#/day-close')).toBeNull();
  });

  it('[review M2] #/shift?shift_id=… also opens with close-shift-for-others alone', async () => {
    PERMS = { 'close-business-day': { grant: 'allowed', scope: 'branch' }, 'close-shift-for-others': { grant: 'allowed', scope: 'branch' } };
    await signedIn();
    expect((await at('#/shift?shift_id=SH7'))?.getAttribute('data-id')).toBe('SH7');
    expect(await at('#/shift')).toBeNull();
  });

  it('[Close this shift] #/shift?shift_id=… mounts the shift screen of that shift', async () => {
    PERMS = { 'manage-own-shift': { grant: 'allowed', scope: 'branch' } };
    await signedIn();
    const page = await at('#/shift?shift_id=SH7');
    expect(page?.getAttribute('data-probe')).toBe('shift');
    expect(page?.getAttribute('data-id')).toBe('SH7');
  });
});

