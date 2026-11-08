import type { EventDraft, PosEvent } from '@pos/events';
import { aStockConsumed, aStockSet, aStockReleased, aStockReserved } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';

// 03a AD-32 (1), developer ruling 2026-11-07: the stock frames StockReserved / StockReleased / StockConsumed go to
// every staff socket of the branch (the ordering screens' availability), never to a station socket — the same rule as
// 01a's StockSet / StockAdded (ws/restaurant-audiences.ts).
const cleanups: Array<() => Promise<void> | void> = [];

describe('[03a AD-32] stock frames reach staff sockets, not station sockets', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('[03a AD-32] StockReserved, StockReleased and StockConsumed reach a staff socket; a station socket gets none', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    await seedDirectory(hub, await aDirectory());
    const staff = await staffSocket(hub);
    const station = await stationSocket(hub);

    const types = ['StockReserved', 'StockReleased', 'StockConsumed'];
    hub.deps.writer.run((tx) => tx.append([aStockReserved(), aStockReleased(), aStockConsumed()].map(draftOf)));

    await staff.untilCount(1 + types.length);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(eventTypes(staff)).toEqual(types);
    expect(eventTypes(station)).toEqual([]);
  });

  it('[01a #194] StockTransferredOut sends a stock frame to the stock audience', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    await seedDirectory(hub, await aDirectory());
    const staff = await staffSocket(hub);
    const station = await stationSocket(hub);

    const moved = aStockSet({ event_type: 'StockTransferredOut', schema_version: 1, stream_id: 'K1', payload: { stock_item_id: 'K1', quantity: 2, zone_id: 'Z1' } });
    hub.deps.writer.run((tx) => tx.append([draftOf(moved)]));

    await staff.untilCount(2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(eventTypes(staff)).toEqual(['StockTransferredOut']);
    expect(eventTypes(station)).toEqual([]);
  });
});

function draftOf(e: PosEvent): EventDraft {
  const { stream_type, stream_id, event_type, schema_version, payload, occurred_at, actor_id, device_id } = e;
  return { stream_type, stream_id, event_type, schema_version, payload, occurred_at, actor_id, device_id } as EventDraft;
}

async function staffSocket(hub: TestHub): Promise<WsClient> {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: device.deviceId });
  return authed(hub, device.token, session.token);
}

async function stationSocket(hub: TestHub): Promise<WsClient> {
  const device = pairDevice(hub, { type: 'kds', stationId: 'S1' });
  const session = openSession(hub, { kind: 'station', deviceId: device.deviceId, stationId: 'S1' });
  return authed(hub, device.token, session.token);
}

async function authed(hub: TestHub, deviceToken: string, sessionToken: string): Promise<WsClient> {
  const ws = await connectWs(hub.app);
  cleanups.push(() => ws.close());
  ws.send({ type: 'auth', device_token: deviceToken, session_token: sessionToken });
  await ws.untilCount(1);
  return ws;
}

function eventTypes(ws: WsClient): string[] {
  return ws.messages
    .filter((m) => (m as { type?: string }).type === 'event')
    .map((m) => (m as { event: { event_type: string } }).event.event_type);
}
