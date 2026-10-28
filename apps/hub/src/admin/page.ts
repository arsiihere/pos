import { encodeCrockford128 } from '../auth/pair-page.js';
import { signInClient } from '../auth/signin-client.js';
import { globalStateClient } from '../lib/global-state.js';
import { clientPrelude, pageHead, scriptJson } from '../lib/page.js';

// 00-S16 … S20 and D01 … D03 (docs/design/handoff/00/00-design.md §1), M86: the hub admin home and its shell.
// Static like /admin/approve (M79): no credentials in the page; the script signs in an admin in this tab and calls
// only §6.7, §6.14–§6.18c. Lists refresh on open and after each action (no WebSocket).
export function adminPage(ctx: { tenant_id: string; branch_id: string; branch_name: string; links: { stock: boolean } }): string {
  return `${pageHead({ title: 'admin.title', theme: 'light' })}
<body class="pos-root">
<div class="pos-page" id="screen"></div>
<script>
${encodeCrockford128.toString()}
${clientPrelude()}
${globalStateClient()}
${signInClient()}
const ctx = ${scriptJson(ctx)};
const screen = document.getElementById('screen');
const KDS_SILENT_MS = 120000; // Q8: a kitchen screen unseen for 2 min gets a warning
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const state = { auth: null, deviceId: null, data: {}, loadedAt: null, offline: false, notice: null, showRemoved: false, stopReconnect: null };
function phone() {
  return typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;
}
function view() {
  const name = (location.hash || '').replace(/^#/, '');
  return ['devices', 'add-phone', 'sessions', 'lockouts'].includes(name) ? name : 'home';
}
function go(name) {
  state.notice = null;
  location.hash = name === 'home' ? '' : '#' + name;
  render();
}
function permissions() {
  try { return JSON.parse(sessionStorage.getItem('admin_permissions') || '{}'); } catch { return {}; }
}
function can(permission) {
  return permissions()[permission] !== false;
}
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
function headers() {
  return Object.assign({ 'content-type': 'application/json', 'x-admin-session': sessionStorage.getItem('admin_session_token') }, state.auth);
}
// --- formatting (times, counts and codes stay LTR) ---
function day(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return t('devices.today', { time: hhmm(ts) });
  return d.getDate() + ' ' + MONTHS[d.getMonth()];
}
function ago(ts) {
  if (ts === null || ts === undefined) return t('devices.seen_never');
  const ms = Date.now() - ts;
  if (ms < 30000) return t('devices.seen_now');
  if (ms < 60000) return t('devices.seen_sec', { n: Math.floor(ms / 1000) });
  if (ms < 3600000) return t('devices.seen_min', { n: Math.floor(ms / 60000) });
  return t('devices.seen_hour', { n: Math.floor(ms / 3600000) });
}
function silentKds(device) {
  return device.device_type === 'kds' && device.revoked_at === null && (device.last_seen_at === null || Date.now() - device.last_seen_at > KDS_SILENT_MS);
}
function minutesLeft(until) {
  return Math.max(1, Math.ceil((until - Date.now()) / 60000));
}
function stationName(id) {
  const station = ((state.data.stations && state.data.stations.stations) || []).find((item) => item.station_id === id);
  return station ? station.name : id || '';
}
// Text with one LTR part, e.g. "until {time}".
function mixed(tag, className, key, vars, ltrName) {
  const el = node(tag, className);
  const parts = T[key].split('{' + ltrName + '}');
  const plain = Object.assign({}, vars);
  delete plain[ltrName];
  el.appendChild(document.createTextNode(fill(parts[0], plain)));
  if (parts.length > 1) {
    el.appendChild(ltr(String(vars[ltrName])));
    el.appendChild(document.createTextNode(fill(parts[1], plain)));
  }
  return el;
}
function fill(text, vars) {
  let out = text;
  for (const name of Object.keys(vars || {})) out = out.split('{' + name + '}').join(String(vars[name]));
  return out;
}
function button(label, className, iconName, onClick) {
  const b = node('button', 'pos-btn' + (className ? ' ' + className : ''));
  b.type = 'button';
  if (iconName) b.appendChild(icon(iconName));
  b.appendChild(document.createTextNode(label));
  b.addEventListener('click', onClick);
  return b;
}
function link(label, className, iconName, target) {
  const a = node('a', 'pos-btn' + (className ? ' ' + className : ''));
  a.href = target.startsWith('/') ? target : '#' + target;
  if (iconName) a.appendChild(icon(iconName));
  a.appendChild(document.createTextNode(label));
  if (!target.startsWith('/')) a.addEventListener('click', (event) => { event.preventDefault(); go(target); });
  return a;
}
// --- data ---
const NEEDS = {
  home: ['devices', 'sessions', 'lockouts'],
  devices: ['devices', 'stations'],
  'add-phone': ['staff'],
  sessions: ['sessions', 'stations'],
  lockouts: ['lockouts', 'staff'],
};
async function load(names) {
  const urls = { devices: '/admin/queries/devices' + (state.showRemoved ? '?include_revoked=true' : ''), sessions: '/admin/queries/sessions', lockouts: '/admin/queries/lockouts', staff: '/admin/queries/staff', stations: '/admin/queries/stations' };
  let results;
  try {
    results = await Promise.all(names.map((name) => call(urls[name], { headers: headers() })));
  } catch {
    setOffline(true);
    return false;
  }
  setOffline(false);
  for (let i = 0; i < names.length; i += 1) {
    const res = results[i];
    if (res.status === 200) {
      state.data[names[i]] = res.body.data;
      continue;
    }
    const error = res.body.error || {};
    if (error.code === 'ADMIN_SESSION_REQUIRED' || error.code === 'PERMISSION_DENIED') {
      await signIn();
      return load(names);
    }
    if (globalScreen(error, {}, { pairAgain: () => { location.href = '/pair'; } })) return false;
  }
  state.loadedAt = Date.now();
  return true;
}
function setOffline(on) {
  state.offline = on;
  if (!on) {
    if (state.stopReconnect) state.stopReconnect();
    state.stopReconnect = null;
    return;
  }
  if (state.stopReconnect) return;
  state.stopReconnect = startReconnect(
    () => fetch('/health', { cache: 'no-store' }).then(() => true),
    async () => {
      state.stopReconnect = null;
      await load(NEEDS[view()]);
      paint();
    },
  );
}
async function command(name, type, payload) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let res;
  try {
    res = await call('/admin/commands/' + name, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        command_id: encodeCrockford128(bytes),
        tenant_id: ctx.tenant_id,
        branch_id: ctx.branch_id,
        command_type: type,
        payload,
        occurred_at: Date.now(),
        actor_id: sessionStorage.getItem('admin_staff_id'),
        device_id: state.deviceId,
      }),
    });
  } catch {
    setOffline(true);
    paint();
    return null;
  }
  if (res.status === 200) return { result: res.body.data.result };
  const error = res.body.error || { code: 'INTERNAL_ERROR' };
  if (error.code === 'ADMIN_SESSION_REQUIRED') {
    await signIn();
    return null;
  }
  if (globalScreen(error, {}, { pairAgain: () => { location.href = '/pair'; } })) return null;
  return { error };
}
// --- shell ---
function nav(current) {
  const box = node('nav', 'pos-sidenav');
  box.setAttribute('aria-label', t('admin.title'));
  const brand = node('div', 'pos-sidenav__brand');
  brand.appendChild(node('strong', '', ctx.branch_name));
  brand.appendChild(node('span', '', t('admin.title')));
  box.appendChild(brand);
  const counts = {
    devices: state.data.devices ? state.data.devices.devices.filter((d) => d.revoked_at === null).length : null,
    sessions: state.data.sessions ? state.data.sessions.sessions.length : null,
    lockouts: lockoutCount(),
  };
  const item = (name, iconName, key) => {
    const a = node('a', 'pos-sidenav__item');
    a.href = name === 'home' ? '#' : '#' + name;
    if (name === current) a.setAttribute('aria-current', 'page');
    a.appendChild(icon(iconName));
    a.appendChild(document.createTextNode(t(key)));
    if (counts[name] !== null && counts[name] !== undefined) {
      const small = node('small');
      small.appendChild(ltr(String(counts[name])));
      a.appendChild(small);
    }
    a.addEventListener('click', (event) => { event.preventDefault(); go(name); });
    box.appendChild(a);
  };
  item('home', 'grid', 'admin.title');
  item('devices', 'screen', 'admin.nav_devices');
  item('sessions', 'user', 'admin.nav_sessions');
  item('lockouts', 'lock', 'admin.nav_lockouts');
  if (ctx.links.stock) {
    box.appendChild(node('span', 'caption', t('admin.nav_other')));
    const stock = node('a', 'pos-sidenav__item');
    stock.href = '/admin/stock/';
    stock.appendChild(icon('box'));
    stock.appendChild(document.createTextNode(t('admin.nav_stock')));
    box.appendChild(stock);
  }
  const foot = node('div', 'pos-sidenav__foot');
  foot.appendChild(node('span', 'body', sessionStorage.getItem('admin_name') || ''));
  foot.appendChild(button(t('admin.sign_out'), '', 'logout', signOut));
  box.appendChild(foot);
  return box;
}
function lockoutCount() {
  const l = state.data.lockouts;
  return l ? l.staff.length + l.devices.length + l.ips.length : null;
}
// One page frame: side menu on tablets and laptops; a phone app bar with a back link inside pages (00-S20).
function frame(current, titleKey, endParts, parts) {
  const bar = node('header', 'pos-appbar' + (phone() ? ' pos-appbar--phone' : ''));
  if (phone() && current !== 'home') {
    const back = link('', '', 'back', 'home');
    back.firstChild.classList.add('pos-icon--flip');
    back.setAttribute('aria-label', t('admin.back'));
    bar.appendChild(back);
  }
  bar.appendChild(node('h1', 'pos-appbar__title', t(titleKey)));
  const end = node('div', 'pos-appbar__end');
  for (const part of endParts) end.appendChild(part);
  bar.appendChild(end);
  const main = node('main', 'pos-content');
  if (state.offline) {
    const notice = banner('warn', t('admin.offline'), state.loadedAt ? t('admin.offline_body', { time: hhmm(state.loadedAt) }) : '');
    notice.classList.add('pos-banner--pulse');
    main.appendChild(notice);
  }
  if (state.notice) main.appendChild(state.notice);
  for (const part of parts) main.appendChild(part);
  if (phone()) return screen.replaceChildren(bar, main);
  const column = node('div');
  column.appendChild(bar);
  column.appendChild(main);
  const shell = node('div', 'pos-shell');
  shell.appendChild(nav(current));
  shell.appendChild(column);
  screen.replaceChildren(shell);
}
function refreshed() {
  const p = mixed('p', 'caption', 'admin.refreshed', { time: hhmm(state.loadedAt || Date.now()) }, 'time');
  return [p, button(t('admin.refresh'), '', 'reload', () => render())];
}
function list(className, heads) {
  const ul = node('ul', 'pos-list ' + (phone() ? 'pos-list--stack' : className));
  if (!phone() && heads) {
    const head = node('li', 'pos-list__head');
    for (const key of heads) head.appendChild(node('span', '', key ? t(key) : ''));
    ul.appendChild(head);
  }
  return ul;
}
function nameBlock(iconName, title, lines, tags) {
  const box = node('div', 'pos-list__name');
  const who = node('strong', 'pos-list__who');
  who.appendChild(icon(iconName));
  if (typeof title === 'string') who.appendChild(document.createTextNode(title));
  else who.appendChild(title);
  box.appendChild(who);
  for (const line of lines) box.appendChild(typeof line === 'string' ? node('span', '', line) : line);
  if (tags && tags.length > 0) {
    const tagBox = node('div', 'pos-list__tags');
    for (const tag of tags) tagBox.appendChild(tag);
    box.appendChild(tagBox);
  }
  return box;
}
function meta(text, sub) {
  const box = node('div', 'pos-list__meta');
  if (typeof text === 'string') box.appendChild(document.createTextNode(text));
  else box.appendChild(text);
  if (sub) box.appendChild(node('span', '', sub));
  return box;
}
function skeleton(rows) {
  const ul = node('ul', 'pos-list pos-list--stack');
  for (let i = 0; i < rows; i += 1) {
    const li = node('li', 'pos-list__row');
    li.appendChild(node('span', 'pos-skeleton'));
    ul.appendChild(li);
  }
  return ul;
}
function notice(kind, text, detail) {
  state.notice = banner(kind, text, detail);
}
// --- dialogs (00-D01 … D03) ---
function dialog(o) {
  const scrim = node('div', 'pos-scrim');
  const box = node('div', 'pos-dialog pos-dialog--form');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.appendChild(node('h2', 'pos-dialog__title', o.title));
  box.appendChild(node('p', 'pos-dialog__body', o.body));
  for (const part of o.parts || []) box.appendChild(part);
  const footer = node('div', 'pos-dialog__footer');
  const close = () => document.body.removeChild(scrim);
  footer.appendChild(button(t('common.cancel'), '', '', close));
  const ok = button(o.confirm, o.danger ? 'pos-btn--danger' : 'pos-btn--primary', o.icon, async () => {
    setBusy(ok, true);
    await o.onConfirm();
    setBusy(ok, false);
    close();
  });
  ok.name = 'dialog_confirm';
  if (state.offline) ok.disabled = true;
  footer.appendChild(ok);
  box.appendChild(footer);
  scrim.appendChild(box);
  document.body.appendChild(scrim);
  return close;
}
// --- 00-S20 home ---
function home() {
  const tiles = node('div', 'pos-tiles pos-tiles--menu');
  const tile = (target, iconName, titleKey, small, chipNode) => {
    const a = node('a', 'pos-tile');
    a.href = target.startsWith('/') ? target : '#' + target;
    const head = node('span', 'pos-tile__head');
    head.appendChild(icon(iconName));
    head.appendChild(document.createTextNode(t(titleKey)));
    a.appendChild(head);
    if (small) a.appendChild(node('small', '', small));
    if (chipNode) a.appendChild(chipNode);
    if (!target.startsWith('/')) a.addEventListener('click', (event) => { event.preventDefault(); go(target); });
    tiles.appendChild(a);
  };
  const devices = state.data.devices ? state.data.devices.devices.filter((d) => d.revoked_at === null) : [];
  const silent = devices.find(silentKds);
  tile('devices', 'screen', 'admin.nav_devices', t('admin.tile_devices', { n: devices.length }),
    silent ? chip('warn', 'clock', t('admin.not_seen_chip', { name: silent.device_name, n: silent.last_seen_at === null ? '—' : Math.floor((Date.now() - silent.last_seen_at) / 60000) })) : null);
  if (can('manage-devices')) tile('add-phone', 'qr', 'admin.tile_add_phone_title', t('admin.tile_add_phone'));
  tile('sessions', 'user', 'admin.nav_sessions', t('admin.tile_sessions', { n: state.data.sessions ? state.data.sessions.sessions.length : 0 }));
  const l = state.data.lockouts;
  const count = lockoutCount() || 0;
  const first = l && l.staff[0];
  tile('lockouts', 'lock', 'admin.nav_lockouts', t('admin.tile_lockouts'),
    count === 0 ? null : chip('danger', 'lock', first && count === 1 ? t('admin.locked_chip', { name: first.display_name, min: minutesLeft(first.locked_until) }) : t('admin.locked_many', { n: count })));
  const parts = [mixed('p', 'body', 'admin.branch_line', { host: location.host || '' }, 'host'), tiles];
  if (ctx.links.stock) {
    parts.push(node('h2', 'heading', t('admin.nav_other')));
    const other = node('div', 'pos-tiles pos-tiles--menu');
    const stock = node('a', 'pos-tile');
    stock.href = '/admin/stock/';
    const head = node('span', 'pos-tile__head');
    head.appendChild(icon('box'));
    head.appendChild(document.createTextNode(t('admin.nav_stock')));
    stock.appendChild(head);
    stock.appendChild(node('small', '', t('admin.tile_stock')));
    other.appendChild(stock);
    parts.push(other);
  }
  if (phone()) parts.push(button(t('admin.sign_out'), 'pos-btn--block', 'logout', signOut));
  const end = can('manage-devices') ? [link(t('devices.approve'), 'pos-btn--primary', 'plus', '/admin/approve')] : [];
  frame('home', 'admin.title', end, parts);
}
// --- 00-S16 devices ---
const GROUPS = [['cashier_kiosk', 'devices.group_cashier'], ['kds', 'devices.group_kitchen'], ['tablet', 'devices.group_tablet'], ['phone', 'devices.group_phone']];
const TYPE_ICON = { cashier_kiosk: 'screen', kds: 'flame', tablet: 'tablet', phone: 'phone' };
function deviceType(d) {
  if (d.device_type === 'kds') return t('devices.type_kds', { station: stationName(d.station_id) });
  if (d.device_type === 'phone') return t('devices.type_phone', { owner: d.owner_name || '—' });
  return t(d.device_type === 'tablet' ? 'devices.type_tablet' : 'devices.type_cashier');
}
function devicesView() {
  const manage = can('manage-devices') && !state.offline;
  const all = state.data.devices ? state.data.devices.devices : null;
  const toggle = node('button', 'pos-switch');
  toggle.type = 'button';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', String(state.showRemoved));
  toggle.appendChild(node('span', 'pos-switch__track'));
  toggle.appendChild(document.createTextNode(t('devices.show_removed')));
  toggle.addEventListener('click', () => {
    state.showRemoved = !state.showRemoved;
    render();
  });
  const actions = [toggle];
  if (can('manage-devices')) {
    actions.push(link(t('devices.add_phone'), '', 'qr', 'add-phone'));
    actions.push(link(phone() ? t('devices.approve_short') : t('devices.approve'), 'pos-btn--primary', 'plus', '/admin/approve'));
  }
  const parts = [];
  if (phone()) {
    const row = node('div', 'pos-row');
    for (const action of actions) row.appendChild(action);
    parts.push(row);
  }
  if (!can('manage-devices')) parts.push(banner('info', t('devices.read_only'), t('devices.read_only_body')));
  if (all === null) {
    parts.push(skeleton(4));
    return frame('devices', 'devices.title', phone() ? [] : actions, parts);
  }
  const live = all.filter((d) => d.revoked_at === null);
  if (live.length <= 1) {
    const callout = node('div', 'pos-callout pos-callout--accent');
    const mark = node('span', 'pos-callout__icon');
    mark.appendChild(icon('plus'));
    callout.appendChild(mark);
    const text = node('div', 'pos-callout__text');
    text.appendChild(node('h2', '', t('devices.first_run_title')));
    text.appendChild(node('p', '', t('devices.first_run_body')));
    callout.appendChild(text);
    parts.push(callout);
  }
  const ul = list('pos-list--devices', ['devices.col_name', 'devices.col_paired', 'devices.col_seen', 'devices.col_session', '']);
  const groups = GROUPS.map(([type, key]) => [key, live.filter((d) => d.device_type === type)]);
  if (state.showRemoved) groups.push(['devices.group_removed', all.filter((d) => d.revoked_at !== null)]);
  for (const [key, devices] of groups) {
    if (devices.length === 0) continue;
    const group = node('li', 'pos-list__group', t(key));
    const count = node('small');
    count.appendChild(ltr(String(devices.length)));
    group.appendChild(count);
    ul.appendChild(group);
    for (const d of devices) ul.appendChild(deviceRow(d, manage));
  }
  parts.push(ul);
  frame('devices', 'devices.title', phone() ? [] : actions, parts);
}
function deviceRow(d, manage) {
  const removed = d.revoked_at !== null;
  const li = node('li', 'pos-list__row' + (removed ? ' is-muted' : ''));
  li.name = 'device_' + d.device_id;
  const tags = [];
  if (d.device_id === state.deviceId) tags.push(chip('accent', '', t('devices.this_screen')));
  if (removed) tags.push(chip('danger', 'x', t('devices.removed_on', { date: day(d.revoked_at) }) + (d.revoked_reason ? ' · ' + d.revoked_reason : '')));
  const silent = silentKds(d);
  const seenText = ago(d.last_seen_at);
  const notSeen = silent ? chip('warn', 'clock', t('devices.not_seen', { n: d.last_seen_at === null ? '—' : Math.floor((Date.now() - d.last_seen_at) / 60000) })) : null;
  const who = d.active_session ? (d.active_session.kind === 'station' ? t('devices.kitchen_session') : d.active_session.display_name || '—') : t('devices.nobody');
  const removeButton = !removed && manage ? button(t('devices.remove'), 'pos-btn--danger', '', () => removeDialog(d)) : node('span');
  if (phone()) {
    const lines = [deviceType(d)];
    if (!removed && !notSeen) lines.push(seenText + ' · ' + who);
    if (notSeen) tags.push(notSeen);
    const row = node('div', 'pos-row');
    row.appendChild(nameBlock(TYPE_ICON[d.device_type], d.device_name, lines, tags));
    row.appendChild(removeButton);
    li.appendChild(row);
    return li;
  }
  li.appendChild(nameBlock(TYPE_ICON[d.device_type], d.device_name, [deviceType(d)], tags));
  li.appendChild(meta(t('devices.paired_by', { date: day(d.paired_at), name: d.paired_by_name || '—' }), t(d.pairing_source === 'request' ? 'devices.source_request' : 'devices.source_token')));
  li.appendChild(notSeen || meta(removed ? '—' : seenText));
  li.appendChild(meta(removed ? '—' : who));
  li.appendChild(removeButton);
  return li;
}
function removeDialog(d) {
  const reason = node('input', 'pos-input');
  reason.name = 'remove_reason';
  reason.setAttribute('maxlength', '200');
  const help = node('p', 'pos-field__help');
  const counter = ltr('0 / 200');
  help.appendChild(document.createTextNode(t('devices.remove_help') + ' · '));
  help.appendChild(counter);
  reason.addEventListener('input', () => { counter.textContent = reason.value.length + ' / 200'; });
  const field = node('div', 'pos-field');
  field.appendChild(node('label', 'pos-field__label', t('devices.remove_reason')));
  field.appendChild(reason);
  field.appendChild(help);
  const parts = [];
  const self = d.device_id === state.deviceId;
  if (self) parts.push(banner('warn', t('devices.remove_self')));
  parts.push(field);
  dialog({
    title: t('devices.remove_title', { name: d.device_name }),
    body: t('devices.remove_body'),
    parts,
    confirm: t('devices.remove'),
    danger: true,
    icon: 'x',
    onConfirm: async () => {
      const text = reason.value.trim();
      const outcome = await command('revoke-device', 'RevokeDevice', text === '' ? { device_id: d.device_id } : { device_id: d.device_id, reason: text });
      if (outcome === null) return;
      if (outcome.error) {
        notice(outcome.error.code === 'DEVICE_NOT_FOUND' ? 'info' : 'danger', errorText(outcome.error));
      } else if (self) {
        document.body.replaceChildren(renderGlobalState({ id: 'F02', mode: 'screen', variant: 'screen' }, { pairAgain: () => { location.href = '/pair'; } }));
        return;
      } else if (outcome.result.already_revoked) {
        notice('ok', t('devices.already_removed', { name: d.device_name }));
      } else {
        notice('ok', t('devices.removed', { name: d.device_name }), t('devices.removed_body'));
      }
      const kept = state.notice;
      await load(NEEDS.devices);
      state.notice = kept;
      paint();
    },
  });
}
// --- 00-S17 add a phone ---
let picked = null;
let qr = null;
function addPhoneView() {
  const back = link(t('admin.nav_devices'), '', '', 'devices');
  if (qr) return qrView(back);
  const section = node('section', 'pos-stack');
  const head = node('div', 'pos-section__head');
  head.appendChild(node('h2', '', t('addphone.who')));
  head.appendChild(node('p', '', t('addphone.who_sub')));
  section.appendChild(head);
  const search = node('label', 'pos-input-affix');
  const lens = node('span');
  lens.appendChild(icon('search'));
  search.appendChild(lens);
  const find = node('input', 'pos-input');
  find.type = 'search';
  find.name = 'find';
  find.setAttribute('aria-label', t('addphone.find'));
  find.setAttribute('placeholder', t('addphone.find'));
  search.appendChild(find);
  section.appendChild(search);
  const grid = node('div', 'pos-staff');
  section.appendChild(grid);
  const staff = state.data.staff ? state.data.staff.staff : null;
  const bar = node('footer', 'pos-actionbar');
  const info = node('div', 'pos-actionbar__info');
  const make = button(t('addphone.make_qr'), 'pos-btn--primary pos-btn--lg', 'qr', makeQr);
  make.name = 'make_qr';
  const sub = (member) => (member.role_names[0] ? member.role_names[0] + ' · ' : '') + (member.phone_count === 0 ? t('addphone.no_phone') : t(member.phone_count === 1 ? 'addphone.has_phones' : 'addphone.has_phones_many', { n: member.phone_count }));
  const paintInfo = () => {
    make.disabled = picked === null || state.offline || !can('manage-devices');
    if (picked === null) return info.replaceChildren(node('span', '', t('addphone.pick')));
    info.replaceChildren(node('strong', '', picked.display_name), document.createTextNode(sub(picked)));
  };
  const paintTiles = () => {
    grid.replaceChildren();
    if (staff === null) return grid.appendChild(skeleton(3));
    const q = find.value.trim().toLowerCase();
    for (const member of staff.filter((m) => m.display_name.toLowerCase().includes(q))) {
      const tile = node('button', 'pos-staff__tile', member.display_name);
      tile.type = 'button';
      tile.setAttribute('aria-pressed', String(picked !== null && picked.staff_id === member.staff_id));
      tile.appendChild(node('small', '', sub(member)));
      tile.addEventListener('click', () => {
        picked = member;
        paintTiles();
        paintInfo();
      });
      grid.appendChild(tile);
    }
  };
  find.addEventListener('input', paintTiles);
  paintTiles();
  paintInfo();
  bar.appendChild(info);
  const end = node('div', 'pos-actionbar__end');
  end.appendChild(make);
  bar.appendChild(end);
  frame('add-phone', 'admin.tile_add_phone_title', phone() ? [] : [back], [section, bar]);
}
async function makeQr() {
  const outcome = await command('generate-device-pairing-token', 'GenerateDevicePairingToken', { device_type: 'phone', owner_staff_id: picked.staff_id });
  if (outcome === null) return;
  if (outcome.error) {
    notice('danger', errorText(outcome.error));
    return paint();
  }
  qr = { name: picked.display_name, svg: outcome.result.pair_qr_svg, url: outcome.result.pair_url, expires_at: outcome.result.expires_at };
  paint();
}
function qrView(back) {
  const card = node('section', 'pos-card');
  const code = node('div', 'pos-code');
  code.appendChild(node('h2', 'title', t('addphone.scan_title', { name: qr.name })));
  code.appendChild(node('p', 'body', t('addphone.scan_body')));
  const expired = Date.now() >= qr.expires_at;
  if (expired) {
    code.appendChild(node('div', 'pos-code__qr pos-code__qr--void', t('addphone.expired_qr')));
    code.appendChild(chip('danger', 'clock', t('addphone.expired')));
  } else {
    const box = node('div', 'pos-code__qr');
    box.innerHTML = qr.svg;
    code.appendChild(box);
    const valid = chip('warn', 'clock', '');
    valid.name = 'qr_valid';
    const tick = () => {
      if (view() !== 'add-phone' || !qr) return;
      if (Date.now() >= qr.expires_at) return paint();
      const parts = T['addphone.valid'].split('{time}');
      valid.replaceChildren(icon('clock'), document.createTextNode(parts[0]), ltr(mmss(qr.expires_at - Date.now())), document.createTextNode(parts[1] || ''));
      setTimeout(tick, 1000);
    };
    tick();
    code.appendChild(valid);
    code.appendChild(node('p', 'pos-mono-wrap', qr.url));
  }
  const again = button(t('addphone.new_qr'), expired ? 'pos-btn--primary pos-btn--lg pos-btn--block' : 'pos-btn--lg pos-btn--block', 'reload', makeQr);
  if (state.offline) again.disabled = true;
  const actions = node('div', 'pos-stack');
  actions.appendChild(again);
  if (!expired) {
    actions.appendChild(button(t('addphone.done'), 'pos-btn--primary pos-btn--lg pos-btn--block', 'check', () => {
      qr = null;
      picked = null;
      go('devices');
    }));
  }
  code.appendChild(actions);
  card.appendChild(code);
  frame('add-phone', 'admin.tile_add_phone_title', phone() ? [] : [back], [card]);
}
// --- 00-S18 sessions ---
function sessionsView() {
  const parts = [];
  const manage = can('manage-staff');
  if (!manage) parts.push(banner('info', t('sessions.read_only'), t('devices.read_only_body')));
  const data = state.data.sessions;
  if (!data) {
    parts.push(skeleton(4));
    return frame('sessions', 'sessions.title', refreshed(), parts);
  }
  const ul = list('pos-list--sessions', ['sessions.col_who', 'sessions.col_on', 'sessions.col_activity', '']);
  if (data.sessions.length === 0) parts.push(node('p', 'body', t('sessions.none')));
  const mine = sessionStorage.getItem('admin_staff_id');
  for (const s of data.sessions) {
    const station = s.kind === 'station';
    const name = station ? stationName(s.station_id) : s.display_name || '—';
    const kind = t(station ? 'sessions.kind_station' : s.kind === 'admin' ? 'sessions.kind_admin' : 'sessions.kind_staff');
    const you = s.kind === 'admin' && s.staff_id === mine;
    const li = node('li', 'pos-list__row');
    li.name = 'session_' + s.session_id;
    li.appendChild(nameBlock(station ? 'flame' : 'user', name, [mixed('span', '', 'sessions.since', { kind, time: hhmm(s.started_at) }, 'time')], you ? [chip('accent', '', t('sessions.you'))] : []));
    li.appendChild(meta(s.device_name || t('sessions.hub_admin_device')));
    let rule = t('sessions.stays_on');
    let soon = false;
    if (s.idle_ttl_ms !== null) {
      const left = s.last_activity_at + s.idle_ttl_ms - Date.now();
      soon = left < 120000;
      rule = soon ? t('sessions.idle_soon', { n: Math.max(0, Math.ceil(left / 60000)) }) : s.idle_ttl_ms >= 3600000 ? t('sessions.idle_rule_h', { n: Math.round(s.idle_ttl_ms / 3600000) }) : t('sessions.idle_rule', { n: Math.round(s.idle_ttl_ms / 60000) });
    }
    li.appendChild(meta(soon ? chip('warn', 'clock', ago(s.last_activity_at)) : ago(s.last_activity_at), rule));
    li.appendChild(manage && !you && !state.offline ? button(t('sessions.log_out'), phone() ? 'pos-btn--block' : '', 'logout', () => logoutDialog(s, name)) : node('span'));
    ul.appendChild(li);
  }
  if (data.sessions.length > 0) parts.push(ul);
  frame('sessions', 'sessions.title', refreshed(), parts);
}
function logoutDialog(s, name) {
  const station = s.kind === 'station';
  const device = s.device_name || t('sessions.hub_admin_device');
  dialog({
    title: station ? t('sessions.end_kds_title', { station: name }) : t('sessions.logout_title', { name, device }),
    body: station ? t('sessions.end_kds_body', { station: name }) : t('sessions.logout_body', { device }),
    confirm: station ? t('sessions.end_kds') : t('sessions.log_out'),
    danger: true,
    icon: 'logout',
    onConfirm: async () => {
      const outcome = await command('force-logout-session', 'ForceLogoutSession', { session_id: s.session_id });
      if (outcome === null) return;
      if (outcome.error) notice('info', errorText(outcome.error));
      else if (outcome.result.already_ended) notice('ok', t('sessions.already_ended'));
      else notice('ok', t('sessions.logged_out', { name, device }));
      const kept = state.notice;
      await load(NEEDS.sessions);
      state.notice = kept;
      paint();
    },
  });
}
// --- 00-S19 lockouts ---
function lockoutsView() {
  const parts = [];
  const manage = can('manage-staff') && !state.offline;
  if (!can('manage-staff')) parts.push(banner('info', t('lockouts.read_only'), t('devices.read_only_body')));
  const data = state.data.lockouts;
  if (!data) {
    parts.push(skeleton(3));
    return frame('lockouts', 'lockouts.title', refreshed(), parts);
  }
  const roles = new Map(((state.data.staff && state.data.staff.staff) || []).map((m) => [m.staff_id, m.role_names[0] || '']));
  const rows = [
    ['lockouts.people', 'lockouts.none_people', data.staff.map((s) => ({ type: 'staff', id: s.staff_id, name: s.display_name, until: s.locked_until, why: 'lockouts.why_person', icon: 'user', role: roles.get(s.staff_id) }))],
    ['lockouts.screens', 'lockouts.none_screens', data.devices.map((d) => ({ type: 'device', id: d.device_id, name: d.device_name || d.device_id, until: d.locked_until, why: 'lockouts.why_screen', icon: 'screen' }))],
    ['lockouts.addresses', 'lockouts.none_ip', data.ips.map((ip) => ({ type: 'ip', id: ip.ip, name: ip.ip, until: ip.locked_until, why: 'lockouts.why_ip', icon: 'link' }))],
  ];
  const newest = phone() && data.staff[0];
  if (newest) parts.push(banner('danger', t('lockouts.banner_person', { name: newest.display_name }), t('lockouts.banner_person_small')));
  for (const [titleKey, noneKey, items] of rows) {
    if (phone() && items.length === 0) continue;
    const section = node('section', 'pos-stack');
    const head = node('div', 'pos-section__head');
    head.appendChild(node('h2', '', t(titleKey)));
    section.appendChild(head);
    if (items.length === 0) {
      const none = node('p', 'body');
      none.appendChild(icon('check'));
      none.appendChild(document.createTextNode(t(noneKey)));
      section.appendChild(none);
      parts.push(section);
      continue;
    }
    const ul = list('pos-list--lockouts', ['lockouts.col_what', 'lockouts.col_locked', '']);
    for (const item of items) {
      const li = node('li', 'pos-list__row');
      li.name = 'lockout_' + item.type + '_' + item.id;
      const title = item.type === 'ip' ? ltr(item.name) : item.name;
      const locked = chip('danger', 'lock', t('staff.locked_min', { min: minutesLeft(item.until) }));
      const why = mixed('span', '', item.why, { time: hhmm(item.until) }, 'time');
      const primary = phone() && newest && item.type === 'staff' && item.id === newest.staff_id;
      const label = primary ? t('lockouts.unlock_name', { name: item.name }) : t('lockouts.unlock');
      const action = manage ? button(label, (primary ? 'pos-btn--primary pos-btn--lg ' : '') + (phone() ? 'pos-btn--block' : ''), 'unlock', () => unlockDialog(item)) : node('span');
      if (phone()) {
        li.appendChild(nameBlock(item.icon, title, [why], [locked]));
      } else {
        li.appendChild(nameBlock(item.icon, title, [why]));
        li.appendChild(locked);
      }
      li.appendChild(action);
      ul.appendChild(li);
    }
    section.appendChild(ul);
    parts.push(section);
  }
  frame('lockouts', 'lockouts.title', phone() ? [] : refreshed(), parts);
}
function unlockDialog(item) {
  dialog({
    title: t('lockouts.confirm_title', { name: item.name }),
    body: t(item.type === 'ip' ? 'lockouts.confirm_ip_body' : 'lockouts.confirm_body'),
    confirm: t('lockouts.unlock'),
    danger: false,
    icon: 'unlock',
    onConfirm: async () => {
      const outcome = await command('clear-pin-lockout', 'ClearPinLockout', { subject_type: item.type, subject_id: item.id });
      if (outcome === null) return;
      if (outcome.error) notice('danger', errorText(outcome.error));
      else if (!outcome.result.cleared) notice('ok', t('lockouts.already_unlocked'));
      else notice('ok', t('lockouts.unlocked', { name: item.name }), t('lockouts.unlocked_body'));
      const kept = state.notice;
      await load(NEEDS.lockouts);
      state.notice = kept;
      paint();
    },
  });
}
// --- sign-in, sign-out, routing ---
const VIEWS = { home, devices: devicesView, 'add-phone': addPhoneView, sessions: sessionsView, lockouts: lockoutsView };
function paint() {
  VIEWS[view()]();
}
async function render() {
  paint();
  if (await load(NEEDS[view()])) paint();
  else paint();
}
function signIn() {
  sessionStorage.removeItem('admin_session_token');
  return new Promise((resolve) => {
    const left = node('section', 'pos-stack');
    left.appendChild(node('p', 'caption', t('app.brand_admin')));
    left.appendChild(node('h1', 'title', t('approve.who')));
    const roster = node('div', 'pos-staff');
    left.appendChild(roster);
    const card = node('form', 'pos-card pos-stack');
    card.addEventListener('submit', (event) => event.preventDefault());
    const split = node('div', 'pos-split');
    split.appendChild(left);
    split.appendChild(card);
    const main = node('main', 'pos-content pos-content--narrow');
    main.appendChild(split);
    screen.replaceChildren(main);
    adminSignIn({
      roster,
      card,
      load: () => call('/admin/login-roster', { headers: state.auth }),
      login: (staffId, pin) => call('/admin/auth', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, state.auth), body: JSON.stringify({ staff_id: staffId, pin }) }),
      onDone: (data) => {
        sessionStorage.setItem('admin_session_token', data.admin_session_token);
        sessionStorage.setItem('admin_staff_id', data.staff_id);
        sessionStorage.setItem('admin_name', data.display_name);
        sessionStorage.setItem('admin_permissions', JSON.stringify(data.permissions || {}));
        resolve();
      },
      onExpired: notHere,
      global: (error) => globalScreen(error, {}, { pairAgain: () => { location.href = '/pair'; } }),
    });
  });
}
async function signOut() {
  const token = sessionStorage.getItem('admin_session_token');
  try { await fetch('/admin/auth/logout', { method: 'POST', headers: Object.assign({ 'x-admin-session': token }, state.auth) }); } catch {}
  for (const key of ['admin_session_token', 'admin_staff_id', 'admin_name', 'admin_permissions', 'admin_bootstrap']) sessionStorage.removeItem(key);
  if (!state.auth.authorization) return notHere();
  state.data = {};
  await signIn();
  render();
}
function notHere() {
  document.body.replaceChildren(stateScreen('info', 'screen', t('approve.needs_admin_title'), t('pairing.approve_needs_admin_device'), [node('p', 'caption', t('approve.first_admin_hint'))]));
}
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('hashchange', () => render());
openDeviceDb().then(async (db) => {
  const deviceToken = await readKey(db, 'token');
  const bootstrap = sessionStorage.getItem('admin_bootstrap') === '1';
  if (!bootstrap && !deviceToken) return notHere();
  state.auth = bootstrap ? {} : { authorization: 'Bearer ' + deviceToken };
  state.deviceId = bootstrap ? 'hub-admin' : await readKey(db, 'device_id');
  if (!sessionStorage.getItem('admin_session_token')) await signIn();
  render();
});
</script>
</body>
</html>`;
}
