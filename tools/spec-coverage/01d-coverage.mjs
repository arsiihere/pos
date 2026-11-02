#!/usr/bin/env node
// 01d coverage check (task 43 step 2; spec §10, §12.1, §12.2). No dependencies.
// Run from the repo root: node tools/spec-coverage/01d-coverage.mjs
// Exit 0 when every check passes, 1 otherwise. It does not run tests: "green" is the gate's job.
//
// (a) every [01d #N], N in 1–66, is in at least one it( / it.each( / test( title; #56, #57, #59, #61 as
//     "[01d #N hub]" and "[01d #N client]" (both, no bare form); #58 present and under it.skipIf;
//     #63 is the tablet plan's (9b, AD-1, plan line "#63 is in the tablet plan") and is reported, not failed.
//     A number split over several it() titles is listed with its locations (the plan's "exactly one" is one
//     task, not one it()); an identical title twice is a duplicate and fails.
// (b) every §12.2 checklist row names tests that are present.
// (c) no Date.now / Math.random in apps/hub/src/alerts.
// (d) no role name (01b default roles, apps/cloud/src/modules/staff-roles/default-roles.ts) in apps/hub/src/alerts (R5).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SCAN_DIRS = ['apps', 'packages'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.git']);
const TEST_FILE = /\.test\.(ts|tsx|mts|js|mjs)$/;
const SPLIT = new Set([56, 57, 59, 61]);
const SKIPPED = 58;
const ELSEWHERE = new Map([[63, 'tablet plan (batch 9b, AD-1)']]);

// §12.2 rows (spec v1.0): [row, item, tests]
const CHECKLIST = [
  [1, 'alerts.raise / raiseMany / close / closeMany / listOpen / tickCtx, APPROVAL_TIER_STEPS', '14, 15, 20, 35, 47, 49, 50, 51, 66'],
  [2, 'AnswerRequest', '6–12, 18, 33, 44, 54–56, 60, 66'],
  [3, 'WithdrawRequest', '13, 33'],
  [4, 'MarkAlertsSeen', '16, 33, 39, 61'],
  [5, 'SendTestAlert', '17'],
  [6, 'SetPresence', '5, 45'],
  [7, 'alerts-inbox', '25, 42'],
  [8, 'my-requests', '41'],
  [9, 'requests-to-answer', '8, 53, 61'],
  [10, 'alert-receipts', '46, 57, 62'],
  [11, 'WS alert mode + frames', '26–30, 39, 49, 53, 59, 63, 64'],
  [12, 'alerts catch-up part', '43, 55, 61'],
  [13, 'Tick (registerTick, due, own transactions)', '19–22, 24, 34–37, 50, 52, 58, 59'],
  [14, 'Receipt buffer', '23'],
  [15, 'Retention', '38'],
  [16, 'GET /app/android/latest, …/<version_code>.apk, CLI app-release add / mark-good', '40, 65'],
];

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

// A test call: it / test, optional modifiers (.skip, .only, .skipIf(...), .runIf(...), .each(...)), then "(" and
// a string title on the same or a following line. Modifier arguments may hold one level of nested parens.
const ARGS = String.raw`\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)`;
const CALL = new RegExp(
  String.raw`\b(it|test)((?:\.(?:skip|only|todo|concurrent|sequential|fails|skipIf${ARGS}|runIf${ARGS}|each${ARGS}))*)\(\s*(['"\x60])`,
  'g',
);
const TAG = /\[01d #(\d+)(?:\s+(hub|client))?(?:[;\]])/g;

function titles(file) {
  const text = readFileSync(file, 'utf8');
  const found = [];
  CALL.lastIndex = 0;
  let m;
  while ((m = CALL.exec(text)) !== null) {
    const quote = m[3];
    const start = CALL.lastIndex;
    let i = start;
    while (i < text.length && text[i] !== quote) i += text[i] === '\\' ? 2 : 1;
    found.push({ title: text.slice(start, i), modifiers: m[2], line: lineOf(text, m.index) });
  }
  return found;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d), [])).filter((f) => TEST_FILE.test(f));
const tags = new Map(); // key "N" | "N hub" | "N client" -> [{ loc, title, skipIf }]
const allTitles = new Map(); // full title -> [loc]
for (const file of files) {
  for (const t of titles(file)) {
    const loc = `${relative(ROOT, file)}:${t.line}`;
    TAG.lastIndex = 0;
    let m;
    let tagged = false;
    while ((m = TAG.exec(t.title)) !== null) {
      tagged = true;
      const key = m[2] ? `${m[1]} ${m[2]}` : m[1];
      if (!tags.has(key)) tags.set(key, []);
      tags.get(key).push({ loc, skipIf: t.modifiers.includes('skipIf') });
    }
    if (tagged) {
      if (!allTitles.has(t.title)) allTitles.set(t.title, []);
      allTitles.get(t.title).push(loc);
    }
  }
}

const problems = [];
const notes = [];
const present = new Set();
const out = [];
out.push(`01d coverage — ${files.length} test files scanned under ${SCAN_DIRS.join(', ')}/`);
out.push('');
out.push('(a) [01d #N] in it() / test() titles, N = 1–66');

for (let n = 1; n <= 66; n += 1) {
  const bare = tags.get(String(n)) ?? [];
  const hub = tags.get(`${n} hub`) ?? [];
  const client = tags.get(`${n} client`) ?? [];
  const where = (list) => [...new Set(list.map((x) => x.loc.replace(/:\d+$/, '')))].join(', ');
  if (SPLIT.has(n)) {
    const ok = hub.length > 0 && client.length > 0 && bare.length === 0;
    if (hub.length === 0) problems.push(`#${n}: no "[01d #${n} hub]" title`);
    if (client.length === 0) problems.push(`#${n}: no "[01d #${n} client]" title`);
    if (bare.length > 0) problems.push(`#${n}: bare "[01d #${n}]" title(s) at ${bare.map((x) => x.loc).join(', ')} (expected hub / client)`);
    if (hub.length > 0 || client.length > 0) present.add(n);
    out.push(`  #${n} ${ok ? 'OK  ' : 'FAIL'} hub ×${hub.length} (${where(hub) || '—'}); client ×${client.length} (${where(client) || '—'})`);
    continue;
  }
  const list = [...bare, ...hub, ...client];
  if (list.length === 0) {
    if (ELSEWHERE.has(n)) {
      notes.push(`#${n}: absent here, owned by the ${ELSEWHERE.get(n)}`);
      out.push(`  #${n} OPEN not in this repo's tests — ${ELSEWHERE.get(n)}`);
    } else {
      problems.push(`#${n}: missing (no it() / test() title)`);
      out.push(`  #${n} FAIL missing`);
    }
    continue;
  }
  present.add(n);
  if (n === SKIPPED) {
    const allSkip = list.every((x) => x.skipIf);
    if (!allSkip) problems.push(`#${n}: expected under it.skipIf at ${list.filter((x) => !x.skipIf).map((x) => x.loc).join(', ')}`);
    out.push(`  #${n} ${allSkip ? 'OK  ' : 'FAIL'} ×${list.length} it.skipIf (${where(list)})`);
    continue;
  }
  if (hub.length + client.length > 0) notes.push(`#${n}: tagged hub / client but not a split test`);
  out.push(`  #${n} OK   ×${list.length} (${where(list)})`);
}

const dupTitles = [...allTitles.entries()].filter(([, locs]) => locs.length > 1);
out.push('');
out.push(`    identical 01d titles in two places: ${dupTitles.length === 0 ? 'none' : dupTitles.length}`);
for (const [title, locs] of dupTitles) {
  problems.push(`duplicate title "${title.slice(0, 80)}…" at ${locs.join(', ')}`);
  out.push(`      ${locs.join(', ')}: ${title.slice(0, 100)}`);
}

out.push('');
out.push('(b) §12.2 checklist rows');
const expand = (spec) =>
  spec.split(',').flatMap((part) => {
    const [a, b] = part.trim().split(/[–-]/).map(Number);
    return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
  });
for (const [row, item, spec] of CHECKLIST) {
  const nums = expand(spec);
  const missing = nums.filter((n) => !present.has(n) && !ELSEWHERE.has(n));
  const open = nums.filter((n) => !present.has(n) && ELSEWHERE.has(n));
  if (missing.length > 0) problems.push(`§12.2 row ${row} (${item}): tests ${missing.join(', ')} missing`);
  const status = missing.length > 0 ? 'FAIL' : 'OK  ';
  const extra = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    open.length > 0 ? `open elsewhere ${open.map((n) => `#${n}`).join(', ')}` : '',
    nums.includes(SKIPPED) ? `#${SKIPPED} skipped off pilot hardware` : '',
  ].filter(Boolean);
  out.push(`  row ${String(row).padStart(2)} ${status} ${item} — tests ${spec}${extra.length ? ` (${extra.join('; ')})` : ''}`);
}

const ALERTS = join(ROOT, 'apps/hub/src/alerts');
const alertFiles = walk(ALERTS, []).filter((f) => /\.(ts|tsx|js|mjs)$/.test(f));

function grepLines(regex, filter = () => true) {
  const hits = [];
  for (const file of alertFiles) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((text, i) => {
        if (regex.test(text) && filter(text)) hits.push(`${relative(ROOT, file)}:${i + 1}: ${text.trim()}`);
      });
  }
  return hits;
}

out.push('');
out.push('(c) Date.now / Math.random in apps/hub/src/alerts');
const clock = grepLines(/Date\.now|Math\.random/);
if (clock.length > 0) problems.push(`(c) ${clock.length} Date.now / Math.random hit(s)`);
out.push(clock.length === 0 ? `  OK   none (${alertFiles.length} files)` : clock.map((h) => `  FAIL ${h}`).join('\n'));

// Default role display names and default_keys (01b §6.15). 'owner' is also 01d vocabulary (closes_on: 'owner',
// table_team depth 'owner', the phone's owner binding), so a lowercase 'owner' literal is reported only outside
// those uses.
out.push('');
out.push('(d) role names in apps/hub/src/alerts (R5)');
const ROLE = /(['"\x60])(Owner|Manager|Cashier|Order taker|Waiter|Cook|manager|cashier|order_taker|waiter|cook)\1|default_key|DEFAULT_ROLES/;
const OWNER = /(['"\x60])owner\1/;
const ownerVocabulary = (text) => !/closes_on|ClosesOn|depth/.test(text);
const roles = [...grepLines(ROLE), ...grepLines(OWNER, ownerVocabulary)];
if (roles.length > 0) problems.push(`(d) ${roles.length} role-name hit(s)`);
out.push(roles.length === 0 ? '  OK   none' : roles.map((h) => `  FAIL ${h}`).join('\n'));

out.push('');
out.push(`Summary: ${present.size} of 66 present; ${problems.length} problem(s); ${notes.length} note(s)`);
for (const p of problems) out.push(`  PROBLEM ${p}`);
for (const n of notes) out.push(`  NOTE    ${n}`);
process.stdout.write(out.join('\n') + '\n');
process.exit(problems.length > 0 ? 1 : 0);
