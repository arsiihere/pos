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
