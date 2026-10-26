import { describe, expect, it } from 'vitest';
import { EN } from '../../src/lib/strings';
import { jsonResponse, runPage, textOf, type PageSandbox } from '../helpers/page-sandbox';
import { createTestHub } from '../helpers/test-hub';

async function bootstrapHtml(): Promise<string> {
  const hub = await createTestHub();
  try {
    return (await hub.app.inject({ method: 'GET', url: '/admin/bootstrap' })).body;
  } finally {
    await hub.close();
  }
}

const isTile = (el: { className: string }) => el.className.split(' ').includes('pos-staff__tile');

function key(page: PageSandbox, label: string) {
  return page.findAll((el) => el.className.includes('pos-pin__key') && el.textContent === label, page.byId('login'))[0]!;
}

async function type(page: PageSandbox, digits: string): Promise<void> {
  for (const digit of digits) await page.click(key(page, digit));
}

describe('bootstrap page', () => {
  it('[00 §10 #138] roster as name tiles (locked one shows the minutes), PIN pad with length check, wrong PIN with tries left, auto-submit on the 6th digit, then the signed-in screen linking /admin/approve', async () => {
    const html = await bootstrapHtml();
    const lockedUntil = Date.now() + 600_000;
    const answers = [
      jsonResponse(401, { error: { code: 'PIN_INVALID', details: { attempts_remaining: 2 } } }),
      jsonResponse(200, {
        data: {
          admin_session_token: 'admin-tok',
          session_id: 'sess-1',
          staff_id: 'S1',
          display_name: 'Ayesha',
          idle_ttl_ms: 3_600_000,
          permissions: { 'manage-devices': true, 'manage-staff': false },
        },
      }),
    ];
    const sent: Array<Record<string, unknown>> = [];
    const page = await runPage(html, {
      hash: '#t=boot-token',
      fetch: (url, init) => {
        if (url === '/admin/login-roster') {
          expect((init as { headers: Record<string, string> }).headers['X-Admin-Bootstrap']).toBe('boot-token');
          return Promise.resolve(
            jsonResponse(200, {
              data: {
                staff: [
                  { staff_id: 'S1', display_name: 'Ayesha', locked_until: null },
                  { staff_id: 'S2', display_name: 'Bilal', locked_until: lockedUntil },
                ],
              },
            }),
          );
        }
        if (url === '/admin/auth/bootstrap') {
          sent.push(JSON.parse((init as { body: string }).body));
          return Promise.resolve(answers.shift());
        }
        throw new Error(`unexpected ${url}`);
      },
    });
    const roster = page.byId('roster');
    const tiles = page.findAll(isTile, roster);
    expect(tiles.map((tile) => tile.staffName)).toEqual(['Ayesha', 'Bilal']);
    expect(tiles[1]!.classList.contains('is-locked')).toBe(true);
    expect(textOf(tiles[1])).toContain(EN['staff.locked_min'].replace('{min}', '10'));
    expect(textOf(roster)).not.toContain('S1');
    expect(page.find('staff_id', page.byId('login'))).toBeUndefined();
    const status = () => textOf(page.find('auth_error', page.byId('login')));

    await page.click(key(page, EN['pin.submit']));
    expect(status()).toContain(EN['bootstrap.pick_first']);
    await page.click(tiles[0]!);
    expect(tiles[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(textOf(page.byId('login'))).toContain('Ayesha');

    await type(page, '123');
    await page.click(key(page, EN['pin.submit']));
    expect(status()).toContain(EN['pin.length']);
    expect(sent).toHaveLength(0);
    await type(page, '4');
    await page.click(key(page, EN['pin.submit']));
    expect(sent[0]).toEqual({ bootstrap_token: 'boot-token', staff_id: 'S1', pin: '1234' });
    expect(status()).toContain(EN['pin.tries_left'].replace('{n}', '2'));
    expect(page.findAll((el) => el.className.includes('pos-pin') && el.className.includes('is-error'), page.byId('login'))).toHaveLength(1);
    expect(page.find('pin', page.byId('login'))!.value).toBe('');

    await type(page, '432112');
    expect(sent[1]).toEqual({ bootstrap_token: 'boot-token', staff_id: 'S1', pin: '432112' });
    const done = page.byId('bootstrap_done');
    expect(done.hidden).toBe(false);
    expect(textOf(done)).toContain(EN['bootstrap.signed_in'].replace('{name}', 'Ayesha'));
    expect(textOf(done)).toContain(EN['bootstrap.idle_note']);
    const approve = page.findAll((el) => el.tagName === 'a', done);
    expect(approve[0]!.href).toBe('/admin/approve');
    expect(approve[0]!.textContent).toBe(EN['bootstrap.approve']);
    expect(page.session.get('admin_session_token')).toBe('admin-tok');
    expect(page.session.get('admin_bootstrap')).toBe('1');
    expect(JSON.parse(page.session.get('admin_permissions')!)).toEqual({ 'manage-devices': true, 'manage-staff': false });
    expect(textOf(page.body)).not.toMatch(/errors\.|pin\.|bootstrap\./);
  });

  it('[00 §10 #138] IP lockout locks the keys with the minutes; a person lockout locks their tile; no admins shows the empty state; a dead link shows the expired screen', async () => {
    const html = await bootstrapHtml();
    const roster = { data: { staff: [{ staff_id: 'S1', display_name: 'Ayesha', locked_until: null }] } };
    const answers = [
      jsonResponse(429, { error: { code: 'IP_LOCKED_OUT', details: { retry_after_ms: 1_260_000 } } }),
      jsonResponse(429, { error: { code: 'PIN_LOCKED_OUT', details: { retry_after_ms: 900_000 } } }),
    ];
    const page = await runPage(html, {
      hash: '#t=boot-token',
      fetch: (url) => Promise.resolve(url === '/admin/login-roster' ? jsonResponse(200, roster) : answers.shift()),
    });
    const form = page.byId('login');
    const pad = () => page.findAll((el) => el.className.split(' ')[0] === 'pos-pin', form)[0]!;
    // One name on the roster is pre-selected.
    await type(page, '1234');
    await page.click(key(page, EN['pin.submit']));
    expect(textOf(form)).toContain(EN['pin.locked_ip']);
    expect(textOf(form)).toContain(EN['pin.locked_ip_body'].replace('{min}', '21'));
    expect(pad().classList.contains('is-locked')).toBe(true);
    await page.advance();
    expect(pad().classList.contains('is-locked')).toBe(false);
    await type(page, '1234');
    await page.click(key(page, EN['pin.submit']));
    expect(textOf(form)).toContain(EN['pin.locked_person'].replace('{name}', 'Ayesha').replace('{min}', '15'));
    expect(page.findAll(isTile, page.byId('roster'))[0]!.classList.contains('is-locked')).toBe(true);

    const empty = await runPage(html, { hash: '#t=boot-token', fetch: () => Promise.resolve(jsonResponse(200, { data: { staff: [] } })) });
    expect(textOf(empty.byId('login'))).toContain(EN['bootstrap.no_admins']);

    const dead = await runPage(html, { fetch: () => Promise.reject(new Error('no request expected')) });
    expect(dead.byId('bootstrap_expired').hidden).toBe(false);
    expect(dead.byId('bootstrap_main').hidden).toBe(true);
  });
});
