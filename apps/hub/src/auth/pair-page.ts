import type { FastifyInstance } from 'fastify';
import { globalStateClient } from '../lib/global-state.js';
import { clientPrelude, pageHead } from '../lib/page.js';

export function encodeCrockford128(bytes: Uint8Array): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  const padded = bits << BigInt(130 - bytes.length * 8);
  let out = '';
  for (let i = 0; i < 26; i += 1) {
    out += alphabet[Number((padded >> BigInt((25 - i) * 5)) & 31n)];
  }
  return out;
}

// 00-S10 … 00-S15 (docs/design/handoff/00/00-design.md §1): every device asks to be paired by request (05a H-1:
// the phone / tablet token branch ?t= / &d= is removed). Rules: §8.2 "Kiosk and KDS pairing".
// 05a §6.1: a default for the approval form only. iPadOS reports a desktop agent and Android tablets omit `Mobile`,
// so those requests carry no hint.
export function hardwareHintFor(userAgent: string): 'phone' | null {
  return /iPhone|Android.*Mobile/.test(userAgent) ? 'phone' : null;
}

export function pairPage(): string {
  return `${pageHead({ title: 'pairing.title', theme: 'dark' })}
<body class="pos-root">
<div id="pair_status" class="pos-pair__status" aria-live="polite" hidden></div>
<div id="screen" class="pos-page"></div>
<script>
${encodeCrockford128.toString()}
${hardwareHintFor.toString()}
${clientPrelude()}
${globalStateClient()}
function openDeviceDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pos-device', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('device')) db.createObjectStore('device');
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
function writeKey(db, key, value) {
  return new Promise((resolve) => {
    const write = db.transaction('device', 'readwrite').objectStore('device').put(value, key);
    write.onsuccess = () => resolve();
    write.onerror = () => resolve();
  });
}
function deleteKey(db, key) {
  return new Promise((resolve) => {
    const removal = db.transaction('device', 'readwrite').objectStore('device').delete(key);
    removal.onsuccess = () => resolve();
    removal.onerror = () => resolve();
  });
}
// 05b H-2 (M-3, N-9): the page inside the tablet app. The page never imports Capacitor; it reads the bridge.
function posNative() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : undefined;
  if (!cap || typeof cap.isNativePlatform !== 'function' || cap.isNativePlatform() !== true) return null;
  return (cap.Plugins && cap.Plugins.PosNative) || null;
}
const NOT_TABLET = 'NOT_TABLET';
const NOT_TABLET_TEXT = 'Approve this tablet as a Tablet';
// Hands the page's keys to native (its copy for the alert service). Resolves null when accepted, or when the bridge
// fails for another reason (the page keys stand; native recovers its copy on a later load); the refusal's text
// when native refuses a non-tablet approval (NOT_TABLET).
async function giveNativeKeys(native, keys) {
  try {
    await native.setDeviceToken(keys);
    return null;
  } catch (error) {
    if (!error || error.code !== NOT_TABLET) return null;
    return error.message || NOT_TABLET_TEXT;
  }
}
async function wipeDeviceKeys(db) {
  await deleteKey(db, 'token');
  await deleteKey(db, 'device_id');
  await deleteKey(db, 'device_type');
}
const screen = document.getElementById('screen');
const status = document.getElementById('pair_status');
// Kitchen-size screens (1920 wide) get the wall size: QR 320, code 112, title 60, button 88 (frames Pair*, 00-F02 Kds).
const WALL = typeof window !== 'undefined' && window.innerWidth >= 1920;
function show(...parts) {
  for (const part of parts) {
    if (!part.classList.contains('pos-screen')) continue;
    if (WALL) part.classList.add('pos-screen--wall');
    // 00-F01 on a screen state: the banner sits under the code (frame PairHubDown).
    part.appendChild(status);
  }
  screen.replaceChildren(...parts);
}
function actionRow(button) {
  const row = node('div', 'pos-row pos-row--center');
  row.appendChild(button);
  return row;
}
// 00-F01 on /pair: a calm banner over what is on screen; the code keeps working (§8.4 backoff to 5 s).
let hubDown = false;
function setHubDown(down, bodyKey) {
  if (down === hubDown) return;
  hubDown = down;
  if (down) {
    const notice = banner('warn', t('pairing.hub_unreachable'), t(bodyKey || 'pairing.hub_unreachable_body'), '', 'sync');
    notice.classList.add('pos-banner--pulse');
    status.replaceChildren(notice);
  } else {
    status.replaceChildren();
  }
  status.hidden = !down;
}
async function fetchRetry(url, init, bodyKey) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch(url, init);
      setHubDown(false);
      return res;
    } catch {
      setHubDown(true, bodyKey);
      await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs(attempt)));
    }
  }
}
async function json(res) {
  try { return (await res.json()) || {}; } catch { return {}; }
}
function global(error, device) {
  return globalScreen(error, { device, loaded: false, authed: false }, { pairAgain: () => location.reload(), wall: WALL });
}
// 00 v1.9.1 §8.2 (Q-13, Q-29): every non-KDS device goes on to the staff entry (01d) once the success screen
// has been seen. 00 v1.9.2 §8.2 (Q-42): a KDS goes on to the KDS entry (03b), which signs in as its station
// itself, so one page owns the station session (M53); this page never does.
const STAFF_ENTRY = '/staff/';
const KDS_ENTRY = '/kds/';
const ENTRY_AFTER_MS = 1500;
function openStaffEntry() {
  setTimeout(() => location.assign(STAFF_ENTRY), ENTRY_AFTER_MS);
}
function openKdsEntry() {
  setTimeout(() => location.assign(KDS_ENTRY), ENTRY_AFTER_MS);
}
// 00-S10 approved / resumed.
function showPaired(deviceType, stationName) {
  // M92: the approved poll names the station; a resumed screen does not know it.
  const kds = stationName ? t('pairing.approved_body', { station: stationName }) : t('pairing.approved_body_kds');
  const body = deviceType === 'kds' ? kds : t('pairing.approved_body_cashier');
  show(stateScreen('ok', 'check', t('pairing.approved_title'), body));
  if (deviceType === 'kds') openKdsEntry();
  else openStaffEntry();
}
// A stored token: no new request and no hub call here; the entry's own requests meet a revoked token (§8.4).
// 05b N-9: inside the app native gets the stored keys first, so it recovers its copy.
async function resumePaired(db) {
  const deviceType = await readKey(db, 'device_type');
  const native = posNative();
  if (native) {
    const refused = await giveNativeKeys(native, { token: await readKey(db, 'token'), device_id: await readKey(db, 'device_id'), device_type: deviceType });
    if (refused) {
      await wipeDeviceKeys(db);
      pairNotice = refused;
      return pairScreen(db);
    }
  }
  showPaired(deviceType);
}
// 00-S11: expired (warn, clock), too many (danger, lock), hub busy (warn, sync); the 72 px button (88 on the wall) asks again.
function askAgain(start, body, waitMs, kind, iconName) {
  const again = node('button', 'pos-btn pos-btn--primary pos-btn--lg pos-pair__again');
  again.type = 'button';
  again.addEventListener('click', start);
  const label = () => again.replaceChildren(icon('reload'), document.createTextNode(t('pairing.new_code')));
  label();
  show(stateScreen(kind || 'warn', iconName || 'alert', t('pairing.title'), body, [actionRow(again)]));
  if (waitMs > 0) {
    const until = Date.now() + waitMs;
    again.disabled = true;
    const parts = T['pairing.new_code_in'].split('{time}');
    const tick = () => {
      const left = until - Date.now();
      if (left <= 0) {
        again.disabled = false;
        label();
        return;
      }
      again.replaceChildren(document.createTextNode(parts[0]), ltr(mmss(left)), document.createTextNode(parts[1] || ''));
      setTimeout(tick, 1000);
    };
    tick();
  }
}
// 05b M-3: native refused the last approval; its text stays over the new code.
let pairNotice = '';
function pairScreen(db) {
  let retried = false;
  // 05b H-2 / N-9: inside the app always 'tablet', whatever the query; ?hint=tablet is the same signal.
  const tabletHint = posNative() !== null || new URLSearchParams(location.search).get('hint') === 'tablet';
  const hint = tabletHint ? 'tablet' : hardwareHintFor(navigator.userAgent);
  const start = () => {
    show(stateScreen('info', 'sync', t('pairing.starting'), t('pairing.starting_body')));
    fetchRetry('/pair/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(hint ? { device_name: 'screen', hardware_hint: hint } : { device_name: 'screen' }),
    }).then(async (res) => {
      const body = await json(res);
      const error = body.error || {};
      const details = error.details || {};
      if (res.status === 503 && !retried) {
        retried = true;
        setTimeout(start, Math.min(details.retry_after_ms || 1000, 5000));
        return;
      }
      if (res.status !== 200) {
        if (global(error, 'screen')) return;
        if (error.code === 'IP_LOCKED_OUT') return askAgain(start, t('pairing.too_many', { min: Math.max(1, Math.ceil((details.retry_after_ms || 0) / 60000)) }), details.retry_after_ms || 0, 'danger', 'lock');
        return res.status === 503 ? askAgain(start, t('pairing.hub_busy'), 0, 'warn', 'sync') : askAgain(start, errorText(error), 0, 'warn', 'alert');
      }
      retried = false;
      const data = body.data;
      const code = node('div', 'pos-code');
      const qr = node('div', 'pos-code__qr');
      qr.innerHTML = data.approve_qr_svg;
      code.appendChild(qr);
      const value = node('div', 'pos-code__value display-code', data.display_code);
      value.setAttribute('aria-label', t('pairing.code_aria'));
      code.appendChild(value);
      const meta = node('p', 'pos-code__meta');
      code.appendChild(meta);
      const waiting = node('main', 'pos-screen pos-pair');
      if (pairNotice) waiting.appendChild(banner('danger', pairNotice, '', '', 'alert'));
      waiting.appendChild(node('h1', 'pos-screen__title', t('pairing.title')));
      waiting.appendChild(node('p', 'pos-screen__body', t('pairing.how')));
      waiting.appendChild(code);
      show(waiting);
      let live = true;
      const countdown = () => {
        if (!live) return;
        const left = data.expires_at - Date.now();
        const parts = T['pairing.expires_in'].split('{time}');
        meta.replaceChildren(icon('clock'), document.createTextNode(parts[0]), ltr(mmss(left)), document.createTextNode(parts[1] || ''));
        if (left > 0) setTimeout(countdown, 1000);
      };
      countdown();
      const tick = () => {
        fetchRetry('/pair/requests/' + data.request_id, { headers: { 'X-Poll-Secret': data.poll_secret } }).then(async (polled) => {
          if (polled.status === 404) {
            live = false;
            askAgain(start, t('pairing.code_expired'), 0, 'warn', 'clock');
            return;
          }
          const update = await json(polled);
          if (update.data && update.data.status === 'approved') {
            live = false;
            await writeKey(db, 'token', update.data.device_token);
            await writeKey(db, 'device_id', update.data.device_id);
            await writeKey(db, 'device_type', update.data.device_type);
            const native = posNative();
            if (native) {
              const refused = await giveNativeKeys(native, { token: update.data.device_token, device_id: update.data.device_id, device_type: update.data.device_type });
              if (refused) {
                await wipeDeviceKeys(db);
                pairNotice = refused;
                start();
                return;
              }
            }
            showPaired(update.data.device_type, update.data.station_name);
            return;
          }
          if (polled.status !== 200 && global(update.error, 'screen')) return;
          setTimeout(tick, 2000);
        });
      };
      setTimeout(tick, 2000);
    });
  };
  start();
}
// 00-S13: iOS Safari outside the Home Screen app never pairs (00 §8.2 rule 2). 05a §8: shown first, the request
// follows from the Home Screen app.
function iosSteps() {
  const page = node('main', 'pos-content pos-phonepair pos-phonepair--ios');
  const head = node('div', 'pos-phonepair__head');
  head.appendChild(node('h1', 'title', t('pairing.ios_title')));
  head.appendChild(node('p', 'body', t('pairing.ios_body')));
  page.appendChild(head);
  const list = node('ol', 'pos-checklist');
  [['1', 'share', 'pairing.ios_step_1'], ['2', 'add-home', 'pairing.ios_step_2'], ['3', 'phone', 'pairing.ios_step_3']].forEach(([n, iconName, key]) => {
    const item = node('li', 'pos-checklist__item');
    item.appendChild(node('span', 'pos-checklist__num', n));
    item.appendChild(node('span', 'body pos-phonepair__step', t(key)));
    const mark = node('span', 'pos-callout__icon pos-phonepair__mark');
    mark.appendChild(icon(iconName));
    item.appendChild(mark);
    list.appendChild(item);
  });
  page.appendChild(list);
  show(page);
}
function needsHomeScreen() {
  if (!/iPhone|iPad|iPod/.test(navigator.userAgent)) return false;
  const standalone = navigator.standalone === true || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  return !standalone;
}
openDeviceDb().then(async (db) => {
  const deviceToken = await readKey(db, 'token');
  // M43: an admin session in this tab is ended before pairing.
  const adminToken = sessionStorage.getItem('admin_session_token');
  if (adminToken) {
    sessionStorage.removeItem('admin_session_token');
    await fetch('/admin/auth/logout', { method: 'POST', headers: { 'x-admin-session': adminToken, authorization: 'Bearer ' + (deviceToken || '') } });
  }
  // 05a H-1: one flow for every device; an old token link (?t=, &d=) is read as a plain /pair.
  // Kiosk and kitchen screens fit the screen: no page scroll, no scrollbars.
  screen.classList.add('pos-page--fit');
  if (deviceToken) return await resumePaired(db);
  // 05a §8: iOS keeps "Add to Home Screen" first; the request is made from the Home Screen app.
  if (needsHomeScreen()) return iosSteps();
  return pairScreen(db);
});
</script>
</body>
</html>`;
}

// 00 §8.2: the pair page. 05a H-1: `POST /devices/pair` and its module (`auth/pairing.ts`) are removed; only the page stays.
export function registerPairPage(app: FastifyInstance): void {
  app.get('/pair', { config: { group: 'pair' } }, async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(pairPage());
  });
}
