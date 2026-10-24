export function setupPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Hub setup</title></head>
<body>
<form id="setup">
  <label>Registration code <input name="registration_code" autocomplete="off"></label>
  <label>Advertised host <input name="advertised_host"></label>
  <label>Guest networks <input name="guest_network_cidrs"></label>
  <button type="submit">Provision</button>
</form>
<script>
document.getElementById('setup').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const response = await fetch('/setup/provision', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      registration_code: form.registration_code.value,
      advertised_host: form.advertised_host.value,
      guest_network_cidrs: form.guest_network_cidrs.value.split(',').map((item) => item.trim()).filter(Boolean),
    }),
  });
  const json = await response.json();
  if (!response.ok) return;
  const link = document.createElement('a');
  link.href = json.data.first_admin_url;
  link.textContent = json.data.first_admin_url;
  document.body.appendChild(link);
  const qr = document.createElement('div');
  qr.innerHTML = json.data.first_admin_qr_svg;
  document.body.appendChild(qr);
});
</script>
</body>
</html>`;
}
