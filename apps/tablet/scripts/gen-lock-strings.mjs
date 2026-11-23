#!/usr/bin/env node
/* global console */
// 05b M-9 (plan A9): generates apps/tablet/android/app/src/main/assets/lock-strings.json, the native copy of the
// lock-line texts and sound rules, so a notification posted by the tablet's alert service reads exactly as the
// kiosk / phone page's F01 lock panel line (01d §3.12, §8.1; apps/client/src/features/alerts/labels.ts `lockText`).
//
//   node apps/tablet/scripts/gen-lock-strings.mjs           write the file
//   node apps/tablet/scripts/gen-lock-strings.mjs --check   exit 1 if the committed file differs (05b test 10 is
//                                                           the same check inside the Vitest gate)
//
// No TS build step: the sources are read as text and their string literals parsed here. If a source stops being a
// plain literal (a computed value, a spread, a concatenation), parsing throws instead of guessing.
//
// Sources:
//   apps/client/src/i18n/en.ts                   `export const en = { 'key': 'text', … } as const;`
//   apps/client/src/i18n/ur.ts                   `export const ur: … = { 'key': 'text', … };` (a missing key → en)
//   apps/client/src/features/alerts/sounds.ts    `SILENT_KINDS = new Set([...])`; the outcome sounds of `soundFor`
//   apps/client/src/features/alerts/labels-03b.ts `ALERT_KINDS_03B = Object.freeze([...])`
//   packages/events/src/alerts.ts                `REQUEST_OUTCOMES = [...]`
//
// Output shape (version 1). Keys are sorted, so the file is stable:
// {
//   "version": 1,
//   "generated_by": "apps/tablet/scripts/gen-lock-strings.mjs",
//   "fallback_language": "en",           any language other than a key of `languages` reads `en`; a key missing
//                                        from `ur` reads its `en` text (client i18n t())
//   "join": " · ",                       the part separator of a template
//   "params": { "table": "table_code", "point": "point_code", "requester": "requester_name", "device": "device_name" },
//                                        template parameter → lock field
//   "table": { "key": "alerts.table", "digits": "^[0-9]+$" },
//                                        `{table}`: an all-digit table_code reads through this key's `{code}`
//                                        ("T12"); any other non-empty code as-is; empty / null → missing
//   "table_point_kinds": { "kinds": [...], "params": ["table", "point"] },
//                                        03b / 03c kinds (labels-03b.ts): only these params are filled; their unknown
//                                        key falls back to `unknown.other`; checked before `takeaway` and `outcome`
//   "takeaway": { "kind": "comp", "key": "comp.takeaway_card" },
//                                        a `comp` with no table_code reads this key (02b Q-25)
//   "outcome": { "kind": "request_result", "key": "alert.request_result.{outcome}", "outcomes": [...] },
//                                        a request_result with a non-null `outcome` (on the alert view, AD-82) reads
//                                        this key instead of the lock's kind_label_key
//   "unknown": { "urgent": "alerts.unknown.request", "other": "alerts.unknown.alert" },
//                                        a key not in the table → this template, by the alert's family
//   "silent_kinds": [...],               no notification, no sound (01d SILENT_KINDS)
//   "result_sounds": { "kind": "request_result", "default": "info",
//                      "by_outcome": { "approved": "result_approved", "rejected": "result_rejected", "withdrawn": "none" } },
//                                        request_result sound by outcome (soundFor: rising / falling / null / info);
//                                        "none" = post without a sound
//   "languages": { "en": { key: template }, "ur": { key: template } }
//                                        every `alert.<kind>.lock` key, the outcome keys, and the keys named above
// }
//
// Fill rule (labels.ts fillLine): split the template on `join`; keep the parts whose every `{param}` has a non-empty
// value; if none is kept, keep all parts; replace each `{param}` by its value or ''; join with `join`; collapse
// whitespace runs to one space; trim.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const OUTPUT = 'apps/tablet/android/app/src/main/assets/lock-strings.json';
export const SOURCES = Object.freeze({
  en: 'apps/client/src/i18n/en.ts',
  ur: 'apps/client/src/i18n/ur.ts',
  sounds: 'apps/client/src/features/alerts/sounds.ts',
  labels03b: 'apps/client/src/features/alerts/labels-03b.ts',
  events: 'packages/events/src/alerts.ts',
});

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const JOIN = ' · ';

// ------------------------------------------------------------------------------------------- literal parsing

function fail(file, why) {
  throw new Error(`gen-lock-strings: cannot read ${file} statically (${why}); fix the generator, do not guess`);
}

/** Reads one JS string literal ('…' or "…", or a `…` with no ${}) at src[i]; returns [value, next index]. */
function readString(src, i, file) {
  const q = src[i];
  if (q !== "'" && q !== '"' && q !== '`') fail(file, `expected a string at offset ${i}`);
  let out = '';
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === q) return [out, j + 1];
    if (q === '`' && c === '$' && src[j + 1] === '{') fail(file, `template expression at offset ${j}`);
    if (c === '\n' && q !== '`') fail(file, `newline in a string at offset ${j}`);
    if (c !== '\\') {
      out += c;
      j += 1;
      continue;
    }
    const e = src[j + 1];
    const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0', '\\': '\\', "'": "'", '"': '"', '`': '`' };
    if (e in simple) {
      out += simple[e];
      j += 2;
    } else if (e === 'u' && src[j + 2] === '{') {
      const end = src.indexOf('}', j + 3);
      out += String.fromCodePoint(parseInt(src.slice(j + 3, end), 16));
      j = end + 1;
    } else if (e === 'u') {
      out += String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16));
      j += 6;
    } else if (e === 'x') {
      out += String.fromCharCode(parseInt(src.slice(j + 2, j + 4), 16));
      j += 4;
    } else if (e === '\n') {
      j += 2; // line continuation
    } else {
      fail(file, `unknown escape \\${e} at offset ${j}`);
    }
  }
  return fail(file, 'unterminated string');
}

/** Skips whitespace and comments. */
function skip(src, i) {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (src.startsWith('//', i)) {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl + 1;
    } else if (src.startsWith('/*', i)) {
      i = src.indexOf('*/', i + 2) + 2;
    } else {
      return i;
    }
  }
}

/** The `{ 'key': 'text', … }` object literal that follows `marker` in `src`, as a plain object. */
export function parseStringTable(src, marker, file) {
  const at = src.indexOf(marker);
  if (at < 0) fail(file, `"${marker}" not found`);
  let i = src.indexOf('{', at + marker.length);
  if (i < 0) fail(file, 'no object literal');
  i += 1;
  const out = {};
  for (;;) {
    i = skip(src, i);
    if (src[i] === '}') return out;
    let key;
    if (src[i] === "'" || src[i] === '"') {
      [key, i] = readString(src, i, file);
    } else {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 200));
      if (m === null) fail(file, `expected a key at offset ${i}`);
      key = m[0];
      i += key.length;
    }
    i = skip(src, i);
    if (src[i] !== ':') fail(file, `expected ':' after ${key}`);
    i = skip(src, i + 1);
    let value;
    [value, i] = readString(src, i, file);
    if (Object.hasOwn(out, key)) fail(file, `duplicate key ${key}`);
    out[key] = value;
    i = skip(src, i);
    if (src[i] === ',') i += 1;
    else if (src[i] !== '}') fail(file, `expected ',' or '}' after ${key} (a non-literal value?)`);
  }
}

/** The string array literal `[ 'a', 'b' ]` matched by `re` (its group 1 is the inside of the brackets). */
export function parseStringArray(src, re, file) {
  const m = re.exec(src);
  if (m === null) fail(file, `${re} not found`);
  const inner = m[1];
  const out = [];
  let i = 0;
  for (;;) {
    i = skip(inner, i);
    if (i >= inner.length) return out;
    let v;
    [v, i] = readString(inner, i, file);
    out.push(v);
    i = skip(inner, i);
    if (inner[i] === ',') i += 1;
    else if (i < inner.length) fail(file, `expected ',' in ${re}`);
  }
}

// ------------------------------------------------------------------------------------------- build

const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

/** Builds the lock-strings object from the source texts (`read(path relative to the repo root)`). */
export function buildLockStrings(read = (p) => readFileSync(resolve(REPO_ROOT, p), 'utf8')) {
  const en = parseStringTable(read(SOURCES.en), 'export const en =', SOURCES.en);
  const ur = parseStringTable(read(SOURCES.ur), 'export const ur', SOURCES.ur);
  const silent = parseStringArray(read(SOURCES.sounds), /SILENT_KINDS\b[^=]*=\s*new Set\(\[([^\]]*)\]\)/, SOURCES.sounds);
  const kinds03b = parseStringArray(read(SOURCES.labels03b), /ALERT_KINDS_03B\s*=\s*Object\.freeze\(\[([^\]]*)\]/, SOURCES.labels03b);
  const outcomes = parseStringArray(read(SOURCES.events), /REQUEST_OUTCOMES\s*=\s*\[([^\]]*)\]/, SOURCES.events);

  const named = ['alerts.table', 'alerts.unknown.request', 'alerts.unknown.alert', 'comp.takeaway_card'];
  for (const k of named) if (!Object.hasOwn(en, k)) fail(SOURCES.en, `missing ${k}`);
  const wanted = (k) =>
    /^alert\.[a-z0-9_]+\.lock$/.test(k) || named.includes(k) || outcomes.some((o) => k === `alert.request_result.${o}`);
  const pick = (table) => sortKeys(Object.fromEntries(Object.entries(table).filter(([k]) => wanted(k))));

  return {
    version: 1,
    generated_by: 'apps/tablet/scripts/gen-lock-strings.mjs',
    fallback_language: 'en',
    join: JOIN,
    params: { table: 'table_code', point: 'point_code', requester: 'requester_name', device: 'device_name' },
    table: { key: 'alerts.table', digits: '^[0-9]+$' },
    table_point_kinds: { kinds: [...kinds03b].sort(), params: ['table', 'point'] },
    takeaway: { kind: 'comp', key: 'comp.takeaway_card' },
    outcome: { kind: 'request_result', key: 'alert.request_result.{outcome}', outcomes: [...outcomes] },
    unknown: { urgent: 'alerts.unknown.request', other: 'alerts.unknown.alert' },
    silent_kinds: [...silent].sort(),
    // sounds.ts soundFor: approved → 'rising', rejected → 'falling', withdrawn → null, anything else → 'info'
    // (the Vitest gate test checks this mapping against soundFor itself)
    result_sounds: {
      kind: 'request_result',
      default: 'info',
      by_outcome: { approved: 'result_approved', rejected: 'result_rejected', withdrawn: 'none' },
    },
    languages: { en: pick(en), ur: pick(ur) },
  };
}

/** The committed file's text, or null when it is missing. */
export function readCommitted() {
  try {
    return readFileSync(resolve(REPO_ROOT, OUTPUT), 'utf8');
  } catch {
    return null;
  }
}

export function serialize(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

// ------------------------------------------------------------------------------------------- reference renderer
// The rule LockStrings.kt implements; the Vitest gate test checks it against the client's own lockText().

function template(data, language, key) {
  const lang = Object.hasOwn(data.languages, language) ? language : data.fallback_language;
  const own = data.languages[lang];
  if (Object.hasOwn(own, key)) return own[key];
  const base = data.languages[data.fallback_language];
  return Object.hasOwn(base, key) ? base[key] : null;
}

const present = (v) => v !== null && v !== undefined && v !== '';

function fillLine(data, tpl, values) {
  const has = (part) => [...part.matchAll(/\{(\w+)\}/g)].every(([, name]) => present(values[name]));
  const parts = tpl.split(data.join);
  const kept = parts.filter(has);
  const filled = (kept.length > 0 ? kept : parts).map((part) => part.replace(/\{(\w+)\}/g, (_w, name) => values[name] ?? ''));
  return filled.join(data.join).replace(/\s+/g, ' ').trim();
}

/**
 * The lock line for an alert-mode view `{ kind, family, outcome?, lock }` in `language`. `onUnknown(key)` is called
 * when the key has no template (the generic text is used).
 */
export function renderLock(data, view, language, onUnknown = () => {}) {
  const { kind, family, lock } = view;
  const outcome = view.outcome ?? null;
  const code = lock.table_code;
  let table = null;
  if (present(code)) {
    table = new RegExp(data.table.digits).test(code) ? template(data, language, data.table.key).replace(/\{code\}/g, code) : code;
  }
  const all = { table, point: lock.point_code ?? null, requester: lock.requester_name ?? null, device: lock.device_name ?? null };
  const tablePoint = data.table_point_kinds.kinds.includes(kind);
  const values = tablePoint ? Object.fromEntries(data.table_point_kinds.params.map((p) => [p, all[p]])) : all;
  if (!tablePoint && kind === data.takeaway.kind && !present(code)) return fillLine(data, template(data, language, data.takeaway.key), values);
  const key =
    !tablePoint && kind === data.outcome.kind && outcome !== null ? data.outcome.key.replace('{outcome}', outcome) : lock.kind_label_key;
  let tpl = template(data, language, key);
  if (tpl === null) {
    onUnknown(key);
    tpl = template(data, language, !tablePoint && family === 'urgent' ? data.unknown.urgent : data.unknown.other);
  }
  return fillLine(data, tpl, values);
}

export function isSilentKind(data, kind) {
  return data.silent_kinds.includes(kind);
}

/** 'urgent' | 'action' | 'info' | 'result_approved' | 'result_rejected' | 'none'. */
export function soundOf(data, kind, family, outcome) {
  if (isSilentKind(data, kind)) return 'none';
  const r = data.result_sounds;
  if (kind === r.kind) return present(outcome) && Object.hasOwn(r.by_outcome, outcome) ? r.by_outcome[outcome] : r.default;
  return family;
}

// ------------------------------------------------------------------------------------------- CLI

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(REPO_ROOT, OUTPUT);
  const fresh = serialize(buildLockStrings());
  if (process.argv.includes('--check')) {
    if (readCommitted() !== fresh) {
      console.error(`${OUTPUT} is stale: run \`node apps/tablet/scripts/gen-lock-strings.mjs\``);
      process.exit(1);
    }
    console.log(`${OUTPUT} is up to date`);
  } else {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, fresh);
    console.log(`wrote ${OUTPUT}`);
  }
}
