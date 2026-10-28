import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { encodeCrockford128 } from '../auth/pair-page.js';
import { stationExists } from '../auth/station-validator.js';
import { sha256hex } from '../lib/hash.js';
import { signInClient } from '../auth/signin-client.js';
import { globalStateClient } from '../lib/global-state.js';
import { clientPrelude, iconSvg, pageHead, scriptJson, tag } from '../lib/page.js';
import type { HubDeps } from '../server.js';
import { defineCommand } from './registry.js';
import { commandRegistry } from './route.js';

const Payload = z.object({
  request_id: z.string().min(1).optional(),
  display_code: z.string().min(1),
  device_type: z.enum(['cashier_kiosk', 'kds']),
  station_id: z.string().min(1).optional(),
});

// 00-S06 … 00-S09 (docs/design/handoff/00/00-design.md §1). Loads without credentials (M79); the script signs in an
// admin in this tab, then approves by QR (?r=) or by the code on the screen.
function approvePage(ctx: { tenant_id: string; branch_id: string }): string {
  return `${pageHead({ title: 'approve.title', theme: 'light' })}
<body class="pos-root">
<div class="pos-page">
<header class="pos-appbar">
  <a class="pos-btn" href="/admin" id="approve_back">${iconSvg('back', 'pos-icon--flip')}${tag('span', '', 'admin.title')}</a>
  ${tag('h1', 'pos-appbar__title', 'approve.title')}
  <div class="pos-appbar__end" id="approve_end"></div>
</header>
<div id="approve_banner"></div>
<main class="pos-content pos-content--narrow"><div id="screen"></div></main>
</div>
<script>
${encodeCrockford128.toString()}
${clientPrelude()}
${globalStateClient()}
${signInClient()}
const ctx = ${scriptJson(ctx)};
const fromQr = new URLSearchParams(location.search).get('r');
let requestId = fromQr;
const screen = document.getElementById('screen');
const end = document.getElementById('approve_end');
const topBanner = document.getElementById('approve_banner');
// Crockford base32 without I L O U (M44 display codes).
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{6}$/;
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
function deleteKey(db, key) {
  return new Promise((resolve) => {
    const del = db.transaction('device', 'readwrite').objectStore('device').delete(key);
    del.onsuccess = () => resolve();
    del.onerror = () => resolve();
  });
}
// 00-F02: wipe the device token, then pair again (§8.4).
async function pairAgain() {
  const db = await openDeviceDb();
  for (const key of ['token', 'device_id', 'device_type']) await deleteKey(db, key);
  location.href = '/pair';
}
function permissions() {
  try { return JSON.parse(sessionStorage.getItem('admin_permissions') || '{}'); } catch { return {}; }
}
function field(labelKey, control, helpKey) {
  const wrap = node('div', 'pos-field');
  wrap.appendChild(node('span', 'pos-field__label', t(labelKey)));
  wrap.appendChild(control);
  if (helpKey) wrap.appendChild(node('p', 'pos-field__help', t(helpKey)));
  const error = node('p', 'pos-field__error');
  error.appendChild(icon('alert'));
  const words = node('span', '', '');
  error.appendChild(words);
  wrap.appendChild(error);
  wrap.fail = (text) => {
    words.textContent = text;
    wrap.classList.toggle('pos-field--error', Boolean(text));
  };
  return wrap;
}
function row(parts) {
  const box = node('div', 'pos-row');
  box.style.justifyContent = 'center';
  for (const part of parts) box.appendChild(part);
  return box;
}
// 00-S06: no device token and no bootstrap session.
function notHere() {
  const hint = node('p', 'caption', t('approve.first_admin_hint'));
  document.body.replaceChildren(stateScreen('info', 'screen', t('approve.needs_admin_title'), t('pairing.approve_needs_admin_device'), [hint]));
}
// 00-S07: admin sign-in in this tab.
function signIn(auth) {
  return new Promise((resolve) => {
    end.replaceChildren(chip('', 'lock', t('approve.signin_chip')));
    const left = node('section', 'pos-stack');
    left.appendChild(node('h2', 'heading', t('approve.who')));
    left.appendChild(node('p', 'body', t('approve.who_sub')));
    const roster = node('div', 'pos-staff');
    left.appendChild(roster);
    const card = node('form', 'pos-card pos-stack');
    card.addEventListener('submit', (event) => event.preventDefault());
    const split = node('div', 'pos-split');
    split.appendChild(left);
    split.appendChild(card);
    screen.replaceChildren(split);
    adminSignIn({
      roster,
      card,
      load: () => call('/admin/login-roster', { headers: auth }),
      login: (staffId, pin) =>
        call('/admin/auth', {
          method: 'POST',
          headers: Object.assign({ 'content-type': 'application/json' }, auth),
          body: JSON.stringify({ staff_id: staffId, pin }),
        }),
      onDone: (data) => {
        sessionStorage.setItem('admin_session_token', data.admin_session_token);
        sessionStorage.setItem('admin_staff_id', data.staff_id);
        sessionStorage.setItem('admin_name', data.display_name);
        sessionStorage.setItem('admin_permissions', JSON.stringify(data.permissions || {}));
        resolve();
      },
      onExpired: notHere,
      global: (error) => globalScreen(error, {}, { pairAgain }),
    });
  });
}
function adminHeaders(auth) {
  return Object.assign({ 'content-type': 'application/json', 'x-admin-session': sessionStorage.getItem('admin_session_token') }, auth);
}
// 00-S08: the form. "values" refills it after Try again.
async function approveForm(auth, deviceId, values) {
  const kept = values || {};
  end.replaceChildren(node('span', 'body', sessionStorage.getItem('admin_name') || ''));
  topBanner.replaceChildren();
  let stations = [];
  try {
    const res = await call('/admin/queries/stations', { headers: adminHeaders(auth) });
    if (res.status === 200) stations = res.body.data.stations;
    else if (res.body.error && res.body.error.code === 'ADMIN_SESSION_REQUIRED') return restart(auth, deviceId);
  } catch {
    topBanner.replaceChildren(renderGlobalState({ id: 'F01', mode: 'banner' }));
  }
  let kind = kept.kind || null;
  let stationId = kept.stationId || null;
  const form = node('form', 'pos-card pos-stack');
  if (requestId) form.appendChild(row([chip('ok', 'check', t('approve.from_qr'))]));
  const code = node('input', 'pos-input pos-input--code');
  code.name = 'display_code';
  code.autocomplete = 'off';
  code.setAttribute('autocapitalize', 'characters');
  code.setAttribute('maxlength', '6');
  code.value = kept.code || '';
  const codeField = field('approve.code_label', code, 'approve.code_help');
  form.appendChild(codeField);
  const seg = node('div', 'pos-seg pos-seg--block');
  seg.setAttribute('role', 'group');
  seg.name = 'device_type';
  const kindField = field('approve.kind_label', seg);
  form.appendChild(kindField);
  const tiles = node('div', 'pos-tiles');
  tiles.setAttribute('role', 'group');
  tiles.name = 'station_id';
  const stationField = field('approve.station_label', tiles);
  form.appendChild(stationField);
  const status = node('div');
  status.name = 'approve_status';
  form.appendChild(status);
  const button = node('button', 'pos-btn pos-btn--primary pos-btn--lg pos-btn--block');
  button.type = 'submit';
  button.appendChild(icon('check'));
  const buttonText = node('span', '', t('approve.submit'));
  button.appendChild(buttonText);
  form.appendChild(button);
  const aside = node('aside', 'pos-card pos-stack');
  const split = node('div', 'pos-split');
  split.appendChild(form);
  split.appendChild(aside);
  screen.replaceChildren(split);
  const station = () => stations.find((item) => item.station_id === stationId);
  const preview = () => {
    aside.hidden = kind === null;
    if (kind === null) return aside.replaceChildren();
    const explain = node('div', 'pos-explain');
    explain.appendChild(icon(kind === 'kds' ? 'flame' : 'screen'));
    explain.appendChild(node('span', 'heading', kind === 'kds' ? t('approve.preview_kds_name', { station: station() ? station().name : '…' }) : t('approve.kind_cashier')));
    aside.replaceChildren(
      node('p', 'label', t('approve.preview_title')),
      explain,
      node('p', 'body', t(kind === 'kds' ? 'approve.preview_kds' : 'approve.preview_cashier')),
      node('p', 'caption', t('approve.audit_note')),
    );
  };
  const opts = [];
  for (const [value, iconName, key] of [['cashier_kiosk', 'screen', 'approve.kind_cashier'], ['kds', 'flame', 'approve.kind_kitchen']]) {
    const opt = node('button', 'pos-seg__opt');
    opt.type = 'button';
    opt.value = value;
    opt.appendChild(icon(iconName));
    opt.appendChild(document.createTextNode(t(key)));
    opt.setAttribute('aria-pressed', String(kind === value));
    opt.addEventListener('click', () => {
      kind = value;
      for (const other of opts) other.setAttribute('aria-pressed', String(other === opt));
      kindField.fail('');
      stationField.hidden = kind !== 'kds';
      preview();
    });
    opts.push(opt);
    seg.appendChild(opt);
  }
  const stationTiles = [];
  for (const item of stations) {
    const tile = node('button', 'pos-tile', item.name);
    tile.type = 'button';
    tile.value = item.station_id;
    const sub = item.location_label || item.category_names.join(', ');
    if (sub) tile.appendChild(node('small', '', sub));
    tile.setAttribute('aria-pressed', String(stationId === item.station_id));
    tile.addEventListener('click', () => {
      stationId = item.station_id;
      for (const other of stationTiles) other.setAttribute('aria-pressed', String(other === tile));
      stationField.fail('');
      preview();
    });
    stationTiles.push(tile);
    tiles.appendChild(tile);
  }
  if (stations.length === 0) tiles.appendChild(node('p', 'body', t('approve.no_stations')));
  stationField.hidden = kind !== 'kds';
  preview();
  const readOnly = () => {
    for (const el of [code, button, ...opts, ...stationTiles]) el.disabled = true;
    status.replaceChildren(banner('info', t('errors.PERMISSION_DENIED_devices'), t('errors.PERMISSION_DENIED_devices_body')));
  };
  if (permissions()['manage-devices'] === false) readOnly();
  let busyRetried = false;
  const send = async () => {
    const value = code.value.replace(/[\\s-]/g, '').toUpperCase();
    codeField.fail(CODE_RE.test(value) ? '' : t('approve.err_code_format'));
    kindField.fail(kind === null ? t('approve.err_kind') : '');
    stationField.fail(kind === 'kds' && stationId === null ? t('approve.err_station') : '');
    if (!CODE_RE.test(value) || kind === null || (kind === 'kds' && stationId === null)) return;
    status.replaceChildren();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    setBusy(button, true);
    buttonText.textContent = t('approve.busy');
    let res;
    try {
      res = await call('/admin/commands/approve-pairing-request', {
        method: 'POST',
        headers: adminHeaders(auth),
        body: JSON.stringify({
          command_id: encodeCrockford128(bytes),
          tenant_id: ctx.tenant_id,
          branch_id: ctx.branch_id,
          command_type: 'ApprovePairingRequest',
          payload: {
            request_id: requestId || undefined,
            display_code: value,
            device_type: kind,
            station_id: kind === 'kds' ? stationId : undefined,
          },
          occurred_at: Date.now(),
          actor_id: sessionStorage.getItem('admin_staff_id'),
          device_id: deviceId,
        }),
      });
    } catch {
      res = undefined;
    }
    setBusy(button, false);
    buttonText.textContent = t('approve.submit');
    if (res === undefined) return topBanner.replaceChildren(renderGlobalState({ id: 'F01', mode: 'banner' }));
    topBanner.replaceChildren();
    if (res.status === 200) return done(auth, deviceId, kind === 'kds' ? station() : null);
    const error = res.body.error || { code: 'INTERNAL_ERROR' };
    if (error.code === 'SERVICE_UNAVAILABLE' && !busyRetried) {
      busyRetried = true;
      setTimeout(send, 1000);
      return;
    }
    busyRetried = false;
    if (error.code === 'SERVICE_UNAVAILABLE') return status.replaceChildren(renderGlobalState({ id: 'F05', mode: 'banner' }, { retry: send }));
    if (error.code === 'PAIRING_REQUEST_NOT_FOUND') return codeField.fail(errorText(error));
    if (error.code === 'VALIDATION_FAILED') return codeField.fail(t('approve.err_code_format'));
    if (error.code === 'STATION_NOT_FOUND') return status.replaceChildren(banner('danger', errorText(error), errorBody(error)));
    if (error.code === 'PERMISSION_DENIED') return readOnly();
    if (error.code === 'ADMIN_SESSION_REQUIRED') return restart(auth, deviceId);
    if (globalScreen(error, {}, { pairAgain })) return;
    failed(auth, deviceId, error, { code: code.value, kind, stationId });
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    send();
  });
}
// 00-S09
function done(auth, deviceId, approved) {
  const again = node('button', 'pos-btn pos-btn--primary pos-btn--lg', t('approve.another'));
  again.type = 'button';
  again.addEventListener('click', () => {
    // A scanned ?r= names one screen; the next approval goes by code only.
    requestId = null;
    approveForm(auth, deviceId);
  });
  const home = node('a', 'pos-btn pos-btn--lg', t('admin.title'));
  home.href = '/admin';
  const body = approved ? t('approve.done_body_kds', { station: approved.name }) : t('approve.done_body_cashier');
  screen.replaceChildren(stateScreen('ok', 'check', t('approve.done_title'), body, [row([again, home])]));
}
function failed(auth, deviceId, error, values) {
  const retry = node('button', 'pos-btn pos-btn--primary pos-btn--lg', t('approve.retry'));
  retry.type = 'button';
  retry.addEventListener('click', () => approveForm(auth, deviceId, values));
  screen.replaceChildren(stateScreen('danger', 'alert', t('approve.failed'), errorText(error), [row([retry])]));
}
async function restart(auth, deviceId) {
  sessionStorage.removeItem('admin_session_token');
  await signIn(auth);
  approveForm(auth, deviceId);
}
openDeviceDb().then(async (db) => {
  const deviceToken = await readKey(db, 'token');
  const deviceId = await readKey(db, 'device_id');
  const bootstrap = sessionStorage.getItem('admin_bootstrap') === '1';
  if (!bootstrap && !deviceToken) return notHere();
  const auth = bootstrap ? {} : { authorization: 'Bearer ' + deviceToken };
  if (!sessionStorage.getItem('admin_session_token')) await signIn(auth);
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
