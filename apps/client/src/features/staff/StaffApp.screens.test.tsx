import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import type { SocketLike } from '../alerts/socket';
import { fakeTimers, recordingSink } from '../alerts/test-fakes';
import type { Device, PageMeta } from './api';
import { StaffApp } from './StaffApp';
import { MaskedAction } from './shell/MaskedAction';
import { createPermissions } from './shell/permissions';
import { fallbackScreens, tabsOf } from './shell/screens';

// 02b-TK C2-1: the kiosk lands on #/takeaway, now the takeaway order screen; these tests are about the shell, so
// it is a probe
vi.mock('./orders/takeaway/TakeawayHome', async () => {
  const { useShell } = await import('./shell/hooks');
  // BUG-12: the probe says whether the shell's live bus still holds an `orders` catch-up part
  const TakeawayHome = () => <div data-probe="takeaway-home" data-orders={String(useShell().live.part('orders') !== undefined)} />;
  return { TakeawayHome };
});

// 05a §3.6, §8, C-1: the staff shell's tabs come from the device profile (`GET /queries/session` `device.screens`,
// the `device_profile` push), the permissions after the mask decide what is hidden, and width only picks the layout.

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
const TABLET: Device = { token: 'DEV-TOK', id: 'D-T3', type: 'tablet' };
const UP = { type: 'catch_up', as_of_seq: 0, state: {} };
const ALLOWED = { grant: 'allowed', scope: { kind: 'branch' } };

let m: Mounted;
let lastTimers: ReturnType<typeof fakeTimers>;
let sockets: FakeSocket[];
beforeEach(() => {
  sockets = [];
  window.location.hash = '';
  window.localStorage.clear();
});
afterEach(() => m?.unmount());

interface Profile {
  screens: string[];
  access?: 'everyone' | 'listed';
  point_id?: string | null;
}

function hub(o: { profile?: () => Profile; permissions?: () => Record<string, unknown> } = {}) {
  const sessionReads = { n: 0 };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0]!;
    switch (`${init?.method ?? 'GET'} ${path}`) {
      case 'GET /queries/staff-roster':
        return reply(200, { data: { staff: [{ staff_id: 'S-IMRAN', display_name: 'Imran', locked_until: null }], active_session: null } });
      case 'POST /auth/pin':
        return reply(200, { data: { session_token: 'SESS-1', session_id: 'X1', staff_id: 'S-IMRAN', display_name: 'Imran', role_ids: [], idle_ttl_ms: 600_000 } });
      case 'GET /queries/session': {
        sessionReads.n += 1;
        const p = o.profile?.();
        return reply(200, {
          data: {
            permissions: { 'take-order': { grant: 'allowed', scope: 'branch' }, ...(o.permissions?.() ?? {}) }, // 02b v1.0.26 Q11: the order screens need take-order
            ...(p === undefined ? {} : { device: { device_id: 'D', screens: p.screens, access: p.access ?? 'listed', point_id: p.point_id ?? null } }),
          },
        });
      }
      case 'GET /queries/alerts-inbox':
        return reply(200, { data: { alerts: [] }, meta: { next_cursor: null } });
      case 'GET /queries/branch-config':
        return reply(200, { data: { config_version: 1, snapshot_hash: 'h', snapshot: {}, hub_time: { now_ms: NOW, utc_offset_ms: 0 } } });
      case 'GET /queries/requests-to-answer':
        return reply(200, { data: { requests: [] } });
      default:
        throw new Error(`no route ${path}`);
    }
  });
  return { fetch, sessionReads };
}

function render(device: Device, fetch: (u: string, i?: RequestInit) => Promise<Response>) {
  const timers = fakeTimers();
  lastTimers = timers;
  m = mount();
  m.render(
    <StaffApp
      device={device}
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
}

async function signIn(): Promise<void> {
  await flush();
  // a narrow layout signs in its one person at once (the phone pad); a wide one lists the tiles first
  if (m.container.querySelector('.pin__keys') === null) m.click(m.button('Imran'));
  const keys = m.container.querySelector('.pin__keys')!;
  for (const d of '1234') m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
  m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === 'Sign in'));
  await flush(8);
}

const wideTabs = () => [...m.container.querySelectorAll('header.top nav.tabs-top a')].map((a) => a.textContent);
const phoneTabs = () => [...m.container.querySelectorAll('nav.tabbar a.tab')].map((a) => a.textContent);

function width(px: number): () => void {
  const real = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: q.includes('max-width: 760px') ? px <= 760 : false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = real;
  };
}

describe('[05a §3.6, §8, C-1] shell tabs from the device screens', () => {
  it('[05a C-1] tabs follow the profile screens in list order, whatever the hardware', async () => {
    render(TABLET, hub({ profile: () => ({ screens: ['parking', 'dine_in', 'takeaway'] }) }).fetch);
    await signIn();
    expect(wideTabs()).toEqual(['Parking', 'Dine in', 'Takeaway']);
    expect(window.location.hash).toBe('#/orders'); // home = the first screen
  });

  it('[05a C-1; A-7] a kiosk opens on `takeaway`, its first screen; kiosk_home is gone', async () => {
    render(KIOSK, hub({ profile: () => ({ screens: ['takeaway', 'parking', 'dine_in', 'cashier', 'manager'], access: 'everyone' }), permissions: () => ({ 'take-payment': ALLOWED, 'view-reports': ALLOWED }) }).fetch);
    await signIn();
    expect(window.location.hash).toBe('#/takeaway');
    expect(wideTabs()).toEqual(['Takeaway', 'Parking', 'Dine in', 'Cash desk', 'Manager tools']);
  });

  it('[05a C-1] the last tab is remembered: the next sign-in opens on it', async () => {
    const h = hub({ profile: () => ({ screens: ['dine_in', 'takeaway'] }) });
    render(TABLET, h.fetch);
    await signIn();
    act(() => {
      window.location.hash = '#/takeaway';
    });
    await flush();
    m.unmount();
    window.location.hash = '';
    render(TABLET, h.fetch);
    await signIn();
    expect(window.location.hash).toBe('#/takeaway');
  });

  it('[05a C-1] a `device_profile` push redraws the tabs', async () => {
    render(TABLET, hub({ profile: () => ({ screens: ['dine_in', 'takeaway'] }) }).fetch);
    await signIn();
    sockets[0]!.frame(UP);
    await flush(2);
    sockets[0]!.frame({ type: 'device_profile', screens: ['takeaway', 'parking', 'dine_in'], access: 'listed', point_id: null });
    await flush(2);
    expect(wideTabs()).toEqual(['Takeaway', 'Parking', 'Dine in']);
  });

  it('[05a C-1] a tab removed under the person: the first remaining tab and a toast', async () => {
    render(TABLET, hub({ profile: () => ({ screens: ['dine_in', 'takeaway', 'parking'] }) }).fetch);
    await signIn();
    act(() => {
      window.location.hash = '#/orders';
    });
    await flush();
    sockets[0]!.frame(UP);
    await flush(2);
    sockets[0]!.frame({ type: 'device_profile', screens: ['takeaway', 'dine_in'], access: 'listed', point_id: null });
    await flush(4);
    expect(window.location.hash).toBe('#/takeaway');
    expect(m.container.querySelector('.toast')?.textContent).toContain('This screen was taken off this device');
    expect(wideTabs()).toEqual(['Takeaway', 'Dine in']);
  });

  it('[05a RF-5] after a reconnect a fresh /queries/session redraws the tabs without the missed push', async () => {
    let screens = ['dine_in', 'takeaway'];
    const h = hub({ profile: () => ({ screens }) });
    render(TABLET, h.fetch);
    await signIn();
    sockets[0]!.frame(UP);
    await flush(2);
    expect(wideTabs()).toEqual(['Dine in', 'Takeaway']);
    // the device is offline while its profile is edited: the push is never delivered
    screens = ['takeaway', 'parking'];
    const reads = h.sessionReads.n;
    act(() => sockets[0]!.onclose?.({ code: 1006, reason: '' }));
    await flush();
    act(() => lastTimers.advance(600)); // the backoff, then a new socket
    await flush();
    sockets[sockets.length - 1]!.frame(UP);
    await flush(6);
    expect(h.sessionReads.n).toBeGreaterThan(reads);
    expect(wideTabs()).toEqual(['Takeaway', 'Parking']);
  });

  it('[05a §3.6 O-16] cashier needs take-payment and manager one of its permissions: a screen with none of them is hidden', async () => {
    render(TABLET, hub({ profile: () => ({ screens: ['dine_in', 'cashier', 'manager'], access: 'everyone' }) }).fetch);
    await signIn();
    expect(wideTabs()).toEqual(['Dine in']);
    m.unmount();
    render(TABLET, hub({ profile: () => ({ screens: ['dine_in', 'cashier', 'manager'], access: 'everyone' }), permissions: () => ({ 'take-payment': ALLOWED, 'view-reports': ALLOWED }) }).fetch);
    await signIn();
    expect(wideTabs()).toEqual(['Dine in', 'Cash desk', 'Manager tools']);
  });

  it('[05a §3.3a] MaskedAction: listed_only hidden; downgraded keeps the action and adds "Confirm on your phone"; take-payment is never downgraded, so no cashier hint', () => {
    const p = createPermissions({
      'apply-refund': { grant: 'requires_approval', approver_role_ids: [], scope: 'branch', masked: 'downgraded' },
      'void-item': { grant: 'allowed', scope: 'branch' },
      'apply-comp': { grant: 'not_granted', masked: 'listed_only' },
    } as never);
    m = mount();
    m.render(
      <div>
        <MaskedAction permissions={p} permission="apply-comp">
          <button type="button">Comp</button>
        </MaskedAction>
        <MaskedAction permissions={p} permission="apply-refund">
          <button type="button">Refund</button>
        </MaskedAction>
        <MaskedAction permissions={p} permission="void-item">
          <button type="button">Void</button>
        </MaskedAction>
      </div>,
    );
    expect([...m.container.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Refund', 'Void']);
    expect(m.container.querySelectorAll('.masked-action').length).toBe(1);
    expect(m.text()).toContain('Confirm on your phone');
    expect(tabsOf(['cashier'])[0]!.hint).toBeNull();
  });

  it('[05a C-1] a 700 px kiosk shows the same items as a 1280 px one; only the layout differs', async () => {
    const profile = () => ({ screens: ['takeaway', 'cashier', 'manager'], access: 'everyone' as const });
    const permissions = () => ({ 'take-payment': ALLOWED, 'view-reports': ALLOWED, 'close-business-day': ALLOWED });
    const restoreWide = width(1280);
    render(KIOSK, hub({ profile, permissions }).fetch);
    await signIn();
    const wide = wideTabs();
    expect(m.container.querySelector('nav.tabbar')).toBeNull();
    act(() => {
      window.location.hash = '#/manager';
    });
    await flush();
    const wideManager = [...m.container.querySelectorAll('main.ph-body button')].map((b) => b.textContent);
    m.unmount();
    restoreWide();

    const restoreNarrow = width(700);
    try {
      window.location.hash = '';
      render(KIOSK, hub({ profile, permissions }).fetch);
      await signIn();
      expect(m.container.querySelector('header.top')).toBeNull();
      expect(phoneTabs().slice(0, -1)).toEqual(wide); // the narrow layout adds Me, nothing else
      act(() => {
        window.location.hash = '#/manager';
      });
      await flush();
      expect([...m.container.querySelectorAll('main.ph-body button')].map((b) => b.textContent)).toEqual(wideManager);
      expect(wideManager).toEqual(['Reports', 'Close day']);
    } finally {
      restoreNarrow();
    }
  });

  it('[05a C-1] with no profile on the hub, the hardware\'s offered screens stand in (Pass first on a point tablet)', () => {
    expect(fallbackScreens('cashier_kiosk', false)).toEqual(['takeaway', 'parking', 'dine_in', 'cashier', 'manager']);
    expect(fallbackScreens('tablet', true)).toEqual(['pass', 'dine_in', 'takeaway', 'parking', 'cashier', 'manager']);
    expect(fallbackScreens('phone', false)).toEqual(['dine_in', 'takeaway', 'parking', 'manager']);
  });
});

// BUG-12 (QA, kiosk): when the hub ends the session (00 HPA M46 / M95 idle; the socket closes 4401 with the end
// reason) the page signs out at once and says so on the sign-in screen; the takeaway screen is gone, not left showing.
describe('[BUG-12; 00 HPA §6.21, M46; 02b §8] the hub ends the session', () => {
  it('4401 idle_timeout → the sign-in tiles with "You were signed out", no takeaway screen; the next sign-in clears it', async () => {
    render(KIOSK, hub({ profile: () => ({ screens: ['takeaway', 'cashier'], access: 'everyone' }), permissions: () => ({ 'take-order': ALLOWED, 'take-payment': ALLOWED }) }).fetch);
    await signIn();
    sockets.at(-1)!.frame({ type: 'catch_up', as_of_seq: 5, state: { orders: { orders: [], zone_stock: [] } } });
    await flush(2);
    expect(m.container.querySelector('[data-probe="takeaway-home"]')?.getAttribute('data-orders')).toBe('true');
    act(() => sockets.at(-1)!.onclose?.({ code: 4401, reason: 'idle_timeout' }));
    await flush(4);
    expect(m.container.querySelector('[data-probe="takeaway-home"]')).toBeNull();
    expect(m.button('Imran')).toBeTruthy();
    expect(m.container.querySelector('[data-signed-out]')?.textContent).toContain('You were signed out');
    await signIn();
    expect(m.container.querySelector('[data-signed-out]')).toBeNull();
    // the last person's catch-up is gone: the screen waits for this person's own
    expect(m.container.querySelector('[data-probe="takeaway-home"]')?.getAttribute('data-orders')).toBe('false');
  });
});

// BUG-18 (QA): a person signed in with the default Cook role (01b B-4: `run-pass`, `reprint-ticket` only) who opens a
// screen they may not use (05a §3.6 O-16: hidden when they hold none of its permissions) is told so — never an empty
// screen, a skeleton or the inbox in its place.
describe('[BUG-18; 05a §3.6 O-16] a screen the person may not use says "Not allowed"', () => {
  const COOK = () => ({ 'run-pass': ALLOWED, 'reprint-ticket': ALLOWED });
  const notAllowed = () => m.container.querySelector('[data-not-allowed]');

  for (const hash of ['#/bills', '#/bill?bill_id=B1', '#/manager', '#/reports', '#/day-close', '#/audit', '#/devices', '#/test-alert']) {
    it(`[05a §3.6] Cook on a kiosk: ${hash} shows Not allowed`, async () => {
      render(KIOSK, hub({ profile: () => ({ screens: ['takeaway', 'cashier', 'manager'], access: 'everyone' }), permissions: COOK }).fetch);
      await signIn();
      act(() => {
        window.location.hash = hash;
      });
      await flush();
      expect(notAllowed()?.textContent).toContain('Not allowed');
      expect(m.container.querySelector('.inbox, [data-inbox]')).toBeNull();
    });
  }

  it('[05a §3.6] #/pass on a device without a point (no `pass` screen) shows Not allowed, not an empty Pass', async () => {
    render(KIOSK, hub({ profile: () => ({ screens: ['takeaway', 'cashier'], access: 'everyone' }), permissions: COOK }).fetch);
    await signIn();
    act(() => {
      window.location.hash = '#/pass';
    });
    await flush();
    expect(notAllowed()?.textContent).toContain('Not allowed');
  });

  it('[05a §3.6] #/pass without `run-pass` shows Not allowed even on a point tablet', async () => {
    render(TABLET, hub({ profile: () => ({ screens: ['pass', 'dine_in'], point_id: 'PT1' }), permissions: () => ({ 'take-order': ALLOWED }) }).fetch);
    await signIn();
    act(() => {
      window.location.hash = '#/pass';
    });
    await flush();
    expect(notAllowed()?.textContent).toContain('Not allowed');
    expect(wideTabs()).toEqual(['Dine in']);
  });

  it('[05a §3.6] the Not allowed panel offers the way home (the first screen the person may use)', async () => {
    render(TABLET, hub({ profile: () => ({ screens: ['pass', 'cashier'], point_id: 'PT1' }), permissions: COOK }).fetch);
    await signIn();
    act(() => {
      window.location.hash = '#/bills';
    });
    await flush();
    m.click(m.button('Go to my screen', notAllowed()!));
    await flush();
    expect(window.location.hash).toBe('#/pass');
  });
});
