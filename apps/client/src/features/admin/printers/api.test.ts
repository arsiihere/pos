import { beforeEach, describe, expect, it } from 'vitest';
import { STATUS, fakeHub, ok, refused, result } from '../kitchen-screens/test-hub';
import { createPrintersApi } from './api';
import { PRINT_CONFIG, PRINT_QUEUE } from './test-data';

function setup(routes: Parameters<typeof fakeHub>[0]) {
  const hub = fakeHub({ 'GET /admin/queries/config-status': STATUS, ...routes });
  const api = createPrintersApi({ fetch: hub.fetchFn, readDeviceToken: async () => 'TOK', readDeviceId: async () => 'D1', onSignedOut: () => {} });
  return { hub, api };
}

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('admin_session_token', 'S1');
  sessionStorage.setItem('admin_staff_id', 'ST1');
});

describe('printers api', () => {
  it('[03c §6.6 §6.7] print-config and print-queue are admin queries', async () => {
    const { api, hub } = setup({ 'GET /admin/queries/print-config': ok(PRINT_CONFIG), 'GET /admin/queries/print-queue': ok(PRINT_QUEUE) });
    expect(await api.printConfig()).toEqual({ ok: true, data: PRINT_CONFIG });
    expect(await api.printQueue()).toEqual({ ok: true, data: PRINT_QUEUE });
    expect(hub.calls.map((c) => c.path)).toEqual(['/admin/queries/print-config', '/admin/queries/print-queue']);
  });

  it('[03c §6.2 §6.3] SavePrinter and SetStationOutput go to /admin/commands/ in the envelope', async () => {
    const saved = { printer: { printer_id: 'P5', name: 'Grill', connection: 'lan', address: '192.168.1.9:9100', paper_width_mm: 80, archived: false } };
    const { api, hub } = setup({
      'POST /admin/commands/save-printer': result(saved),
      'POST /admin/commands/set-station-output': result({ station_output: {} }),
    });
    const payload = { name: 'Grill', connection: 'lan' as const, address: '192.168.1.9', paper_width_mm: 80 as const, archived: false };
    expect(await api.savePrinter(payload, 'C1')).toEqual({ ok: true, data: saved });
    await api.setStationOutput({ station_id: 'S-T', mode: 'screen', printer_id: null }, 'C2');
    expect(hub.commands('SavePrinter')).toEqual([payload]);
    expect(hub.commands('SetStationOutput')).toEqual([{ station_id: 'S-T', mode: 'screen', printer_id: null }]);
    expect(hub.calls[1]?.body).toMatchObject({ command_id: 'C1', tenant_id: 'T1', branch_id: 'B1', actor_id: 'ST1', device_id: 'D1' });
  });

  it('[03c §6.4 §6.5] test print posts { printer_id }; cancel posts to /admin/print/jobs/:job_id/cancel; errors keep their code', async () => {
    const { api, hub } = setup({
      'POST /admin/print/test': ok({ printed: true, status: 'clean', error: null }),
      'POST /admin/print/jobs/J%201/cancel': refused(409, 'PRINT_JOB_NOT_PENDING', { job_id: 'J 1', state: 'acked' }),
    });
    expect(await api.testPrint('P1')).toEqual({ ok: true, data: { printed: true, status: 'clean', error: null } });
    expect(hub.calls[0]?.body).toEqual({ printer_id: 'P1' });
    expect(await api.cancelJob('J 1')).toEqual({
      ok: false,
      error: { kind: 'api', status: 409, code: 'PRINT_JOB_NOT_PENDING', details: { job_id: 'J 1', state: 'acked' } },
    });
  });
});
