import { describe, expect, it } from 'vitest';
import { EN } from '../../src/lib/strings';
import { jsonResponse, runPage, textOf } from '../helpers/page-sandbox';
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

describe('bootstrap page', () => {
  it('[00 §10 #138] roster as name tiles, tap to select, PIN errors with attempts left, then the signed-in screen linking /admin/approve; a dead link shows the expired screen', async () => {
    const html = await bootstrapHtml();
    const lockedUntil = Date.now() + 600_000;
    const answers = [
      jsonResponse(401, { error: { code: 'PIN_INVALID', details: { attempts_remaining: 2 } } }),
      jsonResponse(200, {
        data: { admin_session_token: 'admin-tok', session_id: 'sess-1', staff_id: 'S1', display_name: 'Ayesha', idle_ttl_ms: 3_600_000 },
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
    expect(tiles.map((tile) => tile.textContent)).toEqual(['Ayesha', 'Bilal']);
    expect(tiles[0]!.disabled).toBe(false);
    expect(tiles[1]!.disabled).toBe(true);
    expect(tiles[1]!.classList.contains('is-locked')).toBe(true);
    expect(textOf(tiles[1])).toContain(EN['auth.locked_for'].replace('{min}', '10'));
    expect(textOf(roster)).not.toContain('{');
    expect(textOf(roster)).not.toContain('S1');
    expect(page.find('staff_id', page.byId('login'))).toBeUndefined();

    const form = page.byId('login');
    const status = page.byId('login_status');
    page.byId('pin').value = '1234';
    await page.submit(form);
    expect(sent).toHaveLength(0);
    expect(textOf(status)).toContain(EN['bootstrap.pick_first']);

    await page.click(tiles[0]!);
    expect(tiles[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(tiles[1]!.getAttribute('aria-pressed')).toBe('false');

    await page.submit(form);
    expect(sent[0]).toEqual({ bootstrap_token: 'boot-token', staff_id: 'S1', pin: '1234' });
    expect(textOf(status)).toContain(EN['errors.PIN_INVALID']);
    expect(textOf(status)).toContain(EN['auth.attempts_left'].replace('{n}', '2'));
    expect(page.byId('pin_box').classList.contains('is-error')).toBe(true);
    expect(page.byId('pin').value).toBe('');

    page.byId('pin').value = '4321';
    await page.submit(form);
    expect(page.session.get('admin_session_token')).toBe('admin-tok');
    expect(page.session.get('admin_staff_id')).toBe('S1');
    expect(page.session.get('admin_bootstrap')).toBe('1');
    const done = page.byId('bootstrap_done');
    expect(done.hidden).toBe(false);
    expect(form.hidden).toBe(true);
    expect(textOf(done)).toContain(EN['bootstrap.signed_in'].replace('{name}', 'Ayesha'));
    const approve = page.findAll((el) => el.href === '/admin/approve', done);
    expect(approve).toHaveLength(1);
    expect(approve[0]!.textContent).toBe(EN['bootstrap.approve']);

    const dead = await runPage(html, {
      hash: '#t=old-token',
      fetch: (url) => {
        if (url === '/admin/login-roster') {
          return Promise.resolve(jsonResponse(401, { error: { code: 'PAIRING_TOKEN_INVALID', details: {} } }));
        }
        throw new Error(`unexpected ${url}`);
      },
    });
    expect(dead.byId('bootstrap_expired').hidden).toBe(false);
    expect(dead.byId('login').hidden).toBe(true);
  });
});
