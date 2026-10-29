import { availableStock, openDayStartMs, type EngineState } from '@pos/engine';
import type { BranchConfigV1, EventDraft } from '@pos/events';
import { aBranchConfigV1 } from '@pos/events/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';

type Admin = { device: { deviceId: string; token: string }; session: { sessionId: string; token: string } };
type CatchUp = { type: 'catch_up'; state: Record<string, unknown> };

const HASH = 'a'.repeat(64);
const cleanups: Array<() => Promise<void>> = [];

describe('restaurant ws pushes and catch-up (§4.5)', () => {
  afterEach(async () => {
    vi.useRealTimers();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[01a §10 #73] StockSet, StockAdded, BusinessDayOpened and ItemMade* reach staff sockets, not station sockets; BranchConfigApplied reaches both', async () => {
    const hub = await open(at(25, 6));
    withConfig(aBranchConfigV1());
    const admin = adminOn(hub);
    const staff = await staffSocket(hub);
    const station = await stationSocket(hub);

    await command(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open');
    await command(hub, admin, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ item_id: 'I1', on_hand: 4 }] }, 'cmd-set');
    await command(hub, admin, 'add-precooked-stock', 'AddPrecookedStock', { entries: [{ item_id: 'I1', quantity: 2 }] }, 'cmd-add');
    await command(hub, admin, 'set-item-availability', 'SetItemAvailability', { item_id: 'I2', is_available: false }, 'cmd-off');
    await command(hub, admin, 'set-item-availability', 'SetItemAvailability', { item_id: 'I2', is_available: true }, 'cmd-on');
    hub.deps.writer.run((tx) => tx.append([configApplied(2)]));

    const staffTypes = ['BusinessDayOpened', 'StockSet', 'StockAdded', 'ItemMadeUnavailable', 'ItemMadeAvailable', 'BranchConfigApplied'];
    await staff.untilCount(1 + staffTypes.length);
    await station.untilCount(2);
    await settle();
    expect(eventTypes(staff)).toEqual(staffTypes);
    expect(eventTypes(station)).toEqual(['BranchConfigApplied']);
    expect(eventFrames(station)[0]).toMatchObject({ event: { payload: { config_version: 2, snapshot_hash: HASH } } });
  });

  it('[01a §4.5] BusinessDayClosed reaches staff sockets, not station sockets (#145 push clause)', async () => {
    const hub = await open(at(25, 6));
    withConfig(aBranchConfigV1());
    const admin = adminOn(hub);
    await command(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open');
    const staff = await staffSocket(hub);
    const station = await stationSocket(hub);

    hub.clock.set(at(25, 23));
    const closed = await command(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close');
    expect(closed.result.reason).toBe('closed');
    await staff.untilCount(2);
    await settle();
    expect(eventTypes(staff)).toEqual(['BusinessDayClosed']);
    expect(eventTypes(station)).toEqual([]);
  });

  it('[01a §10 #89] a new stock-tracked item with no StockSet reads 0 in the stock query, availableStock and the catch-up stock part', async () => {
    const base = aBranchConfigV1();
    const i3 = base.items.find((i) => i.item_id === 'I3')!;
    const config: BranchConfigV1 = { ...base, items: [...base.items, { ...i3, item_id: 'I4', name: 'Seekh Kebab', sort_order: 4 }] };
    const hub = await open(at(25, 6));
    withConfig(config);
    const admin = adminOn(hub);
    await command(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open');

    const res = await hub.app.inject({
      method: 'GET',
      url: '/admin/queries/stock',
      headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
    });
    expect(res.statusCode).toBe(200);
    const row = (res.json().data.items as Array<{ item_id: string }>).find((r) => r.item_id === 'I4');
    expect(row).toMatchObject({ on_hand: 0, reserved: 0, available: 0, set_at: null, level: 'not_counted' });
    const state = engine(hub);
    expect(availableStock(state, 'I4', openDayStartMs(state), config.items.find((i) => i.item_id === 'I4')!)).toBe(0);

    const stock = catchUpOf(await staffSocket(hub)).stock as { items: Record<string, unknown> };
    expect(stock.items.I4).toEqual({ on_hand: 0, reserved: 0, set_at: null, unit: 'g', available: 0, level: 'not_counted' });
  });

  it('[01a §10 #90] under fake timers the ItemMadeUnavailable frame arrives with the clock advanced < 5 000 ms; a later reconnect has the item in availability', async () => {
    const hub = await open(at(25, 6));
    withConfig(aBranchConfigV1());
    const admin = adminOn(hub);
    const staff = await staffSocket(hub);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const startedAt = Date.now();
    const pending = command(hub, admin, 'set-item-availability', 'SetItemAvailability', { item_id: 'I1', is_available: false }, 'cmd-off');
    await pending;
    // setImmediate is not faked: wait for the frame without moving the fake clock.
    for (let i = 0; i < 100 && staff.messages.length < 2; i += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(eventFrames(staff)).toEqual([
      expect.objectContaining({ type: 'event', event: expect.objectContaining({ event_type: 'ItemMadeUnavailable', payload: { item_id: 'I1' } }) }),
    ]);
    vi.useRealTimers();

    const again = await staffSocket(hub);
    expect(catchUpOf(again).availability).toEqual({ unavailable_item_ids: ['I1'] });
  });

  it('[01a §10 #91] catch-up: staff gets branch_config, availability and stock; station gets branch_config only; before any config branch_config is null', async () => {
    const hub = await open(at(25, 6));
    const early = catchUpOf(await staffSocket(hub));
    expect(early.branch_config).toBeNull();
    expect(early.availability).toEqual({ unavailable_item_ids: [] });
    expect(early.stock).toEqual({ business_day: null, business_day_started_at: null, items: {} });
    expect(catchUpOf(await stationSocket(hub)).branch_config).toBeNull();

    const config = aBranchConfigV1({ config_version: 7 });
    withConfig(config);
    const admin = adminOn(hub);
    await command(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open');
    hub.clock.set(at(25, 7));
    await command(hub, admin, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ item_id: 'I1', on_hand: 3 }, { item_id: 'I3', on_hand: 1_000 }] }, 'cmd-set');
    await command(hub, admin, 'set-item-availability', 'SetItemAvailability', { item_id: 'I3', is_available: false }, 'cmd-off-3');
    await command(hub, admin, 'set-item-availability', 'SetItemAvailability', { item_id: 'I2', is_available: false }, 'cmd-off-2');

    const state = catchUpOf(await staffSocket(hub));
    expect(state.branch_config).toEqual({ config_version: 7, snapshot_hash: HASH, hub_time: { now_ms: at(25, 7), utc_offset_ms: offset(at(25, 7)) } });
    expect(state.availability).toEqual({ unavailable_item_ids: ['I2', 'I3'] });
    // 01c §6.20: the open day's frozen stock units and draws (aBranchConfigV1 through the V2 view).
    const frozen = {
      stock_units: { I1: 'piece', I3: 'g' },
      draws: {
        I1: { sale_unit: 'piece', stock_draws: [{ stock_item_id: 'I1', quantity_per_sale_unit: 1 }] },
        I3: { sale_unit: 'piece', stock_draws: [{ stock_item_id: 'I3', quantity_per_sale_unit: 250 }] },
      },
    };
    expect(state.stock).toEqual({
      business_day: { business_date: '2026-10-25', opened_at: at(25, 6), closed_at: null, ...frozen },
      business_day_started_at: at(25, 6),
      items: {
        I1: { on_hand: 3, reserved: 0, set_at: at(25, 7), unit: 'piece', available: 3, level: 'ok' },
        I3: { on_hand: 1_000, reserved: 0, set_at: at(25, 7), unit: 'g', available: 1_000, level: 'ok' },
      },
    });

    const station = catchUpOf(await stationSocket(hub));
    expect(station.branch_config).toEqual(state.branch_config);
    expect(station).not.toHaveProperty('availability');
    expect(station).not.toHaveProperty('stock');
  });

  it('[01a S47] the catch-up branch_config part carries hub_time', async () => {
    const hub = await open(at(25, 12, 34));
    withConfig(aBranchConfigV1());
    const part = catchUpOf(await staffSocket(hub)).branch_config as { hub_time: { now_ms: number; utc_offset_ms: number } };
    expect(part.hub_time).toEqual({ now_ms: at(25, 12, 34), utc_offset_ms: offset(at(25, 12, 34)) });
    hub.clock.advance(90_000);
    const later = catchUpOf(await stationSocket(hub)).branch_config as { hub_time: { now_ms: number } };
    expect(later.hub_time.now_ms).toBe(at(25, 12, 34) + 90_000);
  });

  it('[01a S41] the catch-up stock part reads available 0 for yesterday’s non-carrying count after the next open (#116 catch-up clause)', async () => {
    const hub = await open(at(24, 10));
    withConfig(aBranchConfigV1());
    const admin = adminOn(hub);
    await command(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-24');
    hub.clock.set(at(24, 23));
    await command(hub, admin, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ item_id: 'I1', on_hand: 4 }] }, 'cmd-set-24');
    hub.clock.set(at(24, 23, 30));
    await command(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-close-24');
    hub.clock.set(at(25, 9));
    await command(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-25');

    let stock = catchUpOf(await staffSocket(hub)).stock as { items: Record<string, unknown> };
    expect(stock.items.I1).toMatchObject({ on_hand: 4, available: 0, level: 'not_counted' });
    await command(hub, admin, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ item_id: 'I1', on_hand: 4 }] }, 'cmd-set-25');
    stock = catchUpOf(await staffSocket(hub)).stock as { items: Record<string, unknown> };
    expect(stock.items.I1).toMatchObject({ on_hand: 4, available: 4, level: 'ok' });
  });
});

// Local wall-clock time on October <day>, 2026 (the hub's zone).
function at(day: number, hours: number, minutes = 0): number {
  return new Date(2026, 9, day, hours, minutes).getTime();
}

function offset(ms: number): number {
  return 0 - new Date(ms).getTimezoneOffset() * 60_000;
}

async function open(start: number): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  hub.clock.set(start);
  // These tests move the clock by hours; long idle TTLs keep the sessions alive.
  const directory = await aDirectory();
  for (const role of directory.roles) role.session_idle_ttl_ms = 7 * 86_400_000;
  await seedDirectory(hub, directory);
  return hub;
}

function withConfig(config: BranchConfigV1): void {
  swapBranchConfig({ config, snapshotHash: HASH, configVersion: config.config_version, snapshotSchemaVersion: 1, appliedAt: 0 });
}

function adminOn(hub: TestHub): Admin {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'admin', staffId: 'S_MGR', deviceId: device.deviceId });
  return { device, session };
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
  cleanups.push(async () => ws.close());
  ws.send({ type: 'auth', device_token: deviceToken, session_token: sessionToken });
  await ws.untilCount(1);
  return ws;
}

function catchUpOf(ws: WsClient): Record<string, unknown> {
  const first = ws.messages[0] as CatchUp;
  expect(first.type).toBe('catch_up');
  return first.state;
}

function eventFrames(ws: WsClient): Array<{ type: string; event: { event_type: string; payload: Record<string, unknown> } }> {
  return ws.messages.filter((m) => (m as { type?: string }).type === 'event') as Array<{ type: string; event: { event_type: string; payload: Record<string, unknown> } }>;
}

function eventTypes(ws: WsClient): string[] {
  return eventFrames(ws).map((frame) => frame.event.event_type);
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function command(hub: TestHub, admin: Admin, name: string, commandType: string, payload: Record<string, unknown>, commandId: string) {
  const res = await hub.app.inject({
    method: 'POST',
    url: `/admin/commands/${name}`,
    headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
    payload: {
      command_id: commandId,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: commandType,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: 'S_MGR',
      device_id: admin.device.deviceId,
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json().data as { result: Record<string, unknown> };
}

function configApplied(version: number): EventDraft {
  return {
    stream_type: 'hub',
    stream_id: 'branch-1',
    event_type: 'BranchConfigApplied',
    schema_version: 1,
    payload: { config_version: version, snapshot_schema_version: 1, snapshot_hash: HASH, previous_config_version: 1 },
    occurred_at: 1,
    actor_id: null,
    device_id: 'hub',
  };
}

function engine(hub: TestHub): EngineState {
  return hub.deps.state.get();
}
