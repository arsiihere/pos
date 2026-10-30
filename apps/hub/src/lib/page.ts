import { EN, UR, type StringKey } from './strings.js';
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
  flame:
    '<path d="M12 21c-4 0-6.5-2.6-6.5-6.2 0-3.6 2.8-5.6 4-8.8 2.2 1.4 2.8 3.6 2.6 5.4 1.2-.4 2-1.6 2.2-3 2 1.8 2.2 4.2 2.2 6.4C16.5 18.4 15 21 12 21z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  // 00 hand-off (docs/design/handoff/00/00-design.md §3).
  unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7"/>',
  tablet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M11 18h2"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  box: '<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5"/><path d="M12 12v9"/>',
  printer: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="7.5" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2z"/><path d="M18 18h2v2h-2z"/><path d="M14 18h2"/><path d="M18 14h2"/>',
  logout: '<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  reload: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  download: '<path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 20h14"/>',
  // Pulse 00 hand-off (Setup address tiles): network cable, pencil.
  cable: '<path d="M7 3v5"/><path d="M11 3v5"/><rect x="5" y="8" width="8" height="6" rx="1.5"/><path d="M9 14v3a4 4 0 0 0 4 4h6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  link: '<path d="M10 14l4-4"/><path d="M8.5 11.5L6 14a3 3 0 0 0 4 4l2.5-2.5"/><path d="M15.5 12.5L18 10a3 3 0 0 0-4-4l-2.5 2.5"/>',
} as const;

export type IconName = keyof typeof ICONS;

// Document resets only; every look comes from the kit (handoff rule 2).
const PAGE_CSS =
  'html,body{margin:0;min-height:100%}body>.pos-page{min-height:100vh}body>.pos-screen,.pos-page>.pos-screen{min-height:100vh}' +
  '.pos-root h1,.pos-root h2,.pos-root p{margin:0}' +
  '.pos-icon-wrap{display:inline-flex}[hidden]{display:none!important}' +
  'fieldset{border:0;margin:0;padding:0;min-width:0}';

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

// M83: the language a page script uses; pure so the page and the tests share it (embedded with toString).
export function pickLang(search: string, stored: string | null, navigatorLanguage: string): 'en' | 'ur' {
  const asked = new URLSearchParams(search).get('lang');
  if (asked === 'en' || asked === 'ur') return asked;
  if (stored === 'en' || stored === 'ur') return stored;
  return /^ur\b/i.test(navigatorLanguage) ? 'ur' : 'en';
}

// Static text: rendered in English, re-rendered by the page script in the chosen language (data-t, M83).
export function tag(name: string, className: string, key: StringKey, attrs = ''): string {
  return `<${name}${className === '' ? '' : ` class="${className}"`} data-t="${key}"${attrs === '' ? '' : ` ${attrs}`}>${esc(EN[key])}</${name}>`;
}

// A kit Field rendered on the hub. The page script marks it with pos-field--error (field_<id>). Pulse order: error, then help.
export function fieldHtml(o: {
  id: string;
  label: StringKey;
  help?: StringKey;
  error?: StringKey;
  attrs?: string;
  mono?: boolean;
  code?: boolean;
}): string {
  const help = o.help === undefined ? '' : `\n  ${tag('p', 'pos-field__help', o.help, `id="${o.id}_help"`)}`;
  const error =
    o.error === undefined
      ? ''
      : `\n  <p class="pos-field__error" id="${o.id}_error">${iconSvg('alert')}${tag('span', '', o.error)}</p>`;
  const describedBy = [o.help === undefined ? '' : `${o.id}_help`, o.error === undefined ? '' : `${o.id}_error`]
    .filter(Boolean)
    .join(' ');
  return `<div class="pos-field" id="field_${o.id}">
  ${tag('label', 'pos-field__label', o.label, `for="${o.id}"`)}
  <input class="pos-input${o.code === true ? ' pos-input--code' : o.mono === true ? ' pos-input--mono' : ''}" id="${o.id}" name="${o.id}"${describedBy === '' ? '' : ` aria-describedby="${describedBy}"`}${o.attrs === undefined ? '' : ` ${o.attrs}`}>${error}${help}
</div>`;
}

// Prepended to every page script: the language (M83), the string table, t(), error texts and small DOM helpers.
export function clientPrelude(): string {
  return `${pickLang.toString()}
const LANG = (() => {
  let stored = null;
  try { stored = localStorage.getItem('pos-lang'); } catch {}
  const chosen = pickLang(location.search, stored, (typeof navigator !== 'undefined' && navigator.language) || '');
  try { if (new URLSearchParams(location.search).get('lang')) localStorage.setItem('pos-lang', chosen); } catch {}
  return chosen;
})();
const T = Object.assign({}, ${scriptJson(EN)}, LANG === 'ur' ? ${scriptJson(UR)} : {});
const ICONS = ${scriptJson(ICONS)};
if (document.documentElement) {
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'ur' ? 'rtl' : 'ltr';
}
// The kit's Urdu rules key on .pos-root[lang]; Latin type classes become the kit's ur-* classes (as in the *Urdu frames).
if (document.body && document.body.setAttribute) document.body.setAttribute('lang', LANG);
const UR_TYPE = { display: 'ur-display', title: 'ur-title', heading: 'ur-title', 'body-lg': 'ur-body', body: 'ur-body', caption: 'ur-body' };
function typeClass(className) {
  if (LANG !== 'ur' || !className) return className;
  return className.split(' ').map((name) => UR_TYPE[name] || name).join(' ');
}
function applyStrings(root) {
  const scope = root || document;
  if (!scope.querySelectorAll) return;
  for (const el of scope.querySelectorAll('[data-t]')) el.textContent = t(el.getAttribute('data-t'));
  if (LANG === 'ur') for (const el of scope.querySelectorAll('.display,.title,.heading,.body-lg,.body,.caption')) el.className = typeClass(el.className);
}
applyStrings();
function t(key, vars) {
  let text = T[key] === undefined ? T['errors.unknown'] : T[key];
  for (const name of Object.keys(vars || {})) text = text.split('{' + name + '}').join(String(vars[name]));
  return text;
}
function errorText(error) {
  const code = error && error.code;
  return T['errors.' + code] === undefined ? T['errors.unknown'] : T['errors.' + code];
}
// The second line some error banners carry (errors.<CODE>_body), or ''.
function errorBody(error, vars) {
  const key = 'errors.' + (error && error.code) + '_body';
  return T[key] === undefined ? '' : t(key, vars);
}
// fetch → { status, body }; a network failure rejects (the caller shows 00-F01).
async function call(url, init) {
  const res = await fetch(url, init);
  let body = {};
  try { body = await res.json(); } catch {}
  return { status: res.status, body: body || {} };
}
// Times and counts never mirror (handoff rule 4).
function ltr(text) {
  return node('span', 'pos-ltr', text);
}
function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function hhmm(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function chip(kind, iconName, text) {
  const box = node('span', 'pos-chip' + (kind ? ' pos-chip--' + kind : ''));
  if (iconName) box.appendChild(icon(iconName));
  box.appendChild(document.createTextNode(text));
  return box;
}
// A full-screen kit state: icon, title, body and any extra nodes.
function stateScreen(kind, iconName, title, body, extra) {
  const box = node('main', 'pos-screen pos-screen--' + kind);
  const mark = node('div', 'pos-screen__icon');
  mark.appendChild(icon(iconName));
  box.appendChild(mark);
  box.appendChild(node('h1', 'pos-screen__title', title));
  if (body) box.appendChild(node('p', 'pos-screen__body', body));
  for (const part of extra || []) box.appendChild(part);
  return box;
}
function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = typeClass(className);
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
function banner(kind, text, detail, name, iconName) {
  const box = node('div', 'pos-banner pos-banner--' + kind);
  box.setAttribute('role', kind === 'danger' ? 'alert' : 'status');
  box.appendChild(icon(iconName || BANNER_ICONS[kind]));
  const words = node('p', '', text);
  if (name) words.name = name;
  if (detail) words.appendChild(node('small', '', detail));
  box.appendChild(words);
  return box;
}
`;
}

// 00-S03/S07: the kit PIN pad (dots + keys, Delete, Sign in). The digits live in a hidden password input named
// "pin"; the 6th digit submits (handoff 00-S03). Physical keys work too (kiosk keyboard).
export function pinPadClient(): string {
  return `function pinPad(onSubmit) {
  const box = node('div', 'pos-pin');
  box.setAttribute('aria-label', t('pin.label'));
  const input = node('input');
  input.type = 'password';
  input.name = 'pin';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.hidden = true;
  input.value = '';
  const dots = node('div', 'pos-pin__dots');
  const keys = node('div', 'pos-pin__keys');
  const render = () => {
    const parts = [];
    for (let i = 0; i < Math.max(4, input.value.length); i += 1) parts.push(node('span', 'pos-pin__dot' + (i < input.value.length ? ' is-filled' : '')));
    dots.replaceChildren(...parts);
    dots.setAttribute('aria-label', t('pin.typed', { n: input.value.length }));
  };
  const press = (digit) => {
    if (box.classList.contains('is-locked') || input.value.length >= 6) return;
    input.value += digit;
    box.classList.remove('is-error');
    render();
    if (input.value.length === 6) onSubmit();
  };
  const back = () => {
    input.value = input.value.slice(0, -1);
    render();
  };
  const key = (label, fn, extra) => {
    const button = node('button', 'pos-pin__key' + (extra ? ' pos-pin__key--fn' : ''), label);
    button.type = 'button';
    button.addEventListener('click', fn);
    keys.appendChild(button);
  };
  for (const digit of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) key(digit, () => press(digit));
  key(t('pin.delete'), back, true);
  key('0', () => press('0'));
  key(t('pin.submit'), () => onSubmit(), true);
  if (document.addEventListener) {
    document.addEventListener('keydown', (event) => {
      if (box.hidden || !box.isConnected) return;
      if (/^[0-9]$/.test(event.key)) press(event.key);
      else if (event.key === 'Backspace') back();
      else if (event.key === 'Enter') onSubmit();
    });
  }
  box.appendChild(input);
  box.appendChild(dots);
  box.appendChild(keys);
  render();
  return {
    el: box,
    input,
    clear() { input.value = ''; render(); },
    error() { box.classList.add('is-error'); },
    lock(on) { box.classList.toggle('is-locked', on); },
  };
}
`;
}
