import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reply } from '../../../../test/dom';
import { createKitchenScreensApi } from './api';

const STATUS = { tenant_id: 'T1', branch_id: 'B1' };

type Call = { url: string; init: RequestInit | undefined };

function fake(answers: Array<Response | Error>) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (next === undefined) throw new Error(`unexpected ${url}`);
    if (next instanceof Error) throw next;
    return next;
  });
  return { calls, fetchFn };
}

function apiWith(answers: Array<Response | Error>, onSignedOut = vi.fn()) {
  const f = fake(answers);
  const api = createKitchenScreensApi({
    fetch: f.fetchFn,
    storage: sessionStorage,
    readDeviceToken: async () => 'DEV-TOKEN',
    readDeviceId: async () => 'D1',
    onSignedOut,
  });
  return { api, ...f, onSignedOut };
}

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('admin_session_token', 'S1');
  sessionStorage.setItem('admin_staff_id', 'ST1');
});

describe('kitchen screens api', () => {
  it('[03b §6.12] kds-config is GET /admin/queries/kds-config with the device token and the admin session', async () => {
    const { api, calls } = apiWith([reply(200, { data: { stations: [], pass_tablets: [], warnings: [] } })]);
    const answer = await api.kdsConfig();
    expect(answer).toEqual({ ok: true, data: { stations: [], pass_tablets: [], warnings: [] } });
    expect(calls[0]?.url).toBe('/admin/queries/kds-config');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer DEV-TOKEN');
    expect(headers['X-Admin-Session']).toBe('S1');
  });

  it('[03b §6.9] SetStationScreen goes to /admin/commands/set-station-screen in a full envelope (ids from config-status once)', async () => {
    const { api, calls } = apiWith([
      reply(200, { data: STATUS }),
      reply(200, { data: { result: { station_id: 'S-T', sound_volume: 40 } } }),
      reply(200, { data: { result: { device_id: 'K1', point_id: null, lane_label: 'Left' } } }),
    ]);
    const first = await api.setStationScreen({ station_id: 'S-T', sound_volume: 40 }, 'CMD1');
    expect(first).toEqual({ ok: true, data: { station_id: 'S-T', sound_volume: 40 } });
    expect(calls[0]?.url).toBe('/admin/queries/config-status');
    expect(calls[1]?.url).toBe('/admin/commands/set-station-screen');
    const envelope = JSON.parse(String(calls[1]?.init?.body)) as Record<string, unknown>;
    expect(envelope).toMatchObject({
      command_id: 'CMD1',
      tenant_id: 'T1',
      branch_id: 'B1',
      command_type: 'SetStationScreen',
      payload: { station_id: 'S-T', sound_volume: 40 },
      actor_id: 'ST1',
      device_id: 'D1',
    });
    await api.setDeviceRole({ device_id: 'K1', lane_label: 'Left' }, 'CMD2');
    expect(calls).toHaveLength(3);
    expect(calls[2]?.url).toBe('/admin/commands/set-device-role');
    expect(JSON.parse(String(calls[2]?.init?.body))).toMatchObject({ command_type: 'SetDeviceRole', payload: { device_id: 'K1', lane_label: 'Left' } });
  });

  it('[03b §6.10] an api error keeps its code and details; a network failure is { kind: network }', async () => {
    const { api } = apiWith([
      reply(200, { data: STATUS }),
      reply(404, { error: { code: 'POINT_NOT_FOUND', details: { point_id: 'P9' } } }),
      new Error('down'),
    ]);
    expect(await api.setDeviceRole({ device_id: 'T5', point_id: 'P9' }, 'C1')).toEqual({
      ok: false,
      error: { kind: 'api', status: 404, code: 'POINT_NOT_FOUND', details: { point_id: 'P9' } },
    });
    expect(await api.kdsConfig()).toEqual({ ok: false, error: { kind: 'network' } });
  });

  it('[00 §8.2] ADMIN_SESSION_REQUIRED clears the shared admin session keys and signs the page out', async () => {
    const { api, onSignedOut } = apiWith([reply(401, { error: { code: 'ADMIN_SESSION_REQUIRED' } })]);
    expect(await api.kdsConfig()).toEqual({ ok: false, error: { kind: 'signed_out' } });
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('admin_session_token')).toBeNull();
    expect(sessionStorage.getItem('admin_staff_id')).toBeNull();
  });
});
