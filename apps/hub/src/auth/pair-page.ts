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

export function pairPage(): string {
  return `${pageHead({ title: 'pair.title', theme: 'dark' })}
<body class="pos-root">
<div id="pair_status" class="pos-page" aria-live="polite" hidden></div>
<div id="screen" class="pos-screen"></div>
<script>
${encodeCrockford128.toString()}
${clientPrelude()}
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
// One full-screen state: icon, title, body and any extra nodes (code, button, form).
function show(kind, iconName, title, body, extra) {
  screen.className = 'pos-screen' + (kind ? ' pos-screen--' + kind : '');
  const parts = [];
  if (iconName) {
    const mark = node('div', 'pos-screen__icon');
    mark.appendChild(icon(iconName));
    parts.push(mark);
  }
  parts.push(node('h1', 'pos-screen__title', title));
  if (body) parts.push(node('p', 'pos-screen__body', body));
  screen.replaceChildren(...parts, ...(extra || []));
}
function showPaired() {
  show('ok', 'check', t('pairing.paired_title'), t('pairing.paired_body'));
}
// §8.4: a hub that is down (power loss, boot) is retried with backoff capped at 5 s, never silently dropped.
const status = document.getElementById('pair_status');
status.hidden = true;
let hubDown = false;
function setHubDown(down) {
  if (down === hubDown) return;
  hubDown = down;
  if (down) {
    const notice = banner('info', t('pairing.hub_unreachable'), t('pairing.hub_unreachable_body'));
    notice.classList.add('pos-banner--pulse');
    status.replaceChildren(notice);
  } else {
    status.replaceChildren();
  }
  status.hidden = !down;
}
async function fetchRetry(url, init) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch(url, init);
      setHubDown(false);
      return res;
    } catch {
      setHubDown(true);
      await new Promise((resolve) => setTimeout(resolve, Math.min(500 * 2 ** attempt, 5000)));
    }
  }
}
async function resumePaired(db, deviceToken) {
  const deviceType = await readKey(db, 'device_type');
  if (deviceType === 'kds') {
    const res = await fetchRetry('/auth/station', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + deviceToken }, body: '{}' });
    if (res.status === 401 || res.status === 403) {
      await deleteKey(db, 'token');
      await deleteKey(db, 'device_id');
      await deleteKey(db, 'device_type');
      return false;
    }
  }
  showPaired();
  return true;
}
function askAgain(start, body) {
  const again = node('button', 'pos-btn pos-btn--primary pos-btn--lg', t('pairing.new_code'));
  again.type = 'button';
  again.addEventListener('click', start);
  show('', 'screen', t('pairing.ask_manager'), body, [again]);
}
openDeviceDb().then(async (db) => {
  const deviceToken = await readKey(db, 'token');
  const adminToken = sessionStorage.getItem('admin_session_token');
  if (adminToken) {
    sessionStorage.removeItem('admin_session_token');
    await fetch('/admin/auth/logout', { method: 'POST', headers: { 'x-admin-session': adminToken, authorization: 'Bearer ' + (deviceToken || '') } });
  }
  const pairingToken = new URLSearchParams(location.search).get('t');
  if (!pairingToken) {
    if (deviceToken && (await resumePaired(db, deviceToken))) return;
    let retried = false;
    const start = () => {
      show('', 'screen', t('pairing.ask_manager'), t('pairing.asking'));
      fetchRetry('/pair/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_name: 'screen' }),
      }).then(async (res) => {
        const body = await res.json();
        if ((res.status === 429 || res.status === 503) && !retried) {
          retried = true;
          setTimeout(start, body.error.details.retry_after_ms);
          return;
        }
        if (res.status !== 200) {
          askAgain(start, errorText(body.error));
          return;
        }
        const code = node('div', 'pos-code');
        const qr = node('div', 'pos-code__qr');
        qr.innerHTML = body.data.approve_qr_svg;
        code.appendChild(qr);
        code.appendChild(node('p', 'pos-code__value display-code', body.data.display_code));
        code.appendChild(node('p', 'pos-code__meta', t('pairing.code_help')));
        const minutes = Math.ceil((body.data.expires_at - Date.now()) / 60000);
        if (minutes > 0) code.appendChild(node('p', 'pos-code__meta', t('pairing.expires', { min: minutes })));
        show('', '', t('pairing.ask_manager'), '', [code]);
        const tick = () => {
          fetchRetry('/pair/requests/' + body.data.request_id, { headers: { 'X-Poll-Secret': body.data.poll_secret } })
            .then(async (polled) => {
              if (polled.status === 404) {
                askAgain(start, t('pairing.code_expired'));
                return;
              }
              const update = await polled.json();
              if (update.data && update.data.status === 'approved') {
                await writeKey(db, 'token', update.data.device_token);
                await writeKey(db, 'device_id', update.data.device_id);
                await writeKey(db, 'device_type', update.data.device_type);
                if (update.data.device_type === 'kds') {
                  await fetchRetry('/auth/station', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + update.data.device_token }, body: '{}' });
                }
                showPaired();
                return;
              }
              setTimeout(tick, 2000);
            });
        };
        setTimeout(tick, 2000);
      });
    };
    start();
    return;
  }
  if (deviceToken) {
    showPaired();
    return;
  }
  const ios = /iPhone|iPad/.test(navigator.userAgent) && navigator.standalone !== true;
  if (ios) {
    const steps = node('ol', 'pos-stack');
    for (const [iconName, key] of [['share', 'pairing.ios_step_share'], ['add-home', 'pairing.ios_step_add'], ['phone', 'pairing.ios_step_open']]) {
      const step = node('li', 'pos-row body-lg');
      step.appendChild(icon(iconName));
      step.appendChild(node('span', '', t(key)));
      steps.appendChild(step);
    }
    show('info', 'add-home', t('pairing.ios_add_to_home'), t('pairing.ios_body'), [steps]);
    return;
  }
  let pairRequestId = await new Promise((resolve) => {
    const read = db.transaction('device').objectStore('device').get('pair_request_id');
    read.onsuccess = () => resolve(read.result);
    read.onerror = () => resolve(undefined);
  });
  if (!pairRequestId) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    pairRequestId = encodeCrockford128(bytes);
    await writeKey(db, 'pair_request_id', pairRequestId);
  }
  // M82: the device name is a page field (1–40 characters), not a browser dialog.
  const form = node('form', 'pos-card pos-stack');
  const nameField = node('div', 'pos-field');
  const label = node('label', 'pos-field__label', t('pairing.name_label'));
  label.setAttribute('for', 'device_name');
  const nameInput = node('input', 'pos-input');
  nameInput.name = 'device_name';
  nameInput.id = 'device_name';
  nameInput.autocomplete = 'off';
  nameInput.setAttribute('maxlength', '40');
  const nameError = node('p', 'pos-field__error');
  nameError.appendChild(icon('alert'));
  nameError.appendChild(node('span', '', t('pairing.name_error')));
  nameField.appendChild(label);
  nameField.appendChild(nameInput);
  nameField.appendChild(node('p', 'pos-field__help', t('pairing.name_help')));
  nameField.appendChild(nameError);
  form.appendChild(node('h1', 'title', t('pairing.name_title')));
  form.appendChild(nameField);
  const formStatus = node('div');
  form.appendChild(formStatus);
  const submit = node('button', 'pos-btn pos-btn--primary pos-btn--lg pos-btn--block', t('pairing.name_submit'));
  submit.type = 'submit';
  form.appendChild(submit);
  screen.className = 'pos-screen';
  screen.replaceChildren(form);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    nameField.classList.toggle('pos-field--error', name.length === 0 || name.length > 40);
    formStatus.replaceChildren();
    if (name.length === 0 || name.length > 40) return;
    setBusy(submit, true);
    const send = () => fetch('/devices/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairing_token: pairingToken, pair_request_id: pairRequestId, device_name: name, device_type: 'phone' }),
    });
    const failed = (error) => {
      setBusy(submit, false);
      formStatus.replaceChildren(banner('danger', errorText(error)));
    };
    const finish = async (res, retried) => {
      if (res.status === 401) {
        await deleteKey(db, 'pair_request_id');
        show('warn', 'clock', t('pairing.token_expired'), t('pairing.token_expired_body'));
        return;
      }
      if (res.status === 200) {
        const body = await res.json();
        await writeKey(db, 'token', body.data.device_token);
        await writeKey(db, 'device_id', body.data.device_id);
        await writeKey(db, 'device_type', body.data.device_type);
        await deleteKey(db, 'pair_request_id');
        showPaired();
        return;
      }
      if (!retried) {
        finish(await send(), true);
        return;
      }
      const body = await res.json().catch(() => ({}));
      failed(body.error);
    };
    // M14: a lost response is retried once with the same pair_request_id.
    send().then(
      (res) => finish(res, false),
      () => send().then((res) => finish(res, true), () => failed({ code: 'SERVICE_UNAVAILABLE' })),
    );
  });
});
</script>
</body>
</html>`;
}
