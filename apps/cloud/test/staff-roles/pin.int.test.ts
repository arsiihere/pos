import { verify } from '@node-rs/argon2';
import type { DefaultKey } from '@pos/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadDirectory } from '../../src/modules/hub-registration/repository';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;

describe('PIN set (01b §6.3)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;

  beforeAll(async () => {
    cloud = await createTestCloud({ captureLogs: true });
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    cloud.clock.set(T);
    f = await restaurantFixture(cloud);
  });

  const roleId = async (key: DefaultKey) =>
    (
      await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1 AND default_key = $2`, [
        f.tenantId,
        key,
      ])
    ).rows[0]!.role_id;
  const waiter = async (name = 'Bilal') => {
    const response = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/staff',
      ...owner(f),
      payload: { display_name: name, role_ids: [await roleId('waiter')], branch_ids: [f.branches[0]] },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.staff as { staff_id: string; version: string };
  };
  const setPin = (staffId: string, pin: unknown, token = f.token) =>
    cloud.app.inject({
      method: 'PUT',
      url: `/v1/admin/staff/${staffId}/pin`,
      headers: { authorization: `Bearer ${token}` },
      payload: { pin },
    });
  const stored = async (staffId: string) =>
    (
      await cloud.pool.query<{ pin_hash: string | null; pin_set_at: string | null }>(
        `SELECT pin_hash, pin_set_at FROM staff WHERE tenant_id = $1 AND staff_id = $2`,
        [f.tenantId, staffId],
      )
    ).rows[0]!;
  const directoryVersion = async () =>
    Number(
      (await cloud.pool.query(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [f.tenantId])).rows[0].directory_version,
    );
  const directoryOf = async (branchId: string) => {
    const client = await cloud.pool.connect();
    try {
      return (await loadDirectory(client, f.tenantId, branchId)).directory;
    } finally {
      client.release();
    }
  };

  it('[01b #3] PIN set stores an argon2id hash with M8 parameters that loadDirectory sends; a reset changes the hash', async () => {
    const person = await waiter();
    const v0 = await directoryVersion();
    const response = await setPin(person.staff_id, '1234');
    expect(response.statusCode, response.body).toBe(200);
    const { staff, changed_versions } = response.json().data;
    expect(staff).toMatchObject({ staff_id: person.staff_id, has_pin: true, pin_set_at: T, version: person.version });
    expect(staff).not.toHaveProperty('pin_hash');
    expect(changed_versions).toEqual({ staff: [], roles: [], responsibilities: [] });
    expect(await directoryVersion()).toBe(v0 + 1);
    const first = await stored(person.staff_id);
    expect(first.pin_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verify(first.pin_hash!, '1234')).toBe(true);
    const sent = (await directoryOf(f.branches[0])).staff.find((row) => row.staff_id === person.staff_id);
    expect(sent?.pin_hash).toBe(first.pin_hash);

    // The same PIN again is a reset, never a no-op (a new salt; the hub ends sessions, M50).
    expect((await setPin(person.staff_id, '1234')).statusCode).toBe(200);
    const second = await stored(person.staff_id);
    expect(second.pin_hash).not.toBe(first.pin_hash);
    expect(await directoryVersion()).toBe(v0 + 2);
    expect((await directoryOf(f.branches[0])).staff.find((row) => row.staff_id === person.staff_id)?.pin_hash).toBe(second.pin_hash);
  });

  it('[01b #25] the PIN in the request body never appears in logs', async () => {
    const person = await waiter();
    expect((await setPin(person.staff_id, '864209')).statusCode).toBe(200);
    cloud.app.log.info({ body: { pin: '975310' } }, 'probe');
    const logs = cloud.logs();
    expect(logs).toContain('probe');
    expect(logs).toContain('[Redacted]');
    expect(logs).not.toContain('864209');
    expect(logs).not.toContain('975310');
    expect(logs).not.toContain((await stored(person.staff_id)).pin_hash!);
  });

  it('[01b #58] PIN set and PIN reset each write one staff / pin_set audit row with { has_pin, pin_set_at } only', async () => {
    const person = await waiter();
    expect((await setPin(person.staff_id, '1234')).statusCode).toBe(200);
    cloud.clock.set(T + 5_000);
    expect((await setPin(person.staff_id, '5678')).statusCode).toBe(200);
    const audit = await cloud.pool.query(
      `SELECT entity, action, actor_kind, before, after FROM config_audit
        WHERE tenant_id = $1 AND entity_id = $2 AND action = 'pin_set' ORDER BY at, audit_id`,
      [f.tenantId, person.staff_id],
    );
    expect(audit.rows).toEqual([
      { entity: 'staff', action: 'pin_set', actor_kind: 'owner', before: { has_pin: false, pin_set_at: null }, after: { has_pin: true, pin_set_at: T } },
      {
        entity: 'staff',
        action: 'pin_set',
        actor_kind: 'owner',
        before: { has_pin: true, pin_set_at: T },
        after: { has_pin: true, pin_set_at: T + 5_000 },
      },
    ]);
    const all = JSON.stringify((await cloud.pool.query(`SELECT before, after FROM config_audit WHERE tenant_id = $1`, [f.tenantId])).rows);
    expect(all).not.toContain('pin_hash');
    expect(all).not.toContain('"pin"');
    expect(all).not.toContain('$argon2id$');
  });

  it('[01b §6.3] Urdu-keyboard digits and spaces → 400, nothing stored; "0123" keeps its leading zero and verifies', async () => {
    const person = await waiter();
    for (const pin of ['١٢٣٤', '12 34', '123', '1234567', 1234]) {
      const response = await setPin(person.staff_id, pin);
      expect(response.statusCode, String(pin)).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    }
    expect((await stored(person.staff_id)).pin_hash).toBeNull();
    expect((await setPin(person.staff_id, '0123')).statusCode).toBe(200);
    const hash = (await stored(person.staff_id)).pin_hash!;
    expect(await verify(hash, '0123')).toBe(true);
    expect(await verify(hash, '123')).toBe(false);
  });

  it('[01b §6.3] a person who left, an unknown id or another tenant\'s person → 404 STAFF_NOT_FOUND, nothing written', async () => {
    const person = await waiter();
    await cloud.pool.query(`UPDATE staff SET is_active = false, left_at = $3 WHERE tenant_id = $1 AND staff_id = $2`, [
      f.tenantId,
      person.staff_id,
      T,
    ]);
    const otherStaff = (
      await cloud.pool.query<{ staff_id: string }>(`SELECT staff_id FROM staff WHERE tenant_id = $1 LIMIT 1`, [f.other.tenantId])
    ).rows[0]!.staff_id;
    const v0 = await directoryVersion();
    for (const id of [person.staff_id, 'NO-SUCH-STAFF', otherStaff]) {
      const response = await setPin(id, '1234');
      expect(response.statusCode, id).toBe(404);
      expect(response.json().error).toMatchObject({ code: 'STAFF_NOT_FOUND', details: { staff_id: id } });
    }
    expect((await stored(person.staff_id)).pin_hash).toBeNull();
    expect(await directoryVersion()).toBe(v0);
  });

  it('[01b B8] an owner row that misses a branch → 403 tenant_wide_write, nothing written', async () => {
    const person = await waiter();
    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      f.tenantId,
      f.userId,
      [f.branches[0], f.branches[1]],
    ]);
    const response = await setPin(person.staff_id, '1234');
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'tenant_wide_write' } });
    expect((await stored(person.staff_id)).pin_hash).toBeNull();
  });
});
