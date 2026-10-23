export function pairPage(): string {
  return `<!doctype html>
<html><body>
<div id="screen"></div>
<script>
const adminToken = sessionStorage.getItem('admin_session_token');
if (adminToken) {
  sessionStorage.removeItem('admin_session_token');
  fetch('/admin/auth/logout', { method: 'POST', headers: { 'x-admin-session': adminToken } });
}
const pairingToken = new URLSearchParams(location.search).get('t');
const screen = document.getElementById('screen');
if (!pairingToken) {
  screen.textContent = 'Ask a manager';
} else {
  const request = indexedDB.open('pos-device');
  request.onsuccess = () => {
    const db = request.result;
    const read = db.transaction('device').objectStore('device').get('token');
    read.onsuccess = () => {
      if (read.result) {
        screen.textContent = 'login';
        return;
      }
      const ios = /iPhone|iPad/.test(navigator.userAgent) && navigator.standalone !== true;
      if (ios) {
        screen.textContent = 'pairing.ios_add_to_home';
        return;
      }
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
      let pairRequestId = '';
      for (const byte of bytes) pairRequestId += alphabet[byte % 32];
      const name = window.prompt('device name');
      fetch('/devices/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pairing_token: pairingToken, pair_request_id: pairRequestId, device_name: name, device_type: 'phone' }),
      }).then(async (res) => {
        if (res.status === 401) screen.textContent = 'pairing.token_expired';
        if (res.status === 200) {
          const body = await res.json();
          db.transaction('device', 'readwrite').objectStore('device').put(body.data.device_token, 'token');
        }
      });
    };
  };
}
</script>
</body></html>`;
}
