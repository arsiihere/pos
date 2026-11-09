// 03a v1.2 Q-3 test 125 (02p task 15), the live and full-replay legs; the restart leg is in boot-idset.int.test.ts.
// The host's absent-id log skips zone lines, deal headers and (AD-E18) ready-items-only orders through the host id set.
import { initialEngineState, type Diagnostic, type EngineState } from '@pos/engine';
import type { EventDraft, PosEvent } from '@pos/events';
import { aBusinessDayClosed, aBusinessDayOpened, anEngineConfigApplied } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { hostFlags, resetHostFlags } from '../../src/engine-host/host-flags';
import { replayEngine } from '../../src/engine-host/replay';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { ABSENT_ID, dealOrder, DIAGNOSTIC, emptyOrder, foodAdded, readyAdded, readyShapes, removed, served, voided, zoneAdded, zoneAndDealShapes } from './q3-lines';

const T0 = 1_761_000_000_000;

function draftOf(event: PosEvent): EventDraft {
  return {
    stream_type: event.stream_type,
    stream_id: event.stream_id,
    event_type: event.event_type,
    schema_version: event.schema_version,
    payload: event.payload,
    occurred_at: event.occurred_at,
    actor_id: event.actor_id,
    device_id: event.device_id,
  };
}

type LogLine = Record<string, unknown> & { level: number; msg?: string };

describe('[03a #125] Q-3 host filter: live and full replay', () => {
  let hub: TestHub;
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });
  async function open(): Promise<TestHub> {
    resetHostFlags();
    hub = await createTestHub();
    cleanups.push(() => hub.close());
    return hub;
  }
  const append = (events: PosEvent[]) => hub.deps.writer.run((tx) => tx.append(events.map(draftOf))).appended;
  const absent = (): LogLine[] =>
    hub
      .logs()
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l) as LogLine)
      .filter((l) => l.msg === ABSENT_ID);

  // Day D of §3.12: O1 with deal header H1 (parts P1, P2) and zone line Z1; O2 a ready-items-only order with R1.
  function seed(): void {
    append([anEngineConfigApplied()]);
    append([...dealOrder('O1', 'H1', ['P1', 'P2'], T0), zoneAdded('O1', 'Z1')]);
    append([emptyOrder('O2', T0), readyAdded('O2', 'R1')]);
  }

  it('[03a #125] live: the four shapes on a zone line and a deal header, and a ready-items-only order, log no absent id', async () => {
    await open();
    seed();
    expect(hub.deps.state.get().orders.O2).toBeUndefined();
    // Each later event in its own transaction, so no fold of the same batch can vouch for the id.
    for (const e of zoneAndDealShapes('O1', 'Z1', 'H1')) append([e]);
    // An ItemAdded served from a zone on an order the engine does not hold (here the empty order O2).
    append([zoneAdded('O2', 'Z2')]);
    for (const e of readyShapes('O2', 'R1')) append([e]);
    expect(absent()).toEqual([]);
    expect([...hostFlags.untrackedLineIds].sort()).toEqual(['H1', 'O2', 'Z1', 'Z2']);
  });

  it('[03a #125, AD-E17] control (live only): the same events on an unknown id log one line each', async () => {
    await open();
    seed();
    append([removed('O1', 'X1')]);
    append([voided('O1', 'X2')]);
    append([served('O1', ['X3'], 'tap')]);
    expect(absent()).toEqual([
      expect.objectContaining({ event_type: 'ItemRemoved', order_id: 'O1', order_item_id: 'X1' }),
      expect.objectContaining({ event_type: 'ItemVoided', order_id: 'O1', order_item_id: 'X2' }),
      expect.objectContaining({ event_type: 'ItemServed', order_id: 'O1', order_item_id: 'X3' }),
    ]);
  });

  it('[03a #125] full replay: no invalid_event for the zone ItemAdded; replay = live', async () => {
    await open();
    seed();
    for (const e of zoneAndDealShapes('O1', 'Z1', 'H1')) append([e]);
    for (const e of readyShapes('O2', 'R1')) append([e]);
    const reported: Diagnostic[] = [];
    const branchId = hub.deps.config.provisioned!.branch_id;
    const out = replayEngine(hub.deps.db, branchId, 0, initialEngineState(), (d) => reported.push(d));
    expect(reported.filter((d) => d.kind === 'invalid_event')).toEqual([]);
    const live = hub.deps.state.get() as EngineState;
    expect({ ...out.state, diagnostics: [] }).toEqual({ ...live, diagnostics: [] });
  });
});

// 03a v1.2 §3.3 E-4 (02p task 15b): "drinks first, food later", live through the hub's writer and after-commit hooks.
describe('[03a E-4] drinks first, food later: live', () => {
  let hub: TestHub;
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });
  async function open(): Promise<TestHub> {
    resetHostFlags();
    hub = await createTestHub();
    cleanups.push(() => hub.close());
    hostFlags.checkpoint_pending = false;
    return hub;
  }
  const append = (events: PosEvent[]) => hub.deps.writer.run((tx) => tx.append(events.map(draftOf))).appended;
  const engine = (): EngineState => hub.deps.state.get() as EngineState;
  const lines = (msg: string): LogLine[] =>
    hub
      .logs()
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l) as LogLine)
      .filter((l) => l.msg === msg);
  const checkpoints = (): number => hub.deps.db.prepare('SELECT COUNT(*) FROM engine_checkpoints').pluck().get() as number;

  it('[03a #131] live: empty OrderPlaced (two drinks), then OrderLinesAdded with order_header and two food lines → an EngineOrder; the id leaves the set; no absent id, no diagnostic', async () => {
    await open();
    append([anEngineConfigApplied()]);
    append([emptyOrder('O2', T0), readyAdded('O2', 'R1'), readyAdded('O2', 'R2')]);
    expect(engine().orders.O2).toBeUndefined();
    expect(hostFlags.untrackedLineIds.has('O2')).toBe(true);
    const [linesAdded] = append(foodAdded('O2', ['F1', 'F2']));
    const o = engine().orders.O2!;
    expect(o).toMatchObject({ order_type: 'dine_in', table_key: 'dine_in:T-O2', table_id: 'T-O2', follow_up: false, pickup_at_ms: null, placed_by: null });
    expect(o.placed_at).toBe(linesAdded!.recorded_at);
    expect(o.line_ids).toEqual(['F1', 'F2']);
    expect(engine().lines.F1!.fire_ms).not.toBeNull();
    expect(hostFlags.untrackedLineIds.has('O2')).toBe(false);
    expect(lines(ABSENT_ID)).toEqual([]);
    expect(lines(DIAGNOSTIC)).toEqual([]);
  });

  it('[03a #135] live safety net: the batch commits; one invalid_event; its ItemAdded events are logged as absent ids unless the order is in the id set', async () => {
    await open();
    append([anEngineConfigApplied()]);
    // An order the engine never saw (not in the id set): the ItemAdded events are logged.
    append(foodAdded('O7', ['F1', 'F2'], { header: null }));
    expect(engine().orders.O7).toBeUndefined();
    expect(lines(DIAGNOSTIC)).toEqual([expect.objectContaining({ kind: 'invalid_event', event_type: 'OrderLinesAdded', order_id: 'O7', order_item_id: 'F1', reason: 'order_not_in_engine' })]);
    expect(lines(ABSENT_ID)).toEqual([
      expect.objectContaining({ event_type: 'ItemAdded', order_id: 'O7', order_item_id: 'F1' }),
      expect.objectContaining({ event_type: 'ItemAdded', order_id: 'O7', order_item_id: 'F2' }),
    ]);
    // A ready-items-only order (in the id set, no header so it stays there): quiet.
    append([emptyOrder('O2', T0)]);
    append(foodAdded('O2', ['G1'], { header: null }));
    expect(hostFlags.untrackedLineIds.has('O2')).toBe(true);
    expect(lines(ABSENT_ID)).toHaveLength(2);
    expect(lines(DIAGNOSTIC)).toHaveLength(2);
  });

  it('[03a #135] live empty addition (with and without order_header): no diagnostic, no EngineOrder, the order stays in the id set; a refused one with order_header removes it', async () => {
    await open();
    append([anEngineConfigApplied()]);
    append([emptyOrder('O2', T0)]);
    const before = engine();
    append(foodAdded('O2', []));
    append(foodAdded('O2', [], { header: null }));
    expect(engine()).toBe(before);
    expect(hostFlags.untrackedLineIds.has('O2')).toBe(true);
    expect(lines(DIAGNOSTIC)).toEqual([]);
    // Refused with order_header (group_id_invalid): its lines are alerted as dropped (AD-8), and the id leaves the set.
    append(foodAdded('O2', ['F1'], { group: 5 }));
    expect(engine().orders.O2).toBeUndefined();
    expect(lines(DIAGNOSTIC)).toEqual([expect.objectContaining({ kind: 'invalid_event', event_type: 'OrderLinesAdded', reason: 'group_id_invalid' })]);
    expect(hostFlags.untrackedLineIds.has('O2')).toBe(false);
    expect(lines(ABSENT_ID)).toEqual([expect.objectContaining({ event_type: 'ItemAdded', order_id: 'O2', order_item_id: 'F1' })]);
  });

  it('[03a #136] an open order of ready items only does not block the day-close checkpoint: written at once', async () => {
    await open();
    append([anEngineConfigApplied(), aBusinessDayOpened()]);
    append([emptyOrder('O2', T0), readyAdded('O2', 'R1')]);
    append([aBusinessDayClosed()]);
    expect(checkpoints()).toBe(1);
    expect(hostFlags.checkpoint_pending).toBe(false);
  });

  it('[03a #133] with the food added before the close, the day-close checkpoint waits for the order to leave the engine (checkpoint_pending)', async () => {
    await open();
    append([anEngineConfigApplied(), aBusinessDayOpened()]);
    append([emptyOrder('O2', T0), readyAdded('O2', 'R1')]);
    append(foodAdded('O2', ['F1']));
    expect(engine().orders.O2).toBeDefined();
    append([aBusinessDayClosed()]);
    expect(checkpoints()).toBe(0);
    expect(hostFlags.checkpoint_pending).toBe(true);
  });
});
