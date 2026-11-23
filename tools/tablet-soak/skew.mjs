#!/usr/bin/env node
/* eslint-disable -- 05b §10.4 soak field tooling (from spike/lock-alerts), outside the product gate */
// skew = hub clock − device clock, in ms. analyse.mjs adds it to device times (--skew-ms). Run at the start and the
// end of every soak run; use the mean, and report the drift (end − start).
//
//   node skew.mjs --hub http://<hub>:3000 [--serial <adb serial>] [--samples 5]
//   node skew.mjs --hub http://<hub>:3000 --device-ms <ms>       (no adb: read the device clock some other way)
//   node skew.mjs --hub … --laptop                                (control socket on this laptop: device = laptop)
//
// Hub time: the `pos-hub-now-ms` meta of GET /staff/ (the hub's own clock, 00 / 01a hub_time), taken at the
// midpoint of the request. Device time: `adb shell date +%s%3N`, at the midpoint of the adb call. Each sample's
// error is at most half of each round trip; the sample with the smallest round trips wins.
import { spawnSync } from 'node:child_process';
import { parseArgs, need, die, call, hubBase } from './lib.mjs';

const args = parseArgs();
const hub = hubBase(need(args, 'hub'));
const samples = Number(args.samples ?? 5);

async function hubNow() {
  const sent = Date.now();
  const r = await call(hub, 'GET', '/staff/');
  const back = Date.now();
  if (r.status === 200 && typeof r.body === 'string') {
    const m = r.body.match(/name="pos-hub-now-ms" content="(\d+)"/);
    if (m) return { hub: Number(m[1]), mid: (sent + back) / 2, rtt: back - sent };
  }
  // fallback: the HTTP Date header (1 s resolution)
  const date = r.headers?.get?.('date');
  if (date) return { hub: Date.parse(date) + 500, mid: (sent + back) / 2, rtt: back - sent, coarse: true };
  die(`GET /staff/ → ${r.status}; no pos-hub-now-ms meta and no Date header`);
}

function deviceNow() {
  if (args.laptop) return { dev: Date.now(), mid: Date.now(), rtt: 0 };
  if (args['device-ms'] !== undefined) return { dev: Number(args['device-ms']), mid: Date.now(), rtt: 0, manual: true };
  const adb = ['shell', 'date', '+%s%3N'];
  if (typeof args.serial === 'string') adb.unshift('-s', args.serial);
  const sent = Date.now();
  const r = spawnSync('adb', adb, { encoding: 'utf8', timeout: 10_000 });
  const back = Date.now();
  if (r.error) die(`adb: ${r.error.message} (install platform-tools, or pass --device-ms / --laptop)`);
  const txt = r.stdout.trim();
  if (/^\d{13}$/.test(txt)) return { dev: Number(txt), mid: (sent + back) / 2, rtt: back - sent };
  // some toybox builds print %3N literally: fall back to seconds
  const s = spawnSync('adb', adb.map((a) => (a === '+%s%3N' ? '+%s' : a)), { encoding: 'utf8', timeout: 10_000 }).stdout.trim();
  if (/^\d{10}$/.test(s)) return { dev: Number(s) * 1000 + 500, mid: (sent + back) / 2, rtt: back - sent, coarse: true };
  die(`adb date printed "${txt}"`);
}

let best = null;
for (let i = 0; i < samples; i++) {
  const h = await hubNow();
  const d = deviceNow();
  // both clocks referred to the laptop clock at their midpoints
  const skew = Math.round(h.hub - h.mid - (d.dev - d.mid));
  const err = Math.round(h.rtt / 2 + d.rtt / 2);
  if (best === null || err < best.err) best = { skew, err, coarse: h.coarse || d.coarse };
  if (d.manual) break;
}
process.stdout.write(
  `skew_ms ${best.skew}   (hub − device; ± ${best.err} ms${best.coarse ? ', COARSE: 1 s resolution on one side' : ''})\n` +
    `use: node analyse.mjs … --skew-ms ${best.skew}\n`,
);
