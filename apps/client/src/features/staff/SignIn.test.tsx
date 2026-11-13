import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import type { SocketLike } from '../alerts/socket';
import { fakeTimers, recordingSink } from '../alerts/test-fakes';
import type { Device, PageMeta } from './api';
import type { ShellHooks } from './shell/hooks';
import { SignIn } from './SignIn';
import { StaffApp } from './StaffApp';

// 01d S00: the sign-in PIN is dropped when its dialog closes (never kept).

let m: Mounted;
afterEach(() => m?.unmount());

const PEOPLE = [
  { staff_id: 'S1', display_name: 'Imran', locked_until: null },
  { staff_id: 'S2', display_name: 'Sana', locked_until: null },
];

function rosterOk(staff = PEOPLE) {
  return async () => ({ ok: true as const, data: { staff, active_session: null } });
}

describe('[01d S00] SignIn', () => {
  it('closing the PIN dialog clears the typed digits', async () => {
    const api = {
      roster: vi.fn(async () => ({ ok: true as const, data: { staff: [{ staff_id: 'S1', display_name: 'Imran', locked_until: null }], active_session: null } })),
      signIn: vi.fn(),
    };
    m = mount();
    m.render(<SignIn api={api} phone={false} lockPanel={null} onSignedIn={() => {}} />);
    await Promise.resolve();
    await Promise.resolve();
    m.render(<SignIn api={api} phone={false} lockPanel={null} onSignedIn={() => {}} />);
    m.click(m.button('Imran'));
    const press = (d: string) => m.click([...m.container.querySelectorAll('.pin__keys button')].find((b) => b.textContent === d));
    press('1');
    press('2');
    expect(m.container.querySelectorAll('.pin__dots i.f').length).toBe(2);
    m.click(m.button('Close'));
    m.click(m.button('Imran'));
    expect(m.container.querySelectorAll('.pin__dots i.f').length).toBe(0);
    expect(api.signIn).not.toHaveBeenCalled();
  });
});

// 02a §8 Login (20a; frames 02-S01 SignIn, SignInOffline, 02a-S00)
describe('[02a §8 Login] SignIn', () => {
  it('[02a §8 Login] 401 DEVICE_TOKEN_INVALID and 403 DEVICE_REVOKED from staff-roster tell the shell the device is not paired any more', async () => {
    for (const [status, code] of [
      [401, 'DEVICE_TOKEN_INVALID'],
      [403, 'DEVICE_REVOKED'],
    ] as const) {
      const onUnpaired = vi.fn();
      const api = {
        roster: vi.fn(async () => ({ ok: false as const, error: { kind: 'api' as const, status, code, details: {} } })),
        signIn: vi.fn(),
      };
      m = mount();
      m.render(<SignIn api={api} phone={false} lockPanel={null} onUnpaired={onUnpaired} onSignedIn={() => {}} />);
      await flush();
      expect(onUnpaired, code).toHaveBeenCalledTimes(1);
      expect(api.roster, code).toHaveBeenCalledTimes(1);
      expect(api.signIn).not.toHaveBeenCalled();
      m.unmount();
    }
  });

  it('[02a §8 Login] network error keeps the names (SignInOffline); the PIN pad says it needs the hub', async () => {
    vi.useFakeTimers();
    try {
      let down = false;
      const api = {
        roster: vi.fn(async () => ({ ok: true as const, data: { staff: PEOPLE, active_session: null } })),
        signIn: vi.fn(async () => {
          down = true;
          return { ok: false as const, error: { kind: 'network' as const } };
        }),
      };
      m = mount();
      m.render(<SignIn api={api} phone={false} lockPanel={null} onSignedIn={() => {}} />);
      await flush();
      m.click(m.button('Imran'));
      const key = (label: string) => [...m.container.querySelectorAll<HTMLButtonElement>('.pin__keys button')].find((b) => b.textContent === label);
      for (const d of '1234') m.click(key(d));
      m.click(key('Sign in'));
      await flush(6);
      // the hub is away: the names stay, with the offline line; the pad is off and says it needs the hub
      expect(down).toBe(true);
      expect(m.text()).toContain('Imran');
      expect(m.text()).toContain('Sana');
      expect(m.container.querySelector('.warnbar')?.textContent).toContain('No connection to the hub');
      expect([...m.container.querySelectorAll<HTMLButtonElement>('.pin__keys button')].every((k) => k.disabled)).toBe(true);
      expect(m.container.querySelector('.pin__err')?.textContent).toContain('Signing in needs the hub');
      // the roster is read again; once it answers the pad is back
      const reads = api.roster.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(api.roster.mock.calls.length).toBe(reads + 1);
      expect(m.container.querySelector('.warnbar')).toBeNull();
      expect(key('1')!.disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('[02a §8 Login] a roster that never loaded shows the offline line and Retry, not names', async () => {
    const api = { roster: vi.fn(async () => ({ ok: false as const, error: { kind: 'network' as const } })), signIn: vi.fn() };
    m = mount();
    m.render(<SignIn api={api} phone={false} lockPanel={null} onSignedIn={() => {}} />);
    await flush();
    expect(m.text()).toContain('No connection to the hub');
    expect(m.button('Retry now')).toBeTruthy();
  });

  it('[02b §8 Queue] sign-in shows shellHooks.queueLine() and awaits beforeSignIn before POST /auth/pin', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const hooks: ShellHooks = {
      beforeSignIn: () => new Promise<void>((resolve) => (release = () => (order.push('drained'), resolve()))),
      queueLine: () => '2 orders waiting to send',
      subscribe: () => () => {},
    };
    const api = {
      roster: vi.fn(rosterOk()),
      signIn: vi.fn(async () => {
        order.push('pin');
        return { ok: false as const, error: { kind: 'network' as const } };
      }),
    };
    m = mount();
    m.render(<SignIn api={api} phone={false} lockPanel={null} hooks={hooks} onSignedIn={() => {}} />);
    await flush();
    expect(m.text()).toContain('2 orders waiting to send');
    // the line sits under the grid (frame SignIn)
    const grid = m.container.querySelector('.who--tiles')!;
    const line = [...m.container.querySelectorAll('[role="status"]')].find((e) => (e.textContent ?? '').includes('2 orders waiting'))!;
    expect(grid.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    m.click(m.button('Imran'));
    for (const d of '1234') m.click([...m.container.querySelectorAll('.pin__keys button')].find((b) => b.textContent === d));
    m.click([...m.container.querySelectorAll('.pin__keys button')].find((b) => b.textContent === 'Sign in'));
    await flush();
    expect(api.signIn).not.toHaveBeenCalled();
    release();
    await flush(6);
    expect(order).toEqual(['drained', 'pin']);
    expect(api.signIn).toHaveBeenCalledWith('S1', '1234', false);
  });
});

// 02a §8 Login (20a): the shell wipes the pairing and shows PairAgain; its button goes to /pair.
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

describe('[02a §8 Login] StaffApp pairing loss', () => {
  let sockets: FakeSocket[];
  beforeEach(() => {
    sockets = [];
    window.location.hash = '';
  });

  function hub(rosterReply: () => Response) {
    return vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.split('?')[0]!;
      switch (`${init?.method ?? 'GET'} ${path}`) {
        case 'GET /queries/staff-roster':
          return rosterReply();
        case 'POST /auth/pin':
          return reply(200, { data: { session_token: 'SESS-1', session_id: 'X1', staff_id: 'S1', display_name: 'Imran', role_ids: [], idle_ttl_ms: 600_000 } });
        case 'GET /queries/session':
          return reply(200, { data: { permissions: {} } });
        case 'GET /queries/alerts-inbox':
          return reply(200, { data: { alerts: [] }, meta: { next_cursor: null } });
        case 'GET /queries/branch-config':
          return reply(200, { data: { config_version: 1, snapshot_hash: 'h', snapshot: {}, hub_time: { now_ms: NOW, utc_offset_ms: 0 } } });
        case 'GET /queries/requests-to-answer':
          return reply(200, { data: { requests: [] } });
        default:
          return reply(404, { error: { code: 'NOT_FOUND', details: {} } });
      }
    });
  }

  function render(fetch: (u: string, i?: RequestInit) => Promise<Response>, wipeKeys: () => Promise<void>, goToPair: (path: string) => void) {
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
        wipeKeys={wipeKeys}
        goToPair={goToPair}
      />,
    );
  }

  it('[02a §8 Login] 401 DEVICE_TOKEN_INVALID from staff-roster wipes token, device_id, device_type → PairAgain → location /pair', async () => {
    const wipeKeys = vi.fn(async () => {});
    const goToPair = vi.fn();
    render(hub(() => reply(401, { error: { code: 'DEVICE_TOKEN_INVALID', details: {} } })), wipeKeys, goToPair);
    await flush(6);
    expect(wipeKeys).toHaveBeenCalledTimes(1);
    expect(m.text()).toContain('This screen must be paired again');
    expect(m.text()).not.toContain('Who is signing in?');
    expect(goToPair).not.toHaveBeenCalled();
    m.click(m.button('Show pairing code'));
    expect(goToPair).toHaveBeenCalledWith('/pair');
  });

  it('[02a §8 Login] the pair button is off until the wipe is done; a failed wipe keeps it off with an error', async () => {
    let finish: () => void = () => {};
    const goToPair = vi.fn();
    render(hub(() => reply(401, { error: { code: 'DEVICE_TOKEN_INVALID', details: {} } })), () => new Promise<void>((resolve) => (finish = resolve)), goToPair);
    await flush(6);
    expect((m.button('Show pairing code') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      finish();
    });
    expect((m.button('Show pairing code') as HTMLButtonElement).disabled).toBe(false);
    m.unmount();

    render(hub(() => reply(401, { error: { code: 'DEVICE_TOKEN_INVALID', details: {} } })), async () => Promise.reject(new Error('idb')), goToPair);
    await flush(6);
    expect((m.button('Show pairing code') as HTMLButtonElement).disabled).toBe(true);
    expect(m.container.querySelector('[role="alert"]')?.textContent).toContain('Could not reset this screen');
    m.click(m.button('Show pairing code'));
    expect(goToPair).not.toHaveBeenCalled();
  });

  it('[02a §8 Login] 403 DEVICE_REVOKED and WS close 4403 → same wipe and PairAgain', async () => {
    const revoked = vi.fn(async () => {});
    render(hub(() => reply(403, { error: { code: 'DEVICE_REVOKED', details: {} } })), revoked, vi.fn());
    await flush(6);
    expect(revoked).toHaveBeenCalledTimes(1);
    expect(m.text()).toContain('This screen must be paired again');
    m.unmount();

    const wipeKeys = vi.fn(async () => {});
    render(hub(() => reply(200, { data: { staff: PEOPLE, active_session: null } })), wipeKeys, vi.fn());
    await flush();
    m.click(m.button('Imran'));
    const keys = m.container.querySelector('.pin__keys')!;
    for (const d of '1234') m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
    m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === 'Sign in'));
    await flush(8);
    expect(m.text()).not.toContain('Who is signing in?');
    expect(wipeKeys).not.toHaveBeenCalled();
    act(() => sockets[0]!.onclose?.({ code: 4403, reason: '' }));
    await flush(6);
    expect(wipeKeys).toHaveBeenCalledTimes(1);
    expect(m.text()).toContain('This screen must be paired again');
    // the signed-in screens are gone with the session
    expect(m.container.querySelector('.staff__nav')).toBeNull();
    expect(m.text()).not.toContain('Imran');
  });

  it('[02a §8 Login] a network error on staff-roster does not wipe the pairing', async () => {
    const wipeKeys = vi.fn(async () => {});
    render(
      vi.fn(async () => {
        throw new TypeError('network');
      }),
      wipeKeys,
      vi.fn(),
    );
    await flush(6);
    expect(wipeKeys).not.toHaveBeenCalled();
    expect(m.text()).not.toContain('paired again');
  });
});
