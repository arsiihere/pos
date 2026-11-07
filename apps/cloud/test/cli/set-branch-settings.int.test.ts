import { BranchConfigSnapshotSchemaV3 } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runSetBranchSettings, setBranchSettings } from '../../src/cli/set-branch-settings';
import { SystemContext } from '../../src/cli/system-context';
import { ulidGen } from '../../src/lib/ids';
import { restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

describe('set-branch-settings', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let errors: string[];

  beforeAll(async () => {
    cloud = await createTestCloud();
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
    errors = [];
  });

  const run = (...argv: string[]) =>
    runSetBranchSettings(argv, {
      sys: new SystemContext(cloud.pool),
      clock: cloud.clock,
      ids: ulidGen(cloud.clock),
      out: () => {},
      err: (line) => errors.push(line),
    });
  const settings = async (branchId: string) =>
    (
      await cloud.pool.query(
        `SELECT tax_enabled, day_stale_after_hours, day_min_gap_hours FROM branches WHERE branch_id = $1`,
        [branchId],
      )
    ).rows[0];
  const audit = async () =>
    (
      await cloud.pool.query(
        `SELECT actor_kind, actor_owner_user_id, branch_id, entity, entity_id, action, before, after FROM config_audit ORDER BY at, audit_id`,
      )
    ).rows;
  const versions = async () =>
    (
      await cloud.pool.query<{ branch_id: string; config_version: string }>(
        `SELECT branch_id, config_version FROM branches ORDER BY branch_id`,
      )
    ).rows.map((row) => [row.branch_id, Number(row.config_version)]);
  const everything = async () => ({ a: await settings(f.branches[0]), b: await settings(f.branches[1]), audit: await audit(), versions: await versions() });
  // Branch A's snapshot, polled with its key.
  const snapshot = async () => {
    const response = await cloud.app.inject({
      method: 'GET',
      url: '/v1/sync/config?config_version=0&directory_version=0',
      headers: { authorization: `Bearer ${f.branchKey}` },
    });
    expect(response.statusCode).toBe(200);
    return response.json().data.config.snapshot as Record<string, unknown>;
  };
  const without = (o: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
  const bumped = (before: Array<(string | number)[]>, after: Array<(string | number)[]>) =>
    after.filter((row, i) => row[1] !== before[i]![1]).map((row) => row[0]);

  it('[01a §10 #105] --tax-enabled true → row updated, one cli audit row with before / after, only this branch bumped, the value in the next snapshot; --business-day-start refused, nothing written', async () => {
    const [a] = f.branches;
    const v0 = await versions();
    expect(await run('--branch', a, '--tax-enabled', 'true')).toBe(0);
    expect(await settings(a)).toEqual({ tax_enabled: true, day_stale_after_hours: 16, day_min_gap_hours: 4 });
    expect(await audit()).toEqual([
      {
        actor_kind: 'cli',
        actor_owner_user_id: null,
        branch_id: a,
        entity: 'branch_settings',
        entity_id: a,
        action: 'update',
        before: { tax_enabled: false, day_stale_after_hours: 16, day_min_gap_hours: 4 },
        after: { tax_enabled: true, day_stale_after_hours: 16, day_min_gap_hours: 4 },
      },
    ]);
    expect(bumped(v0, await versions())).toEqual([a]);
    expect((await snapshot()).tax_enabled).toBe(true);

    const before = await everything();
    expect(await run('--branch', a, '--business-day-start', '0')).toBe(1);
    expect(errors.join('\n')).toMatch(/business-day-start/);
    expect(await everything()).toEqual(before);
  });

  it('[01a §10 #108] a new branch snapshot has tax_enabled false; after --tax-enabled true the next one has true; the snapshot schema rejects a missing tax_enabled', async () => {
    const first = await snapshot();
    expect(first.tax_enabled).toBe(false);
    expect(BranchConfigSnapshotSchemaV3.safeParse(first).success).toBe(true);
    expect(await run('--branch', f.branches[0], '--tax-enabled', 'true')).toBe(0);
    expect((await snapshot()).tax_enabled).toBe(true);
    expect(BranchConfigSnapshotSchemaV3.safeParse(without(first, 'tax_enabled')).success).toBe(false);
  });

  it('[01a §10 #154] day settings: 20 / 2 updated, audited, this branch bumped, in the snapshot; a new branch has 16 / 4; out-of-range or stale ≤ gap → exit 1, nothing written; the schema rejects a missing field', async () => {
    const [a, b] = f.branches;
    const first = await snapshot();
    expect(first).toMatchObject({ day_stale_after_hours: 16, day_min_gap_hours: 4 });
    const v0 = await versions();
    expect(await run('--branch', a, '--day-stale-after-hours', '20', '--day-min-gap-hours', '2')).toBe(0);
    expect(await settings(a)).toEqual({ tax_enabled: false, day_stale_after_hours: 20, day_min_gap_hours: 2 });
    const rows = await audit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_kind: 'cli',
      entity: 'branch_settings',
      action: 'update',
      before: { day_stale_after_hours: 16, day_min_gap_hours: 4 },
      after: { day_stale_after_hours: 20, day_min_gap_hours: 2 },
    });
    expect(bumped(v0, await versions())).toEqual([a]);
    expect(await snapshot()).toMatchObject({ day_stale_after_hours: 20, day_min_gap_hours: 2 });
    expect(await settings(b)).toEqual({ tax_enabled: false, day_stale_after_hours: 16, day_min_gap_hours: 4 });

    const before = await everything();
    for (const argv of [
      ['--branch', b, '--day-stale-after-hours', '0'],
      ['--branch', b, '--day-stale-after-hours', '73'],
      ['--branch', b, '--day-min-gap-hours', '25'],
      ['--branch', b, '--day-min-gap-hours', '20'], // stale stays 16: stale must be greater
      ['--branch', b, '--day-min-gap-hours', '1.5'],
      ['--branch', b, '--tax-enabled', 'yes'],
      ['--branch', b],
      ['--day-min-gap-hours', '2'],
      ['--branch', 'NO-SUCH-BRANCH', '--tax-enabled', 'true'],
    ]) {
      expect(await run(...argv), argv.join(' ')).toBe(1);
    }
    expect(await everything()).toEqual(before);
    for (const key of ['day_stale_after_hours', 'day_min_gap_hours']) {
      expect(BranchConfigSnapshotSchemaV3.safeParse(without(first, key)).success, key).toBe(false);
    }
  });

  it('[01b B16] the usage text shows the day ranges 1…48 and 0…12', async () => {
    expect(await run('--branch')).toBe(1);
    expect(errors.join('\n')).toContain('[--day-stale-after-hours <1…48>] [--day-min-gap-hours <0…12>]');
  });

  it('[01a §6.7] setBranchSettings returns the merged settings', async () => {
    const result = await setBranchSettings(
      new SystemContext(cloud.pool),
      { branchId: f.branches[2], dayMinGapHours: 6 },
      { clock: cloud.clock, ids: ulidGen(cloud.clock) },
    );
    expect(result).toEqual({ tax_enabled: false, day_stale_after_hours: 16, day_min_gap_hours: 6 });
  });
});
