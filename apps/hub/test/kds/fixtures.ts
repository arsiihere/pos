// 03b shared test fixtures (phase 0 P0.12), on 02b's test/orders/fixtures.ts (FX, fixtureMenu, openDay, openSeating,
// appendOrder). Everything goes through the hub's real writer as real events, except the two device columns 00 H-5 /
// H-6 that only 03b's SetDeviceRole writes (pairDevice has no option for them, so they are set directly here).
import { stockEffects, type EngineState } from '@pos/engine';
import type { DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { aDirectory } from '../helpers/fixtures';
import { openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

export { FX, appendOrder, fixtureMenu, openDay, openSeating } from '../orders/fixtures';

/** The Cook of cookDirectory(): role R_COOK (run-pass + reprint-ticket, branch, 03b B-1), staff S_COOK. */
export const COOK = { role: 'R_COOK', staff: 'S_COOK' } as const;

/** aDirectory() (Owner, Manager, Cashier, Order taker) plus a Cook holding run-pass and reprint-ticket (aDirectory has none). */
export async function cookDirectory(o?: { directory_version?: number }): Promise<DirectoryInput> {
  const base = await aDirectory(o);
  const grant = (permission: 'run-pass' | 'reprint-ticket') => ({
    permission,
    grant_type: 'allowed' as const,
    approver_role_id: null,
    approver_role_ids: [],
    scope: 'branch' as const,
  });
  return {
    ...base,
    roles: [...base.roles, { role_id: COOK.role, name: 'Cook', session_idle_ttl_ms: 300_000, permissions: [grant('run-pass'), grant('reprint-ticket')] }],
    staff: [
      ...base.staff,
      {
        staff_id: COOK.staff,
        display_name: 'Cook',
        pin_hash: base.staff[0]!.pin_hash,
        role_ids: [COOK.role],
        denied_permissions: [],
        lead_staff_id: null,
        floor_ids: [],
      },
    ],
  };
}

/** Seeds cookDirectory() and signs the Cook in on `deviceId` (default: a new Pass tablet on `pointId`, default P1). */
export async function signInCook(hub: TestHub, o: { deviceId?: string; pointId?: string } = {}): Promise<{ deviceId: string; token: string; sessionId: string; sessionToken: string }> {
  await seedDirectory(hub, await cookDirectory());
  const device = o.deviceId === undefined ? pairPassTablet(hub, { pointId: o.pointId ?? 'P1' }) : { deviceId: o.deviceId, token: '' };
  const session = openSession(hub, { kind: 'staff', staffId: COOK.staff, deviceId: device.deviceId });
  return { ...device, sessionId: session.sessionId, sessionToken: session.token };
}

/** A paired `kds` device on `stationId`; with `laneLabel` it is a lane of that station (00 H-6). */
export function pairKds(hub: TestHub, o: { stationId: string; laneLabel?: string; name?: string }): { deviceId: string; token: string } {
  const device = pairDevice(hub, { type: 'kds', stationId: o.stationId, name: o.name });
  if (o.laneLabel !== undefined) {
    hub.deps.db.prepare('UPDATE devices SET lane_label = ? WHERE device_id = ?').run(o.laneLabel, device.deviceId);
  }
  return device;
}

/** A paired `tablet` bound to `pointId` (00 H-5): a Pass tablet (03b §3.1). */
export function pairPassTablet(hub: TestHub, o: { pointId: string; name?: string }): { deviceId: string; token: string } {
  const device = pairDevice(hub, { type: 'tablet', name: o.name });
  hub.deps.db.prepare('UPDATE devices SET point_id = ? WHERE device_id = ?').run(o.pointId, device.deviceId);
  return device;
}

type Draft = Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id' | 'schema_version'> & { schema_version?: number };

/**
 * Real events through the writer, clock + `advanceMs` (default 1 s) first; the stock effects (03a §3.7) are drafted from
 * the folded state, as a command would.
 */
export function append(hub: TestHub, drafts: Draft[], o: { actor?: string | null; device?: string; advanceMs?: number } = {}): PosEvent[] {
  hub.clock.advance(o.advanceMs ?? 1_000);
  const env = { occurred_at: hub.clock.branchNow(), actor_id: o.actor === undefined ? 'S_WAIT' : o.actor, device_id: o.device ?? 'D_FIXTURE' };
  return hub.deps.writer.run((tx) => {
    const full = drafts.map((d) => ({ schema_version: 1, ...d, ...env }) as EventDraft);
    return tx.append(stockEffects(tx.state as EngineState, full).map((d) => ({ ...env, ...d }) as EventDraft));
  }).appended;
}

const onOrder = (order_id: string, event_type: string, payload: Record<string, unknown>): Draft => ({ stream_type: 'order', stream_id: order_id, event_type, payload });

/** Fires `order_item_ids` at `stationId` with a real FireDispatched (station stream); the engine sets fired_at. */
export function fireLines(hub: TestHub, stationId: string, order_item_ids: string[], reason: 'scheduled' | 'early_fill' | 'pulled' = 'pulled'): PosEvent[] {
  return append(hub, [
    {
      stream_type: 'station',
      stream_id: stationId,
      event_type: 'FireDispatched',
      payload: { station_id: stationId, order_item_ids, load_id: null, due_at: hub.clock.branchNow(), reason },
    },
  ]);
}

/** ItemServed { source } for lines of one order (default 'tap'). */
export function serveLines(hub: TestHub, order_id: string, order_item_ids: string[], source: 'tap' | 'estimated' = 'tap'): PosEvent[] {
  return append(hub, [onOrder(order_id, 'ItemServed', { order_item_ids, source })]);
}

/** ItemRemoved (all units, or `units` of them). */
export function removeLine(hub: TestHub, order_id: string, order_item_id: string, units?: number): PosEvent[] {
  return append(hub, [onOrder(order_id, 'ItemRemoved', units === undefined ? { order_item_id } : { order_item_id, units })]);
}

/** ItemVoided of `units` (04's event; no refund). */
export function voidLine(hub: TestHub, order_id: string, order_item_id: string, units: number): PosEvent[] {
  return append(hub, [onOrder(order_id, 'ItemVoided', { order_item_id, units })], { actor: 'S_MGR' });
}
