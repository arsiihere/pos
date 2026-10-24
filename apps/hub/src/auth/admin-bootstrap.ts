/// <reference types="node" />
import { DomainError } from '@pos/domain';
import { verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { HubDeps } from '../server.js';
import { sha256hex } from '../lib/hash.js';
import { clientPrelude, esc, fieldHtml, iconSvg, pageHead } from '../lib/page.js';
import { EN } from '../lib/strings.js';
import type { Semaphore } from '../lib/semaphore.js';
import { currentDirectory } from './guards.js';
import { checkPin } from './pin.js';
import { createSession } from './session-store.js';

function bootstrapPage(): string {
  return `${pageHead({ title: 'bootstrap.title', theme: 'light' })}
<body class="pos-root">
<main class="pos-page pos-stack">
<form id="login" class="pos-stack" novalidate>
  <header class="pos-stack">
    <h1 class="title">${esc(EN['bootstrap.title'])}</h1>
    <p class="body-lg">${esc(EN['bootstrap.intro'])}</p>
  </header>
  <fieldset class="pos-field">
    <legend class="pos-field__label">${esc(EN['bootstrap.staff'])}</legend>
    <div id="roster" class="pos-staff" aria-busy="true"></div>
  </fieldset>
  <div id="pin_box" class="pos-pin">
${fieldHtml({ id: 'pin', label: 'bootstrap.pin', mono: true, attrs: 'type="password" inputmode="numeric" autocomplete="off" maxlength="6"' })}
  </div>
  <div id="login_status" aria-live="polite"></div>
  <button id="login_submit" class="pos-btn pos-btn--primary pos-btn--lg pos-btn--block" type="submit">${esc(EN['bootstrap.submit'])}</button>
</form>
<section id="bootstrap_done" class="pos-screen pos-screen--ok" hidden>
  <div class="pos-screen__icon">${iconSvg('check')}</div>
</section>
<section id="bootstrap_expired" class="pos-screen pos-screen--warn" hidden>
  <div class="pos-screen__icon">${iconSvg('clock')}</div>
  <h1 class="pos-screen__title">${esc(EN['bootstrap.expired_title'])}</h1>
  <p class="pos-screen__body">${esc(EN['bootstrap.expired_body'])}</p>
</section>
</main>
<script>
${clientPrelude()}
const token = new URLSearchParams(location.hash.replace(/^#/, '')).get('t');
history.replaceState(null, '', location.pathname);
const form = document.getElementById('login');
const roster = document.getElementById('roster');
const status = document.getElementById('login_status');
const submit = document.getElementById('login_submit');
const pin = document.getElementById('pin');
const pinBox = document.getElementById('pin_box');
const tiles = [];
let selected = null;
function showExpired() {
  form.hidden = true;
  document.getElementById('bootstrap_expired').hidden = false;
}
function showDone(name) {
  const done = document.getElementById('bootstrap_done');
  done.appendChild(node('h1', 'pos-screen__title', t('bootstrap.signed_in', { name: name })));
  done.appendChild(node('p', 'pos-screen__body', t('bootstrap.next_body')));
  // Same tab on purpose: the admin session lives in this tab's sessionStorage (M79).
  const next = node('a', 'pos-btn pos-btn--primary pos-btn--lg', t('bootstrap.approve'));
  next.href = '/admin/approve';
  done.appendChild(next);
  form.hidden = true;
  done.hidden = false;
}
function select(member, tile) {
  selected = member;
  for (const other of tiles) other.setAttribute('aria-pressed', other === tile ? 'true' : 'false');
  status.replaceChildren();
  pin.focus();
}
function addTile(member, now) {
  const tile = node('button', 'pos-staff__tile', member.display_name);
  tile.type = 'button';
  tile.setAttribute('aria-pressed', 'false');
  if (member.locked_until !== null && member.locked_until > now) {
    tile.disabled = true;
    tile.classList.add('is-locked');
    const note = node('small');
    note.appendChild(icon('lock'));
    note.appendChild(node('span', '', t('auth.locked_for', { min: Math.ceil((member.locked_until - now) / 60000) })));
    tile.appendChild(note);
  }
  tile.addEventListener('click', () => select(member, tile));
  tiles.push(tile);
  roster.appendChild(tile);
}
if (!token) {
  showExpired();
} else {
  fetch('/admin/login-roster', { headers: { 'X-Admin-Bootstrap': token } }).then(
    async (res) => {
      const body = await res.json();
      roster.removeAttribute('aria-busy');
      if (res.status !== 200) {
        if (body.error && body.error.code === 'PAIRING_TOKEN_INVALID') return showExpired();
        status.replaceChildren(banner('danger', errorText(body.error)));
        return;
      }
      const now = Date.now();
      for (const member of body.data.staff) addTile(member, now);
      if (tiles.length === 0) status.replaceChildren(banner('info', t('bootstrap.no_admins')));
    },
    () => status.replaceChildren(banner('danger', errorText({ code: 'SERVICE_UNAVAILABLE' }))),
  );
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  pinBox.classList.remove('is-error');
  if (selected === null) {
    status.replaceChildren(banner('danger', t('bootstrap.pick_first')));
    return;
  }
  setBusy(submit, true);
  let res;
  let body;
  try {
    res = await fetch('/admin/auth/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bootstrap_token: token, staff_id: selected.staff_id, pin: pin.value }),
    });
    body = await res.json();
  } catch {
    res = undefined;
  }
  setBusy(submit, false);
  if (res !== undefined && res.status === 200) {
    sessionStorage.setItem('admin_session_token', body.data.admin_session_token);
    sessionStorage.setItem('admin_staff_id', body.data.staff_id);
    sessionStorage.setItem('admin_bootstrap', '1');
    showDone(body.data.display_name);
    return;
  }
  const error = (body && body.error) || { code: 'SERVICE_UNAVAILABLE', details: {} };
  if (error.code === 'PAIRING_TOKEN_INVALID') return showExpired();
  pin.value = '';
  if (error.code === 'PIN_INVALID') pinBox.classList.add('is-error');
  status.replaceChildren(banner('danger', errorText(error), authDetail(error)));
});
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
