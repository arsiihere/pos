#!/usr/bin/env node
/* eslint-disable -- throwaway spike tooling, outside the product gate (spike/lock-alerts) */
// A laptop alert-mode socket (01d §3.7): the baseline that separates hub + LAN latency from tablet latency, and the
// stand-in tablet for a dry run without a device. Behaves like the spike app's AlertService:
//   auth { device_token } with no session_token → alerts_open, then alert frames; one `receipt delivered` per
//   (alert_id, step); reconnect 500 ms → 1 s → 2 s → 4 s → 5 s cap, reset after the first frame (01d §8.1);
//   4401 / 4403 / 4426 / 4409 are final.
// It writes the SAME JSONL as the device log (fields t, elapsed, ev, …), so analyse.mjs reads either.
//
//   node control-socket.mjs --device devices/control.json [--out logs/control.jsonl]
//   node control-socket.mjs --hub http://<hub>:3000 --token <device_token> [--out …]
//
// NEVER use the tablet's own token here: one alert-mode socket per device, the second closes the first 4409.
import { parseArgs, die, appendJsonl, readJsonl, loadDevice, sleep } from './lib.mjs';
import { existsSync } from 'node:fs';

const args = parseArgs();
let hub;
let token;
if (typeof args.device === 'string') {
  const d = loadDevice(args.device);
  hub = d.hub;
  token = d.device_token;
} else {
  hub = typeof args.hub === 'string' ? args.hub : die('give --device <file> or --hub + --token');
  token = typeof args.token === 'string' ? args.token : die('missing --token');
}
const out = typeof args.out === 'string' ? args.out : new URL('./logs/control.jsonl', import.meta.url).pathname;
const wsUrl = hub.replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws';
const FINAL = new Set([4401, 4403, 4426, 4409]);
const BACKOFF = [500, 1000, 2000, 4000, 5000];
const t0 = performance.now();

const log = (ev, fields = {}) => {
  const line = { t: Date.now(), elapsed: Math.round(performance.now() - t0), ev, ...fields };
  appendJsonl(out, line);
  if (!args.quiet) process.stdout.write(JSON.stringify(line) + '\n');
};

// dedupe (alert_id, step), seeded from an existing log so a restart of this script never "notifies" twice
const seen = new Set();
if (existsSync(out)) for (const l of readJsonl(out)) if (l.ev === 'notified') seen.add(`${l.alert_id}:${l.step}`);

let attempt = 0;
let stopped = false;
let current = null;
const counts = { received: 0, notified: 0, reconnects: 0 };

function onAlert(ws, alert, via) {
  const key = `${alert.alert_id}:${alert.step}`;
  log('alert_received', { alert_id: alert.alert_id, step: alert.step, raised_at: alert.raised_at, family: alert.family, via });
  counts.received++;
  if (seen.has(key)) {
    log('duplicate_dropped', { alert_id: alert.alert_id, step: alert.step });
    return;
  }
  seen.add(key);
  log('notified', { alert_id: alert.alert_id, step: alert.step });
  counts.notified++;
  ws.send(JSON.stringify({ type: 'receipt', alert_id: alert.alert_id, kind: 'delivered', step: alert.step }));
  log('receipt_sent', { alert_id: alert.alert_id, step: alert.step });
}

let generation = 0;
const CONNECT_TIMEOUT_MS = 10_000;

async function scheduleReconnect() {
  if (stopped) return;
  const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
  attempt++;
  counts.reconnects++;
  log('reconnect_scheduled', { delay_ms: delay });
  await sleep(delay);
  if (!stopped) connect();
}

function connect() {
  const gen = ++generation;
  log('socket_open', { url: wsUrl });
  const ws = new WebSocket(wsUrl);
  current = ws;
  let firstFrame = false;
  // A hub that is stopping (or a half-open TCP path) can accept the connection and never answer: without this the
  // socket would sit in CONNECTING forever. Abandon it and reconnect (its late events are ignored by generation).
  const connectTimer = setTimeout(() => {
    if (firstFrame || gen !== generation) return;
    log('connect_timeout', { ms: CONNECT_TIMEOUT_MS });
    generation++;
    try {
      ws.close();
    } catch {
      /* CONNECTING */
    }
    void scheduleReconnect();
  }, CONNECT_TIMEOUT_MS);
  ws.addEventListener('open', () => {
    if (gen !== generation) {
      ws.close(1000); // an abandoned attempt must never authenticate: it would take the device's alert socket (4409)
      return;
    }
    ws.send(JSON.stringify({ type: 'auth', device_token: token }));
    log('auth_sent');
  });
  ws.addEventListener('message', (msg) => {
    let frame;
    try {
      frame = JSON.parse(String(msg.data));
    } catch {
      log('frame', { type: 'unparsable' });
      return;
    }
    if (gen !== generation) return;
    if (!firstFrame) {
      firstFrame = true;
      clearTimeout(connectTimer);
      attempt = 0;
      log('first_frame', { type: frame.type });
    }
    log('frame', { type: frame.type });
    if (frame.type === 'alerts_open') for (const row of frame.alerts) onAlert(ws, row, 'alerts_open');
    else if (frame.type === 'alert') onAlert(ws, frame.alert, 'alert');
  });
  ws.addEventListener('close', (e) => {
    clearTimeout(connectTimer);
    if (gen !== generation) return;
    log('socket_closed', { code: e.code, reason: e.reason });
    if (stopped) return;
    if (FINAL.has(e.code)) {
      log('stopped', { code: e.code });
      stopped = true;
      process.exitCode = 2;
      return;
    }
    void scheduleReconnect();
  });
  ws.addEventListener('error', () => {
    /* a close event follows */
  });
}

const hb = setInterval(() => log('heartbeat', { ...counts, socket: current?.readyState ?? -1 }), 300_000);
process.on('SIGINT', () => {
  stopped = true;
  clearInterval(hb);
  log('service_destroyed', counts);
  current?.close(1000);
  setTimeout(() => process.exit(0), 200);
});
log('service_start', { reason: 'user' });
connect();
