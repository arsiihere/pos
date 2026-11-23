#!/usr/bin/env node
/* eslint-disable -- 05b §10.4 soak field tooling (from spike/lock-alerts), outside the product gate */
// Mint a `tablet` device token on a hub at `main` (00 §6.7 GenerateDevicePairingToken + §6.8 POST /devices/pair).
//
//   node mint-tablet-token.mjs --hub http://<hub>:3000 <admin auth> [--label tablet-a] [--sender] [--out devices/<label>.json]
//
// <admin auth> is one of (see lib.mjs adminSession):
//   --admin-session <tok>
//   --bootstrap <tok> --staff <id|name> --pin <pin>
//   --admin-device-token <tok> --staff <id|name> --pin <pin>
//
// --sender only changes the default label/name ("soak-sender"): the sender is a second tablet that fire.mjs signs a
// manager in on. Use --label control for the laptop control socket's own device.
// Writes the device file (mode 600; it holds the device token). The tablet under test pairs itself by request
// (05b M-16, the pair page); mint tokens here only for the sender and the laptop control socket.
import { parseArgs, need, die, ulid, call, ok, errCode, adminSession, adminCommand, writeJson } from './lib.mjs';

const args = parseArgs();
const hub = need(args, 'hub', 'e.g. http://192.168.1.10:3000');
const label = typeof args.label === 'string' ? args.label : args.sender ? 'sender' : 'tablet';
const name = typeof args.name === 'string' ? args.name : `soak-${label}`.slice(0, 40);
const out = typeof args.out === 'string' ? args.out : new URL(`./devices/${label}.json`, import.meta.url).pathname;

const admin = await adminSession(hub, args);

// tenant / branch for the envelope (01a §6.21 config-status, admin session)
const status = await call(hub, 'GET', '/admin/queries/config-status', { headers: admin.authHeaders });
if (!ok(status)) die(`/admin/queries/config-status → ${status.status} ${errCode(status)}`);
const ids = { tenant_id: status.body.data.tenant_id, branch_id: status.body.data.branch_id };
if (ids.tenant_id == null || ids.branch_id == null) die('hub is not provisioned (config-status has no tenant/branch)');

// 00 §6.7: a tablet token has no owner
const minted = await adminCommand(hub, admin, ids, 'GenerateDevicePairingToken', { device_type: 'tablet' });

// 00 §6.8: pair with it (fresh ULID pair_request_id; a retry with the same id within 10 min rotates)
const pair = await call(hub, 'POST', '/devices/pair', {
  body: { pairing_token: minted.pairing_token, pair_request_id: ulid(), device_name: name, device_type: 'tablet' },
});
if (!ok(pair)) die(`/devices/pair → ${pair.status} ${errCode(pair)} ${JSON.stringify(pair.body?.error?.details ?? {})}`);
const d = pair.body.data;

const file = {
  label,
  hub: hub.replace(/\/+$/, ''),
  tenant_id: ids.tenant_id,
  branch_id: ids.branch_id,
  device_id: d.device_id,
  device_token: d.device_token,
  device_type: d.device_type,
  device_name: name,
  minted_at: Date.now(),
};
writeJson(out, file);

process.stdout.write(
  [
    `device_id    ${d.device_id}`,
    `device_type  ${d.device_type}`,
    `device_token ${d.device_token}`,
    `written      ${out}`,
    '',
    `admin session (reuse for the next mint while it is not idle): --admin-session ${admin.session} --staff ${admin.staffId}`,
    '',
  ].join('\n'),
);
