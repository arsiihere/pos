import { describe, expect, it } from 'vitest';
import { hardwareHintFor, pairPage } from '../../src/auth/pair-page';
import { EN } from '../../src/lib/strings';
import { jsonResponse, runPage, textOf } from '../helpers/page-sandbox';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36';
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
const KIOSK = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

function requestReply() {
  return jsonResponse(200, { data: { request_id: 'R1', poll_secret: 'p', display_code: 'ABCDEF', approve_qr_svg: '<svg></svg>', expires_at: Date.now() + 581_000 } });
}

async function postedBody(userAgent: string): Promise<Record<string, unknown>> {
  let body = '';
  const page = await runPage(pairPage(), {
    userAgent,
    fetch: (url, init) => {
      if (url === '/pair/requests') {
        body = String((init as { body?: string }).body);
        return Promise.resolve(requestReply());
      }
      return Promise.resolve(jsonResponse(200, { data: { status: 'pending' } }));
    },
  });
  while (!body) if (!(await page.advance())) break;
  return JSON.parse(body) as Record<string, unknown>;
}

describe('pair page', () => {
  it('[05a §8] one flow for every device: code and the text "Ask someone with hub access to approve this screen"', async () => {
    expect(EN['pairing.title']).toBe('Ask someone with hub access to approve this screen');
    const page = await runPage(pairPage(), { userAgent: KIOSK, fetch: () => Promise.resolve(requestReply()) });
    while (!textOf(page.screen).includes('ABCDEF')) if (!(await page.advance())) break;
    expect(textOf(page.screen)).toContain('Ask someone with hub access to approve this screen');
    expect(textOf(page.screen)).toContain('ABCDEF');
  });

  it('[05a §6.1] user agent to hint: iPhone and Android Mobile give phone; iPad desktop agent and Android tablet give none', () => {
    expect(hardwareHintFor(IPHONE)).toBe('phone');
    expect(hardwareHintFor(ANDROID_PHONE)).toBe('phone');
    expect(hardwareHintFor(IPAD_DESKTOP)).toBeNull();
    expect(hardwareHintFor(ANDROID_TABLET)).toBeNull();
  });

  it('[05a §6.1] the POST body carries hardware_hint phone on an Android phone, and no hardware_hint key at all otherwise', async () => {
    expect(await postedBody(ANDROID_PHONE)).toEqual({ device_name: 'screen', hardware_hint: 'phone' });
    for (const ua of [IPAD_DESKTOP, ANDROID_TABLET, KIOSK]) {
      const body = await postedBody(ua);
      expect(Object.keys(body)).toEqual(['device_name']);
    }
  });

  it('[05a §8] iOS Safari outside the Home Screen shows "Add to Home Screen" first and makes no request', async () => {
    const calls: string[] = [];
    const page = await runPage(pairPage(), {
      userAgent: IPHONE,
      fetch: (url) => {
        calls.push(url);
        return Promise.resolve(requestReply());
      },
    });
    await page.advance();
    expect(textOf(page.screen)).toContain(EN['pairing.ios_title']);
    expect(calls).toEqual([]);
  });
});

// 05b H-2 / N-9 (gate test 8): the pair page inside the tablet app (a fake `window.Capacitor` bridge).
type DeviceKeys = { token: string; device_id: string; device_type: string };
function fakeBridge(reject?: { code: string; message: string }) {
  const calls: DeviceKeys[] = [];
  const PosNative = {
    setDeviceToken: (keys: DeviceKeys) => {
      calls.push({ ...keys });
      return reject === undefined ? Promise.resolve() : Promise.reject(Object.assign(new Error(reject.message), { code: reject.code }));
    },
  };
  return { calls, window: { Capacitor: { isNativePlatform: () => true, Plugins: { PosNative } } } };
}

function approvedReply(device_type: string, token = 'tok-1') {
  return jsonResponse(200, { data: { status: 'approved', device_id: 'T1', device_token: token, device_type, station_id: null, screens: ['dine_in'] } });
}

describe('pair page in the tablet app (05b H-2, N-9; gate test 8)', () => {
  it('[05b #8] ?hint=tablet sends hardware_hint tablet; with the bridge it sends tablet without the query too, whatever the user agent', async () => {
    const posted = async (o: { search?: string; userAgent: string; window?: Record<string, unknown> }) => {
      let body = '';
      const page = await runPage(pairPage(), {
        ...o,
        fetch: (url, init) => {
          if (url === '/pair/requests') body = String((init as { body?: string }).body);
          return Promise.resolve(url === '/pair/requests' ? requestReply() : jsonResponse(200, { data: { status: 'pending' } }));
        },
      });
      while (!body) if (!(await page.advance())) break;
      return JSON.parse(body) as Record<string, unknown>;
    };
    expect(await posted({ search: '?hint=tablet', userAgent: KIOSK })).toEqual({ device_name: 'screen', hardware_hint: 'tablet' });
    for (const ua of [ANDROID_PHONE, ANDROID_TABLET, KIOSK]) {
      expect(await posted({ userAgent: ua, window: fakeBridge().window }), ua).toEqual({ device_name: 'screen', hardware_hint: 'tablet' });
    }
    // outside the app (no bridge, or a bridge that is not the native platform): 05a's rule, unchanged
    expect(Object.keys(await posted({ userAgent: ANDROID_TABLET }))).toEqual(['device_name']);
    const web = { Capacitor: { isNativePlatform: () => false, Plugins: { PosNative: {} } } };
    expect(await posted({ userAgent: ANDROID_PHONE, window: web })).toEqual({ device_name: 'screen', hardware_hint: 'phone' });
  });

  it('[05b #8] on approval the page writes IndexedDB pos-device as today and calls setDeviceToken with the three keys, then opens /staff/', async () => {
    const bridge = fakeBridge();
    const page = await runPage(pairPage(), {
      userAgent: ANDROID_TABLET,
      window: bridge.window,
      fetch: (url) => Promise.resolve(url === '/pair/requests' ? requestReply() : approvedReply('tablet')),
    });
    for (let i = 0; i < 40 && page.assigned.length === 0; i += 1) await page.advance();
    expect(page.store.get('token')).toBe('tok-1');
    expect(page.store.get('device_id')).toBe('T1');
    expect(page.store.get('device_type')).toBe('tablet');
    expect(bridge.calls).toEqual([{ token: 'tok-1', device_id: 'T1', device_type: 'tablet' }]);
    expect(page.assigned).toEqual(['/staff/']);
  });

  it('[05b #8] a NOT_TABLET refusal wipes the three keys, shows its message and starts a new request', async () => {
    const bridge = fakeBridge({ code: 'NOT_TABLET', message: 'Approve this tablet as a Tablet' });
    const posts: string[] = [];
    let polls = 0;
    const page = await runPage(pairPage(), {
      userAgent: ANDROID_TABLET,
      window: bridge.window,
      fetch: (url) => {
        if (url === '/pair/requests') {
          posts.push(url);
          return Promise.resolve(requestReply());
        }
        polls += 1;
        return Promise.resolve(polls === 1 ? approvedReply('phone') : jsonResponse(200, { data: { status: 'pending' } }));
      },
    });
    for (let i = 0; i < 40 && posts.length < 2; i += 1) await page.advance();
    expect(bridge.calls).toEqual([{ token: 'tok-1', device_id: 'T1', device_type: 'phone' }]);
    expect(page.store.has('token')).toBe(false);
    expect(page.store.has('device_id')).toBe(false);
    expect(page.store.has('device_type')).toBe(false);
    expect(posts.length).toBe(2);
    await page.settle();
    expect(textOf(page.screen)).toContain('Approve this tablet as a Tablet');
    expect(textOf(page.screen)).toContain('ABCDEF');
    expect(page.assigned).toEqual([]);
  });

  it('[05b #8] resumePaired with the bridge calls setDeviceToken with the stored keys before opening /staff/; without it, no call', async () => {
    const bridge = fakeBridge();
    const urls: string[] = [];
    const page = await runPage(pairPage(), {
      userAgent: ANDROID_TABLET,
      window: bridge.window,
      store: { token: 'stored', device_id: 'T9', device_type: 'tablet' },
      fetch: (url) => {
        urls.push(url);
        throw new Error(`unexpected ${url}`);
      },
    });
    expect(bridge.calls).toEqual([{ token: 'stored', device_id: 'T9', device_type: 'tablet' }]);
    for (let i = 0; i < 20 && (await page.advance()); i += 1);
    expect(page.assigned).toEqual(['/staff/']);
    expect(urls).toEqual([]);
    expect(page.store.get('token')).toBe('stored');
  });

  it('[05b N-9] resumePaired: a NOT_TABLET refusal of the stored keys wipes them and starts a new request with the message', async () => {
    const bridge = fakeBridge({ code: 'NOT_TABLET', message: 'Approve this tablet as a Tablet' });
    const posts: string[] = [];
    const page = await runPage(pairPage(), {
      userAgent: ANDROID_TABLET,
      window: bridge.window,
      store: { token: 'stored', device_id: 'K9', device_type: 'cashier_kiosk' },
      fetch: (url) => {
        posts.push(url);
        return Promise.resolve(url === '/pair/requests' ? requestReply() : jsonResponse(200, { data: { status: 'pending' } }));
      },
    });
    for (let i = 0; i < 10 && !textOf(page.screen).includes('ABCDEF'); i += 1) await page.advance();
    expect([...page.store.keys()]).toEqual([]);
    expect(posts[0]).toBe('/pair/requests');
    expect(textOf(page.screen)).toContain('Approve this tablet as a Tablet');
    expect(page.assigned).toEqual([]);
  });
});
