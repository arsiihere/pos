import { EN, type StringKey } from './strings.js';
import { uiVersion } from './ui-assets.js';

// Shared building blocks of the hub-served pages (M82). Pages stay one HTML string with one inline script.

// Paths from packages/ui-kit/README.md (24px grid, stroke only, currentColor).
const ICONS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3.5L2.5 20h19L12 3.5z"/><path d="M12 10v4.5"/><path d="M12 17.5v.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.6L20 16"/><path d="M20 20v-4h-4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  wifi: '<path d="M2.5 8.5a14 14 0 0 1 19 0"/><path d="M5.5 12a9.5 9.5 0 0 1 13 0"/><path d="M8.5 15.5a5 5 0 0 1 7 0"/><path d="M12 19v.01"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  share: '<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11v8.5h12V11"/>',
  'add-home': '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8.5v7"/><path d="M8.5 12h7"/>',
  user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
} as const;

export type IconName = keyof typeof ICONS;

const PAGE_CSS =
  'html,body{margin:0;min-height:100%}body{min-height:100vh}' +
  '.pos-page{box-sizing:border-box;width:100%;max-width:var(--content-max);margin-inline:auto;padding:var(--space-6) var(--space-4)}' +
  '.pos-page h1,.pos-page p{margin:0}.pos-icon-wrap{display:inline-flex}[hidden]{display:none!important}' +
  'fieldset{border:0;margin:0;padding:0;min-width:0}.pos-pin>.pos-field{width:100%}';

export function esc(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// JSON that is safe inside an inline <script>.
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

export function iconSvg(name: IconName, extraClass = ''): string {
  return `<svg class="pos-icon${extraClass === '' ? '' : ` ${extraClass}`}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

export function pageHead(o: { title: StringKey; theme: 'light' | 'dark' }): string {
  const v = uiVersion();
  return `<!doctype html>
<html lang="en" dir="ltr" data-theme="${o.theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(EN[o.title])}</title>
<link rel="stylesheet" href="/ui/tokens.css?v=${v}">
<link rel="stylesheet" href="/ui/components/bundle.css?v=${v}">
<style>${PAGE_CSS}</style>
</head>`;
}

// A kit Field rendered on the hub. The page script marks it with pos-field--error (field_<id>).
export function fieldHtml(o: {
  id: string;
  label: StringKey;
  help?: StringKey;
  error?: StringKey;
  attrs?: string;
  mono?: boolean;
}): string {
  const help = o.help === undefined ? '' : `\n  <p class="pos-field__help" id="${o.id}_help">${esc(EN[o.help])}</p>`;
  const error =
    o.error === undefined
      ? ''
      : `\n  <p class="pos-field__error" id="${o.id}_error">${iconSvg('alert')}<span>${esc(EN[o.error])}</span></p>`;
  const describedBy = [o.help === undefined ? '' : `${o.id}_help`, o.error === undefined ? '' : `${o.id}_error`]
    .filter(Boolean)
    .join(' ');
  return `<div class="pos-field" id="field_${o.id}">
  <label class="pos-field__label" for="${o.id}">${esc(EN[o.label])}</label>
  <input class="pos-input${o.mono === true ? ' pos-input--mono' : ''}" id="${o.id}" name="${o.id}"${describedBy === '' ? '' : ` aria-describedby="${describedBy}"`}${o.attrs === undefined ? '' : ` ${o.attrs}`}>${help}${error}
</div>`;
}

// Prepended to every page script: the string table, t(), error texts and small DOM helpers.
export function clientPrelude(): string {
  return `const T = ${scriptJson(EN)};
const ICONS = ${scriptJson(ICONS)};
function t(key, vars) {
  let text = T[key] === undefined ? T['errors.unknown'] : T[key];
  for (const name of Object.keys(vars || {})) text = text.split('{' + name + '}').join(String(vars[name]));
  return text;
}
function errorText(error) {
  const code = error && error.code;
  return T['errors.' + code] === undefined ? T['errors.unknown'] : T['errors.' + code];
}
// §8.4: attempts left when ≤ 2; lockouts show the minutes left, rounded up.
function authDetail(error) {
  const details = (error && error.details) || {};
  if (error && error.code === 'PIN_INVALID' && details.attempts_remaining <= 2) {
    return t(details.attempts_remaining === 1 ? 'auth.attempts_left_one' : 'auth.attempts_left', { n: details.attempts_remaining });
  }
  if (error && /_LOCKED_OUT$/.test(error.code) && details.retry_after_ms > 0) {
    return t('auth.locked_for', { min: Math.ceil(details.retry_after_ms / 60000) });
  }
  return '';
}
function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function icon(name) {
  const wrap = node('span', 'pos-icon-wrap');
  wrap.innerHTML = '<svg class="pos-icon" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>';
  return wrap;
}
function setBusy(button, on) {
  button.disabled = on;
  button.classList.toggle('is-busy', on);
  if (on) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
}
const BANNER_ICONS = { ok: 'check', warn: 'clock', danger: 'alert', info: 'sync' };
function banner(kind, text, detail, name) {
  const box = node('div', 'pos-banner pos-banner--' + kind);
  box.setAttribute('role', kind === 'danger' ? 'alert' : 'status');
  box.appendChild(icon(BANNER_ICONS[kind]));
  const words = node('p', '', text);
  if (name) words.name = name;
  if (detail) words.appendChild(node('small', '', detail));
  box.appendChild(words);
  return box;
}
`;
}
