import { globalStateClient } from '../lib/global-state.js';
import type { HostChoice } from '../lib/net.js';
import { clientPrelude, fieldHtml, iconSvg, pageHead, scriptJson, tag } from '../lib/page.js';

// 00-S01 / 00-S02 (docs/design/handoff/00/00-design.md §1): setup form, then the first-admin link while the hub
// restarts. M85: the host field is a pick-list of this machine's addresses with a typed fallback.
export function setupPage(choices: HostChoice[] = []): string {
  const steps = (['1', '2', '3'] as const)
    .map(
      (n) => `<li class="pos-checklist__item"><span class="pos-checklist__num">${n}</span><div class="pos-list__name">${tag('strong', '', `setup.next_${n}`)}${tag('span', '', `setup.next_${n}_sub`)}</div><span></span></li>`,
    )
    .join('');
  return `${pageHead({ title: 'setup.title', theme: 'light' })}
<body class="pos-root">
<div class="pos-page" id="screen">
<header class="pos-appbar">
  <div class="pos-sidenav__brand">${tag('strong', '', 'app.brand')}${tag('span', '', 'setup.brand_sub')}</div>
  <div class="pos-appbar__end"><span class="pos-chip">${iconSvg('screen')}<span class="pos-ltr" id="setup_host"></span></span></div>
</header>
<div id="setup_offline"></div>
<main class="pos-content pos-content--narrow">
<div class="pos-split">
<form id="setup" class="pos-card pos-stack" novalidate>
  <div class="pos-stack">${tag('h1', 'title', 'setup.title')}${tag('p', 'body', 'setup.intro')}</div>
${fieldHtml({ id: 'registration_code', label: 'setup.code_label', help: 'setup.code_help', error: 'setup.err_code', code: true, attrs: 'autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="14"' })}
  <div class="pos-field" id="field_advertised_host">
    ${tag('span', 'pos-field__label', 'setup.host_label')}
    <div class="pos-tiles pos-tiles--pick" id="host_tiles" role="group"></div>
    <input class="pos-input pos-input--mono" id="advertised_host" name="advertised_host" inputmode="decimal" autocomplete="off" spellcheck="false" aria-describedby="advertised_host_help advertised_host_error">
    ${tag('p', 'pos-field__help', 'setup.host_help', 'id="advertised_host_help"')}
    <p class="pos-field__error" id="advertised_host_error">${iconSvg('alert')}${tag('span', '', 'setup.err_host')}</p>
  </div>
${fieldHtml({ id: 'guest_network_cidrs', label: 'setup.cidr_label', help: 'setup.cidr_help', error: 'setup.err_cidr', mono: true, attrs: 'autocomplete="off" spellcheck="false"' })}
  ${tag('button', 'pos-btn pos-btn--primary pos-btn--lg pos-btn--block', 'setup.submit', 'id="setup_submit" type="submit"')}
  <div id="setup_status" aria-live="polite"></div>
</form>
<aside class="pos-stack">${tag('h2', 'heading', 'setup.next_title')}<ol class="pos-checklist">${steps}</ol></aside>
</div>
</main>
</div>
<section id="setup_done" hidden></section>
<script>
${clientPrelude()}
${globalStateClient()}
const CHOICES = ${scriptJson(choices)};
const FIELDS = ['registration_code', 'advertised_host', 'guest_network_cidrs'];
const page = document.getElementById('screen');
const form = document.getElementById('setup');
const submit = document.getElementById('setup_submit');
const status = document.getElementById('setup_status');
const offline = document.getElementById('setup_offline');
const done = document.getElementById('setup_done');
const host = document.getElementById('advertised_host');
const tilesBox = document.getElementById('host_tiles');
document.getElementById('setup_host').textContent = location.host || '';
// M85: one tile per address, "Other address" reveals the typed field; Ethernet is preselected.
const tiles = [];
function pickTile(tile, value) {
  for (const other of tiles) other.setAttribute('aria-pressed', other === tile ? 'true' : 'false');
  host.hidden = value !== null;
  host.value = value === null ? '' : value;
  if (value === null && host.focus) host.focus();
}
function addTile(label, sub, value) {
  const tile = node('button', 'pos-tile');
  tile.type = 'button';
  tile.appendChild(node('span', 'pos-ltr', label));
  if (sub) tile.appendChild(node('small', '', sub));
  tile.addEventListener('click', () => pickTile(tile, value));
  tiles.push(tile);
  tilesBox.appendChild(tile);
  return tile;
}
for (const choice of CHOICES) {
  addTile(choice.address, choice.kind === 'cable' ? t('setup.host_cable') : choice.kind === 'wifi' ? t('setup.host_wifi') : choice.name, choice.address);
}
const other = addTile(t('setup.host_other'), '', null);
if (CHOICES.length > 0) pickTile(tiles[0], CHOICES[0].address);
else {
  tilesBox.hidden = true;
  pickTile(other, null);
}
function cidrs() {
  return document.getElementById('guest_network_cidrs').value.split(',').map((item) => item.trim()).filter(Boolean);
}
// 00-S02: QR and link; poll the hub until it is back (restarting → ready); expired after first_admin_expires_at.
function showDone(data) {
  const chipRow = node('div', 'pos-row');
  chipRow.style.justifyContent = 'center';
  const code = node('div', 'pos-code');
  const qr = node('div', 'pos-code__qr');
  qr.innerHTML = data.first_admin_qr_svg;
  code.appendChild(qr);
  code.appendChild(node('p', 'pos-mono-wrap', data.first_admin_url));
  const meta = node('p', 'pos-code__meta');
  const parts = T['setup.link_meta'].split('{time}');
  meta.appendChild(document.createTextNode(parts[0]));
  meta.appendChild(ltr(hhmm(data.first_admin_expires_at)));
  meta.appendChild(document.createTextNode(parts[1] || ''));
  code.appendChild(meta);
  const actionRow = node('div', 'pos-row');
  actionRow.style.justifyContent = 'center';
  const wait = node('button', 'pos-btn pos-btn--lg', t('setup.wait_restart'));
  wait.type = 'button';
  wait.disabled = true;
  chipRow.appendChild(chip('warn', 'sync', t('setup.restarting')));
  actionRow.appendChild(wait);
  const screen = stateScreen('ok', 'check', t('setup.done_title'), t('setup.done_body'), [chipRow, code, actionRow]);
  done.replaceChildren(screen);
  page.hidden = true;
  done.hidden = false;
  const ready = () => {
    chipRow.replaceChildren(chip('ok', 'check', t('setup.ready')));
    const open = node('a', 'pos-btn pos-btn--primary pos-btn--lg', t('setup.open_here'));
    open.href = data.first_admin_url;
    actionRow.replaceChildren(open);
  };
  const expire = () => {
    const box = node('div', 'pos-code');
    box.appendChild(node('div', 'pos-code__qr pos-code__qr--void', t('setup.qr_expired')));
    box.appendChild(node('p', 'pos-mono-wrap', data.first_admin_url));
    const cli = node('p', 'pos-code__meta', t('setup.link_cli') + ' ');
    const command = node('span', 'pos-ltr');
    command.appendChild(node('code', 'value-mono', 'issue-admin-bootstrap'));
    cli.appendChild(command);
    box.appendChild(cli);
    const row = node('div', 'pos-row');
    row.style.justifyContent = 'center';
    row.appendChild(chip('danger', 'clock', t('setup.link_expired_title')));
    done.replaceChildren(stateScreen('danger', 'alert', t('setup.link_expired_title'), t('setup.link_expired_body'), [row, box]));
  };
  const health = new URL(data.first_admin_url).origin + '/health';
  // The old process may still answer for a moment: ready after a failure, or after 20 answers in a row.
  let sawDown = false;
  let answers = 0;
  // One 1 s loop: poll until ready, then only watch the expiry.
  let isReady = false;
  const poll = async () => {
    if (Date.now() >= data.first_admin_expires_at) return expire();
    if (!isReady) {
      try {
        await fetch(health, { mode: 'no-cors', cache: 'no-store' });
        answers += 1;
        if (sawDown || answers >= 20) {
          isReady = true;
          ready();
        }
      } catch {
        sawDown = true;
        answers = 0;
      }
    }
    setTimeout(poll, 1000);
  };
  setTimeout(poll, 1000);
}
function setOffline(on) {
  submit.disabled = on;
  if (!on) return offline.replaceChildren();
  const box = banner('warn', t('global.hub_down_title'), t('setup.offline_body'));
  box.classList.add('pos-banner--pulse');
  offline.replaceChildren(box);
  startReconnect(
    () => fetch('/health', { cache: 'no-store' }).then(() => true),
    () => setOffline(false),
  );
}
function fieldOf(path) {
  if (path === 'registration_code' || path === 'advertised_host') return path;
  return String(path).startsWith('guest_network_cidrs') ? 'guest_network_cidrs' : null;
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  for (const name of FIELDS) document.getElementById('field_' + name).classList.remove('pos-field--error');
  status.replaceChildren();
  setBusy(submit, true);
  submit.textContent = t('setup.busy');
  // A slow call (the cloud can take up to 10 s) gets a calm banner after 3 s.
  const slow = setTimeout(() => {
    const box = banner('warn', t('setup.slow'), t('setup.slow_body'));
    box.classList.add('pos-banner--pulse');
    status.replaceChildren(box);
  }, 3000);
  let response;
  let json;
  try {
    response = await fetch('/setup/provision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        registration_code: document.getElementById('registration_code').value,
        advertised_host: host.value.trim(),
        guest_network_cidrs: cidrs(),
      }),
    });
    json = await response.json();
  } catch {
    response = undefined;
  }
  clearTimeout(slow);
  setBusy(submit, false);
  submit.textContent = t('setup.submit');
  status.replaceChildren();
  if (response === undefined) return setOffline(true);
  if (response.ok && json && json.data) return showDone(json.data);
  const error = (json && json.error) || { code: 'INTERNAL_ERROR', details: {} };
  const details = error.details || {};
  const global = globalStateFor({ kind: 'error', code: error.code, details }, { loaded: true, device: 'screen', app: false, authed: true, tokenRotated: false, busyRetried: true });
  if (global && global.mode === 'screen') {
    document.body.replaceChildren(renderGlobalState(global, {}));
    return;
  }
  if (error.code === 'VALIDATION_FAILED') {
    for (const issue of details.issues || []) {
      const name = fieldOf(issue.path);
      if (name) document.getElementById('field_' + name).classList.add('pos-field--error');
    }
    status.replaceChildren(banner('danger', errorText(error)));
    return;
  }
  if (error.code === 'SERVICE_UNAVAILABLE') {
    const wait = details.retry_after_ms > 0 ? details.retry_after_ms : 5000;
    status.replaceChildren(banner('warn', t('errors.SERVICE_UNAVAILABLE_cloud'), t('errors.SERVICE_UNAVAILABLE_cloud_body', { s: Math.ceil(wait / 1000) })));
    submit.disabled = true;
    setTimeout(() => { submit.disabled = false; }, wait);
    return;
  }
  const kind = error.code === 'REGISTRATION_CODE_KIND_UNSUPPORTED' || error.code === 'SETUP_IN_PROGRESS' ? 'info' : 'danger';
  status.replaceChildren(banner(kind, errorText(error), errorBody(error)));
  if (error.code === 'SETUP_IN_PROGRESS') {
    submit.disabled = true;
    setTimeout(() => { submit.disabled = false; }, 3000);
  }
});
</script>
</body>
</html>`;
}

// M84: /setup after provisioning stays 404 but says why, with no form and no hub data.
export function setupAlreadyPage(): string {
  return `${pageHead({ title: 'setup.already_title', theme: 'light' })}
<body class="pos-root">
<main class="pos-screen pos-screen--info">
  <div class="pos-screen__icon">${iconSvg('check')}</div>
  ${tag('h1', 'pos-screen__title', 'setup.already_title')}
  ${tag('p', 'pos-screen__body', 'setup.already_body')}
</main>
<script>
${clientPrelude()}
</script>
</body>
</html>`;
}
