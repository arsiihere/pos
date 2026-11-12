import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { currentDirectory } from '../../../hub/src/auth/guards';
import { swapBranchConfig } from '../../../hub/src/sync/branch-config-holder';
import { httpConfigClient } from '../../../hub/src/sync/config-client';
import { configPoller } from '../../../hub/src/sync/config-poller';
import { PIN, pinHash } from '../../../hub/test/helpers/fixtures';
import { createTestHub, type TestHub } from '../../../hub/test/helpers/test-hub';
import { openVoidsDay, signIn, stagedOrder, type Who } from '../../../hub/test/voids/fixtures';
import { seedMenu, restaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

// 04 §10 test 32, joined (Z1 review): "the hub directory after the backfill lists Manager in `approver_role_ids`
// (`role_permission_approvers` row present) and a Cashier void raises a request the Manager can approve". One run:
// a tenant seeded before 04 (no cashier void grants) → cloud migration 0013's backfill → the hub's real config poller
// pulls the directory over real HTTP → a Cashier VoidItems on that hub raises a void_approval request carrying the
// Manager role → the Manager approves with PIN → ItemVoided. Halves: void-defaults-backfill.int.test.ts (BF) and
// apps/hub/test/voids/permissions.int.test.ts (PE).

const backfill = fileURLToPath(new URL('../../src/db/migrations/0013_void_defaults_backfill.sql', import.meta.url));

describe('[04 #32] backfill → hub directory → Cashier void request → Manager approve', () => {
  let cloud: TestCloud;
  let base: string;
  const hubs: TestHub[] = [];

  beforeAll(async () => {
    cloud = await createTestCloud();
    await cloud.app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(cloud.app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await cloud.close();
  });
  afterEach(async () => {
    swapBranchConfig(null);
    for (const h of hubs.splice(0)) await h.close();
  });

  it('[04 #32] after 0013 the polled hub directory lists Manager in approver_role_ids; a Cashier void raises a request with [Manager] and the Manager approves it', async () => {
    const f = await restaurantFixture(cloud);
    await seedMenu(cloud.pool, f);
    const branch = f.branches[0];
    const roleId = async (key: string) =>
      (await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1 AND default_key = $2`, [f.tenantId, key])).rows[0]!.role_id;
    const [managerRole, cashierRole] = [await roleId('manager'), await roleId('cashier')];
    // a tenant seeded before 04: its cashier / order_taker roles hold neither void permission (approver rows cascade)
    await cloud.pool.query(
      `DELETE FROM role_permissions rp USING roles r
        WHERE r.tenant_id = rp.tenant_id AND r.role_id = rp.role_id AND rp.tenant_id = $1
          AND r.default_key IN ('cashier', 'order_taker') AND rp.permission IN ('void-item', 'move-item-to-stock')`,
      [f.tenantId],
    );
    // a Manager and a Cashier with PINs at branch A
    const [mgrHash, cashHash] = await Promise.all([pinHash(PIN.b), pinHash(PIN.c)]);
    await cloud.pool.query(
      `INSERT INTO staff (tenant_id, staff_id, display_name, pin_hash, pin_set_at, created_at, updated_at)
       VALUES ($1, 'S_MGR', 'Mo', $2, 1, 1, 1), ($1, 'S_CASH', 'Cy', $3, 1, 1, 1)`,
      [f.tenantId, mgrHash, cashHash],
    );
    await cloud.pool.query(`INSERT INTO staff_branches (tenant_id, branch_id, staff_id) VALUES ($1, $2, 'S_MGR'), ($1, $2, 'S_CASH')`, [f.tenantId, branch]);
    await cloud.pool.query(`INSERT INTO staff_roles (tenant_id, staff_id, role_id) VALUES ($1, 'S_MGR', $2), ($1, 'S_CASH', $3)`, [f.tenantId, managerRole, cashierRole]);

    await cloud.pool.query(readFileSync(backfill, 'utf8'));
    const approverRows = await cloud.pool.query(
      `SELECT approver_role_id FROM role_permission_approvers WHERE tenant_id = $1 AND role_id = $2 AND permission = 'void-item'`,
      [f.tenantId, cashierRole],
    );
    expect(approverRows.rows).toEqual([{ approver_role_id: managerRole }]);

    const hub = await createTestHub({
      config: { cloud_base_url: base, provisioned: { tenant_id: f.tenantId, branch_id: branch, branch_name: 'Branch A', branch_api_key: f.branchKey, confirmed_at: 1 } },
      configClient: httpConfigClient(base, f.branchKey),
    });
    hubs.push(hub);
    expect((await configPoller(hub.app).pollOnce()).outcome).toBe('applied');
    const directory = currentDirectory(hub.app);
    expect(directory.resolve('S_CASH', 'void-item')).toEqual({ grant: 'requires_approval', approver_role_ids: [managerRole], scope: 'branch' });
    expect(directory.resolve('S_CASH', 'move-item-to-stock')).toEqual({ grant: 'allowed', scope: 'branch' });

    openVoidsDay(hub);
    const s = stagedOrder(hub);
    const cashier = signIn(hub, 'S_CASH');
    const manager = signIn(hub, 'S_MGR');
    let seq = 0;
    const post = async (who: Who, path: string, command_type: string, payload: Record<string, unknown>) => {
      seq += 1;
      const res = await hub.app.inject({
        method: 'POST',
        url: `/commands/${path}`,
        headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
        payload: { command_id: `c32-${seq}`, tenant_id: f.tenantId, branch_id: branch, command_type, payload, occurred_at: hub.clock.branchNow(), actor_id: who.staffId, device_id: who.deviceId },
      });
      const body = res.json() as { data?: { event_ids: string[]; result: Record<string, unknown> }; error?: unknown };
      const events = (body.data?.event_ids ?? []).map((id) => {
        const row = hub.deps.db.prepare('SELECT event_type, payload FROM events WHERE event_id = ?').get(id) as { event_type: string; payload: string };
        return { event_type: row.event_type, payload: JSON.parse(row.payload) as Record<string, unknown> };
      });
      return { status: res.statusCode, body, events };
    };

    const asked = await post(cashier, 'void-items', 'VoidItems', { order_id: s.order_id, reason_code: 'customer_changed_mind', note: null, disposition_note: null, lines: [{ order_item_id: s.served, disposition: 'wastage' }] });
    expect(asked.status, JSON.stringify(asked.body.error)).toBe(200);
    expect(asked.events.map((e) => e.event_type)).not.toContain('ItemVoided');
    const raised = asked.events.find((e) => e.event_type === 'AlertRaised' && e.payload.kind === 'void_approval')!;
    expect(raised.payload).toMatchObject({ requester_staff_id: 'S_CASH', request: { right_mode: 'approval', base_permission: 'void-item', range_permission: 'approve-void', approver_role_ids: [managerRole] } });
    const alert_id = (asked.body.data!.result as { pending: Array<{ alert_id: string }> }).pending[0]!.alert_id;

    const approved = await post(manager, 'answer-request', 'AnswerRequest', { alert_id, decision: 'approve', method: 'pin', pin: PIN.b });
    expect(approved.status, JSON.stringify(approved.body.error)).toBe(200);
    expect(approved.events.filter((e) => e.event_type === 'ItemVoided').map((e) => e.payload)).toEqual([
      expect.objectContaining({ order_item_id: s.served, requester_staff_id: 'S_CASH', approver_staff_id: 'S_MGR', alert_id }),
    ]);
  }, 60_000);
});
