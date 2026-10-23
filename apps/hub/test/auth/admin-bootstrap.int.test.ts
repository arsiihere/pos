import { issueAdminBootstrap } from '../../src/auth/bootstrap-tokens';
import { afterEach, describe, expect, it } from 'vitest';
import { PIN } from '../helpers/fixtures';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';

const cleanups: Array<() => Promise<void>> = [];

describe('first-admin bootstrap', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #92] one admin session without a device; second use 401; after 30 min 401; 10 wrong PINs from one IP → 429 IP_LOCKED_OUT; the page reads location.hash and calls replaceState, and never sends the token in a URL query', async () => {
    const hub = await open();
    const issued = issue(hub);
    const opened = await bootstrap(hub, issued.token, 'S_OWNER', PIN.a);
    expect(opened.statusCode).toBe(200);
    const body = opened.json().data;
    const session = hub.deps.db
      .prepare('SELECT device_id, kind FROM staff_sessions WHERE session_id = ?')
      .get(body.session_id) as { device_id: string | null; kind: string };
    expect(session).toEqual({ device_id: null, kind: 'admin' });
    const started = hub.deps.db
      .prepare(`SELECT device_id FROM events WHERE event_type = 'SessionStarted' ORDER BY seq DESC LIMIT 1`)
      .get() as { device_id: string };
    expect(started.device_id).toBe('hub-admin');

    const again = await bootstrap(hub, issued.token, 'S_OWNER', PIN.a);
    expect(again.statusCode).toBe(401);
    expect(again.json().error.code).toBe('PAIRING_TOKEN_INVALID');

    const expiring = issue(hub);
    hub.clock.advance(1_800_000);
    const expired = await bootstrap(hub, expiring.token, 'S_OWNER', PIN.a);
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe('PAIRING_TOKEN_INVALID');

    hub.deps.config.auth.pin_max_failures = 100;
    const fresh = issue(hub);
    for (let i = 0; i < 10; i += 1) {
      const wrong = await bootstrap(hub, fresh.token, 'S_OWNER', '0000');
      expect(wrong.statusCode).toBe(401);
      expect(wrong.json().error.code).toBe('PIN_INVALID');
    }
    const locked = await bootstrap(hub, fresh.token, 'S_OWNER', '0000');
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('IP_LOCKED_OUT');

    const page = await hub.app.inject({ method: 'GET', url: '/admin/bootstrap' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('location.hash');
    expect(page.body).toContain('history.replaceState');
    expect(page.body).toContain('X-Admin-Bootstrap');
    expect(page.body).toContain("sessionStorage.setItem('admin_session_token'");
    expect(page.body).not.toContain('localStorage');
    expect(page.body).not.toContain('?t=');
    expect(page.body).not.toContain('location.search');
  });
});

async function open(): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub);
  return hub;
}

function issue(hub: TestHub): { token: string } {
  return hub.deps.writer.run((tx) =>
    issueAdminBootstrap(tx, 'setup', { clock: hub.deps.clock, ids: hub.deps.ids, secrets: hub.deps.secrets }),
  ).result;
}

function bootstrap(hub: TestHub, token: string, staffId: string, pin: string) {
  return hub.app.inject({
    method: 'POST',
    url: '/admin/auth/bootstrap',
    payload: { bootstrap_token: token, staff_id: staffId, pin },
  });
}
