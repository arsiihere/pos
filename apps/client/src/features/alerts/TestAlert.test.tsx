import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { TestAlert, type TestTarget } from './TestAlert';

// 01d §6.5 (S03): send a test alert to a person, a team or a device (Point off until points exist), then open
// the receipts for the new alert.

let m: Mounted;
afterEach(() => m?.unmount());

const PEOPLE = [
  { staff_id: 'S-ALI', display_name: 'Ali' },
  { staff_id: 'S-BILAL', display_name: 'Bilal' },
];

function setup(result: { ok: true; alert_id: string } | { ok: false; code: string } = { ok: true, alert_id: 'A-TEST' }) {
  const send = vi.fn(async (target: TestTarget) => (void target, result));
  const onSent = vi.fn();
  m = mount();
  m.render(<TestAlert people={PEOPLE} device={{ device_id: 'D3', device_type: 'tablet' }} send={send} onSent={onSent} />);
  return { send, onSent };
}

describe('[01d §6.5 S03] TestAlert', () => {
  it('Point is off with its help line', () => {
    setup();
    expect((m.button('Point') as HTMLButtonElement).disabled).toBe(true);
    expect(m.text()).toContain('Point: available after points are set up.');
  });

  it('person → SendTestAlert { person } and opens the receipts', async () => {
    const s = setup();
    m.click(m.button('Person'));
    m.click(m.button('Ali'));
    expect(m.container.querySelector('aside')!.textContent).toContain('Ali');
    m.click(m.button('Send test'));
    await flush();
    expect(s.send).toHaveBeenCalledWith({ kind: 'person', staff_id: 'S-ALI' });
    expect(s.onSent).toHaveBeenCalledWith('A-TEST', expect.stringContaining('Ali'));
  });

  it('team → { team, lead_staff_id, depth }, direct reports by default, whole team on choice', async () => {
    const s = setup();
    m.click(m.button('Team'));
    m.click(m.button('Bilal'));
    m.click(m.button('Whole team'));
    expect(m.container.querySelector('aside')!.textContent).toContain('Bilal’s team');
    m.click(m.button('Send test'));
    await flush();
    expect(s.send).toHaveBeenCalledWith({ kind: 'team', lead_staff_id: 'S-BILAL', depth: 'all' });
  });

  it('device → { device, device_id } (this device)', async () => {
    const s = setup();
    m.click(m.button('Device'));
    m.click(m.button('This device'));
    m.click(m.button('Send test'));
    await flush();
    expect(s.send).toHaveBeenCalledWith({ kind: 'device', device_id: 'D3' });
  });

  it('STAFF_NOT_FOUND → "Not found — reload the list."', async () => {
    setup({ ok: false, code: 'STAFF_NOT_FOUND' });
    m.click(m.button('Person'));
    m.click(m.button('Ali'));
    m.click(m.button('Send test'));
    await flush();
    expect(m.text()).toContain('Not found — reload the list.');
  });
});
