import { request as httpRequest } from 'node:http';
import type { DirectoryInput } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FX, openDay } from './fixtures';

// 02b §6.14 over a REAL socket (inject() bypasses Node's header limit): the ≤ 8 KB draft rides in the query string, and
// its URL-encoding can pass Node's default 16 KB maxHeaderSize. Owner ruling 2026-11-11 (option a): the hub server's
// maxHeaderSize is 64 KB, so every legal draft reaches the query and an over-8 KB one gets the hub's 400, not Node's 431.

let hub: TestHub;

afterEach(async () => {
  activity.drain();
  swapBranchConfig(null);
  await hub.close();
});

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const grant = (permission: string) => ({ permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope: 'branch' as const });
  return {
    ...base,
    roles: [...base.roles, { role_id: 'R_TAKER', name: 'R_TAKER', session_idle_ttl_ms: 3_600_000, permissions: [grant('take-order')] }],
    staff: [...base.staff, { staff_id: 'S_ALI', display_name: 'Ali', pin_hash: pin, role_ids: ['R_TAKER'], denied_permissions: [], lead_staff_id: null, floor_ids: [] }],
  };
}

async function listen(): Promise<{ port: number; headers: Record<string, string> }> {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  openDay(hub, {});
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId: 'S_ALI', deviceId: device.deviceId });
  const address = await hub.app.listen({ host: '127.0.0.1', port: 0 });
  return {
    port: Number(new URL(address).port),
    headers: { host: '192.168.10.2:3000', authorization: `Bearer ${device.token}`, 'x-session-token': session.token },
  };
}

function get(port: number, path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'GET', path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

// 80 Urdu letters (the kitchen_note max): 2 UTF-8 bytes each, 6 encoded chars each.
const URDU_NOTE = 'مرچ کم'.padEnd(80, 'ک');
const draft = (lineCount: number) => ({
  order_type: 'takeaway',
  lines: Array.from({ length: lineCount }, (_, i) => ({ key: `k${String(i).padStart(2, '0')}`, item_id: FX.naan, quantity: 1, kitchen_note: URDU_NOTE })),
});

describe('02b eta-preview over a real socket (§6.14; owner 2026-11-11)', () => {
  it('[02b §6.14] a legal ≤ 8 KB draft whose URL-encoding is > 16 KB reaches the query over a real socket', async () => {
    const { port, headers } = await listen();
    const raw = JSON.stringify(draft(36));
    const encoded = encodeURIComponent(raw);
    expect(Buffer.byteLength(raw, 'utf8')).toBeLessThanOrEqual(8_192);
    expect(encoded.length).toBeGreaterThan(16_384);
    const res = await get(port, `/queries/eta-preview?draft=${encoded}`, headers);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { data: { lines: Array<{ key: string }> } };
    expect(body.data.lines).toHaveLength(36);
  });

  it('[02b §6.14] an over-8 KB draft over a real socket → 400 VALIDATION_FAILED, not 431', async () => {
    const { port, headers } = await listen();
    const raw = JSON.stringify(draft(40));
    const encoded = encodeURIComponent(raw);
    expect(Buffer.byteLength(raw, 'utf8')).toBeGreaterThan(8_192);
    expect(encoded.length).toBeGreaterThan(16_384);
    const res = await get(port, `/queries/eta-preview?draft=${encoded}`, headers);
    expect(res.status).toBe(400);
    expect((JSON.parse(res.body) as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });
});
