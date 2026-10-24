import { describe, expect, it } from 'vitest';
import { EN } from '../../src/lib/strings';
import { setupPage } from '../../src/setup/page';
import { jsonResponse, runPage, textOf, type PageSandbox } from '../helpers/page-sandbox';

const FIELDS = { registration_code: 'ABCD-EFGH-JKMN', advertised_host: '192.168.10.2', guest_network_cidrs: '192.168.20.0/24, 10.9.0.0/16' };

function fill(page: PageSandbox): void {
  for (const [id, value] of Object.entries(FIELDS)) page.byId(id).value = value;
}

describe('setup page', () => {
  it('[00 §10 #137] busy while provisioning, slow banner after 3 s, per-code banners with the failing field, usable again after an error, then the first-admin link and QR', async () => {
    const answers: Array<() => Promise<unknown>> = [
      () => Promise.resolve(jsonResponse(400, { error: { code: 'VALIDATION_FAILED', details: { issues: [{ path: 'advertised_host', message: 'not an address of this host' }] } } })),
      () => Promise.resolve(jsonResponse(503, { error: { code: 'SERVICE_UNAVAILABLE', details: { retry_after_ms: 5000 } } })),
      () => Promise.reject(new TypeError('fetch failed')),
    ];
    const sent: unknown[] = [];
    let release: () => void = () => undefined;
    const page = await runPage(setupPage(), {
      fetch: (url, init) => {
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
                  first_admin_url: 'http://192.168.10.2:3000/admin/bootstrap#t=tok',
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
    fill(page);

    await page.submit(form);
    expect(sent[0]).toEqual({
      registration_code: FIELDS.registration_code,
      advertised_host: FIELDS.advertised_host,
      guest_network_cidrs: ['192.168.20.0/24', '10.9.0.0/16'],
    });
    expect(page.byId('field_advertised_host').classList.contains('pos-field--error')).toBe(true);
    expect(page.byId('field_registration_code').classList.contains('pos-field--error')).toBe(false);
    expect(textOf(status)).toContain(EN['errors.VALIDATION_FAILED']);
    expect(button.disabled).toBe(false);
    expect(button.classList.contains('is-busy')).toBe(false);

    await page.submit(form);
    expect(page.byId('field_advertised_host').classList.contains('pos-field--error')).toBe(false);
    expect(textOf(status)).toContain(EN['errors.SERVICE_UNAVAILABLE']);

    await page.submit(form);
    expect(textOf(status)).toContain(EN['errors.SERVICE_UNAVAILABLE']);
    expect(button.disabled).toBe(false);

    const submitted = page.submit(form);
    await page.settle();
    expect(button.disabled).toBe(true);
    expect(button.classList.contains('is-busy')).toBe(true);
    expect(textOf(status)).not.toContain(EN['setup.slow']);
    expect(page.delays.at(-1)).toBe(3000);
    await page.advance();
    expect(textOf(status)).toContain(EN['setup.slow']);
    release();
    await submitted;
    await page.settle();

    const done = page.byId('setup_done');
    expect(done.hidden).toBe(false);
    expect(form.hidden).toBe(true);
    const text = textOf(done);
    expect(text).toContain(EN['setup.done_title']);
    expect(text).toContain(EN['setup.done_body']);
    expect(text).toContain('http://192.168.10.2:3000/admin/bootstrap#t=tok');
    expect(text).toContain(EN['setup.expires'].replace('{min}', '30'));
    expect(page.findAll((el) => el.href === 'http://192.168.10.2:3000/admin/bootstrap#t=tok', done)).toHaveLength(1);
    expect(page.findAll((el) => el.innerHTML === '<svg id="qr"></svg>', done)).toHaveLength(1);
    expect(textOf(page.body)).not.toMatch(/errors\.|setup\./);
  });
});
