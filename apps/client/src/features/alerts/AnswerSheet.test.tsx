import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOW, VOID_CARD, requestRow } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import { createAnswerSender, type HubLink } from './answer';
import { AnswerSheet } from './AnswerSheet';

// 01d §8.1, §6.2 (D01, D02, B02–B04): Approve / Reject with the PIN pad on a money kind, one tap on an accept
// kind; "Approve here" only on the raising device (AD-165); each §8.1 error maps to its text; details only
// on a signed-in card (§3.12).

let m: Mounted;
afterEach(() => m?.unmount());

function link(up = true): HubLink & { set(v: boolean): void } {
  let isUp = up;
  const fns = new Set<() => void>();
  return {
    isUp: () => isUp,
    subscribe: (fn) => (fns.add(fn), () => void fns.delete(fn)),
    set(v) {
      isUp = v;
      for (const fn of [...fns]) fn();
    },
  };
}

const CTX = { deviceToken: 'dev', sessionToken: 'sess', tenantId: 'T1', branchId: 'B1', deviceId: 'D1', staffId: 'S-IMRAN' };
const OK = { data: { result: { alert_id: 'R1', decision: 'approve', answered_at: NOW } } };

function setup(o: { replies?: Response[]; up?: boolean; row?: Partial<Parameters<typeof requestRow>[0]>; canAnswer?: boolean; deviceId?: string } = {}) {
  const hub = link(o.up ?? true);
  const replies = [...(o.replies ?? [reply(200, OK)])];
  const fetch = vi.fn(async () => replies.shift() ?? reply(200, OK));
  const sender = createAnswerSender({ link: hub, context: () => CTX, fetch, newCommandId: () => '01JCMD' });
  const onClose = vi.fn();
  const onToast = vi.fn();
  const r = requestRow({ alert_id: 'R1', ...(o.row ?? {}) });
  m = mount();
  m.render(
    <AnswerSheet
      row={r}
      canAnswer={o.canAnswer ?? r.can_answer}
      deviceId={o.deviceId ?? 'D9'}
      me={{ staffId: 'S-IMRAN', name: 'Imran' }}
      sender={sender}
      link={hub}
      loadApprovers={async () => [{ staff_id: 'S-SANA', display_name: 'Sana' }]}
      nowMs={NOW}
      utcOffsetMs={0}
      sheet={false}
      onClose={onClose}
      onToast={onToast}
    />,
  );
  const bodies = () => fetch.mock.calls.map((c) => JSON.parse(((c as unknown[])[1] as RequestInit).body as string) as { payload: Record<string, unknown> });
  return { hub, fetch, bodies, onClose, onToast };
}

function typePin(digits: string): void {
  const keys = m.container.querySelector('.pin__keys')!;
  for (const d of digits) m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
}

describe('[01d §8.1 D01] AnswerSheet', () => {
  it('money kind: the facts (card only), Reject / Approve, then the PIN step; the answer goes with method pin', async () => {
    const s = setup();
    const text = m.text();
    for (const fact of ['Item', 'Chicken Karahi — Full', 'Quantity', '×1', 'Amount', 'Rs 2,200', 'Reason', '“Customer changed mind”']) expect(text).toContain(fact);
    expect(text).toContain('waiting 2 min');
    m.click(m.button('Approve'));
    expect(m.text()).toContain('Imran, enter your PIN to approve');
    expect(m.text()).toContain('Your PIN is not kept.');
    expect(s.fetch).not.toHaveBeenCalled();
    typePin('1234');
    expect(m.container.querySelectorAll('.pin__dots i.f').length).toBe(4);
    m.click(m.button('Approve', m.container.querySelector('.pin__keys')!));
    await flush();
    expect(s.bodies()[0]!.payload).toEqual({ alert_id: 'R1', decision: 'approve', method: 'pin', pin: '1234' });
    expect(m.text()).toContain('Approved');
  });

  it('Reject goes through the PIN step too, with "to reject"', async () => {
    const s = setup();
    m.click(m.button('Reject'));
    expect(m.text()).toContain('Imran, enter your PIN to reject');
    typePin('4321');
    m.click(m.button('Reject', m.container.querySelector('.pin__keys')!));
    await flush();
    expect(s.bodies()[0]!.payload).toMatchObject({ decision: 'reject', method: 'pin' });
  });

  it('accept kind: Decline / Accept, one tap, no PIN (method session)', async () => {
    const s = setup({ row: { kind: 'table_handover', family: 'action', answers: ['accept', 'decline'], needs_pin: 'never', card: { ...VOID_CARD, details: null } } });
    expect(m.text()).toContain('Decline');
    m.click(m.button('Accept'));
    await flush();
    expect(s.bodies()[0]!.payload).toEqual({ alert_id: 'R1', decision: 'accept', method: 'session' });
    expect(m.container.querySelector('.pin__keys')).toBeNull();
  });

  it('REQUEST_PIN_REQUIRED opens the PIN pad', async () => {
    setup({
      row: { answers: ['accept', 'decline'], needs_pin: null },
      replies: [reply(422, { error: { code: 'REQUEST_PIN_REQUIRED', details: { alert_id: 'R1' } } })],
    });
    m.click(m.button('Accept'));
    await flush();
    expect(m.container.querySelector('.pin__keys')).not.toBeNull();
  });

  it('"Approve here" shows only when this device raised the request (raised_device_id)', () => {
    setup({ row: { raised_device_id: 'D1' }, deviceId: 'D9' });
    expect(m.text()).not.toContain('Approve here');
    m.unmount();
    setup({ row: { raised_device_id: 'D1' }, deviceId: 'D1' });
    expect(m.text()).toContain('Approve here');
  });

  it('REQUEST_NOT_PENDING closes the sheet with "Already approved by <name>"', async () => {
    const s = setup({
      replies: [reply(409, { error: { code: 'REQUEST_NOT_PENDING', details: { close_reason: 'answered', decision: 'approve', answered_by_name: 'Sana' } } })],
    });
    m.click(m.button('Approve'));
    typePin('1234');
    m.click(m.button('Approve', m.container.querySelector('.pin__keys')!));
    await flush();
    expect(s.onToast).toHaveBeenCalledWith({ text: 'Already approved by Sana.', sub: 'Request · T12', tone: 'ok' });
    expect(s.onClose).toHaveBeenCalled();
  });

  it.each([
    [401, 'PIN_INVALID', {}, 'Wrong PIN.'],
    [429, 'PIN_LOCKED_OUT', { retry_after_ms: 15 * 60_000 }, 'Too many tries — wait 15 min.'],
    [503, 'SERVICE_UNAVAILABLE', {}, 'Busy — try again.'],
    [403, 'PERMISSION_DENIED', { reason: 'out_of_range' }, 'Not your team — a manager can approve.'],
    [403, 'PERMISSION_DENIED', { reason: 'self' }, "You can't approve your own request."],
    [404, 'ALERT_NOT_FOUND', {}, 'This request is no longer there.'],
  ])('%s %s shows "%s"', async (status, code, details, text) => {
    const s = setup({ replies: [reply(status, { error: { code, details } })] });
    m.click(m.button('Approve'));
    typePin('1234');
    m.click(m.button('Approve', m.container.querySelector('.pin__keys')!));
    await flush();
    const shown = m.text() + JSON.stringify(s.onToast.mock.calls);
    expect(shown).toContain(text);
    // the PIN is cleared after every response
    expect(m.container.querySelectorAll('.pin__dots i.f').length).toBe(0);
  });

  it('B02 read-only: informed → "Find an approver or a manager", no answer buttons, Close only', () => {
    const s = setup({ row: { can_answer: false, set: 'informed' } });
    expect(m.text()).toContain('For your information. Find an approver or a manager.');
    expect(m.text()).toContain('Read only');
    expect(m.buttons().some((b) => b.textContent === 'Approve')).toBe(false);
    m.click(m.button('Close', m.container.querySelector('.dlg')!));
    expect(s.onClose).toHaveBeenCalled();
  });

  it('can_answer wins over set informed', () => {
    setup({ row: { can_answer: true, set: 'informed' } });
    expect(m.text()).not.toContain('For your information');
    expect(m.text()).toContain('Approve');
  });

  it('a lock-only request (no card) shows no facts and no amount', () => {
    setup({ row: { card: undefined } });
    expect(m.text()).not.toMatch(/2,200|Karahi|changed|Reason/);
  });

  it('B03: socket down → the line and the buttons off; the sheet stays', () => {
    const s = setup({ up: false });
    expect(m.text()).toContain('No connection to the hub — try again.');
    expect((m.button('Approve') as HTMLButtonElement).disabled).toBe(true);
    expect(m.container.querySelector('.dlg')).not.toBeNull();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('[01d D02 B03; frame PinOffline] the hub goes down mid-PIN: pad off, PIN cleared, the "not kept" help hidden', async () => {
    const s = setup();
    m.click(m.button('Approve'));
    typePin('12');
    expect(m.text()).toContain('Your PIN is not kept.');
    s.hub.set(false);
    await flush();
    expect(m.text()).toContain('No connection to the hub — try again.');
    expect(m.text()).not.toContain('Your PIN is not kept.');
    expect(m.container.querySelectorAll('.pin__dots i.f').length).toBe(0);
    expect(m.container.querySelector('.pin__keys.off')).not.toBeNull();
    s.hub.set(true);
    await flush();
    expect(m.text()).toContain('Your PIN is not kept.');
  });

  it('[01d D02; frames PinWrong, PinLocked] the dots turn red on a wrong PIN, not while the pad is locked', async () => {
    setup({ replies: [reply(401, { error: { code: 'PIN_INVALID', details: {} } }), reply(429, { error: { code: 'PIN_LOCKED_OUT', details: { retry_after_ms: 15 * 60_000 } } })] });
    m.click(m.button('Approve'));
    typePin('1234');
    m.click(m.button('Approve', m.container.querySelector('.pin__keys')!));
    await flush();
    expect(m.container.querySelector('.pin__dots')!.classList.contains('err')).toBe(true);
    typePin('5678');
    m.click(m.button('Approve', m.container.querySelector('.pin__keys')!));
    await flush();
    expect(m.text()).toContain('Too many tries — wait 15 min.');
    expect(m.container.querySelector('.pin__keys.off')).not.toBeNull();
    expect(m.container.querySelector('.pin__dots')!.classList.contains('err')).toBe(false);
  });

  it('Escape closes the sheet', () => {
    const s = setup();
    m.key(m.container.querySelector('.dlg'), 'Escape');
    expect(s.onClose).toHaveBeenCalled();
  });

  it('the PIN step takes the focus, so keyboard digits work at once', () => {
    setup();
    m.click(m.button('Approve'));
    const keys = m.container.querySelector('.pin__keys')!;
    expect(keys.contains(document.activeElement)).toBe(true);
    m.key(document.activeElement, '1');
    m.key(document.activeElement, '2');
    expect(m.container.querySelectorAll('.pin__dots i.f').length).toBe(2);
  });

  it('the dialog traps Tab, and Escape closes it wherever the focus is', () => {
    const s = setup();
    const dlg = m.container.querySelector('.dlg')!;
    const items = [...dlg.querySelectorAll<HTMLElement>('button:not([disabled])')];
    items[items.length - 1]!.focus();
    m.key(items[items.length - 1], 'Tab');
    expect(document.activeElement).toBe(items[0]);
    (document.activeElement as HTMLElement).blur();
    m.key(document.body, 'Escape');
    expect(s.onClose).toHaveBeenCalled();
  });

  it('a row that is closed (live, from the shell) shows the result line and the buttons off', () => {
    setup({ row: { state: 'closed', close_reason: 'answered', decision: 'reject', by_name: 'Sana' } as never });
    expect(m.text()).toContain('Rejected by Sana');
    expect((m.button('Approve') as HTMLButtonElement).disabled).toBe(true);
    expect(m.text()).not.toContain('waiting 2 min');
  });

  it('ALERT_NOT_FOUND toasts with the warn tone', async () => {
    const s = setup({ replies: [reply(404, { error: { code: 'ALERT_NOT_FOUND', details: {} } })] });
    m.click(m.button('Approve'));
    typePin('1234');
    m.click(m.button('Approve', m.container.querySelector('.pin__keys')!));
    await flush();
    expect(s.onToast).toHaveBeenCalledWith({ text: 'This request is no longer there.', sub: 'Request · T12', tone: 'warn' });
  });
});


describe('[02a §8 Table sheet, 02b §3.9] AnswerSheet for the 02 kinds (23b)', () => {
  const HANDOVER = {
    kind: 'table_handover',
    family: 'action' as const,
    answers: ['accept', 'decline'] as ('accept' | 'decline')[],
    needs_pin: 'never' as const,
    lock: { kind_label_key: 'alert.table_handover.lock', table_code: 'F4 + F5', point_code: null, requester_name: 'Ali' },
    card: { kind_label_key: 'alert.table_handover.card', table_code: 'F4 + F5', point_code: null, requester_name: 'Ali', device_name: null, details: { quantity: 3, amount: 1_425_000 } },
  };
  const ACCEPTED = { data: { result: { alert_id: 'R1', decision: 'accept', answered_at: NOW } } };

  it('[02a §8 Table sheet] handover Accept / Decline, one tap, no PIN', async () => {
    const s = setup({ row: HANDOVER, replies: [reply(200, ACCEPTED)] });
    const facts = m.container.querySelector('.facts')!.textContent ?? '';
    expect(facts).toContain('Orders');
    expect(facts).toContain('3');
    expect(facts).toContain('Running total');
    expect(facts).toContain('Rs 14,250');
    expect(facts).not.toContain('Quantity');
    expect(m.container.querySelector('.fact--amt')?.textContent).toContain('Rs 14,250');
    const acts = [...m.container.querySelectorAll('.acts .btn')].map((b) => b.textContent);
    expect(acts).toEqual(['Decline', 'Accept']);
    m.click(m.button('Accept'));
    await flush();
    expect(m.container.querySelector('.pin__keys')).toBeNull();
    expect(s.bodies()[0]!.payload).toEqual({ alert_id: 'R1', decision: 'accept', method: 'session' });
  });

  it('[02a §8 Table sheet] Accept 409 TABLE_HANDOVER_STALE → "Bill paid, waiting for cleaning"; card stays', async () => {
    const s = setup({ row: HANDOVER, replies: [reply(409, { error: { code: 'TABLE_HANDOVER_STALE', message: 'stale', details: {} } })] });
    m.click(m.button('Accept'));
    await flush();
    const msg = m.container.querySelector('.msg.c-warn');
    expect(msg?.textContent).toContain('Bill paid, waiting for cleaning');
    expect(s.onClose).not.toHaveBeenCalled();
    expect(s.onToast).not.toHaveBeenCalled();
    // the request closes when the table is cleaned: no second try from here
    for (const b of m.container.querySelectorAll<HTMLButtonElement>('.acts .btn')) expect(b.disabled).toBe(true);
  });

  it('[02a §8 Table sheet] phone: banner / Inbox row → bottom answer sheet, 72 px Decline / Accept', () => {
    const hub = link(true);
    const sender = createAnswerSender({ link: hub, context: () => CTX, fetch: vi.fn(), newCommandId: () => '01JCMD' });
    m = mount();
    m.render(
      <AnswerSheet
        row={requestRow({ alert_id: 'R1', ...HANDOVER })}
        canAnswer
        deviceId="D9"
        me={{ staffId: 'S-SARA', name: 'Sara' }}
        sender={sender}
        link={hub}
        loadApprovers={async () => []}
        nowMs={NOW}
        utcOffsetMs={0}
        sheet
        onClose={() => {}}
        onToast={() => {}}
      />,
    );
    expect(m.container.querySelector('.scrim.scrim--sheet .dlg .dlg__grip')).not.toBeNull();
    expect([...m.container.querySelectorAll('.acts .btn')].map((b) => b.textContent)).toEqual(['Decline', 'Accept']);
    // `.acts .btn` is the kit's 72 px answer button (pulse-staff.css)
    expect(m.container.querySelector('.dlg .acts')?.children).toHaveLength(2);
  });

  it('[02b Q-19] approver comp card shows details.reason as sent; answer sheet then PIN', async () => {
    const card = { kind_label_key: 'alert.comp.card', table_code: 'F4', point_code: null, requester_name: 'Bilal', device_name: null, details: { item: 'Chicken Karahi', quantity: 1, amount: 220_000, reason: 'Cold food: sent back twice' } };
    setup({ row: { kind: 'comp', family: 'action', card, lock: { kind_label_key: 'alert.comp.lock', table_code: 'F4', point_code: null, requester_name: 'Bilal' } } });
    expect(m.text()).toContain('“Cold food: sent back twice”');
    m.click(m.button('Approve'));
    expect(m.container.querySelector('.pin__keys')).not.toBeNull();
  });
});
