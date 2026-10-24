import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { encodeCrockford128 } from '../auth/pair-page.js';
import { stationExists } from '../auth/station-validator.js';
import { sha256hex } from '../lib/hash.js';
import { clientPrelude, esc, pageHead, scriptJson } from '../lib/page.js';
import { EN } from '../lib/strings.js';
import type { HubDeps } from '../server.js';
import { defineCommand } from './registry.js';
import { commandRegistry } from './route.js';

const Payload = z.object({
  request_id: z.string().min(1).optional(),
  display_code: z.string().min(1),
  device_type: z.enum(['cashier_kiosk', 'kds']),
  station_id: z.string().min(1).optional(),
});

function approvePage(ctx: { tenant_id: string; branch_id: string }): string {
  return `${pageHead({ title: 'approve.title', theme: 'light' })}
<body class="pos-root">
<main class="pos-page pos-stack">
<header class="pos-stack">
  <h1 class="title">${esc(EN['approve.title'])}</h1>
  <p class="body-lg">${esc(EN['approve.intro'])}</p>
</header>
<div id="screen" class="pos-stack"></div>
</main>
<script>
${encodeCrockford128.toString()}
${clientPrelude()}
const ctx = ${scriptJson(ctx)};
let requestId = new URLSearchParams(location.search).get('r');
const screen = document.getElementById('screen');
function openDeviceDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pos-device', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('device')) request.result.createObjectStore('device');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function readKey(db, key) {
  return new Promise((resolve) => {
    const read = db.transaction('device').objectStore('device').get(key);
    read.onsuccess = () => resolve(read.result);
    read.onerror = () => resolve(undefined);
  });
}
function control(tag, name, className) {
  const el = node(tag, className);
  el.name = name;
  el.id = 'f_' + name;
  return el;
}
function field(label, input, help) {
  const wrap = node('div', 'pos-field');
  const caption = node('label', 'pos-field__label', label);
  caption.setAttribute('for', input.id);
  wrap.appendChild(caption);
  wrap.appendChild(input);
  if (help) wrap.appendChild(node('p', 'pos-field__help', help));
  return wrap;
}
function stateScreen(kind, iconName, title, body) {
  const box = node('section', 'pos-screen pos-screen--' + kind);
  const mark = node('div', 'pos-screen__icon');
  mark.appendChild(icon(iconName));
  box.appendChild(mark);
  box.appendChild(node('h2', 'pos-screen__title', title));
  if (body) box.appendChild(node('p', 'pos-screen__body', body));
  return box;
}
function submitButton(label) {
  const button = node('button', 'pos-btn pos-btn--primary pos-btn--lg pos-btn--block', label);
  button.type = 'submit';
  return button;
}
// §8.4: PIN_INVALID shows attempts_remaining when ≤ 2; lockouts show the time left (authDetail).
function login(auth) {
  return new Promise((resolve) => {
    fetch('/admin/login-roster', { headers: auth }).then(async (res) => {
      const body = await res.json();
      const form = node('form', 'pos-card pos-stack');
      form.appendChild(node('h2', 'heading', t('approve.signin_title')));
      const staff = control('select', 'staff_id', 'pos-select');
      for (const member of (body.data && body.data.staff) || []) staff.add(new Option(member.display_name, member.staff_id));
      form.appendChild(field(t('approve.staff'), staff));
      const pin = control('input', 'pin', 'pos-input pos-input--mono');
      pin.type = 'password';
      pin.inputMode = 'numeric';
      pin.autocomplete = 'off';
      const pinBox = node('div', 'pos-pin');
      pinBox.appendChild(field(t('approve.pin'), pin));
      form.appendChild(pinBox);
      const errorSlot = node('div');
      form.appendChild(errorSlot);
      const button = submitButton(t('approve.signin'));
      form.appendChild(button);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        pinBox.classList.remove('is-error');
        setBusy(button, true);
        fetch('/admin/auth', {
          method: 'POST',
          headers: Object.assign({ 'content-type': 'application/json' }, auth),
          body: JSON.stringify({ staff_id: staff.value, pin: pin.value }),
        }).then(
          async (res) => {
            setBusy(button, false);
            const body = await res.json();
            if (res.status !== 200) {
              if (body.error && body.error.code === 'PIN_INVALID') pinBox.classList.add('is-error');
              pin.value = '';
              errorSlot.replaceChildren(banner('danger', errorText(body.error), authDetail(body.error), 'auth_error'));
              return;
            }
            sessionStorage.setItem('admin_session_token', body.data.admin_session_token);
            sessionStorage.setItem('admin_staff_id', body.data.staff_id);
            resolve();
          },
          () => {
            setBusy(button, false);
            errorSlot.replaceChildren(banner('danger', errorText({ code: 'SERVICE_UNAVAILABLE' }), '', 'auth_error'));
          },
        );
      });
      screen.replaceChildren(form);
    });
  });
}
function approveForm(auth, deviceId) {
  const form = node('form', 'pos-card pos-stack');
  const code = control('input', 'display_code', 'pos-input pos-input--mono');
  code.autocomplete = 'off';
  code.setAttribute('autocapitalize', 'characters');
  code.setAttribute('maxlength', '7');
  form.appendChild(field(t('approve.code'), code, t('approve.code_help')));
  const type = control('select', 'device_type', 'pos-select');
  type.add(new Option(t('approve.type_cashier_kiosk'), 'cashier_kiosk'));
  type.add(new Option(t('approve.type_kds'), 'kds'));
  form.appendChild(field(t('approve.type'), type));
  const station = control('input', 'station_id', 'pos-input');
  form.appendChild(field(t('approve.station'), station, t('approve.station_help')));
  const status = node('div');
  form.appendChild(status);
  const button = submitButton(t('approve.submit'));
  form.appendChild(button);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    status.replaceChildren();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    setBusy(button, true);
    fetch('/admin/commands/approve-pairing-request', {
      method: 'POST',
      headers: Object.assign(
        { 'content-type': 'application/json', 'x-admin-session': sessionStorage.getItem('admin_session_token') },
        auth,
      ),
      body: JSON.stringify({
        command_id: encodeCrockford128(bytes),
        tenant_id: ctx.tenant_id,
        branch_id: ctx.branch_id,
        command_type: 'ApprovePairingRequest',
        payload: {
          request_id: requestId || undefined,
          display_code: code.value.replace(/[\\s-]/g, '').toUpperCase(),
          device_type: type.value,
          station_id: station.value === '' ? undefined : station.value,
        },
        occurred_at: Date.now(),
        actor_id: sessionStorage.getItem('admin_staff_id'),
        device_id: deviceId,
      }),
    }).then(
      async (res) => {
        setBusy(button, false);
        const body = await res.json();
        if (res.status !== 200) {
          status.replaceChildren(banner('danger', errorText(body.error)));
          return;
        }
        const done = stateScreen('ok', 'check', t('pairing.approved'), t('approve.approved_body'));
        const again = node('button', 'pos-btn pos-btn--lg', t('approve.another'));
        again.type = 'button';
        again.addEventListener('click', () => {
          // A scanned ?r= names one screen; the next approval goes by code only.
          requestId = null;
          approveForm(auth, deviceId);
        });
        done.appendChild(again);
        screen.replaceChildren(done);
      },
      () => {
        setBusy(button, false);
        status.replaceChildren(banner('danger', errorText({ code: 'SERVICE_UNAVAILABLE' })));
      },
    );
  });
  screen.replaceChildren(form);
}
openDeviceDb().then(async (db) => {
  const deviceToken = await readKey(db, 'token');
  const deviceId = await readKey(db, 'device_id');
  const bootstrap = sessionStorage.getItem('admin_bootstrap') === '1';
  if (!bootstrap && !deviceToken) {
    screen.replaceChildren(stateScreen('info', 'lock', t('approve.needs_admin_title'), t('pairing.approve_needs_admin_device')));
    return;
  }
  const auth = bootstrap ? {} : { authorization: 'Bearer ' + deviceToken };
  if (!sessionStorage.getItem('admin_session_token')) await login(auth);
  approveForm(auth, bootstrap ? 'hub-admin' : deviceId);
});
</script>
</body>
</html>`;
}

export function registerApprovePairingRequest(app: FastifyInstance, deps: HubDeps): void {
  app.get('/admin/approve', { config: { group: 'admin-bootstrap' } }, async (_request, reply) => {
    const provisioned = deps.config.provisioned;
    if (provisioned === undefined) throw new DomainError('HUB_NOT_PROVISIONED');
    return reply
      .type('text/html; charset=utf-8')
      .send(approvePage({ tenant_id: provisioned.tenant_id, branch_id: provisioned.branch_id }));
  });
  commandRegistry(app).register(
    defineCommand({
      commandType: 'ApprovePairingRequest',
      payloadSchema: Payload,
      sessionKind: 'admin',
      permission: 'manage-devices',
      handle(ctx, payload) {
        const kds = payload.device_type === 'kds';
        const stationId = payload.station_id ?? null;
        if (kds !== (stationId !== null)) {
          throw new DomainError('VALIDATION_FAILED', {
            issues: [{ path: 'station_id', message: 'required iff kds' }],
          });
        }
        const now = ctx.clock.branchNow();
        const row =
          payload.request_id === undefined
            ? pendingByCode(ctx.tx.db, ctx.branch.branchId, payload.display_code, now)
            : byId(ctx.tx.db, ctx.branch.branchId, payload.request_id);
        if (row === undefined || row.expires_at <= now || row.approved_at !== null || row.display_code !== payload.display_code) {
          throw new DomainError('PAIRING_REQUEST_NOT_FOUND');
        }
        if (kds && stationId !== null && !stationExists(ctx.tx, stationId)) {
          throw new DomainError('STATION_NOT_FOUND', { station_id: stationId });
        }
        const actor = ctx.actor.staffId;
        if (actor === null) throw new DomainError('PERMISSION_DENIED', { permission: 'manage-devices' });
        const deviceId = ctx.ids.next();
        const deviceToken = ctx.secrets.token256();
        ctx.tx.db
          .prepare(
            `INSERT INTO devices (
              device_id, branch_id, token_hash, device_name, device_type,
              station_id, owner_staff_id, paired_at, paired_by
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          )
          .run(deviceId, ctx.branch.branchId, sha256hex(deviceToken), row.device_name, payload.device_type, stationId, now, actor);
        ctx.tx.db
          .prepare(
            `UPDATE pair_requests
             SET approved_at = ?, approved_by = ?, device_id = ?, delivery_token = ?
             WHERE request_id = ?`,
          )
          .run(now, actor, deviceId, deviceToken, row.request_id);
        return {
          events: [
            {
              stream_type: 'hub',
              stream_id: deviceId,
              event_type: 'DevicePaired',
              schema_version: 1,
              payload: {
                device_id: deviceId,
                device_name: row.device_name,
                device_type: payload.device_type,
                station_id: stationId,
                owner_staff_id: null,
                pairing_token_id: null,
                pairing_request_id: row.request_id,
              },
              occurred_at: now,
              actor_id: actor,
              device_id: deviceId,
            },
          ],
          result: { device_id: deviceId, device_type: payload.device_type, station_id: stationId },
        };
      },
    }),
  );
}

type RequestRow = {
  request_id: string;
  display_code: string;
  device_name: string;
  expires_at: number;
  approved_at: number | null;
};

const COLUMNS = 'request_id, display_code, device_name, expires_at, approved_at';

function byId(db: Database.Database, branchId: string, requestId: string): RequestRow | undefined {
  return db
    .prepare(`SELECT ${COLUMNS} FROM pair_requests WHERE request_id = ? AND branch_id = ?`)
    .get(requestId, branchId) as RequestRow | undefined;
}

// M79: without request_id, exactly one pending request may carry the code.
function pendingByCode(db: Database.Database, branchId: string, displayCode: string, now: number): RequestRow | undefined {
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM pair_requests
       WHERE branch_id = ? AND approved_at IS NULL AND expires_at > ? AND display_code = ?`,
    )
    .all(branchId, now, displayCode) as RequestRow[];
  return rows.length === 1 ? rows[0] : undefined;
}
