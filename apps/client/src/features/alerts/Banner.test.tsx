import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIN, NOW, VOID_CARD, row } from '../../../test/alert-rows';
import { mount, type Mounted } from '../../../test/dom';
import { Banners } from './Banner';
import type { AlertRow } from './store';
import { pendingHandovers } from '../staff/tables/cards/pending-handovers';
import { forceMoveNotice } from '../staff/tables/cards/ResultBanner';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import { createLiveBus } from '../staff/shell/live';
import { flush } from '../../../test/dom';

// 01d §8.1 (B01), DQ3: at most 2 banners, newest on top, then "{n} more new · Open inbox"; Open is the tinted
// button; no close and no snooze; lock text only on an always-on screen with nobody signed in.

let m: Mounted;
afterEach(() => m?.unmount());

const a = row({ alert_id: 'A', card: VOID_CARD, raised_at: NOW - 2 * MIN });
const b = row({ alert_id: 'B', raised_at: NOW - 3 * MIN });
const c = row({ alert_id: 'C', raised_at: NOW - 4 * MIN });
const d = row({ alert_id: 'D', raised_at: NOW - 5 * MIN });

describe('[01d §8.1 B01] Banners', () => {
  it('shows two, then the more-new bar; Open and Open inbox call back', () => {
    const onOpen = vi.fn();
    const onOpenInbox = vi.fn();
    m = mount();
    m.render(<Banners banners={[a, b, c, d]} nowMs={NOW} lockOnly={false} onOpen={onOpen} onOpenInbox={onOpenInbox} />);
    const shown = m.container.querySelectorAll('.abn');
    expect(shown.length).toBe(2);
    expect(shown[0]!.getAttribute('role')).toBe('alert');
    expect(shown[0]!.textContent).toContain('Chicken Karahi — Full ×1 · Rs 2,200');
    expect(m.text()).toContain('2 more new');
    const open = m.button('Open', shown[0]!);
    expect(open.className).toContain('btn--tone');
    m.click(open);
    expect(onOpen).toHaveBeenCalledWith(a);
    m.click(m.button('Open inbox'));
    expect(onOpenInbox).toHaveBeenCalledOnce();
    expect(m.text()).not.toMatch(/Later|Snooze/);
    expect(m.container.querySelector('[aria-label="Close"]')).toBeNull();
  });

  it('lock text only when the screen shows lock text (always-on, signed out)', () => {
    m = mount();
    m.render(<Banners banners={[a]} nowMs={NOW} lockOnly onOpen={() => {}} onOpenInbox={() => {}} />);
    expect(m.text()).not.toMatch(/2,200|Karahi/);
    expect(m.text()).toContain('T12');
  });

  it('nothing when there are no banners', () => {
    m = mount();
    m.render(<Banners banners={[]} nowMs={NOW} lockOnly={false} onOpen={() => {}} onOpenInbox={() => {}} />);
    expect(m.container.querySelector('.abns')).toBeNull();
  });
});

describe('[02a §8, 02b §3.9] Banners for the 02 kinds (23b)', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('[02a §8 Table sheet] a handover banner reads "3 orders · Rs 14,250" from Ali; Open opens the answer sheet', () => {
    const onOpen = vi.fn();
    const handover = row({
      alert_id: 'H1',
      kind: 'table_handover',
      family: 'action',
      lock: { kind_label_key: 'alert.table_handover.lock', table_code: 'F4 + F5', point_code: null, requester_name: 'Ali' },
      card: { kind_label_key: 'alert.table_handover.card', table_code: 'F4 + F5', point_code: null, requester_name: 'Ali', device_name: null, details: { quantity: 3, amount: 1_425_000 } },
    });
    m = mount();
    m.render(<Banners banners={[handover]} nowMs={NOW} lockOnly={false} onOpen={onOpen} onOpenInbox={() => {}} />);
    const abn = m.container.querySelector('.abn.c-info')!;
    expect(abn.querySelector('.ac__title')?.textContent).toBe('F4 + F5Table handover');
    expect(abn.querySelector('.ac__det')?.textContent).toBe('3 orders · Rs 14,250');
    expect(abn.textContent).toContain('from Ali');
    m.click(m.button('Open', abn));
    expect(onOpen).toHaveBeenCalledWith(handover);
  });

  it('[02a Q-12] a call_waiter banner is the call card "F4 · Call · Ali"', () => {
    const call = row({
      alert_id: 'C1',
      kind: 'call_waiter',
      family: 'action',
      lock: { kind_label_key: 'alert.call_waiter.lock', table_code: 'F4', point_code: null, requester_name: 'Ali' },
      card: { kind_label_key: 'alert.call_waiter.card', table_code: 'F4', point_code: null, requester_name: 'Ali', device_name: null, details: null },
    });
    m = mount();
    m.render(<Banners banners={[call]} nowMs={NOW} lockOnly={false} onOpen={() => {}} onOpenInbox={() => {}} />);
    expect(m.container.querySelector('.abn .tcode')?.textContent).toBe('F4');
    expect(m.container.querySelector('.abn .ac__title b')?.textContent).toBe('Call · Ali');
  });

  it('[02b Q-25] takeaway comp card "Comp · Takeaway order"; zone_stock_low / _out card generic, tap → #/zones', () => {
    const onOpen = vi.fn();
    const comp = row({
      alert_id: 'C1',
      kind: 'comp',
      family: 'action',
      lock: { kind_label_key: 'alert.comp.lock', table_code: null, point_code: null, requester_name: 'Bilal' },
      card: { kind_label_key: 'alert.comp.card', table_code: null, point_code: null, requester_name: 'Bilal', device_name: null, details: { item: 'Raita', quantity: 1, amount: 15_000, reason: 'Spilled' } },
    });
    const low = row({ alert_id: 'Z1', kind: 'zone_stock_low', family: 'action', lock: { kind_label_key: 'alert.zone_stock_low.lock', table_code: null, point_code: null, requester_name: null } });
    m = mount();
    m.render(<Banners banners={[comp, low]} nowMs={NOW} lockOnly={false} onOpen={onOpen} onOpenInbox={() => {}} />);
    const [c, z] = [...m.container.querySelectorAll('.abn')];
    expect(c!.querySelector('.ac__title b')?.textContent).toBe('Comp · Takeaway order');
    expect(z!.querySelector('.ac__title b')?.textContent).toBe('A zone item is running low');
    expect(z!.querySelector('.tcode')).toBeNull();
    m.click(m.button('Open', z!));
    expect(window.location.hash).toBe('#/zones');
    expect(onOpen).not.toHaveBeenCalled();
    m.unmount();
    const out = row({ alert_id: 'Z2', kind: 'zone_stock_out', family: 'action', lock: { kind_label_key: 'alert.zone_stock_out.lock', table_code: null, point_code: null, requester_name: null } });
    m = mount();
    m.render(<Banners banners={[out]} nowMs={NOW} lockOnly={false} onOpen={onOpen} onOpenInbox={() => {}} />);
    expect(m.container.querySelector('.ac__title b')?.textContent).toBe('A zone item ran out');
  });

  it('[02a Q-14] a request_result banner reports itself to the handover store; one the store shows as a handover result is not shown here', async () => {
    const seen = vi.spyOn(pendingHandovers, 'resultSeen').mockResolvedValue();
    const mine = vi.spyOn(pendingHandovers, 'isHandoverResult').mockImplementation((id) => id === 'RR1');
    const result = (id: string) =>
      row({ alert_id: id, kind: 'request_result', family: 'info', outcome: 'rejected', lock: { kind_label_key: 'alert.request_result.lock', table_code: 'F4', point_code: null, requester_name: 'Ali' } });
    m = mount();
    m.render(<Banners banners={[result('RR1'), result('RR2')]} nowMs={NOW} lockOnly={false} onOpen={() => {}} onOpenInbox={() => {}} />);
    expect(seen.mock.calls.map((c) => [c[0], c[1]]).sort()).toEqual([['RR1', 'F4'], ['RR2', 'F4']]);
    expect([...m.container.querySelectorAll('.abn')].map((a) => a.getAttribute('data-alert'))).toEqual(['RR2']);
    seen.mockRestore();
    mine.mockRestore();
  });
});


describe('[01d §8.1 B01, 02a Q-14] one stack for 01d banners and handover cards (23b follow-up)', () => {
  const shell = { live: createLiveBus() } as unknown as Shell;
  const declined = (id: string) => ({ alert_id: id, kind: 'table_handover', state: 'rejected' as const, close_reason: 'answered' as const, decision: 'decline' as const, answerer_name: 'Sara', raised_at: 0, waiting_ms: 0, ask_in_person: false, lock: { kind_label_key: 'alert.table_handover.lock', table_code: id } });
  const pending = (id: string) => ({ ...declined(id), state: 'pending' as const, decision: null, close_reason: null, answerer_name: null });

  /** two handover results, the newer at `NOW` */
  async function twoResults(): Promise<void> {
    const times = [NOW - MIN, NOW];
    const replies = [[pending('F1'), pending('F2')], [declined('F1'), pending('F2')], [declined('F2')]];
    pendingHandovers.connect({ staff_id: `ST-STACK-${Math.random()}`, load: async () => ({ ok: true, data: { requests: replies.shift() ?? [] } }), now: () => times.shift() ?? NOW });
    await pendingHandovers.refresh();
    await pendingHandovers.refresh();
    await pendingHandovers.refresh();
  }
  afterEach(() => {
    pendingHandovers.disconnect();
    forceMoveNotice.set(null);
  });

  it('[01d §8.1 B01] without handover cards the store order is kept exactly (not urgent-first, not by raised_at)', () => {
    const olderAction = row({ alert_id: 'A', family: 'action', kind: 'test_alert', raised_at: NOW - 5 * MIN });
    const newerUrgent = row({ alert_id: 'U', raised_at: NOW - MIN });
    m = mount();
    m.render(
      <ShellContext.Provider value={shell}>
        <Banners banners={[olderAction, newerUrgent]} nowMs={NOW} lockOnly={false} onOpen={() => {}} onOpenInbox={() => {}} />
      </ShellContext.Provider>,
    );
    expect([...m.container.querySelectorAll('.abns > .abn')].map((c) => c.getAttribute('data-alert'))).toEqual(['A', 'U']);
  });

  it('[01d §8.1 B01] shared limit of 2: a card takes the slot of an older non-urgent banner, never one an urgent banner holds; hidden handover cards are not counted in "{n} more new"', async () => {
    await twoResults();
    const urgent = row({ alert_id: 'U', raised_at: NOW - 10 * MIN });
    const action = row({ alert_id: 'A', family: 'action', kind: 'test_alert', raised_at: NOW - MIN / 2 });
    m = mount();
    m.render(
      <ShellContext.Provider value={shell}>
        <Banners banners={[action, urgent]} nowMs={NOW} lockOnly={false} onOpen={() => {}} onOpenInbox={() => {}} />
      </ShellContext.Provider>,
    );
    await flush();
    const cards = [...m.container.querySelectorAll('.abns > .abn')];
    // the store order was A, U: the newest card takes A's slot (A is older and not urgent) and sits above the older U
    expect(cards.map((c) => c.getAttribute('data-alert') ?? c.getAttribute('data-handover'))).toEqual(['F2', 'U']);
    // only the 01d action row is hidden and reachable from the Inbox; the hidden handover card is not counted
    expect(m.text()).toContain('1 more new');
  });

  it('[01d §8.1 B01] two handover cards and no urgent row: the two newest, newest first', async () => {
    await twoResults();
    const older = row({ alert_id: 'A', family: 'action', kind: 'test_alert', raised_at: NOW - 5 * MIN });
    m = mount();
    m.render(
      <ShellContext.Provider value={shell}>
        <Banners banners={[older]} nowMs={NOW} lockOnly={false} onOpen={() => {}} onOpenInbox={() => {}} />
      </ShellContext.Provider>,
    );
    await flush();
    const cards = [...m.container.querySelectorAll('.abns > .abn')];
    expect(cards.map((c) => c.getAttribute('data-alert') ?? c.getAttribute('data-handover'))).toEqual(['F2', 'F1']);
    expect(m.text()).toContain('1 more new');
  });

  it('[01d §8.1 F01] the lock screen never shows handover cards or the force-move notice', async () => {
    await twoResults();
    forceMoveNotice.set({ kind: 'force_moved_to_me', table: 'F2' }, NOW);
    const urgent = row({ alert_id: 'U', raised_at: NOW - MIN });
    m = mount();
    m.render(
      <ShellContext.Provider value={shell}>
        <Banners banners={[urgent]} nowMs={NOW} lockOnly onOpen={() => {}} onOpenInbox={() => {}} />
      </ShellContext.Provider>,
    );
    await flush();
    expect(m.container.querySelectorAll('.abns > .abn')).toHaveLength(1);
    expect(m.text()).not.toMatch(/declined|gave you/);
  });
  const ids = () => [...m.container.querySelectorAll('.abns > .abn')].map((c) => c.getAttribute('data-alert') ?? c.getAttribute('data-handover'));
  const inShell = (banners: AlertRow[]) => (
    <ShellContext.Provider value={shell}>
      <Banners banners={banners} nowMs={NOW} lockOnly={false} onOpen={() => {}} onOpenInbox={() => {}} />
    </ShellContext.Provider>
  );

  it('[02a Q-14] a request_result raised after a handover result was learnt (a later void on the same table) keeps its own banner: Banners passes the row\'s raised_at', async () => {
    await twoResults();
    const voidResult = row({ alert_id: 'RV', kind: 'request_result', family: 'info', outcome: 'rejected', raised_at: NOW + MIN, lock: { kind_label_key: 'alert.request_result.lock', table_code: 'F2', point_code: null, requester_name: null } });
    m = mount();
    m.render(inShell([voidResult]));
    await flush();
    m.render(inShell([voidResult]));
    expect(pendingHandovers.isHandoverResult('RV')).toBe(false);
    expect(ids()).toEqual(['RV', 'F2']);
  });

  it('[01d §8.1 B01] a card never takes the slot of a NEWER non-urgent banner', async () => {
    await twoResults();
    const a = row({ alert_id: 'A', family: 'action', kind: 'test_alert', raised_at: NOW + MIN });
    const b = row({ alert_id: 'B', family: 'action', kind: 'test_alert', raised_at: NOW + 2 * MIN });
    m = mount();
    m.render(inShell([b, a]));
    await flush();
    expect(ids()).toEqual(['B', 'A']);
  });

  it('[01d §8.1 B01] a card older than a shown banner sits below it (cards are not always on top)', async () => {
    await twoResults();
    const b = row({ alert_id: 'B', family: 'action', kind: 'test_alert', raised_at: NOW + MIN });
    m = mount();
    m.render(inShell([b]));
    await flush();
    expect(ids()).toEqual(['B', 'F2']);
  });
});
