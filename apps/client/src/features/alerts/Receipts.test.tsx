import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { Receipts, RECEIPTS_POLL_MS, type ReceiptsData } from './Receipts';

// 01d §6.10 (S04): one table per step; delivered / seen per person and device; "No route"; an alert-connection
// receipt names the bound person ("bound to Ali (not signed in)"); re-fetched every 5 s while open.

let m: Mounted;
afterEach(() => {
  m?.unmount();
  vi.useRealTimers();
});

const T = Date.UTC(2026, 10, 2, 14, 10, 3);

const DATA: ReceiptsData = {
  alert_id: 'A1',
  kind: 'test_alert',
  steps: [
    {
      step: 0,
      recipients: [
        { staff_id: 'S-BILAL', staff_name: 'Bilal', device_id: null, device_name: null, for_staff_id: null, for_staff_name: null, set: 'recipient', no_route: false },
        { staff_id: 'S-ALI', staff_name: 'Ali', device_id: null, device_name: null, for_staff_id: null, for_staff_name: null, set: 'recipient', no_route: false },
        { staff_id: 'S-DANISH', staff_name: 'Danish', device_id: null, device_name: null, for_staff_id: null, for_staff_name: null, set: 'recipient', no_route: true },
      ],
      routes: [
        { staff_id: 'S-BILAL', route: 'screen', ref: 'D2' },
        { staff_id: 'S-ALI', route: 'alert_connection', ref: 'D3' },
      ],
    },
    {
      step: 2,
      recipients: [{ staff_id: 'S-ARIF', staff_name: 'Arif', device_id: null, device_name: null, for_staff_id: null, for_staff_name: null, set: 'recipient', no_route: false }],
      routes: [{ staff_id: 'S-ARIF', route: 'screen', ref: 'D7' }],
    },
  ],
  receipts: [
    { kind: 'delivered', step: 0, staff_id: 'S-BILAL', staff_name: 'Bilal', device_id: 'D2', device_name: 'Tablet 2', route: 'screen', at: T },
    { kind: 'seen', step: null, staff_id: 'S-BILAL', staff_name: 'Bilal', device_id: 'D2', device_name: 'Tablet 2', route: 'screen', at: T + 37_000 },
    { kind: 'delivered', step: 0, staff_id: 'S-ALI', staff_name: 'Ali', device_id: 'D3', device_name: 'Tablet 3', route: 'alert_connection', at: T },
  ],
};

describe('[01d §6.10 S04] Receipts', () => {
  it('one table per step with person, device / route, delivered, seen and note', async () => {
    m = mount();
    m.render(<Receipts alertId="A1" load={async () => ({ ok: true, data: DATA })} summary={null} utcOffsetMs={0} />);
    await flush();
    const tables = m.container.querySelectorAll('.rt');
    expect(tables.length).toBe(2);
    const heads = [...m.container.querySelectorAll('.steph')].map((h) => h.textContent);
    expect(heads[0]).toContain('Sent');
    expect(heads[1]).toContain('Escalated');
    const first = tables[0]!.textContent!;
    expect(first).toContain('Tablet 2 (signed in)');
    expect(first).toContain('2:10:03 PM');
    expect(first).toContain('2:10:40 PM');
    expect(first).toContain('Tablet 3, bound to Ali (not signed in)');
    expect(first).toContain('No route');
    expect(m.text()).toContain('Test alert');
    expect(m.text()).toContain('Updating');
  });

  it('re-fetches every 5 s while open, and stops when closed', async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => ({ ok: true as const, data: DATA }));
    m = mount();
    m.render(<Receipts alertId="A1" load={load} summary={null} utcOffsetMs={0} />);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(RECEIPTS_POLL_MS);
    });
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    m.unmount();
    vi.advanceTimersByTime(RECEIPTS_POLL_MS * 3);
    expect(load).toHaveBeenCalledTimes(2);
    m = mount();
  });

  it('nobody reached → the empty state; a missing alert → its text', async () => {
    m = mount();
    const none: ReceiptsData = { ...DATA, steps: [{ step: 0, recipients: [DATA.steps[0]!.recipients[2]!], routes: [] }], receipts: [] };
    m.render(<Receipts alertId="A1" load={async () => ({ ok: true, data: none })} summary="Sent 2:12 PM by Imran · to Danish" utcOffsetMs={0} />);
    await flush();
    expect(m.text()).toContain('Nobody could be reached.');
    expect(m.text()).toContain('Sent 2:12 PM by Imran · to Danish');
    m.render(<Receipts alertId="A2" load={async () => ({ ok: false, error: { kind: 'api', status: 404, code: 'ALERT_NOT_FOUND', details: {} } })} summary={null} utcOffsetMs={0} />);
    await flush();
    expect(m.text()).toContain('This alert is no longer there.');
  });
});
