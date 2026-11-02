import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIN, NOW, VOID_CARD, row } from '../../../test/alert-rows';
import { mount, type Mounted } from '../../../test/dom';
import { Inbox, inboxSections } from './Inbox';

// 01d §8.1, §6.7 (S01): the inbox lists the alerts-inbox rows; open action alerts first, then newest; a lead's
// "For <name>" groups; details only on a signed-in card (§3.12).

let m: Mounted;
afterEach(() => m?.unmount());

const handover = row({
  alert_id: 'H1',
  kind: 'table_handover',
  family: 'action',
  raised_at: NOW - 3 * MIN,
  lock: { kind_label_key: 'alert.table_handover.lock', table_code: '7', requester_name: 'Ali' },
});
const voidCard = row({ alert_id: 'V1', card: VOID_CARD, raised_at: NOW - 2 * MIN });
const voidLock = row({ alert_id: 'V2', raised_at: NOW - 10 * MIN, seen_by_me: true });
const test = row({
  alert_id: 'T1',
  kind: 'test_alert',
  family: 'info',
  raised_at: NOW - 30 * MIN,
  lock: { kind_label_key: 'alert.test_alert.lock', requester_name: 'Arif' },
  seen_by_me: true,
});
const closed = row({ alert_id: 'C1', state: 'closed', close_reason: 'answered', decision: 'approve', by_name: 'Sana', raised_at: NOW - 40 * MIN });
const forAli = row({
  alert_id: 'F1',
  kind: 'request_result',
  family: 'info',
  outcome: 'approved',
  for_staff_id: 'S-ALI',
  for_staff_name: 'Ali',
  raised_at: NOW - 5 * MIN,
  lock: { kind_label_key: 'alert.request_result.lock', table_code: '3' },
});

describe('[01d §8.1 S01] Inbox', () => {
  it('open action alerts first, then open requests newest first; everything else under Today, newest first; "For" groups', () => {
    const s = inboxSections([closed, test, voidLock, voidCard, handover, forAli]);
    expect(s.open.map((r) => r.alert_id)).toEqual(['H1', 'V1', 'V2']);
    expect(s.today.map((r) => r.alert_id)).toEqual(['T1', 'C1']);
    expect(s.groups).toEqual([{ name: 'Ali', rows: [forAli] }]);
  });

  it('renders the rows: a card with its details and amount, a lock-only row without, a closed row with its result', () => {
    const onOpen = vi.fn();
    m = mount();
    m.render(<Inbox rows={[closed, test, voidLock, voidCard, handover, forAli]} loading={false} offlineAt={null} nowMs={NOW} utcOffsetMs={0} onOpen={onOpen} />);
    const text = m.text();
    expect(text).toContain('Open');
    expect(text).toContain('Today');
    const card = m.container.querySelector('[data-alert="V1"]')!;
    expect(card.textContent).toContain('T12');
    expect(card.textContent).toContain('Chicken Karahi — Full');
    expect(card.textContent).toContain('Rs 2,200');
    expect(card.textContent).toContain('from Hamza · 2:02 PM');
    const lockOnly = m.container.querySelector('[data-alert="V2"]')!;
    expect(lockOnly.textContent).not.toMatch(/2,200|Karahi|changed/);
    expect(lockOnly.textContent).toContain('Request');
    expect(m.container.querySelector('[data-alert="C1"]')!.textContent).toContain('Approved by Sana');
    expect(text).toContain('For Ali · 1 · no device');
    expect(m.container.querySelector('[data-alert="H1"]')!.textContent).toContain('Action');
    // the whole card is the tap target; Enter works too
    m.click(card);
    m.key(m.container.querySelector('[data-alert="H1"]'), 'Enter');
    expect(onOpen.mock.calls.map(([r]) => (r as { alert_id: string }).alert_id)).toEqual(['V1', 'H1']);
  });

  it('a "For" group folds and unfolds; the first is open', () => {
    m = mount();
    m.render(<Inbox rows={[forAli]} loading={false} offlineAt={null} nowMs={NOW} utcOffsetMs={0} onOpen={() => {}} />);
    const head = m.button('For Ali');
    expect(head.getAttribute('aria-expanded')).toBe('true');
    m.click(head);
    expect(m.button('For Ali').getAttribute('aria-expanded')).toBe('false');
    expect(m.container.querySelector('[data-alert="F1"]')).toBeNull();
  });

  it('loading shows skeletons, empty shows the empty line, offline keeps the list with the B03 line', () => {
    m = mount();
    m.render(<Inbox rows={[]} loading offlineAt={null} nowMs={NOW} utcOffsetMs={0} onOpen={() => {}} />);
    expect(m.container.querySelectorAll('.sk').length).toBeGreaterThan(0);
    m.render(<Inbox rows={[]} loading={false} offlineAt={null} nowMs={NOW} utcOffsetMs={0} onOpen={() => {}} />);
    expect(m.text()).toContain('Nothing needs you right now.');
    m.render(<Inbox rows={[voidCard]} loading={false} offlineAt={NOW - MIN} nowMs={NOW} utcOffsetMs={0} onOpen={() => {}} />);
    expect(m.text()).toContain('No connection to the hub — try again. The list is from 2:03 PM.');
    expect(m.container.querySelector('[data-alert="V1"]')).not.toBeNull();
  });

  it('Load more asks for the next page', () => {
    const onMore = vi.fn();
    m = mount();
    m.render(<Inbox rows={[test]} loading={false} offlineAt={null} nowMs={NOW} utcOffsetMs={0} onOpen={() => {}} hasMore onMore={onMore} />);
    m.click(m.button('Load more'));
    expect(onMore).toHaveBeenCalledOnce();
  });
});
