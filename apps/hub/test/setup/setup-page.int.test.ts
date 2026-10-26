import { describe, expect, it } from 'vitest';
import { hostChoices } from '../../src/lib/net';
import { EN } from '../../src/lib/strings';
import { setupPage } from '../../src/setup/page';
import { jsonResponse, runPage, textOf, type PageSandbox } from '../helpers/page-sandbox';

const CHOICES = [
  { address: '192.168.0.107', kind: 'cable' as const, name: 'enp1s0' },
  { address: '192.168.1.34', kind: 'wifi' as const, name: 'wlp2s0' },
];

function fill(page: PageSandbox): void {
  page.byId('registration_code').value = 'ABCD-EFGH-JKMN';
  page.byId('guest_network_cidrs').value = '192.168.20.0/24, 10.9.0.0/16';
}

async function advanceUntil(page: PageSandbox, done: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !done(); i += 1) if (!(await page.advance())) break;
}

describe('setup page', () => {
  it('[00 §10 #137] M85 address tiles: own IPv4 only, link-local and internal removed, cable first', () => {
    const choices = hostChoices({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '255.0.0.0', mac: '', cidr: null }],
      wlp2s0: [
        { address: '192.168.1.34', family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '', cidr: null },
        { address: 'fe80::1', family: 'IPv6', internal: false, netmask: '', mac: '', cidr: null, scopeid: 0 },
      ],
      enp1s0: [
        { address: '169.254.3.3', family: 'IPv4', internal: false, netmask: '255.255.0.0', mac: '', cidr: null },
        { address: '192.168.0.107', family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '', cidr: null },
      ],
    });
    expect(choices).toEqual(CHOICES);
  });

  it('[00 §10 #137] tiles preselect the cable address and "Other address" opens the typed field; busy, slow banner, per-code states, offline, then the first-admin link until the hub is back', async () => {
    const answers: Array<() => Promise<unknown>> = [
      () => Promise.resolve(jsonResponse(400, { error: { code: 'VALIDATION_FAILED', details: { issues: [{ path: 'guest_network_cidrs.1', message: 'bad' }] } } })),
      () => Promise.resolve(jsonResponse(503, { error: { code: 'SERVICE_UNAVAILABLE', details: { retry_after_ms: 5000 } } })),
      () => Promise.resolve(jsonResponse(401, { error: { code: 'REGISTRATION_CODE_INVALID', details: {} } })),
      () => Promise.reject(new TypeError('fetch failed')),
    ];
    const sent: Array<Record<string, unknown>> = [];
    const healths: string[] = [];
    let healthUp = false;
    let release: () => void = () => undefined;
    const page = await runPage(setupPage(CHOICES), {
      fetch: (url, init) => {
        if (url.endsWith('/health')) {
          healths.push(url);
          return healthUp ? Promise.resolve(jsonResponse(200, {})) : Promise.reject(new TypeError('down'));
        }
        expect(url).toBe('/setup/provision');
        sent.push(JSON.parse((init as { body: string }).body));
        const next = answers.shift();
        if (next !== undefined) return next();
        return new Promise((resolve) => {
          release = () =>
            resolve(
              jsonResponse(200, {
                data: {
                  restarting: true,
                  first_admin_url: 'http://192.168.0.107:3000/admin/bootstrap#t=tok',
                  first_admin_qr_svg: '<svg id="qr"></svg>',
                  first_admin_expires_at: Date.now() + 1_800_000,
                },
              }),
            );
        });
      },
    });
    const form = page.byId('setup');
    const button = page.byId('setup_submit');
    const status = page.byId('setup_status');
    const host = page.byId('advertised_host');
    const tiles = page.byId('host_tiles').children;
    expect(tiles.map((tile) => textOf(tile))).toEqual([`192.168.0.107 ${EN['setup.host_cable']}`, `192.168.1.34 ${EN['setup.host_wifi']}`, EN['setup.host_other']]);
    expect(tiles[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(host.hidden).toBe(true);
    expect(host.value).toBe('192.168.0.107');
    await page.click(tiles[2]!);
    expect(host.hidden).toBe(false);
    expect(host.value).toBe('');
    await page.click(tiles[1]!);
    expect(host.value).toBe('192.168.1.34');
    fill(page);

    await page.submit(form);
    expect(sent[0]).toEqual({ registration_code: 'ABCD-EFGH-JKMN', advertised_host: '192.168.1.34', guest_network_cidrs: ['192.168.20.0/24', '10.9.0.0/16'] });
    expect(page.byId('field_guest_network_cidrs').classList.contains('pos-field--error')).toBe(true);
    expect(page.byId('field_registration_code').classList.contains('pos-field--error')).toBe(false);
    expect(textOf(status)).toContain(EN['errors.VALIDATION_FAILED']);

    await page.submit(form);
    expect(page.byId('field_guest_network_cidrs').classList.contains('pos-field--error')).toBe(false);
    expect(textOf(status)).toContain(EN['errors.SERVICE_UNAVAILABLE_cloud']);
    expect(textOf(status)).toContain(EN['errors.SERVICE_UNAVAILABLE_cloud_body'].replace('{s}', '5'));
    expect(button.disabled).toBe(true);
    await advanceUntil(page, () => !button.disabled);
    expect(button.disabled).toBe(false);

    await page.submit(form);
    expect(textOf(status)).toContain(EN['errors.REGISTRATION_CODE_INVALID']);
    expect(textOf(status)).toContain(EN['errors.REGISTRATION_CODE_INVALID_body']);

    await page.submit(form);
    expect(textOf(page.byId('setup_offline'))).toContain(EN['global.hub_down_title']);
    expect(textOf(page.byId('setup_offline'))).toContain(EN['setup.offline_body']);
    expect(button.disabled).toBe(true);
    expect(page.byId('registration_code').value).toBe('ABCD-EFGH-JKMN');
    healthUp = true;
    await advanceUntil(page, () => !button.disabled);
    expect(textOf(page.byId('setup_offline'))).toBe('');

    const submitted = page.submit(form);
    await submitted;
    expect(button.classList.contains('is-busy')).toBe(true);
    expect(button.textContent).toBe(EN['setup.busy']);
    expect(textOf(status)).not.toContain(EN['setup.slow']);
    await page.advance();
    expect(textOf(status)).toContain(EN['setup.slow']);
    release();
    await page.settle();

    const done = page.byId('setup_done');
    expect(done.hidden).toBe(false);
    expect(page.byId('screen').hidden).toBe(true);
    const text = textOf(done);
    expect(text).toContain(EN['setup.done_title']);
    expect(text).toContain('http://192.168.0.107:3000/admin/bootstrap#t=tok');
    expect(text).toMatch(/Works once, for 30 minutes \(until\s+\d\d:\d\d\s*\)/);
    expect(text).toContain(EN['setup.restarting']);
    expect(text).not.toContain(EN['setup.open_here']);
    healthUp = false;
    await page.advance();
    healthUp = true;
    await advanceUntil(page, () => textOf(done).includes(EN['setup.open_here']));
    expect(textOf(done)).toContain(EN['setup.ready']);
    expect(healths.at(-1)).toBe('http://192.168.0.107:3000/health');
    const open = page.findAll((el) => el.textContent === EN['setup.open_here'], done)[0]!;
    expect(open.href).toBe('http://192.168.0.107:3000/admin/bootstrap#t=tok');
    expect(textOf(page.body)).not.toMatch(/errors\.|setup\./);
  });

  it('[00 §10 #140] M83: ?lang=ur → lang ur, dir rtl, Urdu text, remembered; navigator ur-PK → Urdu; en-US → English; a key missing from UR shows English', async () => {
    const fetch = () => new Promise<never>(() => undefined);
    const ur = await runPage(setupPage(CHOICES), { fetch, search: '?lang=ur' });
    expect(ur.documentElement).toMatchObject({ lang: 'ur', dir: 'rtl' });
    expect(ur.local.get('pos-lang')).toBe('ur');
    expect(textOf(ur.byId('host_tiles'))).toContain(EN['setup.host_other']);
    const remembered = await runPage(setupPage(CHOICES), { fetch, local: { 'pos-lang': 'ur' } });
    expect(remembered.documentElement.dir).toBe('rtl');
    const fromBrowser = await runPage(setupPage(CHOICES), { fetch, language: 'ur-PK' });
    expect(fromBrowser.documentElement.lang).toBe('ur');
    const english = await runPage(setupPage(CHOICES), { fetch, language: 'en-US' });
    expect(english.documentElement).toMatchObject({ lang: 'en', dir: 'ltr' });
    const override = await runPage(setupPage(CHOICES), { fetch, search: '?lang=en', language: 'ur-PK', local: { 'pos-lang': 'ur' } });
    expect(override.documentElement.lang).toBe('en');
  });
});
