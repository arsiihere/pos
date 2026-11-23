/* eslint-disable -- 05b §10.4 soak field tooling (from spike/lock-alerts), outside the product gate */
// Shared helpers for the 05b soak scripts (ported from the lock-alerts spike). Node 22, no dependencies.
// Wire shapes are copied from the hub code on main (see DEV_HUB.md "Where each call comes from").
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// ---------------------------------------------------------------- args
/** --key value / --flag → { key: value | true }; repeatable keys collect into arrays. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    const value = next === undefined || next.startsWith('--') ? true : (i++, next);
    if (key in out) out[key] = [].concat(out[key], value);
    else out[key] = value;
  }
  return out;
}

export function need(args, key, hint = '') {
  const v = args[key];
  if (v === undefined || v === true) die(`missing --${key}${hint ? ` (${hint})` : ''}`);
  return v;
}

export function die(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------- ids, time
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** ULID (26 chars, Crockford base32): 48-bit ms time + 80 random bits. Matches /^[0-9A-HJKMNP-TV-Z]{26}$/. */
export function ulid(now = Date.now()) {
  let t = now;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i] % 32];
  return time + rand;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- files
export function appendJsonl(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(obj) + '\n');
}

export function readJsonl(path) {
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const s = line.trim();
    if (s === '') continue;
    try {
      out.push(JSON.parse(s));
    } catch {
      /* a torn last line from a killed writer */
    }
  }
  return out;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
}

// ---------------------------------------------------------------- http
export function hubBase(url) {
  return String(url).replace(/\/+$/, '');
}

/**
 * fetch JSON. Never throws: { status, body } or { status: 0, error } on a network failure.
 * Hub bodies are F §6.1 envelopes: { data } on success, { error: { code, details } } on failure.
 */
export async function call(base, method, path, { headers = {}, body, timeoutMs = 10_000 } = {}) {
  const all = { ...headers };
  if (body !== undefined) all['Content-Type'] = 'application/json';
  try {
    const res = await fetch(hubBase(base) + path, {
      method,
      headers: all,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text === '' ? null : JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed, headers: res.headers };
  } catch (err) {
    return { status: 0, error: String(err?.cause?.code ?? err?.name ?? err) };
  }
}

export function errCode(reply) {
  return reply?.body?.error?.code ?? (reply?.status === 0 ? `NETWORK:${reply.error}` : `HTTP_${reply?.status}`);
}

export function ok(reply) {
  return reply.status >= 200 && reply.status < 300;
}

/** CamelCase command type → the route segment (`SendTestAlert` → `send-test-alert`). */
export function kebab(commandType) {
  return commandType.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** F §6.3 command envelope, as `apps/client/src/features/alerts/answer.ts` and `api/hub-admin.ts` build it. */
export function envelope({ commandType, payload, tenantId, branchId, actorId, deviceId, commandId = ulid() }) {
  return {
    command_id: commandId,
    tenant_id: tenantId,
    branch_id: branchId,
    command_type: commandType,
    payload,
    occurred_at: Date.now(),
    actor_id: actorId,
    device_id: deviceId,
  };
}

// ---------------------------------------------------------------- admin session (00 §6.6, M42)
/**
 * One of:
 *  --admin-session <tok>                                 (copy `admin_session_token` from the admin tab's sessionStorage)
 *  --bootstrap <tok> --staff <id|name> --pin <pin>       (`pnpm issue-admin-bootstrap` link, the part after #t=; single use)
 *  --admin-device-token <tok> --staff <id|name> --pin    (a paired kiosk / tablet that may sign in to hub admin)
 * Returns { session, authHeaders, deviceId }.
 */
export async function adminSession(base, args) {
  if (typeof args['admin-session'] === 'string') {
    // the envelope's actor_id must be the session's staff (00 §3.7): sessionStorage `admin_staff_id` in the admin tab
    const staffId = need(args, 'staff', 'with --admin-session: the staff id the session belongs to (sessionStorage admin_staff_id)');
    const headers = { 'X-Admin-Session': args['admin-session'] };
    if (typeof args['admin-device-token'] === 'string') headers['Authorization'] = `Bearer ${args['admin-device-token']}`;
    return { session: args['admin-session'], authHeaders: headers, deviceId: args['admin-device-id'] ?? 'hub-admin', staffId };
  }
  const pin = need(args, 'pin', 'PIN of a staff member with hub admin access');
  const staffArg = need(args, 'staff', 'staff id or display name');
  if (typeof args.bootstrap === 'string') {
    const rosterHeaders = { 'X-Admin-Bootstrap': args.bootstrap };
    const staffId = await resolveStaff(base, '/admin/login-roster', rosterHeaders, staffArg);
    const r = await call(base, 'POST', '/admin/auth/bootstrap', {
      body: { bootstrap_token: args.bootstrap, staff_id: staffId, pin },
    });
    if (!ok(r)) die(`/admin/auth/bootstrap → ${r.status} ${errCode(r)}`);
    const session = r.body.data.admin_session_token;
    return { session, authHeaders: { 'X-Admin-Session': session }, deviceId: 'hub-admin', staffId };
  }
  if (typeof args['admin-device-token'] === 'string') {
    const dev = { Authorization: `Bearer ${args['admin-device-token']}` };
    const staffId = await resolveStaff(base, '/admin/login-roster', dev, staffArg);
    const r = await call(base, 'POST', '/admin/auth', { headers: dev, body: { staff_id: staffId, pin } });
    if (!ok(r)) die(`/admin/auth → ${r.status} ${errCode(r)}`);
    const session = r.body.data.admin_session_token;
    return {
      session,
      authHeaders: { ...dev, 'X-Admin-Session': session },
      deviceId: args['admin-device-id'] ?? 'hub-admin',
      staffId,
    };
  }
  die('give --admin-session, or --bootstrap with --staff/--pin, or --admin-device-token with --staff/--pin');
}

async function resolveStaff(base, path, headers, staffArg) {
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/.test(staffArg)) return staffArg;
  const r = await call(base, 'GET', path, { headers });
  if (!ok(r)) die(`${path} → ${r.status} ${errCode(r)} (needed to look up "${staffArg}"; pass the staff id instead)`);
  const rows = r.body.data.staff ?? [];
  const hit = rows.find((s) => s.display_name.toLowerCase() === String(staffArg).toLowerCase());
  if (hit === undefined) die(`no staff named "${staffArg}" in ${path} (have: ${rows.map((s) => s.display_name).join(', ')})`);
  return hit.staff_id;
}

/** POST /admin/commands/<kebab> with the admin envelope; returns data.result or dies. */
export async function adminCommand(base, admin, ids, commandType, payload) {
  const body = envelope({
    commandType,
    payload,
    tenantId: ids.tenant_id,
    branchId: ids.branch_id,
    actorId: admin.staffId ?? null,
    deviceId: admin.deviceId,
  });
  const r = await call(base, 'POST', `/admin/commands/${kebab(commandType)}`, { headers: admin.authHeaders, body });
  if (!ok(r)) die(`${commandType} → ${r.status} ${errCode(r)} ${JSON.stringify(r.body?.error?.details ?? {})}`);
  return r.body.data.result;
}

// ---------------------------------------------------------------- device files
/** A device file written by mint-tablet-token.mjs: { hub, tenant_id, branch_id, device_id, device_token, device_type, label }. */
export function loadDevice(path) {
  const d = readJson(path);
  for (const k of ['hub', 'tenant_id', 'branch_id', 'device_id', 'device_token']) {
    if (typeof d[k] !== 'string') die(`${path}: missing ${k}`);
  }
  return d;
}

// ---------------------------------------------------------------- stats
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
