import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flush, mount, type Mounted } from '../../../../test/dom';
import { STATUS, fakeHub, ok, refused, type Route } from '../kitchen-screens/test-hub';
import { createPrintersApi, type PrintQueue, type QueueJob } from './api';
import { PrintersApp } from './Printers';
import { PRINT_CONFIG, PRINT_QUEUE } from './test-data';

let m: Mounted;

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('admin_session_token', 'S1');
  sessionStorage.setItem('admin_staff_id', 'ST1');
  m = mount();
});

afterEach(() => m.unmount());

function job(over: Partial<QueueJob> & { job_id: string }): QueueJob {
  return {
    kind: 'kitchen',
    printer_id: 'P1',
    station_id: 'S-T',
    ticket_id: 'TK1',
    order_id: 'O1',
    created_at: 100,
    sent_at: null,
    attempts: 0,
    last_error: null,
    is_reprint: false,
    suspect_at: null,
    no_printer: false,
    ...over,
  };
}

const QUEUE: PrintQueue = {
  printers: [
    { printer_id: 'P1', name: 'Tandoor printer', status: 'paper_out', waiting: 6, suspect: 3, head_error: 'write_timeout', last_ack_at: 90 },
    { printer_id: 'P2', name: 'Cold printer', status: 'unknown', waiting: 0, suspect: 0, head_error: null, last_ack_at: 80 },
  ],
  jobs: [
    job({ job_id: 'J1', attempts: 4, last_error: 'connect_failed:ECONNREFUSED' }),
    job({ job_id: 'J2', kind: 'reprint', is_reprint: true, suspect_at: 50 }),
    job({ job_id: 'J3', kind: 'coming_up' }),
    job({ job_id: 'J4', station_id: 'S-G', printer_id: null, no_printer: true }),
  ],
  no_printer: 1,
};

function setup(routes: Record<string, Route | Response> = {}, queue: PrintQueue = QUEUE) {
  const hub = fakeHub({
    'GET /admin/queries/print-config': ok(PRINT_CONFIG),
    'GET /admin/queries/print-queue': ok(queue),
    'GET /admin/queries/config-status': STATUS,
    ...routes,
  });
  const api = createPrintersApi({ fetch: hub.fetchFn, readDeviceToken: async () => 'TOK', readDeviceId: async () => 'D1', onSignedOut: () => {} });
  m.render(<PrintersApp api={api} />);
  return hub;
}

function queueSection(): HTMLElement {
  return m.container.querySelector<HTMLElement>('[data-section="print-queue"]')!;
}

function rows(): HTMLElement[] {
  return [...queueSection().querySelectorAll<HTMLElement>('.pos-list__row')];
}

describe('print queue (03c-S03, D05)', () => {
  it('[03c §6.7] queue: waiting, suspect, no_printer totals per printer', async () => {
    setup();
    await flush();
    const section = queueSection();
    expect(section.textContent).toContain('Tandoor printer: 6 waiting · 3 may not have printed');
    // a printer with nothing waiting and no suspects has no total line
    expect(section.textContent).not.toContain('Cold printer:');
    expect(section.querySelector('.pos-banner--danger')?.textContent).toContain('1 jobs have no printer');
    const [j1, j2, j3, j4] = rows();
    expect(j1?.textContent).toContain('Ticket');
    expect(j1?.textContent).toContain('Tandoor · Tandoor printer');
    expect(j1?.querySelector('.pos-chip--warn')?.textContent).toBe('tried 4 times');
    expect(j1?.textContent).toContain("Can't reach the printer");
    expect(j2?.querySelector('.tagrp')?.textContent).toBe('REPRINT');
    expect(j2?.querySelector('.pos-chip--warn')?.textContent).toBe('may not have printed');
    expect(j3?.textContent).toContain('Coming up');
    expect(j3?.querySelector('.pos-chip')?.textContent).toBe('waiting');
    expect(j4?.textContent).toContain('Grill · no printer');
    expect(j4?.querySelector('.pos-chip--danger')?.textContent).toContain('No printer: this station has no printer now.');
  });

  it('[03c §6.7] nothing pending → "Nothing waiting"; Refresh reads print-config and print-queue once', async () => {
    const hub = setup({}, PRINT_QUEUE);
    await flush();
    expect(queueSection().textContent).toContain('Nothing waiting');
    m.click(m.button('Refresh', queueSection()));
    await flush();
    expect(hub.reads('/admin/queries/print-queue')).toBe(2);
    expect(hub.reads('/admin/queries/print-config')).toBe(2);
  });

  it('[03c §6.5] cancel → PRINT_JOB_NOT_FOUND / PRINT_JOB_NOT_PENDING { state } → toast and one re-read', async () => {
    const answers = [
      ok({ job_id: 'J1', cancelled_at: 200 }),
      refused(409, 'PRINT_JOB_NOT_PENDING', { job_id: 'J1', state: 'acked' }),
      refused(409, 'PRINT_JOB_NOT_PENDING', { job_id: 'J1', state: 'cancelled' }),
      refused(404, 'PRINT_JOB_NOT_FOUND', { job_id: 'J1' }),
    ];
    const hub = setup({ 'POST /admin/print/jobs/J1/cancel': () => answers.shift()! });
    await flush();
    const dialog = () => m.container.querySelector<HTMLElement>('[role="dialog"]');
    const expected = [null, 'Already printed', 'Already cancelled', 'This job is no longer there'];
    for (const [i, toast] of expected.entries()) {
      m.click(m.button('Cancel', rows()[0]));
      expect(dialog()?.textContent).toContain('Cancel this ticket? It will not print.');
      expect(dialog()?.textContent).toContain('Tandoor · Ticket');
      m.click(m.button('Cancel ticket', dialog()!));
      await flush();
      expect(dialog()).toBeNull();
      expect(m.container.querySelector('.ad-toast')?.textContent ?? null).toBe(toast);
      expect(hub.reads('/admin/queries/print-queue')).toBe(i + 2);
    }
    expect(hub.calls.filter((c) => c.path === '/admin/print/jobs/J1/cancel')).toHaveLength(4);
    // Keep closes without a call
    m.click(m.button('Cancel', rows()[0]));
    m.click(m.button('Keep', dialog()!));
    expect(dialog()).toBeNull();
    expect(hub.calls.filter((c) => c.path === '/admin/print/jobs/J1/cancel')).toHaveLength(4);
  });
  it('[03c §6.5] while a cancel runs, Keep and Escape do nothing', async () => {
    let answer: (r: Response) => void = () => {};
    const hub = setup();
    await flush();
    const base = hub.fetchFn.getMockImplementation()!;
    hub.fetchFn.mockImplementation(async (url: string, init?: RequestInit) =>
      url === '/admin/print/jobs/J1/cancel' ? new Promise<Response>((r) => (answer = r)) : base(url, init),
    );
    const dialog = () => m.container.querySelector<HTMLElement>('[role="dialog"]');
    m.click(m.button('Cancel', rows()[0]));
    m.click(m.button('Cancel ticket', dialog()!));
    await flush();
    expect(m.button('Keep', dialog()!).hasAttribute('disabled')).toBe(true);
    m.key(dialog(), 'Escape');
    expect(dialog()).not.toBeNull();
    await act(async () => answer(ok({ job_id: 'J1', cancelled_at: 1 })));
    await flush();
    expect(dialog()).toBeNull();
  });
});
