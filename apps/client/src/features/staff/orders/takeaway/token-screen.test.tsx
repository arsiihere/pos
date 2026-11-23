import { aBranchConfig } from '@pos/events/testing';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import type { EnqueueMeta, QueueableCommand } from '../../tables/contracts';
import type { DraftStore, OpenOrder, OrderViewBody, SeatingLine } from '../contracts';
import { createMemoryDraftStore } from '../drafts/memory-drafts';
import { DraftStoreContext, OrderScreen } from '../order-screen/OrderScreen';
import { UNDO_MS } from './handover';
import { aCaught, aLine, aRow, at } from './test-fixtures';

// 02b-TK C2 on the takeaway order screen: the rail opens the token view over the kept cart; hand-overs wait for Undo.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

const sl = (order_id: string, id: string, name: string, stage: SeatingLine['stage']): SeatingLine => ({ ...aLine(order_id, id, name), stage, fired: true });
const view = (order_id: string, lines: SeatingLine[]): OrderViewBody => ({
  order_id,
  placed_by: { staff_id: 'sana', name: 'Sana' },
  placed_at: at(13, 4),
  follow_up: false,
  cancelled: false,
  billed: false,
  has_phone: false,
  promise_ms: at(13, 12),
  lines,
  order_type: 'takeaway',
  seating_id: null,
});

export interface ScreenHarness {
  shell: Shell;
  sent: Array<{ type: QueueableCommand; payload: unknown; meta: EnqueueMeta }>;
  commands: Array<{ type: string; payload: unknown }>;
  drafts: DraftStore;
  live: ReturnType<typeof createLiveBus>;
  render(id?: string): Mounted;
}

export function screenHarness(o: { rows?: OpenOrder[]; views?: Record<string, OrderViewBody>; bills?: Record<string, unknown>; grants?: Record<string, unknown>; drafts?: DraftStore; command?: (type: string, payload: unknown) => unknown } = {}): ScreenHarness {
  const live = createLiveBus();
  live.frame({ type: 'catch_up', as_of_seq: 1, state: { orders: { orders: [aCaught('O48', 48, [aLine('O48', 'A', 'Karahi')], { customer_name: 'Ali' })], zone_stock: [] } } });
  const config = aBranchConfig();
  const sent: ScreenHarness['sent'] = [];
  const commands: ScreenHarness['commands'] = [];
  const drafts = o.drafts ?? createMemoryDraftStore();
  const enqueue = Object.assign(
    async (type: QueueableCommand, payload: unknown, meta: EnqueueMeta) => {
      sent.push({ type, payload, meta });
      return { status: 'sent', result: { served: 1, skipped: [] } };
    },
    { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} },
  );
  const bills = o.bills ?? { O48: { bill_id: 'B48', state: 'closed', splits: [], totals_default: { total_minor: 205_000 } } };
  const shell = {
    device: { token: 'tok', id: 'DV1', type: 'cashier_kiosk' },
    live,
    api: {
      query: async (path: string) => {
        const id = new URLSearchParams(path.split('?')[1]).get('order_id')!;
        return bills[id] === undefined ? { ok: false, error: { kind: 'network' } } : { ok: true, data: bills[id] };
      },
      page: async () => ({ ok: false, error: { kind: 'network' } }),
      command: async (type: string, payload: unknown) => {
        commands.push({ type, payload });
        return o.command?.(type, payload) ?? { ok: true, data: {} };
      },
      roster: async () => ({ ok: true, data: { staff: [{ staff_id: 'zain', display_name: 'Zain', locked_until: null }], active_session: null } }),
    },
    config: { config: () => null, snapshot: () => config, refresh: async () => {}, subscribe: () => () => {}, dispose: () => {} },
    orders: {
      etaPreview: async () => ({ ok: false, error: { kind: 'network' } }),
      seatingOrders: async () => ({ ok: true, data: { orders: [], total_minor: 0 } }),
      openOrders: async () => ({ ok: true, data: { orders: o.rows ?? [aRow({ order_id: 'O48', token: 48, ready: { n: 1, m: 1 }, promise_ms: at(13, 12) })] } }),
      orderView: async (id: string) => ({ ok: true, data: { kind: 'order', order: (o.views ?? { O48: view('O48', [sl('O48', 'A', 'Karahi', 'done')]) })[id] } }),
      orderContact: async () => ({ ok: false, error: { kind: 'network' } }),
    },
    tables: { tableMap: async () => ({ ok: true, data: { as_of_seq: 1, floors: [] } }) },
    toasts: { show: () => {}, current: () => null, clear: () => {}, subscribe: () => () => {} },
    permissions: createPermissions({ 'mark-served': { grant: 'allowed', scope: 'branch' }, 'take-order': { grant: 'allowed', scope: 'branch' }, 'take-payment': { grant: 'allowed', scope: 'branch' }, ...(o.grants ?? {}) } as never),
    enqueue,
    clock: { nowMs: () => at(13, 20), utcOffsetMs: 0 },
    me: { staff_id: 'sana', name: 'Sana' },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  const render = (id = 'D1') => {
    const m = mount();
    m.render(
      <ShellContext.Provider value={shell}>
        <DraftStoreContext.Provider value={drafts}>
          <OrderScreen order_type="takeaway" id={id} />
        </DraftStoreContext.Provider>
      </ShellContext.Provider>,
    );
    return m;
  };
  return { shell, sent, commands, drafts, live, render };
}

const tick = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
};

describe('[02b-TK C2-2] token view on the takeaway screen', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }));
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    nav.to = [];
  });

  it('[02b §8; frames TokenReady, HandoverUndo] the rail opens the drawer; Hand over all shows "48 handed over · Undo" and sends MarkServed after 5 s', async () => {
    const h = screenHarness();
    const m = h.render();
    await flush();
    m.click(m.container.querySelector('.tk-rt__open'));
    await flush();
    expect(m.container.querySelector('.tk-drawer')?.textContent).toContain('Ali');
    m.click(m.button('Hand over all'));
    expect(m.container.querySelector('.tk-drawer')).toBeNull();
    expect(m.container.querySelector('.tk-toast')?.textContent).toContain('48 handed over');
    // the token leaves the rail while it can still be undone
    expect(m.container.querySelector('.tk-rt')).toBeNull();
    expect(h.sent).toEqual([]);
    await tick(UNDO_MS);
    expect(h.sent).toEqual([{ type: 'MarkServed', payload: { lines: [{ order_id: 'O48', order_item_ids: ['A'] }] }, meta: { label: 'Mark served · 48' } }]);
    expect(m.container.querySelector('.tk-toast')).toBeNull();
    m.unmount();
  });

  it('[02b §6.4 no undo command] Undo inside 5 s: nothing is sent, the token is back', async () => {
    const h = screenHarness();
    const m = h.render();
    await flush();
    // the paid ready tile hands over in one tap (frame ReadyTiles)
    act(() => h.live.frame({ type: 'event', seq: 2, event: { event_id: 'E2', event_type: 'OrdersBilled', schema_version: 1, payload: { order_ids: ['O48'], bill_id: 'B48' } } }));
    m.click(m.button('Hand over', m.container.querySelector('.tk-rt')!));
    await flush();
    expect(m.container.querySelector('.tk-toast')?.textContent).toContain('48 handed over');
    m.click(m.button('Undo'));
    await tick(UNDO_MS * 2);
    expect(h.sent).toEqual([]);
    expect(m.container.querySelector('.tk-rt')).not.toBeNull();
    m.unmount();
  });

  it('[02b-TK C2-2] leaving the screen sends a waiting hand-over at once', async () => {
    const h = screenHarness();
    const m = h.render();
    await flush();
    m.click(m.container.querySelector('.tk-rt__open'));
    await flush();
    m.click(m.button('Hand over all'));
    m.unmount();
    expect(h.sent.map((s) => s.type)).toEqual(['MarkServed']);
  });
});
