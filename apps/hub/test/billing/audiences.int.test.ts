import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { auditEventTypes } from '@pos/domain';
import type { DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import * as builders from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BILL_STREAM, BILLING_AUDIENCE_TYPES, checkBillingWiring, FIVE_EVENT_TYPES, NO_AUDIT_ACTION, SHIFT_STREAM } from '../../src/billing/index';
import { billTileMarks } from '../../src/billing/tile-marks';
import { tileMarksOf } from '../../src/tables/tile-marks';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { openVoidsDay } from '../voids/fixtures';
import { billingDirectory, openSeating, STAFF, VX } from './fixtures';

// 05 §6.30 (H16-6, H17-4, B23), §10 #91b, plan §3 row 33 (G-30 / R-30, G-38 / R-41): the startup wiring check and the
// audience table of every 05 event. Real sockets on a real hub (catch-up, then live frames through ws/server.ts deliver),
// events appended through the hub's writer and folded by the real `billing` / `shifts` projections.

const TAKER = 'S_TAKE'; // take-order only (no take-payment)
const CASH2 = 'S_CASH2'; // a second cashier
const ROOT = fileURLToPath(new URL('../../../../packages/events/src/events/', import.meta.url));

let hub: TestHub;
const sockets: WsClient[] = [];

/** billingDirectory() plus a take-order-only person and a second cashier. */
async function directory(): Promise<DirectoryInput> {
  const base = await billingDirectory();
  const cashier = base.staff.find((s) => s.staff_id === STAFF.cashier)!;
  return {
    ...base,
    roles: [
      ...base.roles,
      {
        role_id: 'R_TAKE',
        name: 'Take only',
        session_idle_ttl_ms: 900_000,
        permissions: [{ permission: 'take-order', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'branch' }],
      },
    ],
    staff: [
      ...base.staff,
      { ...cashier, staff_id: TAKER, display_name: 'Taker', role_ids: ['R_TAKE'] },
      { ...cashier, staff_id: CASH2, display_name: 'Cashier two' },
    ],
  };
}

beforeEach(async () => {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  openVoidsDay(hub);
});

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  await hub.close();
});

/** A signed-in staff socket on a new device of `type`, past its catch-up frame. */
async function socketOf(staffId: string, type: 'tablet' | 'cashier_kiosk' = 'tablet'): Promise<WsClient> {
  const device = pairDevice(hub, { type });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  const ws = await connectWs(hub.app);
  sockets.push(ws);
  ws.send({ type: 'auth', device_token: device.token, session_token: session.token });
  await ws.untilCount(1);
  return ws;
}

async function stationSocket(): Promise<WsClient> {
  const kds = pairDevice(hub, { type: 'kds', stationId: 'S1' });
  const session = openSession(hub, { kind: 'station', deviceId: kds.deviceId, stationId: 'S1' });
  const ws = await connectWs(hub.app);
  sockets.push(ws);
  ws.send({ type: 'auth', device_token: kds.token, session_token: session.token });
  await ws.untilCount(1);
  return ws;
}

/** A builder's event, payload overridden, appended through the hub's writer (folded by the real projections). */
function append(built: PosEvent, payload: Record<string, unknown> = {}, stream_id?: string): void {
  hub.clock.advance(1_000);
  const draft: EventDraft = {
    stream_type: built.stream_type,
    stream_id: stream_id ?? built.stream_id,
    event_type: built.event_type,
    schema_version: built.schema_version,
    payload: { ...(built.payload as Record<string, unknown>), ...payload },
    occurred_at: hub.clock.branchNow(),
    actor_id: STAFF.cashier,
    device_id: 'D_FIXTURE',
  };
  hub.deps.writer.run((tx) => tx.append([draft]));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

function received(ws: WsClient): string[] {
  return ws.messages
    .filter((m) => (m as { type?: string }).type === 'event')
    .map((m) => (m as { event: { event_type: string } }).event.event_type);
}

/** The live frames of `ws` with their payload. */
function frames(ws: WsClient, type: string): Array<Record<string, unknown>> {
  return ws.messages
    .filter((m) => (m as { type?: string; event?: { event_type: string } }).event?.event_type === type)
    .map((m) => (m as { event: { payload: Record<string, unknown> } }).event.payload);
}

// =========================================================================================== the wiring check

describe('[05 §6.30, #91b] startup wiring check', () => {
  it('[05 #91b] the 05 event list is exactly the bill and shift event files of @pos/events plus the three 05 hub events', () => {
    const files = (dir: string) =>
      readdirSync(`${ROOT}${dir}`)
        .filter((f) => /^[A-Z]\w+\.v1\.ts$/.test(f))
        .map((f) => f.replace('.v1.ts', ''));
    const expected = [...files('bill'), ...files('shift'), 'OrdersCarriedOver', 'ZReportIssued', 'FiscalTokenSet'];
    expect([...FIVE_EVENT_TYPES].sort()).toEqual(expected.sort());
    expect(FIVE_EVENT_TYPES).toHaveLength(31);
    // each audience list holds exactly its stream's event folder (a moved event never gets the wrong audience)
    expect([...BILL_STREAM].sort()).toEqual(files('bill').sort());
    expect([...SHIFT_STREAM].sort()).toEqual(files('shift').sort());
  });

  it('[05 #91b] a booted hub: every 05 event type has a billing audience; every one but DiscountFrozen and FiscalNumberAssigned has an audit map; those two have none', () => {
    const audited = new Set(auditEventTypes());
    for (const t of FIVE_EVENT_TYPES) {
      expect(BILLING_AUDIENCE_TYPES.has(t), `${t} audience`).toBe(true);
      expect(audited.has(t), `${t} audit`).toBe(!NO_AUDIT_ACTION.has(t));
    }
    expect([...NO_AUDIT_ACTION].sort()).toEqual(['DiscountFrozen', 'FiscalNumberAssigned']);
    expect(() => checkBillingWiring(BILLING_AUDIENCE_TYPES, audited)).not.toThrow();
  });

  it('[05 #91b] a missing audience or audit map fails the check loudly, naming each type', () => {
    const audited = new Set(auditEventTypes());
    const noPayment = new Set([...BILLING_AUDIENCE_TYPES].filter((t) => t !== 'PaymentAdded' && t !== 'DiscountFrozen'));
    expect(() => checkBillingWiring(noPayment, audited)).toThrow(/no WS audience: DiscountFrozen, PaymentAdded$/);
    const noCount = new Set([...audited].filter((t) => t !== 'ShiftCounted'));
    expect(() => checkBillingWiring(BILLING_AUDIENCE_TYPES, noCount)).toThrow(/no audit map: ShiftCounted/);
  });

  it('[05 #91b, row T-4, G-30] registerTileMarks(billTileMarks) is registered by the booted hub (before listen)', () => {
    openSeating(hub, { table_id: VX.tables.T4, seating_id: 'SEAT-T' });
    append(builders.aBillOpened(), { bill_id: 'B-T', seating_id: 'SEAT-T' }, 'B-T');
    expect(billTileMarks(hub.deps.db, ['SEAT-T']).size).toBe(0);
    append(builders.aCheckBillPrinted(), { bill_id: 'B-T' }, 'B-T');
    expect(tileMarksOf(hub.deps.db, ['SEAT-T']).get('SEAT-T')!.check_printed_at).not.toBeNull();
  });
});

// =========================================================================================== real sockets

describe('[05 §6.30, H16-6, #91b] who receives the money and shift events', () => {
  it('[05 #91b] PaymentAdded and every bill-stream event (DiscountFrozen included) → take-payment holders and cashier kiosks; never a take-order-only socket or a KDS station', async () => {
    openSeating(hub, { table_id: VX.tables.T4, seating_id: 'SEAT-1', holder_staff_id: STAFF.orderTaker });
    const cashier = await socketOf(STAFF.cashier);
    const taker = await socketOf(TAKER);
    const takerKiosk = await socketOf(TAKER, 'cashier_kiosk');
    const station = await stationSocket();
    append(builders.aBillOpened(), { bill_id: 'B1', seating_id: 'SEAT-1' }, 'B1');
    append(builders.aPaymentAdded(), { bill_id: 'B1', payment_id: 'P1' }, 'B1');
    append(builders.aDiscountFrozen(), { bill_id: 'B1' }, 'B1');
    await cashier.untilCount(4);
    await takerKiosk.untilCount(4);
    await settle();
    expect(received(cashier)).toEqual(['BillOpened', 'PaymentAdded', 'DiscountFrozen']);
    expect(received(takerKiosk)).toEqual(['BillOpened', 'PaymentAdded', 'DiscountFrozen']);
    expect(received(taker)).toEqual([]);
    expect(received(station)).toEqual([]);
  });

  it('[05 §6.30 "scope as §6.1"] take-payment own_tables: the holder of the seating gets PaymentAdded, a bill on another person\'s table does not reach them', async () => {
    openSeating(hub, { table_id: VX.tables.T4, seating_id: 'SEAT-1', holder_staff_id: STAFF.orderTaker });
    openSeating(hub, { table_id: VX.tables.T5, seating_id: 'SEAT-2', holder_staff_id: STAFF.manager });
    const holder = await socketOf(STAFF.orderTaker); // Order taker: take-payment own_tables
    const manager = await socketOf(STAFF.manager); // branch
    append(builders.aBillOpened(), { bill_id: 'B1', seating_id: 'SEAT-1' }, 'B1');
    append(builders.aBillOpened(), { bill_id: 'B2', seating_id: 'SEAT-2' }, 'B2');
    append(builders.aPaymentAdded(), { bill_id: 'B2', payment_id: 'P2' }, 'B2');
    append(builders.aPaymentAdded(), { bill_id: 'B1', payment_id: 'P1' }, 'B1');
    await manager.untilCount(5);
    await holder.untilCount(3);
    await settle();
    expect(received(manager)).toEqual(['BillOpened', 'BillOpened', 'PaymentAdded', 'PaymentAdded']);
    expect(received(holder)).toEqual(['BillOpened', 'PaymentAdded']);
    expect(frames(holder, 'PaymentAdded').map((p) => p['bill_id'])).toEqual(['B1']);
  });

  it("[05 #91b, B23] a cashier's socket receives no other person's ShiftCounted / HandoverCounted / ShiftOpened; the shift's own staff and close-shift-for-others holders do, carrying expected only after the count", async () => {
    const own = await socketOf(STAFF.cashier);
    const other = await socketOf(CASH2);
    const otherKiosk = await socketOf(CASH2, 'cashier_kiosk');
    const manager = await socketOf(STAFF.manager); // close-shift-for-others
    const taker = await socketOf(TAKER);
    append(builders.aShiftOpened(), { shift_id: 'SH1', staff_id: STAFF.cashier }, 'SH1');
    append(builders.aHandoverCounted(), { shift_id: 'SH1', by_staff_id: STAFF.cashier }, 'SH1');
    append(builders.aShiftCounted(), { shift_id: 'SH1', by_staff_id: STAFF.cashier, variance_alert_id: null }, 'SH1');
    await own.untilCount(4);
    await manager.untilCount(4);
    await settle();
    expect(received(own)).toEqual(['ShiftOpened', 'HandoverCounted', 'ShiftCounted']);
    expect(received(manager)).toEqual(['ShiftOpened', 'HandoverCounted', 'ShiftCounted']);
    expect(frames(own, 'ShiftCounted')[0]).toMatchObject({ expected_minor: 1_195_500, variance_minor: -500 });
    for (const ws of [other, otherKiosk, taker]) expect(received(ws)).toEqual([]);
    for (const ws of [other, otherKiosk, taker]) expect(JSON.stringify(ws.messages)).not.toContain('expected_minor');
  });

  it('[05 §6.30] petty cash and drawer opens → the shift owner and close-shift-for-others holders only', async () => {
    const own = await socketOf(STAFF.cashier);
    const other = await socketOf(CASH2);
    const manager = await socketOf(STAFF.manager);
    append(builders.aShiftOpened(), { shift_id: 'SH1', staff_id: STAFF.cashier }, 'SH1');
    append(builders.aPettyCashOut(), { shift_id: 'SH1' }, 'SH1');
    append(builders.aDrawerOpened(), { shift_id: 'SH1' }, 'SH1');
    await own.untilCount(4);
    await manager.untilCount(4);
    await settle();
    expect(received(own)).toEqual(['ShiftOpened', 'PettyCashOut', 'DrawerOpened']);
    expect(received(manager)).toEqual(['ShiftOpened', 'PettyCashOut', 'DrawerOpened']);
    expect(received(other)).toEqual([]);
  });

  it('[05 §6.30] ZReportIssued → view-reports / close-business-day holders only; FiscalTokenSet → admin sessions only (no hub socket)', async () => {
    const manager = await socketOf(STAFF.manager);
    const cashier = await socketOf(STAFF.cashier, 'cashier_kiosk');
    append(builders.aZReportIssued());
    append(builders.aFiscalTokenSet());
    await manager.untilCount(2);
    await settle();
    expect(received(manager)).toEqual(['ZReportIssued']);
    expect(received(cashier)).toEqual([]);
  });
});
