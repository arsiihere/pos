import type { DirectoryInput, PosEvent } from '@pos/events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerFiscalWorkerSeams, resetFiscalWorkerSeams, startBillingWorkers } from '../../src/billing/index';
import { registerHubProjections } from '../../src/lib/boot';
import type { Projection, ProjectionRegistry } from '../../src/projections/registry';
import type { HubDeps } from '../../src/server';
import { audienceAllows } from '../../src/ws/audience';
import type { SocketCtx } from '../../src/ws/catch-up';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';

// 05 §6.30 (task 7): `billing` in registerHubProjections (G-20), the OrdersCarriedOver audience (S-B, §6.30) and
// startBillingWorkers (G-21): the fiscal worker starts only once 29b registered loadSubmission and onAnswer.

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  vi.useRealTimers();
  resetFiscalWorkerSeams();
  for (const c of cleanups.splice(0)) await c();
});

describe('[05 §5, G-20] registerHubProjections', () => {
  it('[05 §5, G-20] registers `billing` once, with reset, after orders, tables and audit', () => {
    const seen: Projection[] = [];
    registerHubProjections({ register: (p: Projection) => seen.push(p), afterCatchUp: () => undefined } as unknown as ProjectionRegistry);
    const names = seen.map((p) => p.name);
    expect(names.filter((n) => n === 'billing')).toHaveLength(1);
    for (const before of ['orders', 'tables', 'audit']) expect(names.indexOf('billing')).toBeGreaterThan(names.indexOf(before));
    expect(seen.find((p) => p.name === 'billing')!.reset).toBeTypeOf('function');
  });

  it('[05 §5, H-2] the test hub writes the billing checkpoint row', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const row = hub.deps.db.prepare(`SELECT last_seq FROM projection_checkpoints WHERE projection = 'billing'`).get();
    expect(row).toEqual({ last_seq: 0 });
  });
});

const socket = (o: Partial<SocketCtx>): SocketCtx => ({
  deviceId: 'D1',
  deviceType: 'tablet',
  sessionId: 'X1',
  kind: 'staff',
  staffId: null,
  stationId: null,
  asOfSeq: 0,
  ...o,
});

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const grant = (permission: string, grant_type: 'allowed' | 'requires_approval' = 'allowed') => ({
    permission,
    grant_type,
    approver_role_id: grant_type === 'allowed' ? null : 'R_MGR',
    approver_role_ids: grant_type === 'allowed' ? [] : ['R_MGR'],
    scope: 'branch' as const,
  });
  const pin = base.staff[0]!.pin_hash;
  const person = (staff_id: string, role_id: string) => ({ staff_id, display_name: staff_id, pin_hash: pin, role_ids: [role_id], denied_permissions: [], lead_staff_id: null, floor_ids: [] });
  return {
    ...base,
    roles: [
      ...base.roles,
      { role_id: 'R_VR', name: 'Reports', session_idle_ttl_ms: 300_000, permissions: [grant('view-reports')] },
      { role_id: 'R_CBD', name: 'Day close', session_idle_ttl_ms: 300_000, permissions: [grant('close-business-day')] },
      { role_id: 'R_VRA', name: 'Reports with approval', session_idle_ttl_ms: 300_000, permissions: [grant('view-reports', 'requires_approval')] },
    ],
    staff: [...base.staff, person('S_VR', 'R_VR'), person('S_CBD', 'R_CBD'), person('S_VRA', 'R_VRA')],
  } as DirectoryInput;
}

describe('[05 §6.30, S-B] OrdersCarriedOver audience', () => {
  const ev = { event_type: 'OrdersCarriedOver', actor_id: 'S_MGR', payload: {} } as unknown as PosEvent;

  it('[05 §6.30] holders of view-reports or close-business-day only (allowed grants, 01d holders); never a station; removed on close', async () => {
    const hub: TestHub = await createTestHub();
    let closed = false;
    cleanups.push(async () => {
      if (!closed) await hub.close();
    });
    await seedDirectory(hub, await directory());
    expect(audienceAllows(ev, socket({ staffId: 'S_VR' }))).toBe(true);
    expect(audienceAllows(ev, socket({ staffId: 'S_CBD' }))).toBe(true);
    expect(audienceAllows(ev, socket({ staffId: 'S_MGR' }))).toBe(true);
    expect(audienceAllows(ev, socket({ staffId: 'S_VRA' }))).toBe(false); // requires_approval is not holding it
    expect(audienceAllows(ev, socket({ staffId: 'S_CASH' }))).toBe(false);
    expect(audienceAllows(ev, socket({ staffId: 'S_CASH', deviceType: 'cashier_kiosk' }))).toBe(false);
    expect(audienceAllows(ev, socket({ staffId: 'S_GHOST' }))).toBe(false);
    expect(audienceAllows(ev, socket({ kind: 'station', stationId: 'ST1' }))).toBe(false);
    await hub.close();
    closed = true;
    expect(audienceAllows(ev, socket({ staffId: 'S_VR' }))).toBe(false);
  });
});

describe('[05 G-21, H-3] startBillingWorkers', () => {
  const log = { error: vi.fn(), info: vi.fn() };

  it('[05 G-21] with no seams registered it starts nothing, touches nothing and fails nothing; stop is a no-op', () => {
    vi.useFakeTimers();
    const untouchable = new Proxy({}, { get: () => { throw new Error('touched'); } });
    const deps = { db: untouchable, clock: untouchable } as unknown as HubDeps;
    const stop = startBillingWorkers(deps, log);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(log.error).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it('[05 G-21] once loadSubmission and onAnswer are registered, the fiscal worker runs over fiscal_outbox and stop ends it', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const loadSubmission = vi.fn(() => ({ ok: false as const, error_code: 'not_yet' }));
    const onAnswer = vi.fn();
    registerFiscalWorkerSeams({ loadSubmission, onAnswer });
    vi.useFakeTimers();
    const passes = vi.spyOn(hub.deps.db, 'prepare');
    const stop = startBillingWorkers(hub.deps, log);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(passes.mock.calls.some(([sql]) => /FROM fiscal_outbox WHERE state = 'pending'/.test(String(sql)))).toBe(true);
    expect(log.error).not.toHaveBeenCalled();
    stop();
    expect(vi.getTimerCount()).toBe(0);
    passes.mockRestore();
  });
});
