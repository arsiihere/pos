import { describe, expect, it } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import { kindOf } from '../../src/alerts/kinds';
import { KDS_OFFLINE, KdsOfflineDetails, READY_TO_SERVE, ReadyToServeDetails, SERVED_CARD, ServedCardDetails } from '../../src/kds/kinds';
import { PRINTER_PROBLEM, PrinterProblemDetails } from '../../src/print/kinds';
import { createTestHub, seedDirectory } from '../helpers/test-hub';

// 03b §6.21 (#53) and 03c §6.10 (03c #54): the four kinds register at module top level without throwing; their
// details (03b D-2 fields) survive the append (AlertRaised v3) and the alerts projection.
describe('[03b #53, 03c #54] 03b / 03c alert kinds', () => {
  it('[03b #53, 03c #54] ready_to_serve, served_card, kds_offline, printer_problem are registered as specced', () => {
    for (const k of [READY_TO_SERVE, SERVED_CARD, KDS_OFFLINE, PRINTER_PROBLEM]) expect(kindOf(k.kind)).toBe(k);
    expect(READY_TO_SERVE).toMatchObject({ kind: 'ready_to_serve', family: 'action', subject: 'order', closes_on: 'owner', lead_fallback: false, request: null });
    expect(READY_TO_SERVE.steps).toEqual([
      { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] },
      { at: { value: 'window_ms', times: 1 }, to: [{ target: 'raised_target', set: 'recipient' }] },
      {
        at: { value: 'window_ms', times: 2 },
        escalation: true,
        to: [
          { target: { kind: 'point', from_value: 'point_id' }, set: 'recipient' },
          { target: { kind: 'managers' }, set: 'recipient' }, // G-14
        ],
      },
    ]);
    expect(SERVED_CARD).toMatchObject({ kind: 'served_card', family: 'info', subject: 'order', lead_fallback: false });
    expect(KDS_OFFLINE).toMatchObject({ kind: 'kds_offline', family: 'action', subject: 'hub', lead_fallback: true });
    expect(KDS_OFFLINE.steps).toEqual([{ at: { ms: 0 }, to: [{ target: { kind: 'managers' }, set: 'recipient' }] }]);
    expect(PRINTER_PROBLEM).toMatchObject({ kind: 'printer_problem', family: 'action', subject: 'hub', lead_fallback: true });
    expect(PRINTER_PROBLEM.steps).toEqual([{ at: { ms: 0 }, to: [{ target: { kind: 'managers' }, set: 'recipient' }] }]);
    for (const k of [READY_TO_SERVE, SERVED_CARD, KDS_OFFLINE, PRINTER_PROBLEM]) {
      expect(k, k.kind).toMatchObject({ expires_at_day_close: true, silent: false, labels: { card: `alert.${k.kind}.card`, lock: `alert.${k.kind}.lock` } });
    }
    // details pick only the D-2 fields
    expect(READY_TO_SERVE.details_schema).toBe(ReadyToServeDetails);
    expect(SERVED_CARD.details_schema).toBe(ServedCardDetails);
    expect(KDS_OFFLINE.details_schema).toBe(KdsOfflineDetails);
    expect(PRINTER_PROBLEM.details_schema).toBe(PrinterProblemDetails);
    expect(Object.keys(ReadyToServeDetails.shape)).toEqual(['identifier']);
    expect(Object.keys(ServedCardDetails.shape)).toEqual(['identifier']);
    expect(Object.keys(KdsOfflineDetails.shape)).toEqual(['station_name']);
    expect(Object.keys(PrinterProblemDetails.shape).sort()).toEqual(['printer_name', 'problem']);
  });

  it('[03b #53, 03c #54] a booted hub raises each kind; the details survive the append (AlertRaised v3) and the projection', async () => {
    const hub = await createTestHub({ provisioned: true });
    try {
      await seedDirectory(hub);
      const branch = hub.deps.config.provisioned!.branch_id;
      const cases = [
        {
          kind: 'ready_to_serve',
          subject: { stream_type: 'order' as const, stream_id: 'O1' },
          target: { kind: 'person' as const, staff_id: 'S_MGR' },
          values: { order_id: 'O1', point_id: 'P1', table_id: 'T4', window_ms: 60_000 },
          details: { identifier: 'T4 + T5' },
          dedupe_key: 'ready_to_serve:O1:P1',
        },
        {
          kind: 'served_card',
          subject: { stream_type: 'order' as const, stream_id: 'O1' },
          target: { kind: 'person' as const, staff_id: 'S_MGR' },
          values: { handover_id: 'H1', order_id: 'O1' },
          details: { identifier: '#12' },
          dedupe_key: 'served_card:H1',
        },
        {
          kind: 'kds_offline',
          subject: { stream_type: 'hub' as const, stream_id: branch },
          target: { kind: 'managers' as const },
          values: { station_id: 'S1' },
          details: { station_name: 'Tandoor' },
          dedupe_key: 'kds_offline:S1',
        },
        {
          kind: 'printer_problem',
          subject: { stream_type: 'hub' as const, stream_id: branch },
          target: { kind: 'managers' as const },
          values: { printer_id: 'PR1', waiting: 3 },
          details: { printer_name: 'Kitchen 1', problem: 'paper_out' },
          dedupe_key: 'printer_problem:PR1',
        },
      ];
      for (const c of cases) {
        const { alert_id } = hub.deps.writer.run((tx) => {
          const r = alerts.raise(alerts.tickCtx(tx, hub.clock.branchNow()), { ...c, display: { kind_label_key: `alert.${c.kind}.lock` } });
          tx.append(r.events);
          return r;
        }).result;
        const raised = hub.deps.db
          .prepare("SELECT schema_version, payload FROM events WHERE event_type = 'AlertRaised' AND json_extract(payload, '$.alert_id') = ?")
          .get(alert_id) as { schema_version: number; payload: string };
        expect(raised.schema_version, c.kind).toBe(4); // 01d v1.2.5 D-3 (04): AlertRaised v4
        expect((JSON.parse(raised.payload) as { details: unknown }).details, c.kind).toEqual(c.details);
        const row = alerts.listOpen(hub.deps.db, { kind: c.kind })[0];
        expect(row?.details, c.kind).toEqual(c.details);
      }
    } finally {
      await hub.close();
    }
  });
});
