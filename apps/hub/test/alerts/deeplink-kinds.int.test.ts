import type { AlertLinkTarget, AlertView, EventDraft, PosEvent } from '@pos/events';
import { anAlertRaised, anAttemptSent } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { kindOf, safeLink, type AlertKind } from '../../src/alerts/kinds';
import { lockView } from '../../src/alerts/ws-frames';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { readyRetargetTick } from '../../src/kds/ticks';
import { registerAlertProjections } from '../../src/projections/alerts';
import { createProjectionRegistry } from '../../src/projections/registry';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { COOK, FX, append as appendDrafts, appendOrder, cookDirectory, fireLines, openDay, openSeating, pairPassTablet } from '../kds/fixtures';

// dl h2 — 01d v1.3 §3.13.1 per-kind table (rows 1–19): each owning kind's pure `link` (02a v1.1.7 §6.14, §6.15;
// 02b v1.0.15 §6.12, §6.13; 03a v1.2.5 §4.2; 03b v1.0.9 §6.21; 04 v1.0.6 §3.5); no `link` on station_overload,
// kds_offline, printer_problem (DL Q-0a (a)); tests 69 and 73. The kinds are the real registrations (createTestHub
// boots every module). Views are read through the real alerts-inbox route over rows written by the alerts projection.

const MGR = 'S_MGR';
const BRANCH = 'branch-1';

let hub: TestHub;

afterEach(async () => {
  await hub.close();
});

function kind(name: string): AlertKind {
  const k = kindOf(name);
  if (k === undefined) throw new Error(`kind ${name} is not registered`);
  return k;
}

/** safeLink on values that first pass the kind's own values_schema (a real raise validates them). */
function targetOf(name: string, values: Record<string, unknown>): AlertLinkTarget | null {
  const k = kind(name);
  return safeLink(k, k.values_schema.parse(values) as Record<string, unknown>);
}

const LINE: AlertLinkTarget = { type: 'order_line', order_id: 'O1', order_item_id: 'L1' };
const TABLE: AlertLinkTarget = { type: 'table', table_id: 'T5', seating_id: 'S5' };
const ZONE: AlertLinkTarget = { type: 'zone_item', zone_id: 'Z1', item_id: 'I_COLA' };
const ORDER: AlertLinkTarget = { type: 'order', order_id: 'O1' };

// The §3.13.1 table, row by row: [#, kind, a values_schema fixture, the target].
const ROWS: Array<[number, string, Record<string, unknown>, AlertLinkTarget | null]> = [
  [
    1,
    'void_approval',
    {
      order_id: 'O1',
      order_item_id: 'L1',
      units: 1,
      reason_code: 'customer_changed_mind',
      note: null,
      disposition: 'wastage',
      disposition_note: null,
      touched_ids: ['L1'],
      line_dispositions: {},
      refund_minor: 0,
      comp_voided_minor: 0,
    },
    LINE,
  ],
  [2, 'comp', { order_id: 'O1', order_item_id: 'L1', units: 1, reason_code: 'other', note: 'regular' }, LINE],
  [3, 'table_handover', { table_id: 'T5', seating_id: 'S5', from_staff_id: 'S_WAIT' }, TABLE],
  [4, 'call_waiter', { table_id: 'T5', seating_id: 'S5', chip: 'water' }, TABLE],
  [5, 'zone_stock_low', { zone_id: 'Z1', item_id: 'I_COLA', on_hand: 2, threshold: 3 }, ZONE],
  [6, 'zone_stock_out', { zone_id: 'Z1', item_id: 'I_COLA', on_hand: 0, threshold: 3 }, ZONE],
  [7, 'slip_warning', { table_key: 'T5', order_ids: ['O1', 'O2'], escalate_ms: 60_000 }, ORDER],
  [8, 'station_overload', { station_id: 'S1', pressure_bp: 12_000, waiting: 9 }, null],
  [9, 'engine_line_dropped', { order_id: 'O1', order_item_id: 'L1', reason: 'station_removed' }, LINE],
  [10, 'ready_to_serve', { order_id: 'O1', point_id: 'P1', table_id: 'T5', window_ms: 60_000 }, ORDER],
  [11, 'served_card', { handover_id: 'H1', order_id: 'O1' }, ORDER],
  [12, 'kds_offline', { station_id: 'S1' }, null],
  [13, 'printer_problem', { printer_id: 'PR1', waiting: 3 }, null],
  [14, 'request_result', { request_alert_id: 'A1', request_kind: 'void_approval', close_reason: 'answered', decision: 'approve', by_staff_id: MGR, link: LINE }, LINE],
  [15, 'approval_receipt', { request_alert_id: 'A1', request_kind: 'void_approval', decision: 'approve', device_id: 'D1', on_requester_device: false, link: LINE }, LINE],
  [16, 'answered_on_requester_device', { request_alert_id: 'A1', request_kind: 'void_approval', decision: 'approve', device_id: 'D1', link: LINE }, LINE],
  [17, 'pin_use_failed', { request_alert_id: 'A1', request_kind: 'void_approval', error_code: 'ITEM_WRONG_STAGE', device_id: 'D1', link: LINE }, LINE],
  [18, 'no_approver', { permission: 'void-item' }, null],
  [19, 'test_alert', {}, null],
];

describe('[01d #69] per-kind link (§3.13.1 rows 1–19)', () => {
  beforeEach(async () => {
    hub = await createTestHub();
  });

  it('[01d #69] each of the 19 kinds: its values_schema fixture gives exactly its §3.13.1 target; null for 8, 12, 13, 18, 19', () => {
    expect(ROWS.map(([n]) => n)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    for (const [n, name, values, target] of ROWS) expect(targetOf(name, values), `${n} ${name}`).toEqual(target);
    // a request's copy kinds without a stored link (a pre-v1.3 row) → null
    for (const [, name, values] of ROWS.slice(13, 17)) expect(targetOf(name, { ...values, link: undefined }), name).toBeNull();
    // kinds 8, 12, 13 (DL Q-0a (a)), 18 and 19 define no link at all
    for (const name of ['station_overload', 'kds_offline', 'printer_problem', 'no_approver', 'test_alert']) expect(kind(name).link, name).toBeUndefined();
  });

  it('[01d #69] slip_warning takes order_ids[0] (the subject: the group\'s oldest order)', () => {
    expect(targetOf('slip_warning', { table_key: 'T5', order_ids: ['O7', 'O1', 'O2'], escalate_ms: 0 })).toEqual({ type: 'order', order_id: 'O7' });
  });

  it('[01d #69] a link that throws, values that fail to parse and a result outside the schema each give target null; the view is still built', () => {
    const row = (name: string, values_json: string) => ({
      alert_id: 'A1',
      kind: name,
      family: 'info' as const,
      display_json: JSON.stringify({ kind_label_key: `alert.${name}.lock` }),
      values_json,
      raised_at: 1,
    });
    const cases: Array<[string, string]> = [
      ['slip_warning', JSON.stringify({ table_key: 'T5', order_ids: null, escalate_ms: 0 })], // link throws (null[0])
      ['slip_warning', JSON.stringify({ table_key: 'T5', order_ids: [], escalate_ms: 0 })], // { order_id: undefined } → schema fails
      ['void_approval', JSON.stringify({ order_id: 'O1' })], // order_item_id missing → schema fails
      ['comp', JSON.stringify({ order_id: '', order_item_id: 'L1' })], // empty id → schema fails
      ['call_waiter', 'not json'], // unparseable values
      ['ready_to_serve', JSON.stringify({ order_id: 42 })], // a number id → schema fails
      ['zone_stock_out', JSON.stringify({ zone_id: 'Z1' })],
    ];
    for (const [name, values_json] of cases) {
      const view = lockView(row(name, values_json), kind(name), 0);
      expect(view.alert_id, `${name} ${values_json}`).toBe('A1');
      expect(view.lock.kind_label_key, name).toBe(kind(name).labels.lock);
      expect(view.target, `${name} ${values_json}`).toBeNull();
    }
  });
});

// -------------------------------------------------------------------------------------------------------------- #73

describe('[01d #73] frozen and old rows', () => {
  let mgr: { deviceToken: string; sessionToken: string };

  beforeEach(async () => {
    hub = await createTestHub();
    await seedDirectory(hub, await aDirectory());
    const tab = pairDevice(hub, { type: 'tablet', name: 'mgr' });
    const s = openSession(hub, { kind: 'staff', staffId: MGR, deviceId: tab.deviceId });
    mgr = { deviceToken: tab.token, sessionToken: s.token };
  });

  function append(events: PosEvent[]): void {
    hub.deps.writer.run((tx) => {
      tx.append(
        events.map(
          (e): EventDraft => ({
            stream_type: e.stream_type,
            stream_id: e.stream_id,
            event_type: e.event_type,
            schema_version: e.schema_version,
            payload: e.payload,
            occurred_at: hub.clock.branchNow(),
            actor_id: e.actor_id,
            device_id: e.device_id,
          }),
        ),
      );
    });
  }

  /** An alert row as an owning module's raise would write it (AlertRaised at the shipped version + step 0 to MGR). */
  function seed(alert_id: string, name: string, family: string, values: Record<string, unknown>, subject: { type: string; id: string } = { type: 'hub', id: BRANCH }): void {
    append([
      anAlertRaised({
        payload: {
          alert_id,
          kind: name,
          family,
          subject_stream_type: subject.type,
          subject_stream_id: subject.id,
          dedupe_key: `seed:${alert_id}`,
          target: { kind: 'person', staff_id: MGR },
          values,
          display: { kind_label_key: `alert.${name}.lock` },
        },
      }),
      anAttemptSent({ payload: { alert_id, step: 0, recipients: [{ staff_id: MGR, device_id: null, for_staff_id: null, set: 'recipient' }], routes: [] } }),
    ]);
  }

  async function inboxTarget(alert_id: string): Promise<AlertView['target']> {
    const res = await hub.app.inject({ method: 'GET', url: '/queries/alerts-inbox', headers: { authorization: `Bearer ${mgr.deviceToken}`, 'x-session-token': mgr.sessionToken } });
    expect(res.statusCode).toBe(200);
    const row = (res.json() as { data: { alerts: Array<AlertView & Record<string, unknown>> } }).data.alerts.find((r) => r.alert_id === alert_id);
    expect(row, alert_id).toBeDefined();
    expect(row, alert_id).toHaveProperty('target');
    return row!.target;
  }

  /** 01d §5.2 reset + replay of the alerts projections over the hub's own log. */
  function resetAndReplay(): void {
    hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection IN ('alerts', 'alert_flags', 'alert_receipts', 'presence_today')`).run();
    const fresh = createProjectionRegistry();
    registerAlertProjections(fresh);
    expect(fresh.catchUp(hub.deps.db, BRANCH).replayed.alerts).toBeGreaterThan(0);
  }

  it('[01d #69] stored values a link cannot use (throws, fails the schema) → the inbox row is still served with target null; nothing is logged', async () => {
    seed('A_SLIP', 'slip_warning', 'action', { table_key: 'T5', order_ids: null, escalate_ms: 0 }, { type: 'order', id: 'O1' }); // link throws
    seed('A_VOID', 'void_approval', 'info', { order_id: 'O1' }, { type: 'order', id: 'O1' }); // result fails the schema
    const before = hub.logs().length;
    expect(await inboxTarget('A_SLIP')).toBeNull();
    expect(await inboxTarget('A_VOID')).toBeNull();
    const lines = hub.logs().slice(before).split('\n').filter((l) => l.trim() !== '');
    for (const line of lines) {
      expect(line).not.toMatch(/"level":(40|50|60)/);
      expect(line).not.toMatch(/link|A_SLIP|A_VOID|order_ids/);
    }
  });

  it('[01d #73] (a) call_waiter: target unchanged after TableMoved, and after a projection reset + replay', async () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'S5' });
    seed('A_CALL', 'call_waiter', 'action', { table_id: FX.table, seating_id: 'S5', chip: 'water' }, { type: 'table', id: FX.table });
    const at = { type: 'table', table_id: FX.table, seating_id: 'S5' };
    expect(await inboxTarget('A_CALL')).toEqual(at);
    appendDrafts(hub, [{ stream_type: 'table', stream_id: FX.table, event_type: 'TableMoved', payload: { seating_id: 'S5', from_table_id: FX.table, to_table_id: FX.zoneTable, by_staff_id: 'S_WAIT' } }]);
    expect(await inboxTarget('A_CALL')).toEqual(at);
    resetAndReplay();
    expect(await inboxTarget('A_CALL')).toEqual(at);
  });

  it('[01d #73] (b) an AlertRaised v4 request_result without values.link (a pre-v1.3 row) replays to target null', async () => {
    seed('A_RES', 'request_result', 'info', { request_alert_id: 'A_REQ', request_kind: 'void_approval', close_reason: 'answered', decision: 'approve', by_staff_id: MGR });
    const raised = hub.deps.db.prepare(`SELECT schema_version FROM events WHERE event_type = 'AlertRaised' ORDER BY seq DESC LIMIT 1`).pluck().get();
    expect(raised).toBe(5); // ⚠️ Changed by 05 (row D-1, G-16): the raise appends the latest, v5
    expect(await inboxTarget('A_RES')).toBeNull();
    resetAndReplay();
    expect(await inboxTarget('A_RES')).toBeNull();
  });

  it('[01d #73] (c) a pre-v1.3 comp row replays with its order_line target', async () => {
    seed('A_COMP', 'comp', 'urgent', { order_id: 'O1', order_item_id: 'L1', units: 1, reason_code: 'other', note: null }, { type: 'order', id: 'O1' });
    resetAndReplay();
    expect(await inboxTarget('A_COMP')).toEqual(LINE);
  });
});

describe('[01d #73] (d) ready_retarget', () => {
  const POINT = 'P1';
  beforeEach(async () => {
    hub = await createTestHub({ provisioned: true });
  });

  it('[01d #73] (d) a ready_to_serve closed and re-raised by ready_retarget gives the new alert the same order target', async () => {
    openDay(hub);
    await seedDirectory(hub, await cookDirectory());
    const device = pairPassTablet(hub, { pointId: POINT });
    const session = openSession(hub, { kind: 'staff', staffId: COOK.staff, deviceId: device.deviceId });
    openSession(hub, { kind: 'staff', staffId: 'S_OWNER', deviceId: pairDevice(hub, { type: 'tablet' }).deviceId });
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT2' });
    const order_id = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT2', lines: [{ order_item_id: 'L1', item_id: FX.naan }] }).order_id;
    const engine = hub.deps.state.get() as { lines: Record<string, { station_id: string }> };
    fireLines(hub, engine.lines.L1!.station_id, ['L1']);
    const on = (event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, payload });
    appendDrafts(hub, [on('ItemStarted', { order_item_id: 'L1', started_at: hub.clock.branchNow() + 1_000, source: 'tap' })]);
    appendDrafts(hub, [on('ItemDone', { order_item_id: 'L1', done_at: hub.clock.branchNow() + 1_000, source: 'tap' })]);
    const res = await hub.app.inject({
      method: 'POST',
      url: '/commands/mark-ready-to-serve',
      headers: { authorization: `Bearer ${device.token}`, 'x-session-token': session.token },
      payload: { command_id: 'cmd-ready', tenant_id: 'tenant-a', branch_id: BRANCH, command_type: 'MarkReadyToServe', payload: { order_id, point_id: POINT }, occurred_at: hub.clock.branchNow(), actor_id: COOK.staff, device_id: device.deviceId },
    });
    expect(res.statusCode, res.body).toBe(200);
    const first = (res.json() as { data: { result: { alert_id: string } } }).data.result.alert_id;

    appendDrafts(hub, [{ stream_type: 'table', stream_id: FX.table, event_type: 'TableMoved', payload: { seating_id: 'SEAT2', from_table_id: FX.table, to_table_id: FX.zoneTable, by_staff_id: 'S_WAIT' } }]);
    const now = hub.clock.branchNow();
    expect(readyRetargetTick.due(readOnlyDb(hub.deps.db), hub.deps.state.get(), now)).toBe(true);
    const { appended } = hub.deps.writer.run((tx) => tx.append(readyRetargetTick.intents(tx, hub.deps.state.get(), now)));
    const second = appended.find((e) => e.event_type === 'ReadyRetargeted')!.payload.alert_id as string;
    expect(second).not.toBe(first);

    const view = (alert_id: string) => {
      const row = hub.deps.db.prepare('SELECT alert_id, kind, family, display_json, values_json, raised_at, state FROM alerts WHERE alert_id = ?').get(alert_id) as {
        alert_id: string;
        kind: string;
        family: 'info';
        display_json: string;
        values_json: string;
        raised_at: number;
        state: string;
      };
      return { state: row.state, target: lockView(row, kind('ready_to_serve'), 0).target };
    };
    expect(view(first)).toEqual({ state: 'closed', target: { type: 'order', order_id } });
    expect(view(second)).toEqual({ state: 'open', target: { type: 'order', order_id } });
  });
});
