#!/usr/bin/env node
/* eslint-disable -- throwaway spike tooling, outside the product gate (spike/lock-alerts) */
// Join a fire log with a device log (the spike app's spike-log.jsonl, or control-socket.mjs's log) and print the
// SPIKE_RESULTS.md "Results" row plus the missed / late list.
//
//   node analyse.mjs --fire logs/fire-S1.jsonl --device spike-log.jsonl --label S1 [--run R1] [--skew-ms N]
//                    [--outage <startMs>,<endMs>]... [--late-ms 3000]
//                    [--receipts devices/control.json --staff Arif --pin 1234]  (hub-side cross-check, optional)
//                    [--receipts-session <session_token> --receipts-device devices/x.json]
//
// Latency of an alert = device `alert_received.t` (first one for step 0) − `raised_at` (hub ms) + skew, where
// skew = hub clock − device clock (skew.mjs prints it; average of start and end). Alerts raised inside an --outage
// window are excluded from p50/p95/max and reported as "recover after outage end" = first receipt − outage end.
// The hub-side check: each fired alert should have an `AlertDelivered` for the target device in
// GET /queries/alert-receipts. That query needs a staff session with manage-devices on a device that is NOT the
// one under test while fire.mjs runs on the sender (a sign-in there would take its session over): use the control
// device, or pass an existing session.
import { parseArgs, need, die, readJsonl, call, ok, errCode, loadDevice, percentile } from './lib.mjs';

const args = parseArgs();
const fireLog = readJsonl(need(args, 'fire'));
const devLog = readJsonl(need(args, 'device'));
const label = typeof args.label === 'string' ? args.label : 'run';
const run = typeof args.run === 'string' ? args.run : label;
const skew = Number(args['skew-ms'] ?? 0);
const lateMs = Number(args['late-ms'] ?? 3000);
const outages = [].concat(args.outage ?? []).filter((o) => typeof o === 'string').map((o) => o.split(',').map(Number));

const fired = fireLog.filter((l) => typeof l.alert_id === 'string' && l.alert_id !== '');
const failedFires = fireLog.filter((l) => l.alert_id === null && l.fired_at_laptop_ms !== undefined).length;

// device side, per alert: first alert_received (step 0), notified, receipt_sent, duplicates
const byAlert = new Map();
const get = (id) => {
  if (!byAlert.has(id)) byAlert.set(id, { received: null, raisedAt: null, via: null, notified: 0, receipts: 0, dupes: 0 });
  return byAlert.get(id);
};
for (const l of devLog) {
  if (l.alert_id === undefined) continue;
  const a = get(l.alert_id);
  if (l.ev === 'alert_received' && (l.step ?? 0) === 0 && a.received === null) {
    a.received = l.t;
    a.raisedAt = l.raised_at;
    a.via = l.via;
  } else if (l.ev === 'notified') a.notified++;
  else if (l.ev === 'receipt_sent') a.receipts++;
  else if (l.ev === 'duplicate_dropped') a.dupes++;
}

const inOutage = (ms) => outages.find(([s, e]) => ms >= s && ms <= e);
const latencies = [];
const missed = [];
const late = [];
const recovers = [];
let received = 0;
let notified = 0;
let dupes = 0;
let doubleNotified = 0;
for (const f of fired) {
  const a = byAlert.get(f.alert_id);
  if (a === undefined || a.received === null) {
    missed.push({ alert_id: f.alert_id, fired: f.fired_at_laptop_ms });
    continue;
  }
  received++;
  if (a.notified > 0) notified++;
  if (a.notified > 1) doubleNotified++;
  dupes += a.dupes;
  const lat = a.received + skew - a.raisedAt;
  const outage = inOutage(a.raisedAt);
  if (outage !== undefined) recovers.push(a.received + skew - outage[1]);
  else {
    latencies.push(lat);
    if (lat > lateMs) late.push({ alert_id: f.alert_id, latency_ms: lat, via: a.via });
  }
}

// optional hub-side cross-check
let hubReceipts = '—';
if (args.receipts !== undefined || args['receipts-session'] !== undefined) {
  const dev = loadDevice(typeof args.receipts === 'string' ? args.receipts : need(args, 'receipts-device'));
  const headers = { Authorization: `Bearer ${dev.device_token}` };
  let session = typeof args['receipts-session'] === 'string' ? args['receipts-session'] : null;
  if (session === null) {
    const staff = need(args, 'staff');
    let staffId = staff;
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(staff)) {
      const roster = await call(dev.hub, 'GET', '/queries/staff-roster', { headers });
      if (!ok(roster)) die(`/queries/staff-roster → ${errCode(roster)}`);
      staffId = roster.body.data.staff.find((s) => s.display_name.toLowerCase() === staff.toLowerCase())?.staff_id ?? die(`no staff ${staff}`);
    }
    let r = await call(dev.hub, 'POST', '/auth/pin', { headers, body: { staff_id: staffId, pin: need(args, 'pin') } });
    if (!ok(r) && errCode(r) === 'DEVICE_SESSION_ACTIVE') {
      r = await call(dev.hub, 'POST', '/auth/pin', { headers, body: { staff_id: staffId, pin: args.pin, takeover: true } });
    }
    if (!ok(r)) die(`receipts sign-in → ${errCode(r)}`);
    session = r.body.data.session_token;
  }
  const target = fireLog.find((l) => l.target_device_id)?.target_device_id ?? args['target-device-id'] ?? null;
  let withReceipt = 0;
  const receiptLat = [];
  for (const f of fired) {
    const r = await call(dev.hub, 'GET', `/queries/alert-receipts?alert_id=${encodeURIComponent(f.alert_id)}`, {
      headers: { ...headers, 'X-Session-Token': session },
    });
    if (!ok(r)) die(`alert-receipts → ${r.status} ${errCode(r)}`);
    const delivered = r.body.data.receipts.filter((x) => x.kind === 'delivered' && x.step === 0 && (target === null || x.device_id === target));
    if (delivered.length > 0) {
      withReceipt++;
      const a = byAlert.get(f.alert_id);
      // raised_at from the device log; without one, the ULID time of the alert id (minted by the hub at raise)
      const raisedAt = a?.raisedAt ?? ulidTime(f.alert_id);
      if (raisedAt != null) receiptLat.push(delivered[0].at - raisedAt);
    }
  }
  receiptLat.sort((x, y) => x - y);
  hubReceipts = `${withReceipt}`;
  process.stderr.write(
    `hub receipts: ${withReceipt}/${fired.length} delivered on the hub; hub receipt time − raised_at p50 ${percentile(receiptLat, 50)} ms, p95 ${percentile(receiptLat, 95)} ms (≤ 1 s batching, A11)\n`,
  );
}

function ulidTime(id) {
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let t = 0;
  for (const c of String(id).slice(0, 10).toUpperCase()) {
    const v = A.indexOf(c);
    if (v < 0) return null;
    t = t * 32 + v;
  }
  return t;
}

latencies.sort((a, b) => a - b);
recovers.sort((a, b) => a - b);
const p50 = percentile(latencies, 50);
const p95 = percentile(latencies, 95);
const max = latencies.length ? latencies[latencies.length - 1] : null;
// reconnect after each outage: first `first_frame` on the device after the outage end (device clock + skew)
const firstFrames = devLog.filter((l) => l.ev === 'first_frame').map((l) => l.t + skew);
const reconnects = outages.map(([, end]) => {
  const f = firstFrames.find((t) => t >= end);
  return f === undefined ? 'never' : `${f - end}`;
});
const recoverParts = [];
if (reconnects.length) recoverParts.push(`reconnect ${reconnects.join(' / ')} ms`);
if (recovers.length) recoverParts.push(`${recovers.length} alerts raised in outage, last in ${recovers[recovers.length - 1]} ms`);
const recover = recoverParts.length ? recoverParts.join('; ') : '—';
// A re-sent row (alerts_open after a reconnect) that the dedupe dropped is correct behaviour, not a duplicate.
// "Dupes" counts only a second notification for one alert.
const noDeviceLog = devLog.length === 0;
const pass = !noDeviceLog && missed.length === 0 && notified === fired.length && doubleNotified === 0 && p95 !== null && p95 < 3000;

const cells = [
  run,
  label,
  fired.length,
  received,
  notified,
  hubReceipts,
  missed.length,
  doubleNotified,
  p50 ?? '—',
  p95 ?? '—',
  max ?? '—',
  recover,
  '(spot check)',
  '(battery)',
  noDeviceLog ? 'NO DEVICE LOG (hub receipts only)' : pass ? 'PASS (pending spot check)' : 'FAIL',
];
process.stdout.write(
  [
    `fired ok ${fired.length}, failed fires ${failedFires} (hub down / not signed in), re-sent rows dropped by dedupe ${dupes}, skew applied ${skew} ms, outages ${outages.length}`,
    '',
    '| Run | Scenario | Fired | Received | Notified | Hub receipts | Missed | Dupes | p50 ms | p95 ms | max ms | Recover after outage | Rang (spot check) | Battery %/h | PASS? |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    `| ${cells.join(' | ')} |`,
    '',
    noDeviceLog ? 'No device log: "Received/Missed" are not measured; use the hub receipts line.' : missed.length ? `Missed (${missed.length}):\n${missed.map((m) => `- ${m.alert_id} fired ${new Date(m.fired).toISOString()}`).join('\n')}` : 'Missed: none',
    late.length ? `Late > ${lateMs} ms (${late.length}):\n${late.map((m) => `- ${m.alert_id} ${m.latency_ms} ms via ${m.via}`).join('\n')}` : `Late > ${lateMs} ms: none`,
    '',
  ].join('\n'),
);
