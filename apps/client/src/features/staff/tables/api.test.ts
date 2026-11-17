import { describe, expect, it } from 'vitest';
import { reply } from '../../../../test/dom';
import { createStaffApi } from '../api';
import { createTablesApi } from './api';

// 02a §6.1–§6.18 (W0.4): the Tables api on the staff api's command() / query().

interface Call {
  url: string;
  init: RequestInit;
}

function setup(data: unknown = { command_id: 'C', event_ids: [], result: { ok: 1 } }) {
  const calls: Call[] = [];
  const staff = createStaffApi({
    device: { token: 'DEV', id: 'D1', type: 'tablet' },
    meta: { tenantId: 'T', branchId: 'B', branchName: 'G', hubNowMs: 0, utcOffsetMs: 0 },
    fetch: async (url, init) => {
      calls.push({ url, init: init ?? {} });
      return reply(200, { data });
    },
    newCommandId: () => 'CMD1',
    onSignedOut: () => {},
  });
  return { calls, tables: createTablesApi(staff) };
}

const ref = { table_id: 'TB4', seating_id: 'S1' };

describe('[02a §6] Tables api', () => {
  it('[02a §6] each TablesApi command posts /commands/<kebab(type)> with the §6 payload', async () => {
    const cases: Array<[string, string, (t: ReturnType<typeof setup>['tables']) => Promise<unknown>, unknown]> = [
      ['open-table', 'OpenTable', (t) => t.openTable({ table_id: 'TB4', seating_id: 'S1', party_size: 4 }), { table_id: 'TB4', seating_id: 'S1', party_size: 4 }],
      ['touch-table-lock', 'TouchTableLock', (t) => t.touchTableLock(ref), ref],
      ['release-table-lock', 'ReleaseTableLock', (t) => t.releaseTableLock(ref), ref],
      ['force-release-table-lock', 'ForceReleaseTableLock', (t) => t.forceReleaseTableLock({ ...ref, reason: 'went_home: left early' }), { ...ref, reason: 'went_home: left early' }],
      ['take-over-table', 'TakeOverTable', (t) => t.takeOverTable(ref), ref],
      ['force-move-table', 'ForceMoveTable', (t) => t.forceMoveTable({ ...ref, to_staff_id: 'ST2', reason: 'shift_ended' }), { ...ref, to_staff_id: 'ST2', reason: 'shift_ended' }],
      ['request-table-handover', 'RequestTableHandover', (t) => t.requestTableHandover({ ...ref, to_staff_id: 'ST2' }), { ...ref, to_staff_id: 'ST2' }],
      ['move-table', 'MoveTable', (t) => t.moveTable({ from_table_id: 'TB4', seating_id: 'S1', to_table_id: 'TB9', reason: 'ac' }), { from_table_id: 'TB4', seating_id: 'S1', to_table_id: 'TB9', reason: 'ac' }],
      [
        'merge-tables',
        'MergeTables',
        (t) => t.mergeTables({ into_table_id: 'TB4', into_seating_id: 'S1', table_id: 'TB5', table_seating_id: null }),
        { into_table_id: 'TB4', into_seating_id: 'S1', table_id: 'TB5', table_seating_id: null },
      ],
      [
        'split-seating',
        'SplitSeating',
        (t) => t.splitSeating({ from_table_id: 'TB4', seating_id: 'S1', to_table_id: 'TB9', order_ids: ['O1'] }),
        { from_table_id: 'TB4', seating_id: 'S1', to_table_id: 'TB9', order_ids: ['O1'] },
      ],
      ['request-bill', 'RequestBill', (t) => t.requestBill(ref), ref],
      ['clean-table', 'CleanTable', (t) => t.cleanTable(ref), ref],
      ['call-waiter', 'CallWaiter', (t) => t.callWaiter({ ...ref, chip: 'water' }), { ...ref, chip: 'water' }],
    ];
    expect(cases).toHaveLength(13);
    for (const [route, type, call, payload] of cases) {
      const s = setup();
      const answer = await call(s.tables);
      expect(answer, type).toEqual({ ok: true, data: { ok: 1 } });
      expect(s.calls, type).toHaveLength(1);
      const [{ url, init }] = s.calls as [Call];
      expect(url, type).toBe(`/commands/${route}`);
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body, type).toMatchObject({ command_id: 'CMD1', tenant_id: 'T', branch_id: 'B', command_type: type, device_id: 'D1' });
      expect(body['payload'], type).toEqual(payload);
    }
  });

  it('[02b §3.12] requestBill / cleanTable reuse a given command_id (a queued replay)', async () => {
    for (const call of [(t: ReturnType<typeof setup>['tables']) => t.requestBill(ref, { commandId: 'Q-7', queuedAt: 42 }), (t: ReturnType<typeof setup>['tables']) => t.cleanTable(ref, { commandId: 'Q-7', queuedAt: 42 })]) {
      const s = setup();
      await call(s.tables);
      const [{ init }] = s.calls as [Call];
      expect(JSON.parse(init.body as string)).toMatchObject({ command_id: 'Q-7', payload: ref });
      expect((init.headers as Record<string, string>)['X-Queued-At']).toBe('42');
    }
  });

  it('[02a §6.17, §6.18] tableMap(floor_id?) and handoverCandidates(table_id) read the two queries', async () => {
    const map = { as_of_seq: 7, floors: [] };
    const s = setup(map);
    expect(await s.tables.tableMap()).toEqual({ ok: true, data: map });
    expect(await s.tables.tableMap('F 1')).toEqual({ ok: true, data: map });
    const c = setup({ staff: [{ staff_id: 'ST2', name: 'Sara', is_assignee: true, working: true, tables_held: 2 }] });
    const cand = await c.tables.handoverCandidates('TB4');
    expect(cand.ok && cand.data.staff[0]?.name).toBe('Sara');
    expect([...s.calls, ...c.calls].map((x) => [x.url, x.init.method])).toEqual([
      ['/queries/table-map', 'GET'],
      ['/queries/table-map?floor_id=F%201', 'GET'],
      ['/queries/handover-candidates?table_id=TB4', 'GET'],
    ]);
  });
});
