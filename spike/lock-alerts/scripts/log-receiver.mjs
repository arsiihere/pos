#!/usr/bin/env node
/* eslint-disable -- throwaway spike tooling, outside the product gate (spike/lock-alerts) */
// Receives the spike app's device log over the LAN (no adb / USB needed).
//
//   node log-receiver.mjs [--port 8787]
//
// In the app: "Laptop log receiver" = http://<this-laptop-ip>:8787/log?label=S1 → "Upload log to laptop".
// Writes logs/tablet-<label>.jsonl (overwrites) and prints the clock skew estimate:
//   skew_ms = laptop_now_at_receipt - X-Device-Now   (laptop = the hub's machine; error ≈ one-way LAN delay)
// Use that value as analyse.mjs --skew-ms. Run this on the HUB's machine so "laptop time" = hub time.
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

const argv = process.argv.slice(2);
const portIdx = argv.indexOf('--port');
const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : 8787;
const logsDir = new URL('./logs/', import.meta.url).pathname;
mkdirSync(logsDir, { recursive: true });

const server = createServer((req, res) => {
  const receivedAt = Date.now();
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'x'}`);
  if (req.method !== 'POST' || url.pathname !== '/log') {
    res.writeHead(404).end('POST /log?label=<run>\n');
    return;
  }
  const label = (url.searchParams.get('label') || 'run').replace(/[^\w.-]/g, '_');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const file = `${logsDir}tablet-${label}.jsonl`;
    writeFileSync(file, body);
    const deviceNow = Number(req.headers['x-device-now']);
    const skew = Number.isFinite(deviceNow) ? receivedAt - deviceNow : null;
    const lines = body.toString('utf8').split('\n').filter(Boolean).length;
    const rec = { label, file, bytes: body.length, lines, received_at: receivedAt, device_now: deviceNow || null, skew_ms: skew };
    appendFileSync(`${logsDir}uploads.jsonl`, JSON.stringify(rec) + '\n');
    const msg = `saved ${lines} lines → ${file}\nskew_ms ${skew}  (use: --skew-ms ${skew})`;
    console.log(`[${new Date(receivedAt).toISOString()}] ${msg}`);
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end(msg + '\n');
  });
});

server.listen(port, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`log receiver on :${port}`);
  for (const ip of ips) console.log(`  in the app: http://${ip}:${port}/log?label=<run>`);
});
