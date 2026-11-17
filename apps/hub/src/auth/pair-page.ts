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

// 00-S10 … 00-S15 (docs/design/handoff/00/00-design.md §1): a kiosk or kitchen screen asks to be paired (no t), or a
// phone pairs with its manager's QR (?t=). Rules: §8.2 "Kiosk and KDS pairing" and "Pair page rules (phones)".
export function pairPage(): string {
  return `${pageHead({ title: 'pairing.title', theme: 'dark' })}
<body class="pos-root">
<div id="pair_status" class="pos-pair__status" aria-live="polite" hidden></div>
<div id="screen" class="pos-page"></div>
<script>
${encodeCrockford128.toString()}
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
    const del = db.transaction('device', 'readwrite').objectStore('device').delete(key);
    del.onsuccess = () => resolve();
    del.onerror = () => resolve();
  });
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
async function resumePaired(db) {
  showPaired(await readKey(db, 'device_type'));
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
function pairScreen(db) {
  let retried = false;
  const start = () => {
    show(stateScreen('info', 'sync', t('pairing.starting'), t('pairing.starting_body')));
    fetchRetry('/pair/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_name: 'screen' }),
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
// 00-S13: iOS Safari outside the Home Screen app never pairs (§8.2 phone rule 2).
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
  page.appendChild(banner('info', t('pairing.ios_link_time'), '', '', 'clock'));
  show(page);
}
function tokenExpired(standaloneIos) {
  show(stateScreen('danger', 'clock', t('pairing.token_expired'), t(standaloneIos ? 'pairing.token_expired_ios' : 'pairing.token_expired_body')));
}
// 00-S12: name the phone, then POST /devices/pair with one pair_request_id per pairing (M14, M60).
async function pairPhone(db, pairingToken) {
  const standaloneIos = /iPhone|iPad/.test(navigator.userAgent);
  let pairRequestId = await readKey(db, 'pair_request_id');
  if (!pairRequestId) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    pairRequestId = encodeCrockford128(bytes);
    await writeKey(db, 'pair_request_id', pairRequestId);
  }
  const page = node('main', 'pos-content pos-phonepair');
  // 00-F01: the hub-down banner sits above the title (frame PhoneHubDown).
  page.appendChild(status);
  const head = node('div', 'pos-phonepair__head');
  head.appendChild(node('p', 'caption', t('app.brand')));
  head.appendChild(node('h1', 'title', t('pairing.phone_title')));
  head.appendChild(node('p', 'body', t('pairing.phone_intro')));
  page.appendChild(head);
  const form = node('form', 'pos-card pos-phonepair__card');
  const nameField = node('div', 'pos-field');
  const label = node('label', 'pos-field__label', t('pairing.name_label'));
  label.setAttribute('for', 'device_name');
  const nameInput = node('input', 'pos-input');
  nameInput.name = 'device_name';
  nameInput.id = 'device_name';
  nameInput.autocomplete = 'off';
  nameInput.setAttribute('maxlength', '40');
  nameInput.setAttribute('enterkeyhint', 'done');
  const nameError = node('p', 'pos-field__error');
  nameError.appendChild(icon('alert'));
  nameError.appendChild(node('span', '', t('pairing.name_error')));
  nameField.appendChild(label);
  nameField.appendChild(nameInput);
  nameField.appendChild(nameError);
  nameField.appendChild(node('p', 'pos-field__help', t('pairing.name_help')));
  form.appendChild(nameField);
  const formStatus = node('div', 'pos-phonepair__status');
  form.appendChild(formStatus);
  const submit = node('button', 'pos-btn pos-btn--primary pos-btn--lg pos-btn--block');
  submit.type = 'submit';
  submit.appendChild(icon('phone'));
  const submitText = node('span', '', t('pairing.submit'));
  submit.appendChild(submitText);
  form.appendChild(submit);
  page.appendChild(form);
  page.appendChild(node('p', 'caption pos-phonepair__note', t('pairing.only_you')));
  show(page);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    nameField.classList.toggle('pos-field--error', name.length === 0 || name.length > 40);
    formStatus.replaceChildren();
    if (name.length === 0 || name.length > 40 || submit.disabled) return;
    setBusy(submit, true);
    submitText.textContent = t('pairing.busy');
    const send = () => fetchRetry('/devices/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairing_token: pairingToken, pair_request_id: pairRequestId, device_name: name, device_type: 'phone' }),
    }, 'pairing.phone_hub_down_body');
    const finish = async (res, retried) => {
      if (res.status === 401) {
        await deleteKey(db, 'pair_request_id');
        return tokenExpired(standaloneIos);
      }
      const body = await json(res);
      if (res.status === 200) {
        await writeKey(db, 'token', body.data.device_token);
        await writeKey(db, 'device_id', body.data.device_id);
        await writeKey(db, 'device_type', body.data.device_type);
        await deleteKey(db, 'pair_request_id');
        const who = body.data.owner_name ? t('pairing.paired_body', { owner: body.data.owner_name }) : t('pairing.paired_body_any');
        show(stateScreen('ok', 'check', t('pairing.paired_title'), who));
        return openStaffEntry();
      }
      // M14: a 503 is retried once with the same pair_request_id.
      if (res.status === 503 && !retried) return finish(await send(), true);
      setBusy(submit, false);
      submitText.textContent = t('pairing.submit');
      if (global(body.error, 'phone')) return;
      formStatus.replaceChildren(banner('danger', errorText(body.error)));
    };
    send().then((res) => finish(res, false));
  });
}
openDeviceDb().then(async (db) => {
  const deviceToken = await readKey(db, 'token');
  // M43: an admin session in this tab is ended before pairing.
  const adminToken = sessionStorage.getItem('admin_session_token');
  if (adminToken) {
    sessionStorage.removeItem('admin_session_token');
    await fetch('/admin/auth/logout', { method: 'POST', headers: { 'x-admin-session': adminToken, authorization: 'Bearer ' + (deviceToken || '') } });
  }
  const pairingToken = new URLSearchParams(location.search).get('t');
  if (!pairingToken) {
    // Kiosk and kitchen screens fit the screen: no page scroll, no scrollbars.
    screen.classList.add('pos-page--fit');
    if (deviceToken) return await resumePaired(db);
    return pairScreen(db);
  }
  // Phones use the light floor theme (frames Phone*); /pair is served dark for screens (M82).
  if (document.documentElement && document.documentElement.setAttribute) document.documentElement.setAttribute('data-theme', 'light');
  // Phone rule 1: already paired → the token in the URL is ignored; on to the staff entry (00 v1.9.1, Q-29).
  if (deviceToken) {
    show(stateScreen('ok', 'check', t('pairing.paired_title'), t('pairing.paired_body_any')));
    return openStaffEntry();
  }
  if (/iPhone|iPad/.test(navigator.userAgent) && navigator.standalone !== true) return iosSteps();
  pairPhone(db, pairingToken);
});
</script>
</body>
</html>`;
}
