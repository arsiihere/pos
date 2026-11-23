import { afterEach, describe, expect, it } from 'vitest';
import { encodeCrockford128 } from '../../src/auth/pair-page';
import { EN } from '../../src/lib/strings';
import { jsonResponse, runPage, textOf } from '../helpers/page-sandbox';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

const cleanups: Array<() => Promise<void>> = [];

describe('device pairing', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §8.4] hub unreachable at page load: the screen says so, retries with backoff capped at 5 s, and recovers once the hub is up', async () => {
    const hub = await open();
    const html = (await hub.app.inject({ method: 'GET', url: '/pair' })).body;
    const unreachable = () => Promise.reject(new TypeError('fetch failed'));

    // 00 v1.9.2 (Q-42): a stored kds token no longer calls the hub here, so the first request of a screen shows it.
    let down = 6;
    const first = await runPage(html, {
      fetch: (url) => {
        if (url !== '/pair/requests') return Promise.resolve(jsonResponse(200, { data: { status: 'pending' } }));
        if (down > 0) {
          down -= 1;
          return unreachable();
        }
        return Promise.resolve(
          jsonResponse(200, { data: { request_id: 'R1', poll_secret: 'p', display_code: 'ABCDEF', approve_qr_svg: '<svg></svg>', expires_at: Date.now() + 581_000 } }),
        );
      },
    });
    expect(textOf(first.byId('pair_status'))).toContain(EN['pairing.hub_unreachable']);
    expect(first.byId('pair_status').hidden).toBe(false);
    while (down > 0 || !textOf(first.screen).includes('ABCDEF')) {
      if (!(await first.advance())) break;
    }
    expect(textOf(first.screen)).toContain('ABCDEF');
    expect(first.delays.slice(0, 6)).toEqual([500, 1_000, 2_000, 4_000, 5_000, 5_000]);
    expect(textOf(first.byId('pair_status'))).not.toContain(EN['pairing.hub_unreachable']);
    expect(first.byId('pair_status').hidden).toBe(true);

    let pollsDown = 2;
    const screen = await runPage(html, {
      fetch: (url) => {
        if (url === '/pair/requests') {
          return Promise.resolve(
            jsonResponse(200, { data: { request_id: 'R1', poll_secret: 'p', display_code: 'ABCDEF', approve_qr_svg: '<svg></svg>', expires_at: Date.now() + 581_000 } }),
          );
        }
        if (url === '/pair/requests/R1') {
          if (pollsDown > 0) {
            pollsDown -= 1;
            return unreachable();
          }
          return Promise.resolve(
            jsonResponse(200, { data: { status: 'approved', device_id: 'K1', device_token: 'tok', device_type: 'cashier_kiosk' } }),
          );
        }
        throw new Error(`unexpected ${url}`);
      },
    });
    expect(textOf(screen.screen)).toContain(EN['pairing.expires_in'].split('{time}')[0]!);
    expect(textOf(screen.screen)).toContain('9:41');
    expect(screen.findAll((el) => el.className.includes('display-code'))[0]!.textContent).toBe('ABCDEF');
    for (let i = 0; i < 40 && screen.store.get('token') === undefined; i += 1) await screen.advance();
    expect(screen.store.get('token')).toBe('tok');
    expect(screen.store.get('device_id')).toBe('K1');
    expect(textOf(screen.screen)).toContain(EN['pairing.approved_title']);
    expect(textOf(screen.screen)).toContain(EN['pairing.approved_body_cashier']);
    expect(textOf(screen.screen)).not.toMatch(/pairing\.|errors\./);
  });

  it('[00 §8.2] Pulse pair screens: wall size on a 1920 kitchen screen only; the hub-down banner sits inside the code screen; too many codes is a danger lock screen with an LTR countdown', async () => {
    const hub = await open();
    const html = (await hub.app.inject({ method: 'GET', url: '/pair' })).body;
    const request = jsonResponse(200, { data: { request_id: 'R1', poll_secret: 'p', display_code: 'ABCDEF', approve_qr_svg: '<svg></svg>', expires_at: Date.now() + 581_000 } });
    const isScreen = (el: { className: string }) => el.className.split(' ').includes('pos-screen');
    const fetch = (url: string) => (url === '/pair/requests' ? Promise.resolve(request) : Promise.reject(new TypeError('fetch failed')));
    const wall = await runPage(html, { innerWidth: 1920, fetch });
    const waiting = wall.findAll(isScreen)[0]!;
    expect(waiting.classList.contains('pos-screen--wall')).toBe(true);
    expect(wall.screen.classList.contains('pos-page--fit')).toBe(true);
    await wall.advance();
    expect(wall.byId('pair_status').hidden).toBe(false);
    expect(waiting.children).toContain(wall.byId('pair_status'));
    const kiosk = await runPage(html, { innerWidth: 1280, fetch });
    expect(kiosk.findAll(isScreen)[0]!.classList.contains('pos-screen--wall')).toBe(false);

    const locked = await runPage(html, {
      fetch: () => Promise.resolve(jsonResponse(429, { error: { code: 'IP_LOCKED_OUT', details: { retry_after_ms: 232_000 } } })),
    });
    const state = locked.findAll(isScreen)[0]!;
    expect(state.className).toContain('pos-screen--danger');
    expect(textOf(state)).toContain(EN['pairing.too_many'].replace('{min}', '4'));
    const again = locked.findAll((el) => el.tagName === 'button', state)[0]!;
    expect(again.disabled).toBe(true);
    expect(again.className).toContain('pos-btn--lg');
    expect(locked.findAll((el) => el.className === 'pos-ltr', again)[0]!.textContent).toBe('3:52');
  });

  it('[00 §10 #94] [05a H-1] the served page logs out an admin session and clears sessionStorage before pairing, and uses neither randomUUID nor serviceWorker; after the logout call the admin token → 401', async () => {
    const hub = await open();
    const page = await hub.app.inject({ method: 'GET', url: '/pair' });
    expect(page.statusCode).toBe(200);
    const html = page.body;
    // M43: at load, the admin session is ended before any pairing starts (screen or phone).
    const boot = html.slice(html.lastIndexOf('openDeviceDb().then('));
    expect(boot.indexOf('/admin/auth/logout')).toBeGreaterThan(-1);
    expect(boot.indexOf('/admin/auth/logout')).toBeLessThan(boot.indexOf('pairScreen(db)'));
    expect(html).toContain('sessionStorage.removeItem');
    expect(html).toContain('indexedDB');
    expect(html).toContain('onupgradeneeded');
    expect(html).toContain('encodeCrockford128');
    const logoutAt = html.indexOf('/admin/auth/logout');
    expect(html.slice(logoutAt, logoutAt + 400)).toContain('authorization');
    expect(boot.indexOf('await resumePaired(db)')).toBeGreaterThan(-1);
    expect(boot.indexOf('await resumePaired(db)')).toBeLessThan(boot.indexOf('pairScreen(db)'));
    const screenBlock = html.match(/function pairScreen\(db\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(screenBlock).toContain("fetchRetry('/pair/requests'");
    expect(screenBlock).toContain('retry_after_ms');
    expect(html.match(/writeKey\(db, 'device_id'/g)?.length).toBe(1);
    expect(screenBlock).toContain('res.status !== 200');
    // 00 v1.9.2 §8.2 (Q-42, M53): the KDS entry owns the station session; this page never signs a station in.
    expect(html).not.toContain('/auth/station');
    expect(html).toContain('status === 404');
    // 05a H-1: no token branch: no POST /devices/pair, no `t` / `d` reading, no expired-QR screen.
    expect(html).not.toContain('/devices/pair');
    expect(html).not.toContain(".get('t')");
    expect(html).not.toContain(".get('d')");
    expect(html).not.toContain('function tokenExpired');
    expect(html).not.toContain('function pairPhone');
    expect(html).not.toContain('randomUUID');
    expect(html).not.toContain('serviceWorker');
    expect(encodeCrockford128(new Uint8Array(16))).toBe('0'.repeat(26));
    expect(encodeCrockford128(Uint8Array.from({ length: 16 }, () => 0xff))).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const session = openSession(hub, { kind: 'admin', staffId: 'S_OWNER' });
    const logout = await hub.app.inject({
      method: 'POST',
      url: '/admin/auth/logout',
      headers: { 'x-admin-session': session.token },
    });
    expect(logout.statusCode).toBe(200);
    const after = await hub.app.inject({ method: 'GET', url: '/admin/queries/sessions', headers: { 'x-admin-session': session.token } });
    expect(after.statusCode).toBe(401);
  });
});

async function open(): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub);
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: device.deviceId });
  return Object.assign(hub, { adminDevice: device, adminSession: session });
}

// ------------------------------------------------------------------------------------------- 00 v1.9.1 §8.2 (H8)

describe('pair page opens the staff or KDS entry (00 v1.9.1 / v1.9.2 §8.2; Q-13, Q-29, Q-42)', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  type Page = Awaited<ReturnType<typeof runPage>>;
  /** Runs every pending timer (the page's own countdowns stop once paired); bounded. */
  async function drain(page: Page): Promise<void> {
    for (let i = 0; i < 60 && (await page.advance()); i += 1);
  }
  async function pairHtml(search = ''): Promise<string> {
    const hub = await open();
    return (await hub.app.inject({ method: 'GET', url: `/pair${search}` })).body;
  }

  it('[00 §8.2 v1.9.1] an approved tablet / cashier_kiosk / phone request → /staff/; kds → /kds/ (v1.9.2)', async () => {
    const html = await pairHtml();
    for (const device_type of ['tablet', 'cashier_kiosk', 'phone', 'kds'] as const) {
      const urls: string[] = [];
      const page = await runPage(html, {
        fetch: (url) => {
          urls.push(url);
          if (url === '/pair/requests') {
            return Promise.resolve(jsonResponse(200, { data: { request_id: 'R1', poll_secret: 'p', display_code: 'ABCDEF', approve_qr_svg: '<svg></svg>', expires_at: Date.now() + 600_000 } }));
          }
          if (url === '/pair/requests/R1') {
            return Promise.resolve(jsonResponse(200, { data: { status: 'approved', device_id: 'D1', device_token: 'tok', device_type, station_id: 'T', station_name: 'Tandoor' } }));
          }
          throw new Error(`unexpected ${url}`);
        },
      });
      for (let i = 0; i < 40 && page.store.get('token') === undefined; i += 1) await page.advance();
      expect(page.store.get('device_type'), device_type).toBe(device_type);
      // the success screen is shown first; the page moves on only after it has been seen
      expect(textOf(page.screen), device_type).toContain(EN['pairing.approved_title']);
      expect(page.assigned, device_type).toEqual([]);
      await drain(page);
      expect(page.assigned, device_type).toEqual([device_type === 'kds' ? '/kds/' : '/staff/']);
      expect(urls, device_type).not.toContain('/auth/station');
    }
  });

  // A revoked / invalid stored kds token is no longer seen here (the page makes no hub call on a stored token). The
  // KDS entry owns "401 / 403 → wipe the device keys → /pair": 03b client plan K1,
  // it('[00 §8.4] 401 DEVICE_TOKEN_INVALID, 403 DEVICE_REVOKED and WS 4403 wipe the device keys → /pair; …').
  it('[00 §8.2 v1.9.1] a later load with a stored token: non-KDS → /staff/, kds → /kds/ (v1.9.2)', async () => {
    const html = await pairHtml();
    for (const device_type of ['tablet', 'cashier_kiosk', 'phone', 'kds'] as const) {
      const urls: string[] = [];
      const page = await runPage(html, {
        store: { token: 'stored', device_id: 'D1', device_type },
        fetch: (url) => {
          urls.push(url);
          throw new Error(`unexpected ${url}`);
        },
      });
      expect(textOf(page.screen), device_type).toContain(EN['pairing.approved_title']);
      await drain(page);
      expect(urls, device_type).toEqual([]); // no new request on a stored token, and no station sign-in (v1.9.2)
      expect(page.assigned, device_type).toEqual([device_type === 'kds' ? '/kds/' : '/staff/']);
      expect(page.store.get('token'), device_type).toBe('stored');
    }
  });

  it('[05a #1] [05a H-1] an old token link /pair?t=tok&d=tablet has no phone form: it asks for a pairing request like /pair, never POST /devices/pair', async () => {
    for (const search of ['?t=tok&d=tablet', '?t=tok']) {
      const html = await pairHtml(search);
      const urls: string[] = [];
      const page = await runPage(html, {
        search,
        fetch: (url) => {
          urls.push(url);
          if (url === '/pair/requests') {
            return Promise.resolve(jsonResponse(200, { data: { request_id: 'R1', poll_secret: 'p', display_code: 'ABCDEF', approve_qr_svg: '<svg></svg>', expires_at: Date.now() + 600_000 } }));
          }
          if (url === '/pair/requests/R1') {
            return Promise.resolve(jsonResponse(200, { data: { status: 'approved', device_id: 'T1', device_token: 'tok-1', device_type: 'tablet', station_id: null, screens: ['dine_in'] } }));
          }
          throw new Error(`unexpected ${url}`);
        },
      });
      expect(page.find('device_name'), search).toBeUndefined();
      for (let i = 0; i < 40 && page.store.get('token') === undefined; i += 1) await page.advance();
      expect(page.store.get('token'), search).toBe('tok-1');
      await drain(page);
      expect(page.assigned, search).toEqual(['/staff/']);
      expect(urls[0], search).toBe('/pair/requests');
      expect(urls, search).not.toContain('/devices/pair');
    }
  });

  // ----------------------------------------------------------------------------------------- 00 v1.9.2 §8.2 (HK4)

  it('[00 §10 #163] an approved kds request → /kds/; the pair page never calls /auth/station', async () => {
    const html = await pairHtml();
    const urls: string[] = [];
    const page = await runPage(html, {
      fetch: (url) => {
        urls.push(url);
        if (url === '/pair/requests') {
          return Promise.resolve(jsonResponse(200, { data: { request_id: 'R1', poll_secret: 'p', display_code: 'ABCDEF', approve_qr_svg: '<svg></svg>', expires_at: Date.now() + 600_000 } }));
        }
        if (url === '/pair/requests/R1') {
          return Promise.resolve(jsonResponse(200, { data: { status: 'approved', device_id: 'K1', device_token: 'kds-tok', device_type: 'kds', station_id: 'T', station_name: 'Tandoor' } }));
        }
        throw new Error(`unexpected ${url}`);
      },
    });
    for (let i = 0; i < 40 && page.store.get('token') === undefined; i += 1) await page.advance();
    expect(page.store.get('token')).toBe('kds-tok');
    expect(page.store.get('device_id')).toBe('K1');
    expect(page.store.get('device_type')).toBe('kds');
    // the paired screen (with its station) is shown first, then the KDS entry opens
    expect(textOf(page.screen)).toContain(EN['pairing.approved_body'].replace('{station}', 'Tandoor'));
    expect(page.assigned).toEqual([]);
    await drain(page);
    expect(page.assigned).toEqual(['/kds/']);
    expect(urls.filter((url) => url !== '/pair/requests/R1')).toEqual(['/pair/requests']);
    expect(urls).not.toContain('/auth/station');
    expect(html).not.toContain('/auth/station');
  });

  it('[00 §10 #163] a later load with a stored kds token → /kds/; tablet / cashier_kiosk / phone still → /staff/', async () => {
    const html = await pairHtml();
    for (const device_type of ['kds', 'tablet', 'cashier_kiosk', 'phone'] as const) {
      const page = await runPage(html, {
        store: { token: 'stored', device_id: 'D1', device_type },
        fetch: (url) => {
          throw new Error(`unexpected ${url}`);
        },
      });
      const body = device_type === 'kds' ? EN['pairing.approved_body_kds'] : EN['pairing.approved_body_cashier'];
      expect(textOf(page.screen), device_type).toContain(body);
      expect(page.assigned, device_type).toEqual([]);
      await drain(page);
      expect(page.assigned, device_type).toEqual([device_type === 'kds' ? '/kds/' : '/staff/']);
      expect(page.store.get('token'), device_type).toBe('stored');
    }
  });
});
