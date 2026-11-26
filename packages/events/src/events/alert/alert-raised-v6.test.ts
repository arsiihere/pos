// ⚠️ 01d v1.3.7 §5.4 (the single definition of AlertRaised v6; run 3 R3-B-1, D5, Foundation D46), test 123: v1–v5
// keep the persisted permission enums they were stored with (frozen), v6 carries the live list, v5 → v6 is the identity.
import { PERMISSIONS } from '@pos/domain';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { latestVersion, parseEvent } from '../../index.js';
import { payloadSchema } from '../../registry.js';
import { ALERT_RAISED_PERMISSIONS_V1_V5 } from './AlertRaised.v1.js';

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url)), 'utf8')) as Record<string, unknown>;

/** 05's holders request as stored at v5: a permission target arm and both request permissions set. */
function v5Holders(): Record<string, unknown> {
  const stored = fixture('AlertRaised.v5.json');
  return {
    ...stored,
    payload: {
      ...(stored.payload as Record<string, unknown>),
      kind: 'petty_cash',
      family: 'urgent',
      target: { kind: 'permission', permission: 'close-shift-for-others' },
      request: {
        answers: ['approve', 'reject'],
        right_mode: 'holders',
        base_permission: 'close-shift-for-others',
        range_permission: 'record-petty-cash',
        approver_role_ids: [],
        receiver_staff_id: null,
        needs_pin: 'always',
      },
    },
  };
}

/** The three persisted permission fields of one AlertRaised version's payload schema. */
function accepts(version: number, permission: string): boolean {
  const schema = payloadSchema('AlertRaised', version);
  const base = v5Holders().payload as Record<string, unknown>;
  const request = base.request as Record<string, unknown>;
  // v1–v4 know only the `approval` / `named` rights (05 D-1 added `holders` at v5)
  const req = version < 5 ? { ...request, right_mode: 'approval' } : request;
  const cases: Array<Record<string, unknown>> = [
    { ...base, request: req, target: { kind: 'permission', permission } },
    { ...base, request: { ...req, base_permission: permission } },
    { ...base, request: { ...req, range_permission: permission } },
  ];
  const results = cases.map((p) => schema.safeParse(p).success);
  if (new Set(results).size !== 1) throw new Error(`v${version} '${permission}': the three fields disagree ${JSON.stringify(results)}`);
  return results[0]!;
}

describe('[01d v1.3.7 §5.4, #123] AlertRaised v6', () => {
  it('is the latest version, registered with an identity upcaster from v5', () => {
    expect(latestVersion('AlertRaised')).toBe(6);
    const stored = fixture('AlertRaised.v5.json');
    const upcast = parseEvent(stored);
    expect(upcast.schema_version).toBe(6);
    expect(upcast.payload).toEqual(stored.payload);
  });

  it('replays a stored v5 holders request (permission target arm, base and range permissions) unchanged', () => {
    const stored = v5Holders();
    const upcast = parseEvent(stored);
    expect(upcast).toEqual({ ...stored, schema_version: 6 });
    expect(parseEvent(JSON.parse(JSON.stringify(upcast)))).toEqual(upcast);
  });

  it('v1–v5 are frozen to the pre-B-5 permission list; v6 takes the live PERMISSIONS', () => {
    for (const permission of ALERT_RAISED_PERMISSIONS_V1_V5) {
      for (const version of [1, 2, 3, 4, 5, 6]) expect(accepts(version, permission), `v${version} ${permission}`).toBe(true);
    }
    for (const permission of PERMISSIONS) expect(accepts(6, permission), permission).toBe(true);
    for (const version of [1, 2, 3, 4, 5, 6]) expect(accepts(version, 'not-a-permission'), `v${version}`).toBe(false);
    // the freeze is the list before 01b v1.12 B-5: the live list minus its one new key
    expect([...ALERT_RAISED_PERMISSIONS_V1_V5]).toEqual(PERMISSIONS.filter((p) => p !== 'hand-over-unpaid'));
  });

  it('hand-over-unpaid: v6 accepts it in the permission target arm, base_permission and range_permission; v1–v5 refuse it', () => {
    expect(accepts(6, 'hand-over-unpaid')).toBe(true);
    for (const version of [1, 2, 3, 4, 5]) expect(accepts(version, 'hand-over-unpaid'), `v${version}`).toBe(false);
    // the OR-7 holders request as 02b's hand_over_unpaid kind writes it, appended and replayed at v6
    const stored = v5Holders();
    const or7 = {
      ...stored,
      schema_version: 6,
      payload: {
        ...(stored.payload as Record<string, unknown>),
        kind: 'hand_over_unpaid',
        target: { kind: 'answerers' },
        request: { ...((stored.payload as Record<string, unknown>).request as Record<string, unknown>), base_permission: 'hand-over-unpaid', range_permission: null },
      },
    };
    expect(parseEvent(or7)).toEqual(or7);
    expect(parseEvent(JSON.parse(JSON.stringify(or7)))).toEqual(or7);
    // the v5 payload schema itself refuses the OR-7 payload (parseEvent validates the upcast result at the latest version)
    expect(payloadSchema('AlertRaised', 5).safeParse(or7.payload).success).toBe(false);
    expect(payloadSchema('AlertRaised', 6).safeParse(or7.payload).success).toBe(true);
  });
});
