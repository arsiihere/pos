import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertRow } from '../../../alerts/store';
import type { HubResult } from '../../../../api/hub-admin';
import { NOW, row } from '../../../../../test/alert-rows';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { createLiveBus, type LiveBus } from '../../shell/live';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { TableMapBody } from '../contracts';
import { CallCard, callTitle } from './CallCard';
import { HandoverLayer } from './HandoverLayer';
import { pendingHandovers, type MyRequest } from './pending-handovers';
import { Banners } from '../../../alerts/Banner';
import { RESULT_HIDE_MS } from './pending-handovers';
import { WaitingCard } from './WaitingCard';

// 02a §8 Handover waiting card, Table sheet (02a-C03, C04, C05; Q-12, Q-14): the sender's waiting card, the result
// banners and the waiter's call card.

const ME = 'ST-ALI';
let staffN = 0;

const MAP: TableMapBody = {
  as_of_seq: 1,
  floors: [
    {
      floor_id: 'FL-1',
      name: 'Ground',
      archived: false,
      zones: [
        {
          zone_id: 'Z1',
          name: 'Family hall',
          tables: [
            {
              table_id: 'TB-F2',
              name: 'F2',
              seats: 4,
              archived: false,
              state: 'ORDERED',
              seating_id: 'SE-2',
              party_size: 2,
              primary_table_id: 'TB-F2',
              joined_table_names: [],
              holder: { staff_id: ME, name: 'Ali' },
              assignee: null,
              lock: null,
              opened_at: 1,
              bill_requested_at: null,
              live_order_count: 1,
            },
          ],
        },
      ],
    },
  ],
};

function req(over: Partial<MyRequest> & { alert_id: string }): MyRequest {
  return {
    kind: 'table_handover',
    state: 'pending',
    close_reason: null,
    decision: null,
    answerer_name: null,
    raised_at: NOW,
    waiting_ms: 0,
    ask_in_person: false,
    lock: { kind_label_key: 'alert.table_handover.lock', table_code: 'F4 + F5', requester_name: 'Ali' },
    ...over,
  };
}

function harness(o: { replies?: MyRequest[][]; withdraw?: () => HubResult<unknown> } = {}) {
  staffN += 1;
  const staff_id = `${ME}-${staffN}`;
  const live: LiveBus = createLiveBus();
  live.frame({ type: 'catch_up', as_of_seq: 1, state: { tables: MAP } });
  const queue = [...(o.replies ?? [])];
  const commands: Array<{ type: string; payload: unknown }> = [];
  const queries: string[] = [];
  const toasts = createToastBus();
  const shown: string[] = [];
  const shell = {
    device: { token: 'T', id: 'DEV-1', type: 'tablet' },
    me: { staff_id, name: 'Ali' },
    online: true,
    live,
    toasts: { ...toasts, show: (t: { text: string }) => shown.push(t.text) },
    clock: { nowMs: () => Date.now(), utcOffsetMs: 0 },
    permissions: createPermissions({}),
    config: { config: () => null },
    api: {
      query: async (path: string) => {
        queries.push(path);
        return { ok: true, data: { requests: queue.shift() ?? [] } };
      },
      command: async (type: string, payload: unknown) => {
        commands.push({ type, payload });
        return o.withdraw?.() ?? { ok: true, data: { alert_id: 'H1' } };
      },
      roster: async () => ({ ok: true, data: { staff: [], active_session: null } }),
    },
    tables: { tableMap: async () => ({ ok: true, data: MAP }) },
  } as unknown as Shell;
  const m: Mounted = mount();
  const render = (node: React.ReactNode) => m.render(<ShellContext.Provider value={shell}>{node}</ShellContext.Provider>);
  return { m, render, live, commands, queries, shown, staff_id };
}

/** the layer plus the one banner stack (01d Banners) the handover cards render in */
const Layer = ({ variant = 'side' as 'side' | 'wide' | 'phone' }) => (
  <>
    <HandoverLayer />
    <Banners banners={[]} nowMs={NOW} lockOnly={false} variant={variant} onOpen={() => {}} onOpenInbox={() => {}} />
  </>
);

let h: ReturnType<typeof harness> | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  window.location.hash = '';
});
afterEach(() => {
  h?.m.unmount();
  h = null;
  vi.useRealTimers();
});

describe('[02a §8 Handover waiting card] sender', () => {
  it('[02a §8 Handover waiting card] "Waiting for Bilal — 0:42" live count; Withdraw = WithdrawRequest', async () => {
    h = harness({ replies: [[req({ alert_id: 'H1', raised_at: NOW })]] });
    pendingHandovers.connect({ staff_id: h.staff_id, load: async () => ({ ok: true, data: { requests: [] } }), now: () => NOW });
    pendingHandovers.remember({ alert_id: 'H1', table_id: 'TB-F4', seating_id: 'SE-4', receiver_name: 'Bilal' });
    h.render(
      <>
        <HandoverLayer />
        <WaitingCard table_id="TB-F4" seating_id="SE-4" table_code="F4 + F5" />
      </>,
    );
    await flush();
    const card = () => h!.m.container.querySelector('.wcard.c-info');
    expect(card()!.querySelector('b')?.textContent).toBe('Waiting for Bilal');
    expect(card()!.querySelector('.clockn')?.textContent).toBe('0:00');
    await vi.advanceTimersByTimeAsync(42_000);
    expect(card()!.querySelector('.clockn')?.textContent).toBe('0:42');
    h.m.click(h.m.button('Withdraw'));
    await flush();
    expect(h.commands).toEqual([{ type: 'WithdrawRequest', payload: { alert_id: 'H1' } }]);
    expect(card()).toBeNull();
  });

  it('[02a Q-14] after reload: "Waiting for an answer", attached by table_code = joined names', async () => {
    h = harness({ replies: [[req({ alert_id: 'H7', raised_at: NOW - 30_000 })]] });
    h.render(
      <>
        <HandoverLayer />
        <WaitingCard table_id="TB-F4" seating_id="SE-4" table_code="F4 + F5" />
        <WaitingCard table_id="TB-F9" seating_id="SE-9" table_code="F9" />
      </>,
    );
    await flush();
    const cards = h.m.container.querySelectorAll('.wcard');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.querySelector('b')?.textContent).toBe('Waiting for an answer');
    expect(cards[0]!.querySelector('.clockn')?.textContent).toBe('0:30');
    expect(h.queries.every((q) => q === '/queries/my-requests')).toBe(true);
  });

  it('[02a §8 Handover waiting card] my-requests ask_in_person → "ask her in person", lead told', async () => {
    h = harness({ replies: [[req({ alert_id: 'H1', raised_at: NOW - 2 * 60_000, ask_in_person: true })]] });
    pendingHandovers.connect({ staff_id: h.staff_id, load: async () => ({ ok: true, data: { requests: [] } }), now: () => NOW });
    pendingHandovers.remember({ alert_id: 'H1', table_id: 'TB-F4', seating_id: 'SE-4', receiver_name: 'Sara' });
    h.render(
      <>
        <HandoverLayer />
        <WaitingCard table_id="TB-F4" seating_id="SE-4" table_code="F4 + F5" />
      </>,
    );
    await flush();
    const card = h.m.container.querySelector('.wcard')!;
    expect(card.querySelector('b')?.textContent).toBe('Waiting for Sara — 2 min · ask her in person');
    expect(card.querySelector('small')?.textContent).toBe('Your lead was told');
  });

  it('[02a Q-14] request_result frame → my-requests diff by alert_id → "Sara declined" + Hand over to someone else, or "Sara accepted F4 + F5" hiding after 4 s', async () => {
    h = harness({
      replies: [
        [req({ alert_id: 'H1' }), req({ alert_id: 'H2', lock: { kind_label_key: 'alert.table_handover.lock', table_code: 'F2' } })],
        [req({ alert_id: 'H1', state: 'rejected', decision: 'decline', close_reason: 'answered', answerer_name: 'Sara' }), req({ alert_id: 'H2', lock: { kind_label_key: 'alert.table_handover.lock', table_code: 'F2' } })],
        [req({ alert_id: 'H2', state: 'approved', decision: 'accept', close_reason: 'answered', answerer_name: 'Sara', lock: { kind_label_key: 'alert.table_handover.lock', table_code: 'F2' } })],
      ],
    });
    h.render(<Layer />);
    pendingHandovers.remember({ alert_id: 'H1', table_id: 'TB-F4', seating_id: 'SE-4', receiver_name: 'Sara' });
    await flush();
    await pendingHandovers.resultSeen('RES-1', 'F4 + F5', NOW);
    await flush();
    const declined = h.m.container.querySelector('.abn.abn--info.abn--stack.c-mute')!;
    expect(declined.querySelector('.ac__title b')?.textContent).toBe('Sara declined F4 + F5');
    expect(declined.querySelector('.ac__det')?.textContent).toBe('The table stays yours.');
    h.m.click(h.m.button('Hand over to someone else', declined));
    expect(window.location.hash).toBe('#/tables/TB-F4?seating_id=SE-4');
    expect(h.m.container.querySelector('.abn')).toBeNull();

    await pendingHandovers.resultSeen('RES-2', 'F2', NOW);
    await flush();
    const accepted = h.m.container.querySelector('.abn.abn--info.c-ok')!;
    expect(accepted.querySelector('.ac__title b')?.textContent).toBe('Sara accepted F2');
    expect(accepted.querySelector('.ac__det')?.textContent).toBe('It’s Sara’s table now.');
    await vi.advanceTimersByTimeAsync(RESULT_HIDE_MS);
    expect(h.m.container.querySelector('.abn')).toBeNull();
  });

  it('[02a Q-14] a reconnect reads my-requests again', async () => {
    h = harness();
    h.render(<HandoverLayer />);
    await flush();
    const before = h.queries.length;
    h.live.connection(true);
    h.live.connection(false);
    h.live.connection(true);
    await flush();
    expect(h.queries.length).toBe(before + 1);
  });
});

describe('[02a §8 Banners] force move to me (map)', () => {
  it('[02a §8 Banners] "A manager gave you F2" with Open table → the table sheet', async () => {
    h = harness();
    h.render(<Layer />);
    h.live.frame({ type: 'event', seq: 5, event: { event_id: 'E5', event_type: 'TableHolderChanged', schema_version: 1, payload: { table_id: 'TB-F2', seating_id: 'SE-2', from_staff_id: 'ST-BILAL', to_staff_id: h.staff_id, reason: 'force_move', by_staff_id: 'ST-IMRAN' } } });
    await flush();
    const abn = h.m.container.querySelector('.abn.abn--info.c-info')!;
    expect(abn.querySelector('.ac__title b')?.textContent).toBe('A manager gave you F2');
    h.m.click(h.m.button('Open table', abn));
    expect(window.location.hash).toBe('#/tables/TB-F2?seating_id=SE-2');
    expect(h.m.container.querySelector('.abn')).toBeNull();
  });
});

describe('[02a §6.14] call card', () => {
  const call = (requester: string | null): AlertRow =>
    row({
      alert_id: 'C1',
      kind: 'call_waiter',
      family: 'action',
      lock: { kind_label_key: 'alert.call_waiter.lock', table_code: 'F4', point_code: null, requester_name: requester },
      card: { kind_label_key: 'alert.call_waiter.card', table_code: 'F4', point_code: null, requester_name: requester, device_name: null, details: null },
    });

  it('[02a Q-12] call card "F4 · Call · Ali" with requester_name, "F4 · Call" without; never a chip', () => {
    expect(callTitle(call('Ali'))).toBe('Call · Ali');
    expect(callTitle(call(null))).toBe('Call');
    const onOpen = vi.fn();
    const m = mount();
    m.render(<CallCard row={call('Ali')} onOpen={onOpen} />);
    expect(m.container.querySelector('.abn.c-info .tcode')?.textContent).toBe('F4');
    expect(m.container.querySelector('.ac__title b')?.textContent).toBe('Call · Ali');
    expect(m.text()).not.toMatch(/Water|Clear the table|Come to the table/);
    m.click(m.button('Open'));
    expect(onOpen).toHaveBeenCalledOnce();
    m.render(<CallCard row={call(null)} onOpen={onOpen} />);
    expect(m.container.querySelector('.ac__title b')?.textContent).toBe('Call');
    m.unmount();
  });
});

describe('[02a §8] handover results in the banner stack', () => {
  it('[02a Q-14] at most two results, newest on top; a closed handover says the table changed', async () => {
    h = harness({
      replies: [
        [req({ alert_id: 'A' }), req({ alert_id: 'B' }), req({ alert_id: 'C' })],
        [
          req({ alert_id: 'A', state: 'rejected', decision: 'decline', answerer_name: 'Sara' }),
          req({ alert_id: 'B', state: 'rejected', decision: 'decline', answerer_name: 'Bilal' }),
          req({ alert_id: 'C', state: 'closed', close_reason: 'obsolete' }),
        ],
      ],
    });
    h.render(<Layer />);
    await flush();
    await pendingHandovers.refresh();
    await flush();
    const titles = [...h.m.container.querySelectorAll('.abn .ac__title b')].map((b) => b.textContent);
    expect(titles).toEqual(['Handover of F4 + F5 closed: the table changed', 'Bilal declined F4 + F5']);
  });
  it('[02a §8 Rules] phone: the result and the force-move notice sit in the one banner stack, abns--phone (no second 470 px stack)', async () => {
    h = harness({
      replies: [[req({ alert_id: 'A' })], [req({ alert_id: 'A', state: 'rejected', decision: 'decline', answerer_name: 'Sara' })]],
    });
    h.render(<Layer variant="phone" />);
    await flush();
    await pendingHandovers.refresh();
    h.live.frame({ type: 'event', seq: 5, event: { event_id: 'E5', event_type: 'TableHolderChanged', schema_version: 1, payload: { table_id: 'TB-F2', seating_id: 'SE-2', from_staff_id: 'ST-BILAL', to_staff_id: h.staff_id, reason: 'force_move', by_staff_id: 'ST-IMRAN' } } });
    await flush();
    const stacks = h.m.container.querySelectorAll('.abns');
    expect(stacks).toHaveLength(1);
    expect(stacks[0]!.className).toBe('abns abns--phone');
    expect(stacks[0]!.textContent).toContain('A manager gave you F2');
    expect(stacks[0]!.textContent).toContain('Sara declined F4 + F5');
  });

  it('[02a Q-14] a new person signing in never sees the previous person\'s results', async () => {
    h = harness({ replies: [[req({ alert_id: 'A' })], [req({ alert_id: 'A', state: 'rejected', decision: 'decline', answerer_name: 'Sara' })]] });
    h.render(<Layer />);
    await flush();
    await pendingHandovers.refresh();
    await flush();
    expect(pendingHandovers.results()).toHaveLength(1);
    // sign-out unmounts the layer (StaffApp mounts it only while someone is signed in)
    h.render(<></>);
    expect(pendingHandovers.results()).toEqual([]);
  });
});
