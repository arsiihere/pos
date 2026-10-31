/// <reference types="node" />
import { DomainError } from '@pos/domain';
import { verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { HubDeps } from '../server.js';
import { sha256hex } from '../lib/hash.js';
import { globalStateClient } from '../lib/global-state.js';
import { clientPrelude, iconSvg, pageHead, tag } from '../lib/page.js';
import type { Semaphore } from '../lib/semaphore.js';
import { currentDirectory } from './guards.js';
import { checkPin } from './pin.js';
import { createSession } from './session-store.js';
import { signInClient } from './signin-client.js';

// 00-S03 … 00-S05 (docs/design/handoff/00/00-design.md §1): first-admin sign-in from the setup link.
function bootstrapPage(): string {
  return `${pageHead({ title: 'bootstrap.title', theme: 'light' })}
<body class="pos-root">
<div class="pos-page pos-page--fit" id="bootstrap_main">
<main class="pos-content pos-signin">
  <section class="pos-signin__who">
    <div class="pos-signin__head">
      ${tag('p', 'caption', 'app.brand_admin')}
      ${tag('h1', 'title', 'bootstrap.title')}
      ${tag('p', 'body-lg', 'bootstrap.sub', 'id="bootstrap_sub"')}
    </div>
    <div id="roster" class="pos-staff"></div>
  </section>
  <form id="login" class="pos-card pos-signin__card" novalidate></form>
</main>
</div>
<section id="bootstrap_done" class="pos-page" hidden></section>
<section id="bootstrap_expired" class="pos-page" hidden>
  <main class="pos-screen pos-screen--danger">
    <div class="pos-screen__icon">${iconSvg('clock')}</div>
    ${tag('h1', 'pos-screen__title', 'bootstrap.expired_title')}
    ${tag('p', 'pos-screen__body', 'bootstrap.expired_body')}
  </main>
</section>
<script>
${clientPrelude()}
${globalStateClient()}
${signInClient()}
// M42: the token is read once from the fragment and removed from the address bar.
const token = new URLSearchParams(location.hash.replace(/^#/, '')).get('t');
history.replaceState(null, '', location.pathname);
const main = document.getElementById('bootstrap_main');
const form = document.getElementById('login');
form.addEventListener('submit', (event) => event.preventDefault());
function showExpired() {
  main.hidden = true;
  document.getElementById('bootstrap_expired').hidden = false;
}
// 00-S05: same tab on purpose, the admin session lives in this tab's sessionStorage (M79).
function showDone(data) {
  const next = node('a', 'pos-btn pos-btn--primary pos-btn--lg pos-btn--block');
  next.href = '/admin/approve';
  next.appendChild(icon('screen'));
  next.appendChild(node('span', '', t('bootstrap.approve')));
  const row = node('div', 'pos-row pos-row--center pos-signin__next');
  row.appendChild(next);
  const note = node('p', 'caption', t('bootstrap.idle_note_2'));
  const done = document.getElementById('bootstrap_done');
  done.replaceChildren(stateScreen('ok', 'check', t('bootstrap.signed_in', { name: data.display_name }), t('bootstrap.idle_note'), [note, row]));
  main.hidden = true;
  done.hidden = false;
}
if (!token) {
  showExpired();
} else {
  adminSignIn({
    roster: document.getElementById('roster'),
    card: form,
    sub: document.getElementById('bootstrap_sub'),
    load: () => call('/admin/login-roster', { headers: { 'X-Admin-Bootstrap': token } }),
    login: (staffId, pin) =>
      call('/admin/auth/bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bootstrap_token: token, staff_id: staffId, pin }),
      }),
    onDone: (data) => {
      sessionStorage.setItem('admin_session_token', data.admin_session_token);
      sessionStorage.setItem('admin_staff_id', data.staff_id);
      sessionStorage.setItem('admin_bootstrap', '1');
      sessionStorage.setItem('admin_name', data.display_name);
      sessionStorage.setItem('admin_permissions', JSON.stringify(data.permissions || {}));
      showDone(data);
    },
    onExpired: showExpired,
    global: (error) => globalScreen(error),
  });
}
</script>
</body>
</html>`;
}

export function registerAdminBootstrapRoutes(app: FastifyInstance, deps: HubDeps, adminSemaphore: Semaphore): void {
  app.get('/admin/bootstrap', { config: { group: 'admin-bootstrap' } }, async (_request, reply: FastifyReply) => {
    return reply.type('text/html; charset=utf-8').send(bootstrapPage());
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
          permissions: directory.adminPermissions(body.staff_id),
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
        permissions: outcome.permissions,
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
