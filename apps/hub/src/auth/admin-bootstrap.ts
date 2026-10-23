/// <reference types="node" />
import { DomainError } from '@pos/domain';
import { verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { HubDeps } from '../server.js';
import { sha256hex } from '../lib/hash.js';
import type { Semaphore } from '../lib/semaphore.js';
import { currentDirectory } from './guards.js';
import { checkPin } from './pin.js';
import { createSession } from './session-store.js';

const PAGE = `<!doctype html>
<html><body>
<form id="login">
  <label>Staff <input name="staff_id"></label>
  <label>PIN <input name="pin" inputmode="numeric"></label>
  <button type="submit">Sign in</button>
</form>
<div id="roster"></div>
<script>
const token = new URLSearchParams(location.hash.replace(/^#/, '')).get('t');
history.replaceState(null, '', location.pathname);
fetch('/admin/login-roster', { headers: { 'X-Admin-Bootstrap': token } })
  .then((res) => res.json())
  .then((body) => { document.getElementById('roster').textContent = JSON.stringify(body.data.staff); });
document.getElementById('login').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  fetch('/admin/auth/bootstrap', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bootstrap_token: token, staff_id: form.get('staff_id'), pin: form.get('pin') }),
  });
});
</script>
</body></html>`;

export function registerAdminBootstrapRoutes(app: FastifyInstance, deps: HubDeps, adminSemaphore: Semaphore): void {
  app.get('/admin/bootstrap', { config: { group: 'admin-bootstrap' } }, async (_request, reply: FastifyReply) => {
    return reply.type('text/html').send(PAGE);
  });

  app.post('/admin/auth/bootstrap', { config: { group: 'admin-bootstrap' } }, async (request) => {
    const body = loginBody(request);
    if (!liveToken(deps, body.bootstrap_token)) throw new DomainError('PAIRING_TOKEN_INVALID');
    const outcome = await checkPin(
      {
        db: deps.db,
        writer: deps.writer,
        directory: () => currentDirectory(app),
        clock: deps.clock,
        config: deps.config,
        semaphore: adminSemaphore,
        verify: (pinHash, pin) => verify(pinHash, pin),
      },
      {
        staffId: body.staff_id,
        pin: body.pin,
        subject: { type: 'ip', id: request.ip },
        eventDeviceId: 'hub-admin',
      },
      (tx) => {
        const directory = currentDirectory(app);
        const staff = directory.get(body.staff_id);
        if (staff === undefined || !directory.hasAdmin(body.staff_id)) return { allowed: false as const };
        const now = deps.clock.branchNow();
        const consumed = tx.db
          .prepare(
            `UPDATE admin_bootstrap_tokens SET consumed_at = ?
             WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
          )
          .run(now, sha256hex(body.bootstrap_token), now);
        if (consumed.changes !== 1) throw new DomainError('PAIRING_TOKEN_INVALID');
        const idleTtlMs = directory.ttlFor(body.staff_id);
        const created = createSession(tx, {
          kind: 'admin',
          staffId: body.staff_id,
          stationId: null,
          deviceId: null,
          idleTtlMs,
          eventDeviceId: 'hub-admin',
        });
        return {
          allowed: true as const,
          admin_session_token: created.token,
          session_id: created.sessionId,
          staff_id: body.staff_id,
          display_name: staff.display_name,
          idle_ttl_ms: idleTtlMs,
        };
      },
    );
    if (!outcome.allowed) throw new DomainError('PERMISSION_DENIED', { permission: 'access-hub-admin' });
    return {
      data: {
        admin_session_token: outcome.admin_session_token,
        session_id: outcome.session_id,
        staff_id: outcome.staff_id,
        display_name: outcome.display_name,
        idle_ttl_ms: outcome.idle_ttl_ms,
      },
    };
  });
}

function loginBody(request: FastifyRequest): { bootstrap_token: string; staff_id: string; pin: string } {
  const body = request.body as { bootstrap_token?: unknown; staff_id?: unknown; pin?: unknown } | null;
  const token = body?.bootstrap_token;
  const staffId = body?.staff_id;
  const pin = body?.pin;
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    typeof staffId !== 'string' ||
    staffId.length === 0 ||
    typeof pin !== 'string' ||
    !/^\d{4,6}$/.test(pin)
  ) {
    throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'pin', message: 'invalid' }] });
  }
  return { bootstrap_token: token, staff_id: staffId, pin };
}

function liveToken(deps: HubDeps, token: string): boolean {
  const row = deps.db
    .prepare('SELECT consumed_at, expires_at FROM admin_bootstrap_tokens WHERE token_hash = ?')
    .get(sha256hex(token)) as { consumed_at: number | null; expires_at: number } | undefined;
  return row !== undefined && row.consumed_at === null && row.expires_at > deps.clock.branchNow();
}
