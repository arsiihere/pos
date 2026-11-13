import { vi } from 'vitest';
import { reply } from '../../../../test/dom';
import type { KdsConfig } from './api';

// Test-only fake hub for the 03 admin pages: answers by path, records every call (method, path, body).

export interface HubCall {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

export type Route = (body: Record<string, unknown> | undefined) => Response | Error;

export function fakeHub(routes: Record<string, Route | Response>) {
  const calls: HubCall[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as Record<string, unknown>);
    calls.push({ method, path: url, body });
    const route = routes[`${method} ${url}`] ?? routes[url];
    if (route === undefined) throw new Error(`no route ${method} ${url}`);
    const answer = typeof route === 'function' ? route(body) : route.clone();
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return {
    calls,
    fetchFn,
    reads: (path: string) => calls.filter((c) => c.method === 'GET' && c.path === path).length,
    commands: (type: string) => calls.filter((c) => c.body?.['command_type'] === type).map((c) => c.body?.['payload'] as Record<string, unknown>),
  };
}

export const STATUS = reply(200, { data: { tenant_id: 'T1', branch_id: 'B1' } });

export function ok(data: unknown): Response {
  return reply(200, { data });
}

export function result(data: unknown): Response {
  return reply(200, { data: { result: data } });
}

export function refused(status: number, code: string, details: Record<string, unknown> = {}): Response {
  return reply(status, { error: { code, details } });
}

export const CONFIG: KdsConfig = {
  stations: [
    {
      station_id: 'S-T',
      name: 'Tandoor',
      point_id: 'P-PASS',
      sound_volume: 80,
      lanes: { lanes_on: 2, lane_count: 2 },
      screens: [
        { device_id: 'K-TL', name: 'Tandoor Left', lane_label: 'Left', state: 'connected' },
        { device_id: 'K-TR', name: 'Tandoor Right', lane_label: 'Right', state: 'offline' },
      ],
      dark: false,
    },
    {
      station_id: 'S-F',
      name: 'Fryer',
      point_id: 'P-PASS',
      sound_volume: 70,
      lanes: { lanes_on: null, lane_count: 1 },
      screens: [{ device_id: 'K-F', name: 'Fryer screen', lane_label: null, state: 'signed_out' }],
      dark: false,
    },
    { station_id: 'S-C', name: 'Cold', point_id: 'P-PASS', sound_volume: 70, lanes: { lanes_on: 1, lane_count: 1 }, screens: [], dark: false },
    {
      station_id: 'S-D',
      name: 'Degh',
      point_id: 'P-DEGH',
      sound_volume: 100,
      lanes: { lanes_on: 1, lane_count: 1 },
      screens: [{ device_id: 'K-D', name: 'Degh screen', lane_label: null, state: 'connected' }],
      dark: false,
    },
  ],
  pass_tablets: [
    { device_id: 'T-PASS', name: 'Pass tablet', point_id: 'P-PASS', state: 'signed_out' },
    { device_id: 'T-DEGH', name: 'Degh tablet', point_id: 'P-DEGH', state: 'connected' },
  ],
  points: [
    { point_id: 'P-PASS', name: 'Pass', is_archived: false },
    { point_id: 'P-DEGH', name: 'Degh', is_archived: false },
    { point_id: 'P-OLD', name: 'Old pass', is_archived: true },
  ],
  warnings: [],
};

export const DEVICES = {
  devices: [
    { device_id: 'T-PASS', device_name: 'Pass tablet', device_type: 'tablet', revoked_at: null },
    { device_id: 'T-DEGH', device_name: 'Degh tablet', device_type: 'tablet', revoked_at: null },
    { device_id: 'T5', device_name: 'Tablet 5', device_type: 'tablet', revoked_at: null },
    { device_id: 'K-TL', device_name: 'Tandoor Left', device_type: 'kds', revoked_at: null },
    { device_id: 'PH1', device_name: 'Bilal phone', device_type: 'phone', revoked_at: null },
  ],
};
