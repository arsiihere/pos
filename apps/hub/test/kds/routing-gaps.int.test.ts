import type { BranchConfig } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, seedDirectory, type TestHub } from '../helpers/test-hub';
import { cookDirectory, fixtureMenu, openDay, pairDevice } from './fixtures';

// 03b v1.0.16 §6.12, §3.8, PT-6 (run 3 R3-M-2; plan PT-4), test 131 (hub part): kds-config `routing_gaps`, one entry
// per active station × order type (dine_in, takeaway, parking) that only reaches a fallback point or a tie, from
// branchConfig() and routePoint (memory, 0 extra statements; the handler stays at 3).

let hub: TestHub;
afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
});

type Point = BranchConfig['points'][number];
const point = (point_id: string, name: string, order_types?: Point['order_types']): Point => ({
  point_id, name, sort_order: 0, is_archived: false, ...(order_types === undefined ? {} : { order_types }),
});

/** Karahi (S1) and Counter (S2) on default point Main; plus an archived station Old. */
function menu(points: Point[]): BranchConfig {
  const base = fixtureMenu();
  const [s1, s2] = base.stations as [BranchConfig['stations'][number], BranchConfig['stations'][number]];
  return {
    ...base,
    points,
    stations: [
      { ...s1, name: 'Karahi', point_id: 'MAIN' },
      { ...s2, name: 'Counter', point_id: 'MAIN' },
      { ...s1, station_id: 'S_OLD', name: 'Old', point_id: 'MAIN', is_archived: true },
    ],
  };
}

async function gaps(points: Point[]): Promise<{ gaps: unknown[]; statements: number }> {
  hub = await createTestHub({ provisioned: true });
  await seedDirectory(hub, await cookDirectory());
  openDay(hub, { menu: menu(points) });
  const device = pairDevice(hub, { type: 'tablet', name: 'Admin tab' });
  const session = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: device.deviceId }).token;
  const { queryRegistry } = await import('../../src/queries/registry');
  const def = queryRegistry(hub.app).byResource('kds-config')!;
  const original = def.handle.bind(def);
  const counter = statementCounter(hub.deps.readDb);
  let statements = -1;
  def.handle = (ctx, q) => {
    const before = counter.count;
    const out = original(ctx, q);
    statements = counter.count - before;
    return out;
  };
  const res = await hub.app.inject({ method: 'GET', url: '/admin/queries/kds-config', headers: { authorization: `Bearer ${device.token}`, 'x-admin-session': session } });
  expect(res.statusCode, res.body).toBe(200);
  const result = { gaps: (res.json() as { data: { routing_gaps: unknown[] } }).data.routing_gaps, statements };
  await hub.close();
  hub = undefined as unknown as TestHub;
  return result;
}

const fallback = (station_id: string, station_name: string, order_type: string) => ({
  station_id, station_name, order_type, reason: 'fallback', point_id: 'MAIN', point_name: 'Main', tied_point_ids: [],
});

describe('[03b v1.0.16 §6.12 PT-6, #131] kds-config routing_gaps', () => {
  it('Main dine-in only and one takeaway point: parking falls back at every active station; every wire field; archived station omitted; 3 statements', async () => {
    const r = await gaps([point('MAIN', 'Main', ['dine_in']), point('TA', 'Takeaway', ['takeaway'])]);
    expect(r.gaps).toEqual([fallback('S2', 'Counter', 'parking'), fallback('S1', 'Karahi', 'parking')]);
    expect(r.statements).toBe(3);
  });

  it('a second takeaway point: a tie listing both specific candidates in lexical order, at the station default', async () => {
    const r = await gaps([point('MAIN', 'Main', ['dine_in']), point('TB', 'Takeaway 2', ['takeaway']), point('TA', 'Takeaway', ['takeaway'])]);
    const tie = (station_id: string, station_name: string) => ({ station_id, station_name, order_type: 'takeaway', reason: 'tie', point_id: 'MAIN', point_name: 'Main', tied_point_ids: ['TA', 'TB'] });
    expect(r.gaps).toEqual([tie('S2', 'Counter'), fallback('S2', 'Counter', 'parking'), tie('S1', 'Karahi'), fallback('S1', 'Karahi', 'parking')]);
  });

  it('the default among the tied points: tie at the default', async () => {
    const r = await gaps([point('MAIN', 'Main', ['takeaway']), point('TA', 'Takeaway', ['takeaway'])]);
    const row = (station_id: string, station_name: string, order_type: string, reason: string, tied: string[]) => ({
      station_id, station_name, order_type, reason, point_id: 'MAIN', point_name: 'Main', tied_point_ids: tied,
    });
    expect(r.gaps).toEqual([
      row('S2', 'Counter', 'dine_in', 'fallback', []),
      row('S2', 'Counter', 'takeaway', 'tie', ['MAIN', 'TA']),
      row('S2', 'Counter', 'parking', 'fallback', []),
      row('S1', 'Karahi', 'dine_in', 'fallback', []),
      row('S1', 'Karahi', 'takeaway', 'tie', ['MAIN', 'TA']),
      row('S1', 'Karahi', 'parking', 'fallback', []),
    ]);
  });

  it('the legacy setup (every active point all / absent) warns nothing: its ties are suppressed', async () => {
    expect((await gaps([point('MAIN', 'Main'), point('TA', 'Takeaway', 'all')])).gaps).toEqual([]);
    expect((await gaps([point('MAIN', 'Main')])).gaps).toEqual([]);
  });
});
