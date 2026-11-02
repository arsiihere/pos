import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOW, requestRow } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import { createAnswerSender, type HubLink } from './answer';
import { AnswerSheet } from './AnswerSheet';

// 01d §8.1 (D03), v1.0 #2: "Approve here" on the raising device: pick the approver from the roster, then their
// PIN; AnswerRequest { method: 'in_person', answerer_staff_id, pin }.

let m: Mounted;
afterEach(() => m?.unmount());

const up: HubLink = { isUp: () => true, subscribe: () => () => {} };
const CTX = { deviceToken: 'dev', sessionToken: 'sess', tenantId: 'T1', branchId: 'B1', deviceId: 'D1', staffId: 'S-HAMZA' };
const OK = { data: { result: { alert_id: 'R1', decision: 'approve', answered_at: NOW } } };

function setup(replies: Response[]) {
  const fetch = vi.fn(async () => replies.shift() ?? reply(200, OK));
  const sender = createAnswerSender({ link: up, context: () => CTX, fetch, newCommandId: () => '01JCMD' });
  m = mount();
  m.render(
    <AnswerSheet
      row={requestRow({ alert_id: 'R1', can_answer: false, set: 'recipient', raised_device_id: 'D1' })}
      canAnswer={false}
      deviceId="D1"
      me={{ staffId: 'S-HAMZA', name: 'Hamza' }}
      sender={sender}
      link={up}
      loadApprovers={async () => [
        { staff_id: 'S-IMRAN', display_name: 'Imran' },
        { staff_id: 'S-SANA', display_name: 'Sana' },
      ]}
      nowMs={NOW}
      utcOffsetMs={0}
      sheet={false}
      onClose={() => {}}
      onToast={() => {}}
    />,
  );
  return { fetch, bodies: () => fetch.mock.calls.map((c) => JSON.parse(((c as unknown[])[1] as RequestInit).body as string) as { payload: Record<string, unknown> }) };
}

function pin(digits: string): void {
  const keys = m.container.querySelector('.pin__keys')!;
  for (const d of digits) m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
  m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === 'Approve'));
}

describe('[01d §8.1 D03] Approve here', () => {
  it('waiting line on the requester device, then pick → their PIN → in_person with answerer_staff_id', async () => {
    const s = setup([]);
    expect(m.text()).toContain('Waiting for an approver or a manager.');
    m.click(m.button('Approve here'));
    await flush();
    expect(m.text()).toContain('Who is approving?');
    m.click(m.button('Sana'));
    expect(m.text()).toContain('Sana’s PIN');
    expect(m.text()).toContain('Sana will be told on his own devices that he approved here.');
    pin('2468');
    await flush();
    expect(s.bodies()[0]!.payload).toEqual({ alert_id: 'R1', decision: 'approve', method: 'in_person', answerer_staff_id: 'S-SANA', pin: '2468' });
    expect(m.text()).toContain('Approved');
  });

  it('STAFF_NOT_FOUND goes back to the tiles with "That person can\'t approve here."', async () => {
    setup([reply(404, { error: { code: 'STAFF_NOT_FOUND', details: {} } })]);
    m.click(m.button('Approve here'));
    await flush();
    m.click(m.button('Imran'));
    pin('1111');
    await flush();
    expect(m.text()).toContain("That person can't approve here.");
    expect(m.text()).toContain('Who is approving?');
  });

  it('in_person_elsewhere shows its text', async () => {
    setup([reply(403, { error: { code: 'PERMISSION_DENIED', details: { reason: 'in_person_elsewhere' } } })]);
    m.click(m.button('Approve here'));
    await flush();
    m.click(m.button('Imran'));
    pin('1111');
    await flush();
    expect(m.text()).toContain("In person only on the requester's device.");
  });

  it('Back returns from the tiles to the request', async () => {
    setup([]);
    m.click(m.button('Approve here'));
    await flush();
    m.click(m.button('Back'));
    expect(m.text()).toContain('Approve here');
  });
});
