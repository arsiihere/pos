// 03a v1.2 Q-3 test 125 (02p task 15), the live and full-replay legs; the restart leg is in boot-idset.int.test.ts.
// The host's absent-id log skips zone lines, deal headers and (AD-E18) ready-items-only orders through the host id set.
import { initialEngineState, type Diagnostic, type EngineState } from '@pos/engine';
import type { EventDraft, PosEvent } from '@pos/events';
import { anEngineConfigApplied } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { hostFlags, resetHostFlags } from '../../src/engine-host/host-flags';
import { replayEngine } from '../../src/engine-host/replay';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { ABSENT_ID, dealOrder, emptyOrder, readyAdded, readyShapes, removed, served, voided, zoneAdded, zoneAndDealShapes } from './q3-lines';

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
