import { DomainError, SCREEN_KEYS, screensOffered, type DeviceType, type ScreenKey } from '@pos/domain';
import type { EventDraft } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { encodeCrockford128 } from '../auth/pair-page.js';
import { closeDeviceWaitingWhenIdle } from '../auth/pair-requests.js';
import { stationExists } from '../auth/station-validator.js';
import type { SessionDirectory } from '../auth/staff-directory.js';
import { sha256hex } from '../lib/hash.js';
import { signInClient } from '../auth/signin-client.js';
import { globalStateClient } from '../lib/global-state.js';
import { clientPrelude, iconSvg, pageHead, scriptJson, tag } from '../lib/page.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import type { HubDeps } from '../server.js';
import { defineCommand } from './registry.js';
import { commandRegistry } from './route.js';

// 05a §6.3 (00 §6.32 changed): every device type pairs by request; a staff device gets its first profile here.
// `kds` ⇒ `station_id` and nothing of the profile; else `access` + `screens`; `listed` ⇒ `staff_ids` 1–20 unique;
// `everyone` ⇒ no `staff_ids` (v1.0.2 G-e is SetDeviceProfile's merge only, so nothing is derived here).
const Payload = z
  .object({
    request_id: z.string().min(1).optional(),
    display_code: z.string().min(1),
    device_type: z.enum(['tablet', 'cashier_kiosk', 'kds', 'phone']),
    device_name: z.string().min(1).max(40),
    station_id: z.string().min(1).optional(),
    access: z.enum(['everyone', 'listed']).optional(),
    staff_ids: z.array(z.string().min(1)).min(1).max(20).optional(),
    screens: z.array(z.enum(SCREEN_KEYS)).min(1).max(6).optional(),
    point_id: z.string().min(1).optional(),
  })
  .superRefine((p, issue) => {
    const fail = (path: string, message: string) => issue.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (p.device_type === 'kds') {
      if (p.station_id === undefined) fail('station_id', 'required for kds');
      for (const key of ['access', 'staff_ids', 'screens', 'point_id'] as const) {
        if (p[key] !== undefined) fail(key, 'not allowed for kds');
      }
      return;
    }
    if (p.station_id !== undefined) fail('station_id', 'kds only');
    if (p.access === undefined) fail('access', 'required for a staff device');
    if (p.screens === undefined) fail('screens', 'required for a staff device');
    else if (new Set(p.screens).size !== p.screens.length) fail('screens', 'must be unique');
    if (p.access === 'listed' && p.staff_ids === undefined) fail('staff_ids', 'required when listed');
    if (p.access === 'everyone' && p.staff_ids !== undefined) fail('staff_ids', 'not allowed when everyone');
    if (p.staff_ids !== undefined && new Set(p.staff_ids).size !== p.staff_ids.length) fail('staff_ids', 'must be unique');
  });

/** A staff-device profile as §6.3 step 3 checks it (also the merged profile of §6.4 step 3). */
export interface StaffProfileInput {
  device_type: DeviceType;
  access: 'everyone' | 'listed';
  staff_ids: readonly string[];
  screens: readonly ScreenKey[];
  point_id: string | null;
}

/**
 * 05a §6.3 step 3, in order: people in the directory → `404 STAFF_NOT_FOUND { staff_id }`; screens offered for the
 * hardware → `400 VALIDATION_FAILED { field: 'screens' }`; `pass` ⇔ `point_id` → `400 { field: 'point_id' }`; the
 * point active (01a config) → `404 POINT_NOT_FOUND`. Memory only: no statement.
 */
export function validateStaffProfile(p: StaffProfileInput, directory: Pick<SessionDirectory, 'get'>): void {
  for (const staff_id of p.staff_ids) {
    if (directory.get(staff_id) === undefined) throw new DomainError('STAFF_NOT_FOUND', { staff_id });
  }
  const offered = screensOffered(p.device_type);
  if (p.screens.some((screen) => !offered.includes(screen))) {
    throw new DomainError('VALIDATION_FAILED', {
      field: 'screens',
      issues: [{ path: 'screens', message: `not offered on ${p.device_type}` }],
    });
  }
  if (p.screens.includes('pass') !== (p.point_id !== null)) {
    throw new DomainError('VALIDATION_FAILED', {
      field: 'point_id',
      issues: [{ path: 'point_id', message: 'pass needs a point_id, and a point_id needs pass' }],
    });
  }
  if (p.point_id !== null) {
    const point = branchConfig()?.points.find((candidate) => candidate.point_id === p.point_id);
    if (point === undefined || point.is_archived) throw new DomainError('POINT_NOT_FOUND', { point_id: p.point_id });
  }
}

// 00-S06 … 00-S09 (docs/design/handoff/00/00-design.md §1). Loads without credentials (M79); the script signs in an
// admin in this tab, then approves by QR (?r=) or by the code on the screen.
function approvePage(ctx: { tenant_id: string; branch_id: string; offered: Record<string, readonly string[]> }): string {
  return `${pageHead({ title: 'approve.title', theme: 'light' })}
<body class="pos-root">
<div class="pos-page pos-page--fit pos-approve">
<header class="pos-appbar">
  <a class="pos-btn pos-approve__back" href="/admin" id="approve_back">${iconSvg('back', 'pos-icon--flip')}${tag('span', '', 'admin.title')}</a>
  ${tag('h1', 'pos-appbar__title', 'approve.title')}
  <div class="pos-appbar__end" id="approve_end"></div>
</header>
<div id="approve_banner" class="pos-approve__banner"></div>
<main class="pos-content pos-approve__main" id="screen"></main>
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
const back = document.getElementById('approve_back');
const topBanner = document.getElementById('approve_banner');
const KIND_KEY = { cashier_kiosk: 'approve.kind_cashier', tablet: 'approve.kind_tablet', phone: 'approve.kind_phone', kds: 'approve.kind_kitchen' };
const SCREEN_KEY = { dine_in: 'screen.dine_in', takeaway: 'screen.takeaway', parking: 'screen.parking', cashier: 'screen.cashier', pass: 'screen.pass', manager: 'screen.manager' };
const KIND_ICON = { cashier_kiosk: 'screen', tablet: 'tablet', phone: 'phone', kds: 'flame' };
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
  const box = node('div', 'pos-row pos-row--center');
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
    // Frame ApproveSignIn: no way back to the hub admin before someone signs in.
    back.hidden = true;
    end.replaceChildren(chip('', 'lock', t('approve.signin_chip')));
    const left = node('section', 'pos-signin__who');
    const head = node('div', 'pos-signin__head');
    head.appendChild(node('h2', 'title', t('approve.who')));
    const sub = node('p', 'body', t('approve.who_sub'));
    head.appendChild(sub);
    left.appendChild(head);
    const roster = node('div', 'pos-staff');
    left.appendChild(roster);
    const card = node('form', 'pos-card pos-signin__card');
    card.addEventListener('submit', (event) => event.preventDefault());
    const split = node('div', 'pos-signin pos-signin--approve');
    split.appendChild(left);
    split.appendChild(card);
    screen.replaceChildren(split);
    adminSignIn({
      roster,
      card,
      sub,
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
  back.hidden = false;
  const who = node('span', 'pos-row pos-approve__who');
  const name = sessionStorage.getItem('admin_name') || '';
  const avatar = node('span', 'pos-avatar', name.slice(0, 1).toUpperCase());
  avatar.setAttribute('aria-hidden', 'true');
  who.appendChild(avatar);
  who.appendChild(node('span', 'body', name));
  end.replaceChildren(who);
  topBanner.replaceChildren();
  let stations = [];
  try {
    const res = await call('/admin/queries/stations', { headers: adminHeaders(auth) });
    if (res.status === 200) stations = res.body.data.stations;
    else if (res.body.error && res.body.error.code === 'ADMIN_SESSION_REQUIRED') return restart(auth, deviceId);
  } catch {
    topBanner.replaceChildren(renderGlobalState({ id: 'F01', mode: 'banner' }));
  }
  // 05a §6.8: people (staff), the waiting requests and Pass points come from the admin queries after sign-in.
  let staff = [];
  let pending = [];
  let points = [];
  try {
    const res = await call('/admin/queries/devices', { headers: adminHeaders(auth) });
    if (res.status === 200) {
      staff = res.body.data.staff || [];
      pending = res.body.data.pending_requests || [];
    } else if (res.body.error && res.body.error.code === 'ADMIN_SESSION_REQUIRED') return restart(auth, deviceId);
  } catch {}
  try {
    const res = await call('/admin/queries/kds-config', { headers: adminHeaders(auth) });
    if (res.status === 200) points = (res.body.data.points || []).filter((item) => !item.is_archived);
  } catch {}
  // 05a §6.1 / §6.3 (M-2): the scanned request's hardware_hint (from pending_requests) is the form's default kind.
  const waiting = requestId ? pending.find((item) => item.request_id === requestId) : undefined;
  let kind = kept.kind || (waiting && waiting.hardware_hint) || null;
  let stationId = kept.stationId || null;
  const adminId = sessionStorage.getItem('admin_staff_id');
  const personName = (id) => { const p = staff.find((item) => item.staff_id === id); return p ? p.display_name : ''; };
  // §6.3 "Form defaults": phone → listed, one person (the signed-in admin when listed), dine_in; tablet → everyone,
  // dine_in + manager; kiosk or no hint → everyone, takeaway + cashier + manager.
  const defaultsFor = (k) => {
    if (k === 'phone') return { access: 'listed', staffIds: staff.some((p) => p.staff_id === adminId) ? [adminId] : [], screens: ['dine_in'] };
    if (k === 'tablet') return { access: 'everyone', staffIds: [], screens: ['dine_in', 'manager'] };
    return { access: 'everyone', staffIds: [], screens: ['takeaway', 'cashier', 'manager'] };
  };
  const suggestName = (k) => {
    if (k === 'phone') { const who = personName(profile.staffIds[0]); return who ? t('approve.suggest_phone_of', { name: who }) : ''; }
    if (k === 'cashier_kiosk') return t('approve.suggest_kiosk');
    if (k === 'tablet') return t('approve.suggest_tablet');
    if (k === 'kds') { const st = stations.find((item) => item.station_id === stationId); return st ? t('approve.preview_kds_name', { station: st.name }) : t('approve.suggest_kds'); }
    return '';
  };
  let profile = Object.assign({ pointId: kept.pointId || null }, kept.profile || defaultsFor(kind));
  let nameEdited = Boolean(kept.nameEdited) || Boolean(waiting && waiting.device_name);
  let deviceName = kept.deviceName !== undefined ? kept.deviceName : waiting && waiting.device_name ? waiting.device_name : suggestName(kind);
  const form = node('form', 'pos-card pos-approve__card');
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
  // §6.3: name, access, people, screens, Pass point (a staff device only).
  const nameInput = node('input', 'pos-input');
  nameInput.name = 'device_name';
  nameInput.autocomplete = 'off';
  nameInput.setAttribute('maxlength', '40');
  nameInput.value = deviceName;
  const nameField = field('approve.name_label', nameInput);
  form.appendChild(nameField);
  const accessSeg = node('div', 'pos-seg pos-seg--block');
  accessSeg.setAttribute('role', 'group');
  accessSeg.name = 'access';
  const accessField = field('approve.access_label', accessSeg);
  form.appendChild(accessField);
  const peopleBox = node('div', 'pos-tiles');
  peopleBox.setAttribute('role', 'group');
  peopleBox.name = 'staff_ids';
  const peopleField = field('approve.people_label', peopleBox);
  form.appendChild(peopleField);
  const screensBox = node('div', 'pos-tiles');
  screensBox.setAttribute('role', 'group');
  screensBox.name = 'screens';
  const screensField = field('approve.screens_label', screensBox);
  form.appendChild(screensField);
  const pointBox = node('div', 'pos-tiles');
  pointBox.setAttribute('role', 'group');
  pointBox.name = 'point_id';
  const pointField = field('approve.point_label', pointBox);
  form.appendChild(pointField);
  const status = node('div', 'pos-approve__status');
  status.name = 'approve_status';
  form.appendChild(status);
  const button = node('button', 'pos-btn pos-btn--primary pos-btn--lg pos-btn--block');
  button.type = 'submit';
  button.appendChild(icon('check'));
  const buttonText = node('span', '', t('approve.submit'));
  button.appendChild(buttonText);
  form.appendChild(button);
  // The outcome line under Approve (Pulse CHANGES §2); the kit hides it on a phone and while a banner shows.
  const outcome = node('p', 'pos-outcome');
  form.appendChild(outcome);
  screen.replaceChildren(form);
  const station = () => stations.find((item) => item.station_id === stationId);
  const preview = () => {
    outcome.hidden = kind === null;
    if (kind === null) return outcome.replaceChildren();
    const what = kind === 'kds' ? t('approve.preview_kds_name', { station: station() ? station().name : '…' }) : t(KIND_KEY[kind]);
    const next = t(kind === 'kds' ? 'approve.preview_kds' : 'approve.preview_cashier');
    const [before, after] = T['approve.outcome'].split('{what}');
    const words = node('span');
    words.appendChild(document.createTextNode(before));
    words.appendChild(node('b', '', what));
    words.appendChild(document.createTextNode((after || '').split('{next}').join(next)));
    outcome.replaceChildren(icon(KIND_ICON[kind]), words);
  };
  const opts = [];
  for (const [value, iconName, key] of [['cashier_kiosk', 'screen', 'approve.kind_cashier'], ['tablet', 'tablet', 'approve.kind_tablet'], ['phone', 'phone', 'approve.kind_phone'], ['kds', 'flame', 'approve.kind_kitchen']]) {
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
      profile = Object.assign({ pointId: null }, defaultsFor(kind));
      if (!nameEdited) { deviceName = suggestName(kind); nameInput.value = deviceName; }
      paintProfile();
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
      if (!nameEdited && kind === 'kds') { deviceName = suggestName(kind); nameInput.value = deviceName; }
      for (const other of stationTiles) other.setAttribute('aria-pressed', String(other === tile));
      stationField.fail('');
      preview();
    });
    stationTiles.push(tile);
    tiles.appendChild(tile);
  }
  if (stations.length === 0) tiles.appendChild(node('p', 'body', t('approve.no_stations')));
  const toggle = (list, value) => (list.includes(value) ? list.filter((item) => item !== value) : list.concat([value]));
  const chooser = (box, items, isOn, onPick) => {
    box.replaceChildren();
    for (const [value, label] of items) {
      const tile = node('button', 'pos-tile', label);
      tile.type = 'button';
      tile.value = value;
      tile.setAttribute('aria-pressed', String(isOn(value)));
      tile.addEventListener('click', () => onPick(value));
      box.appendChild(tile);
    }
  };
  // Every control that depends on the kind or the profile is drawn here; pass ⇔ point (§3.6, §6.3).
  const paintProfile = () => {
    const staffDevice = kind !== null && kind !== 'kds';
    stationField.hidden = kind !== 'kds';
    for (const part of [nameField, accessField, screensField]) part.hidden = kind === null;
    accessField.hidden = !staffDevice;
    screensField.hidden = !staffDevice;
    peopleField.hidden = !staffDevice || profile.access !== 'listed';
    pointField.hidden = !staffDevice || !profile.screens.includes('pass');
    accessSeg.replaceChildren();
    for (const [value, key] of [['everyone', 'approve.access_everyone'], ['listed', 'approve.access_listed']]) {
      const opt = node('button', 'pos-seg__opt', t(key));
      opt.type = 'button';
      opt.value = value;
      opt.setAttribute('aria-pressed', String(profile.access === value));
      opt.addEventListener('click', () => { profile.access = value; if (value === 'everyone') profile.staffIds = []; accessField.fail(''); paintProfile(); });
      accessSeg.appendChild(opt);
    }
    chooser(peopleBox, staff.map((p) => [p.staff_id, p.display_name]), (id) => profile.staffIds.includes(id), (id) => {
      profile.staffIds = toggle(profile.staffIds, id);
      peopleField.fail('');
      if (kind === 'phone' && !nameEdited) { deviceName = suggestName(kind); nameInput.value = deviceName; }
      paintProfile();
    });
    const offered = staffDevice ? ctx.offered[kind] || [] : [];
    chooser(screensBox, offered.map((key) => [key, t(SCREEN_KEY[key])]), (key) => profile.screens.includes(key), (key) => {
      profile.screens = toggle(profile.screens, key);
      if (!profile.screens.includes('pass')) profile.pointId = null;
      screensField.fail('');
      paintProfile();
    });
    chooser(pointBox, points.map((p) => [p.point_id, p.name]), (id) => profile.pointId === id, (id) => { profile.pointId = id; pointField.fail(''); paintProfile(); });
    if (points.length === 0) pointBox.appendChild(node('p', 'body', t('approve.no_points')));
  };
  nameInput.addEventListener('input', () => { nameEdited = true; deviceName = nameInput.value; nameField.fail(''); });
  paintProfile();
  preview();
  const readOnly = () => {
    for (const el of [code, nameInput, button, ...opts, ...stationTiles]) el.disabled = true;
    button.replaceChildren(buttonText);
    status.replaceChildren(banner('info', t('errors.PERMISSION_DENIED_devices'), t('errors.PERMISSION_DENIED_devices_body'), '', 'lock'));
  };
  if (permissions()['manage-devices'] === false) readOnly();
  const approvePayload = (value) => {
    const name = nameInput.value.trim().slice(0, 40);
    const base = { request_id: requestId || undefined, display_code: value, device_type: kind, device_name: name };
    if (kind === 'kds') return Object.assign(base, { station_id: stationId });
    const out = Object.assign(base, { access: profile.access, screens: profile.screens });
    if (profile.access === 'listed') out.staff_ids = profile.staffIds;
    if (profile.screens.includes('pass')) out.point_id = profile.pointId;
    return out;
  };
  // The rules the hub re-checks (§6.3 step 3): name 1–40, listed ⇒ 1–20 people, ≥ 1 screen, pass ⇔ point.
  const invalid = () => {
    const staffDevice = kind !== 'kds';
    nameField.fail(nameInput.value.trim() === '' ? t('approve.err_name') : '');
    peopleField.fail(staffDevice && profile.access === 'listed' && (profile.staffIds.length < 1 || profile.staffIds.length > 20) ? t('approve.err_people') : '');
    screensField.fail(staffDevice && profile.screens.length === 0 ? t('approve.err_screens') : '');
    pointField.fail(staffDevice && profile.screens.includes('pass') && profile.pointId === null ? t('approve.err_point') : '');
    return [nameField, peopleField, screensField, pointField].some((part) => part.classList.contains('pos-field--error'));
  };
  let busyRetried = false;
  const send = async () => {
    const value = code.value.replace(/[\\s-]/g, '').toUpperCase();
    codeField.fail(CODE_RE.test(value) ? '' : t('approve.err_code_format'));
    kindField.fail(kind === null ? t('approve.err_kind') : '');
    stationField.fail(kind === 'kds' && stationId === null ? t('approve.err_station') : '');
    if (!CODE_RE.test(value) || kind === null || (kind === 'kds' && stationId === null)) return;
    if (invalid()) return;
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
          // 05a §6.3: the v2 payload from the form (name, access, people, screens, Pass point).
          payload: approvePayload(value),
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
    if (res.status === 200) return done(auth, deviceId, kind === 'kds' ? station() : null, kind);
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
    failed(auth, deviceId, error, { code: code.value, kind, stationId, deviceName: nameInput.value, nameEdited, profile, pointId: profile.pointId });
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    send();
  });
}
// 00-S09
function done(auth, deviceId, approved, doneKind) {
  const again = node('button', 'pos-btn pos-btn--primary pos-btn--lg');
  again.type = 'button';
  again.appendChild(icon('plus'));
  again.appendChild(node('span', '', t('approve.another')));
  again.addEventListener('click', () => {
    // A scanned ?r= names one screen; the next approval goes by code only.
    requestId = null;
    approveForm(auth, deviceId);
  });
  const home = node('a', 'pos-btn pos-btn--lg', t('admin.title'));
  home.href = '/admin';
  const body = approved ? t('approve.done_body_kds', { station: approved.name }) : t(doneKind === 'cashier_kiosk' ? 'approve.done_body_cashier' : 'approve.done_body_staff');
  // 00-S09: the audit note moved here from the form (Pulse CHANGES §2).
  screen.replaceChildren(stateScreen('ok', 'check', t('approve.done_title'), body, [node('p', 'caption', t('approve.audit_note')), row([again, home])]));
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
  app.get('/admin/approve', { config: { group: 'admin-bootstrap' } }, async (request, reply) => {
    const provisioned = deps.config.provisioned;
    if (provisioned === undefined) throw new DomainError('HUB_NOT_PROVISIONED');
    // 05a §6.1 (M-2), §6.8: the hardware hint is read after sign-in from `pending_requests`, so this page reads nothing.
    return reply
      .type('text/html; charset=utf-8')
      .send(
        approvePage({
          tenant_id: provisioned.tenant_id,
          branch_id: provisioned.branch_id,
          offered: { cashier_kiosk: screensOffered('cashier_kiosk'), tablet: screensOffered('tablet'), phone: screensOffered('phone') },
        }),
      );
  });
  commandRegistry(app).register(
    defineCommand({
      commandType: 'ApprovePairingRequest',
      payloadSchema: Payload,
      // 05a §6.3 (M-3): `/commands/…` from a listed device and `/admin/commands/…`; `manage-devices` through the view.
      sessionKind: 'both',
      permission: 'manage-devices',
      handle(ctx, payload) {
        const kds = payload.device_type === 'kds';
        const stationId = payload.station_id ?? null;
        const now = ctx.clock.branchNow();
        // Step 1 (00 §6.32): the request, by id or by its single pending code; the code always matches.
        const row =
          payload.request_id === undefined
            ? pendingByCode(ctx.tx.db, ctx.branch.branchId, payload.display_code, now)
            : byId(ctx.tx.db, ctx.branch.branchId, payload.request_id);
        if (row === undefined || row.expires_at <= now || row.approved_at !== null || row.display_code !== payload.display_code) {
          throw new DomainError('PAIRING_REQUEST_NOT_FOUND');
        }
        // Step 2: kds → its station.
        if (kds && stationId !== null && !stationExists(ctx.tx, stationId)) {
          throw new DomainError('STATION_NOT_FOUND', { station_id: stationId });
        }
        // Step 3: a staff device's profile (the Payload refine has made access and screens present).
        const profile = kds
          ? null
          : {
              device_type: payload.device_type,
              access: payload.access ?? 'everyone',
              staff_ids: payload.access === 'listed' ? (payload.staff_ids ?? []) : [],
              screens: payload.screens ?? [],
              point_id: payload.point_id ?? null,
            };
        if (profile !== null) validateStaffProfile(profile, ctx.directory);
        const actor = ctx.actor.staffId;
        if (actor === null) throw new DomainError('PERMISSION_DENIED', { permission: 'manage-devices' });
        // Step 4: the device (no owner: 05a §5.1 dropped the phone ⇔ owner check), the request, the events.
        const deviceId = ctx.ids.next();
        const deviceToken = ctx.secrets.token256();
        ctx.tx.db
          .prepare(
            `INSERT INTO devices (
              device_id, branch_id, token_hash, device_name, device_type,
              station_id, owner_staff_id, paired_at, paired_by
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          )
          .run(deviceId, ctx.branch.branchId, sha256hex(deviceToken), payload.device_name, payload.device_type, stationId, now, actor);
        ctx.tx.db
          .prepare(
            `UPDATE pair_requests
             SET approved_at = ?, approved_by = ?, device_id = ?, delivery_token = ?
             WHERE request_id = ?`,
          )
          .run(now, actor, deviceId, deviceToken, row.request_id);
        const events: EventDraft[] = [
          {
            stream_type: 'hub',
            stream_id: deviceId,
            event_type: 'DevicePaired',
            schema_version: 1,
            payload: {
              device_id: deviceId,
              device_name: payload.device_name,
              device_type: payload.device_type,
              station_id: stationId,
              owner_staff_id: null,
              pairing_token_id: null,
              pairing_request_id: row.request_id,
            },
            occurred_at: now,
            actor_id: actor,
            // unchanged from 00 §6.32: the DevicePaired envelope names the new device
            device_id: deviceId,
          },
        ];
        if (profile !== null) {
          events.push({
            stream_type: 'hub',
            stream_id: deviceId,
            event_type: 'DeviceProfileSet',
            schema_version: 1,
            payload: {
              device_id: deviceId,
              device_name: payload.device_name,
              access: profile.access,
              staff_ids: [...profile.staff_ids],
              screens: [...profile.screens],
              point_id: profile.point_id,
              profile_version: 1,
              cause: 'approved',
              needs_review: false,
            },
            occurred_at: now,
            actor_id: actor,
            device_id: ctx.actor.deviceId,
          });
        }
        // Step 4, last (05a §3.10, row D-3): close `device_waiting` `done` when no other request is pending (1 read + the close)
        events.push(...closeDeviceWaitingWhenIdle(ctx, now, 'done'));
        // Step 5 (refresh `deviceProfile`) is the `refreshDeviceProfilesAfter` commit hook (server.ts, §4.2).
        return {
          events,
          result: {
            device_id: deviceId,
            device_type: payload.device_type,
            station_id: stationId,
            screens: profile === null ? [] : [...profile.screens],
            access: profile === null ? null : profile.access,
          },
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
