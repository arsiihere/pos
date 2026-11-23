#!/usr/bin/env node
/* eslint-disable -- 05b §10.4 soak field tooling (from spike/lock-alerts), outside the product gate */
// Fire `test_alert`s at one device on a schedule (01d §6.5 SendTestAlert, target { kind: 'device' }).
//
//   node fire.mjs --sender devices/sender.json --target devices/tablet.json --staff Arif --pin 1234 \
//                 --label S1 [--interval-s 60] [--jitter-s 20] [--duration-h 12 | --count N] [--burst N] [--out logs/fire-S1.jsonl]
//   (--device <device_id> instead of --target)
//
// The sender is a second paired tablet; a staff member holding `manage-devices` signs in on it with POST /auth/pin
// (Authorization: Bearer <sender token>), and each command goes to POST /commands/send-test-alert with
// X-Session-Token (as apps/client/src/features/alerts/answer.ts sends commands).
// --burst N fires N alerts as fast as the hub answers (S7), then exits.
// Survives the hub being down: a failed fire is logged and the schedule keeps going. A session error
// (idle timeout, hub restore, takeover) signs in again on the next tick.
import { parseArgs, need, die, call, ok, errCode, envelope, appendJsonl, loadDevice, sleep } from './lib.mjs';

const args = parseArgs();
const sender = loadDevice(need(args, 'sender', 'device file from mint-tablet-token.mjs --sender'));
const targetId =
  typeof args.device === 'string' ? args.device : typeof args.target === 'string' ? loadDevice(args.target).device_id : die('give --target <file> or --device <device_id>');
const pin = need(args, 'pin');
const staffArg = need(args, 'staff', 'staff id or display name; needs manage-devices');
const label = typeof args.label === 'string' ? args.label : 'run';
const out = typeof args.out === 'string' ? args.out : new URL(`./logs/fire-${label}.jsonl`, import.meta.url).pathname;
const intervalMs = Number(args['interval-s'] ?? 60) * 1000;
const jitterMs = Number(args['jitter-s'] ?? 20) * 1000;
const endAt = args['duration-h'] !== undefined ? Date.now() + Number(args['duration-h']) * 3_600_000 : Infinity;
const maxCount = args.count !== undefined ? Number(args.count) : Infinity;
const burst = args.burst !== undefined ? Number(args.burst) : 0;
if (endAt === Infinity && maxCount === Infinity && burst === 0) die('give --duration-h, --count or --burst');

const hub = sender.hub;
const devHeaders = { Authorization: `Bearer ${sender.device_token}` };
const SESSION_ERRORS = new Set(['SESSION_INVALID', 'SESSION_EXPIRED', 'SESSION_NOT_FOUND']);

async function staffId() {
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/.test(staffArg)) return staffArg;
  const r = await call(hub, 'GET', '/queries/staff-roster', { headers: devHeaders });
  if (!ok(r)) die(`/queries/staff-roster → ${r.status} ${errCode(r)}`);
  const hit = r.body.data.staff.find((s) => s.display_name.toLowerCase() === staffArg.toLowerCase());
  if (hit === undefined) die(`no staff "${staffArg}" on the roster`);
  return hit.staff_id;
}

const actor = await staffId();
let session = null;

async function signIn() {
  // 00 §6.9; takeover when the sender already holds a session (a previous run, or one kept over a hub restart)
  let r = await call(hub, 'POST', '/auth/pin', { headers: devHeaders, body: { staff_id: actor, pin } });
  if (!ok(r) && errCode(r) === 'DEVICE_SESSION_ACTIVE') {
    r = await call(hub, 'POST', '/auth/pin', { headers: devHeaders, body: { staff_id: actor, pin, takeover: true } });
  }
  if (!ok(r)) {
    appendJsonl(out, { label, ev: 'sign_in_failed', at: Date.now(), http_status: r.status, error: errCode(r) });
    if (['PIN_INVALID', 'PIN_LOCKED_OUT', 'DEVICE_TOKEN_INVALID', 'DEVICE_REVOKED'].includes(errCode(r))) die(`sign-in: ${errCode(r)}`);
    return false;
  }
  session = r.body.data.session_token;
  appendJsonl(out, { label, ev: 'signed_in', at: Date.now(), session_tail: String(session).slice(-6), expires: r.body.data.expires_at ?? r.body.data.idle_ttl_ms ?? null });
  return true;
}

let fired = 0;
let sessionFailStreak = 0;
async function fireOne(isRetry = false) {
  if (session === null && !(await signIn())) {
    appendJsonl(out, { label, alert_id: null, fired_at_laptop_ms: Date.now(), http_status: 0, error: 'not_signed_in' });
    return;
  }
  const body = envelope({
    commandType: 'SendTestAlert',
    payload: { target: { kind: 'device', device_id: targetId } },
    tenantId: sender.tenant_id,
    branchId: sender.branch_id,
    actorId: actor,
    deviceId: sender.device_id,
  });
  const firedAt = Date.now();
  const r = await call(hub, 'POST', '/commands/send-test-alert', {
    headers: { ...devHeaders, 'X-Session-Token': session },
    body,
  });
  const line = {
    label,
    alert_id: ok(r) ? r.body.data.result.alert_id : null,
    target_device_id: targetId,
    fired_at_laptop_ms: firedAt,
    answered_at_laptop_ms: Date.now(),
    http_status: r.status,
    error: ok(r) ? null : errCode(r),
  };
  appendJsonl(out, line);
  if (!args.quiet) process.stdout.write(JSON.stringify(line) + '\n');
  if (ok(r)) { fired++; sessionFailStreak = 0; }
  if (SESSION_ERRORS.has(line.error)) {
    // sign in again right now and retry this alert once, so a session expiry never silently stops the soak
    session = null;
    sessionFailStreak++;
    appendJsonl(out, { label, ev: 'session_error', at: Date.now(), error: line.error, details: r.body?.error?.details ?? null, streak: sessionFailStreak });
    process.stderr.write(`session ${line.error} (streak ${sessionFailStreak}) → signing in again\n`);
    if (sessionFailStreak >= 10) die(`10 session errors in a row (${line.error}); the hub rejects fresh sessions — check the hub log`);
    if (!isRetry) await fireOne(true);
  }
}

let stop = false;
process.on('SIGINT', () => {
  stop = true;
});

if (burst > 0) {
  for (let i = 0; i < burst && !stop; i++) await fireOne();
} else {
  let n = 0;
  while (!stop && Date.now() < endAt && n < maxCount) {
    await fireOne();
    n++;
    if (n >= maxCount) break;
    const wait = Math.max(0, intervalMs + Math.round((Math.random() * 2 - 1) * jitterMs));
    const until = Date.now() + wait;
    while (!stop && Date.now() < until) await sleep(Math.min(1000, until - Date.now()));
  }
}
process.stdout.write(`fired ${fired} ok → ${out}\n`);
