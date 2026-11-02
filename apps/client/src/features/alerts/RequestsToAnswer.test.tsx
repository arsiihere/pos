import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIN, NOW, requestRow, row } from '../../../test/alert-rows';
import { mount, type Mounted } from '../../../test/dom';
import { RequestsToAnswer, requestViews } from './RequestsToAnswer';

// 01d §8.1, §6.9 (S02): "You can answer" (can_answer, oldest first) and "For your information" (read-only).
// can_answer: true wins over set: 'informed' (controller ruling); the latest server view wins: a lock row from
// the socket replaces a held card (AD-163, applied to this list too).

let m: Mounted;
afterEach(() => {
  m?.unmount();
  vi.useRealTimers();
});

const older = requestRow({ alert_id: 'R1', raised_at: NOW - 9 * MIN });
const newer = requestRow({ alert_id: 'R2', raised_at: NOW - 2 * MIN, set: 'informed' });
const readOnly = requestRow({ alert_id: 'R3', can_answer: false, set: 'informed', card: undefined, answers: undefined, needs_pin: undefined });

describe('[01d §8.1 S02] Requests to answer', () => {
  it('lists can_answer rows oldest first (informed with can_answer included) and read-only rows apart', () => {
    m = mount();
    m.render(<RequestsToAnswer rows={requestViews([newer, readOnly, older], new Map())} nowMs={NOW} utcOffsetMs={0} onOpen={() => {}} />);
    const [answer, fyi] = [...m.container.querySelectorAll('section.lcard')];
    expect(answer!.textContent).toContain('You can answer');
    expect([...answer!.querySelectorAll('[data-alert]')].map((e) => e.getAttribute('data-alert'))).toEqual(['R1', 'R2']);
    expect(fyi!.textContent).toContain('For your information');
    const ro = fyi!.querySelector('[data-alert="R3"]')!;
    expect(ro.textContent).toContain('Read only');
    expect(ro.textContent).not.toContain('Answer');
    // a row with no card shows lock text only
    expect(ro.textContent).not.toMatch(/2,200|Karahi|changed/);
    expect(answer!.textContent).toContain('Rs 2,200');
  });

  it('latest view wins: a lock-only row the socket holds replaces the card of the fetched row', () => {
    const held = new Map([['R1', row({ alert_id: 'R1' })]]);
    const [view] = requestViews([older], held);
    expect(view!.card).toBeUndefined();
    expect(view!.answers).toBeUndefined();
    expect(view!.raised_device_id).toBeUndefined();
    expect(requestViews([older], new Map([['R1', row({ alert_id: 'R1', card: older.card })]]))[0]!.card).toEqual(older.card);
  });

  it('a request answered elsewhere shows its result line, then slides out', () => {
    vi.useFakeTimers();
    const held = new Map([['R1', row({ alert_id: 'R1', state: 'closed', close_reason: 'answered', decision: 'approve', by_name: 'Sana' })]]);
    m = mount();
    m.render(<RequestsToAnswer rows={requestViews([older], held)} nowMs={NOW} utcOffsetMs={0} onOpen={() => {}} />);
    const gone = m.container.querySelector('[data-alert="R1"]')!;
    expect(gone.textContent).toContain('Approved by Sana');
    expect(gone.className).toContain('is-closed');
    act(() => vi.advanceTimersByTime(3_000));
    expect(m.container.querySelector('[data-alert="R1"]')).toBeNull();
  });

  it('empty shows "No requests waiting."; tapping a row opens it', () => {
    const onOpen = vi.fn();
    m = mount();
    m.render(<RequestsToAnswer rows={[]} nowMs={NOW} utcOffsetMs={0} onOpen={onOpen} />);
    expect(m.text()).toContain('No requests waiting.');
    m.render(<RequestsToAnswer rows={requestViews([older], new Map())} nowMs={NOW} utcOffsetMs={0} onOpen={onOpen} />);
    m.click(m.container.querySelector('[data-alert="R1"]'));
    expect(onOpen.mock.calls[0]![0]).toMatchObject({ alert_id: 'R1', can_answer: true });
  });
});
