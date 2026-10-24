import { clientPrelude, esc, fieldHtml, iconSvg, pageHead } from '../lib/page.js';
import { EN } from '../lib/strings.js';

export function setupPage(): string {
  return `${pageHead({ title: 'setup.title', theme: 'light' })}
<body class="pos-root">
<main class="pos-page pos-stack">
<header class="pos-stack">
  <h1 class="title">${esc(EN['setup.title'])}</h1>
  <p class="body-lg">${esc(EN['setup.intro'])}</p>
</header>
<form id="setup" class="pos-card pos-stack" novalidate>
${fieldHtml({ id: 'registration_code', label: 'setup.registration_code', help: 'setup.registration_code_help', error: 'setup.registration_code_error', mono: true, attrs: 'autocomplete="off" autocapitalize="characters" spellcheck="false"' })}
${fieldHtml({ id: 'advertised_host', label: 'setup.advertised_host', help: 'setup.advertised_host_help', error: 'setup.advertised_host_error', mono: true, attrs: 'inputmode="decimal" autocomplete="off" spellcheck="false"' })}
${fieldHtml({ id: 'guest_network_cidrs', label: 'setup.guest_network_cidrs', help: 'setup.guest_network_cidrs_help', error: 'setup.guest_network_cidrs_error', mono: true, attrs: 'autocomplete="off" spellcheck="false"' })}
  <div id="setup_status" aria-live="polite"></div>
  <button id="setup_submit" class="pos-btn pos-btn--primary pos-btn--lg pos-btn--block" type="submit">${esc(EN['setup.submit'])}</button>
</form>
<section id="setup_done" class="pos-screen pos-screen--ok" hidden>
  <div class="pos-screen__icon">${iconSvg('check')}</div>
</section>
</main>
<script>
${clientPrelude()}
const FIELDS = ['registration_code', 'advertised_host', 'guest_network_cidrs'];
const form = document.getElementById('setup');
const submit = document.getElementById('setup_submit');
const status = document.getElementById('setup_status');
const done = document.getElementById('setup_done');
function showDone(data) {
  done.appendChild(node('h1', 'pos-screen__title', t('setup.done_title')));
  done.appendChild(node('p', 'pos-screen__body', t('setup.done_body')));
  const qr = node('div', 'pos-code__qr');
  qr.innerHTML = data.first_admin_qr_svg;
  done.appendChild(qr);
  const link = node('a', 'value-mono pos-ltr', data.first_admin_url);
  link.href = data.first_admin_url;
  done.appendChild(link);
  const minutes = Math.max(1, Math.ceil((data.first_admin_expires_at - Date.now()) / 60000));
  done.appendChild(node('p', 'pos-code__meta', t('setup.expires', { min: minutes })));
  form.hidden = true;
  done.hidden = false;
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  for (const name of FIELDS) document.getElementById('field_' + name).classList.remove('pos-field--error');
  status.replaceChildren();
  setBusy(submit, true);
  // A slow call (the cloud can take up to 10 s) gets a calm banner after 3 s.
  const slow = setTimeout(() => status.replaceChildren(banner('warn', t('setup.slow'))), 3000);
  let response;
  let json;
  try {
    response = await fetch('/setup/provision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        registration_code: document.getElementById('registration_code').value,
        advertised_host: document.getElementById('advertised_host').value,
        guest_network_cidrs: document.getElementById('guest_network_cidrs').value.split(',').map((item) => item.trim()).filter(Boolean),
      }),
    });
    json = await response.json();
  } catch {
    response = undefined;
  }
  clearTimeout(slow);
  setBusy(submit, false);
  if (response !== undefined && response.ok && json && json.data) {
    status.replaceChildren();
    showDone(json.data);
    return;
  }
  // No answer at all: the hub or the cloud is unreachable, which reads like SERVICE_UNAVAILABLE.
  const error = (json && json.error) || { code: 'SERVICE_UNAVAILABLE', details: {} };
  const issues = (error.details && error.details.issues) || [];
  for (const issue of issues) {
    if (FIELDS.includes(issue.path)) document.getElementById('field_' + issue.path).classList.add('pos-field--error');
  }
  status.replaceChildren(banner('danger', errorText(error)));
});
</script>
</body>
</html>`;
}
