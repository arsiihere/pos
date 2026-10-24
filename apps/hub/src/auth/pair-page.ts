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
  return `<!doctype html>
<html><body>
<div id="screen"></div>
<script>
${encodeCrockford128.toString()}
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
openDeviceDb().then(async (db) => {
  const deviceToken = await readKey(db, 'token');
  const adminToken = sessionStorage.getItem('admin_session_token');
  if (adminToken) {
    sessionStorage.removeItem('admin_session_token');
    await fetch('/admin/auth/logout', { method: 'POST', headers: { 'x-admin-session': adminToken, authorization: 'Bearer ' + (deviceToken || '') } });
  }
  const pairingToken = new URLSearchParams(location.search).get('t');
  if (!pairingToken) {
    const start = () => {
      screen.textContent = 'Ask a manager to pair this screen';
      fetch('/pair/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_name: 'screen' }),
      }).then(async (res) => {
        const body = await res.json();
        const qr = document.createElement('div');
        qr.innerHTML = body.data.approve_qr_svg;
        const code = document.createElement('p');
        code.className = 'display-code';
        code.textContent = body.data.display_code;
        screen.replaceChildren(qr, code);
        const tick = () => {
          fetch('/pair/requests/' + body.data.request_id, { headers: { 'X-Poll-Secret': body.data.poll_secret } })
            .then(async (polled) => {
              if (polled.status === 404) {
                screen.textContent = 'Ask a manager to pair this screen';
                const again = document.createElement('button');
                again.textContent = 'Ask a manager to pair this screen';
                again.addEventListener('click', start);
                screen.appendChild(again);
                return;
              }
              const update = await polled.json();
              if (update.data && update.data.status === 'approved') {
                await writeKey(db, 'token', update.data.device_token);
                if (update.data.device_type === 'kds') {
                  await fetch('/auth/station', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + update.data.device_token }, body: '{}' });
                }
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
    screen.textContent = 'login';
    return;
  }
  const ios = /iPhone|iPad/.test(navigator.userAgent) && navigator.standalone !== true;
  if (ios) {
    screen.textContent = 'pairing.ios_add_to_home';
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
  const name = window.prompt('device name');
  if (!name) return;
  const send = () => fetch('/devices/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pairing_token: pairingToken, pair_request_id: pairRequestId, device_name: name, device_type: 'phone' }),
  });
  const finish = async (res, retried) => {
    if (res.status === 401) {
      await deleteKey(db, 'pair_request_id');
      screen.textContent = 'pairing.token_expired';
      return;
    }
    if (res.status === 200) {
      const body = await res.json();
      await writeKey(db, 'token', body.data.device_token);
      await deleteKey(db, 'pair_request_id');
      screen.textContent = 'login';
      return;
    }
    if (!retried) finish(await send(), true);
  };
  send().then((res) => finish(res, false), () => send().then((res) => finish(res, true)));
});
</script>
</body></html>`;
}
