import type { ReactNode } from 'react';
import { aBranchConfig } from '@pos/events/testing';
import { mount, type Mounted } from '../../../../../test/dom';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createRushSlot } from '../../shell/rush-slot';
import type { EnqueueMeta, QueueableCommand } from '../../tables/contracts';
import type { BranchConfig } from '@pos/events';
import type { DraftStore, EtaDraft, OpenOrder, OrderViewBody, SeatingLine } from '../contracts';
import { createMemoryDraftStore } from '../drafts/memory-drafts';
import { DraftStoreContext, OrderScreen } from '../order-screen/OrderScreen';
import { TakeawayHome } from './TakeawayHome';
import { aCaught, aLine, aRow, at } from './test-fixtures';

// 02b-TK C2 / C3 tests only: the takeaway order screen with a fake shell (open-orders, order-view, bill, commands).
// The test files mock the table lock, the lock banner, the offline bar and the router themselves.

export const sl = (order_id: string, id: string, name: string, stage: SeatingLine['stage']): SeatingLine => ({ ...aLine(order_id, id, name), stage, fired: true });
export const view = (order_id: string, lines: SeatingLine[]): OrderViewBody => ({
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
  /** the Takeaway tab (`#/takeaway`): the order screen on this device's current takeaway draft */
  renderHome(): Mounted;
  /** the order screen of another order type (a parking cart) on the same fake shell */
  renderAs(order_type: 'takeaway' | 'parking', id: string): Mounted;
  toasts: Array<{ text: string; tone?: string; sub?: string }>;
  /** every query path read */
  queries: string[];
}

export function screenHarness(o: { rows?: OpenOrder[]; views?: Record<string, OrderViewBody>; bills?: Record<string, unknown>; grants?: Record<string, unknown>; drafts?: DraftStore; command?: (type: string, payload: unknown) => unknown; answer?: (type: string, payload: unknown) => unknown; bill?: (order_id: string) => unknown; online?: boolean; device?: 'cashier_kiosk' | 'tablet'; phone?: boolean; openBills?: unknown[]; config?: (base: BranchConfig) => BranchConfig; preview?: (draft: EtaDraft) => unknown } = {}): ScreenHarness {
  const live = createLiveBus();
  live.frame({ type: 'catch_up', as_of_seq: 1, state: { orders: { orders: [aCaught('O48', 48, [aLine('O48', 'A', 'Karahi')], { customer_name: 'Ali' })], zone_stock: [] } } });
  const base = aBranchConfig();
  const plain = (id: string, name: string) => ({ ...base.items.find((i) => i.item_id === 'I2')!, item_id: id, name, category_id: 'C2', price_minor: 4_000 });
  const built: BranchConfig = { ...base, categories: [...base.categories, { category_id: 'C2', name: 'Sides', sort_order: 2, availability_windows: [] }], items: [...base.items, plain('I5', 'Naan')] };
  const config = o.config?.(built) ?? built;
  const toasts: Array<{ text: string; tone?: string; sub?: string }> = [];
  const sent: ScreenHarness['sent'] = [];
  const commands: ScreenHarness['commands'] = [];
  const queries: string[] = [];
  const drafts = o.drafts ?? createMemoryDraftStore();
  const enqueue = Object.assign(
    async (type: QueueableCommand, payload: unknown, meta: EnqueueMeta) => {
      sent.push({ type, payload, meta });
      return o.answer?.(type, payload) ?? { status: 'sent', result: { served: 1, skipped: [] } };
    },
    { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} },
  );
  const bills = o.bills ?? { O48: { bill_id: 'B48', state: 'closed', splits: [], totals_default: { total_minor: 205_000 } } };
  const shell = {
    device: { token: 'tok', id: 'DV1', type: o.device ?? 'cashier_kiosk' },
    live,
    api: {
      query: async (path: string) => {
        queries.push(path);
        // 05 §6.2 open-bills (the rail's Due amounts)
        if (path.startsWith('/queries/open-bills')) return { ok: true, data: { bills: o.openBills ?? [], as_of_seq: 1 } };
        const id = new URLSearchParams(path.split('?')[1]).get('order_id')!;
        const found = bills[id] ?? o.bill?.(id);
        return found === undefined ? { ok: false, error: { kind: 'network' } } : { ok: true, data: found };
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
      etaPreview: async (d: EtaDraft) => o.preview?.(d) ?? { ok: false, error: { kind: 'network' } },
      seatingOrders: async () => ({ ok: true, data: { orders: [], total_minor: 0 } }),
      openOrders: async () => ({ ok: true, data: { orders: [...(o.rows ?? [aRow({ order_id: 'O48', token: 48, ready: { n: 1, m: 1 }, promise_ms: at(13, 12) })])] } }),
      orderView: async (id: string) => ({ ok: true, data: { kind: 'order', order: (o.views ?? { O48: view('O48', [sl('O48', 'A', 'Karahi', 'done')]) })[id] } }),
      orderContact: async () => ({ ok: false, error: { kind: 'network' } }),
    },
    tables: { tableMap: async () => ({ ok: true, data: { as_of_seq: 1, floors: [] } }) },
    toasts: { show: (x: { text: string; tone?: string; sub?: string }) => toasts.push(x), current: () => null, clear: () => {}, subscribe: () => () => {} },
    permissions: createPermissions({ 'mark-served': { grant: 'allowed', scope: 'branch' }, 'take-order': { grant: 'allowed', scope: 'branch' }, 'take-payment': { grant: 'allowed', scope: 'branch' }, ...(o.grants ?? {}) } as never),
    enqueue,
    clock: { nowMs: () => at(13, 20), utcOffsetMs: 0 },
    me: { staff_id: 'sana', name: 'Sana' },
    online: o.online ?? true,
    phone: o.phone === true,
    portrait: false,
    rush: createRushSlot(),
  } as unknown as Shell;
  const show = (node: ReactNode) => {
    const m = mount();
    m.render(
      <ShellContext.Provider value={shell}>
        <DraftStoreContext.Provider value={drafts}>{node}</DraftStoreContext.Provider>
      </ShellContext.Provider>,
    );
    return m;
  };
  const render = (id = 'D1') => show(<OrderScreen order_type="takeaway" id={id} />);
  const renderHome = () => show(<TakeawayHome />);
  const renderAs = (order_type: 'takeaway' | 'parking', id: string) => show(<OrderScreen order_type={order_type} id={id} />);
  return { shell, sent, commands, drafts, live, render, renderHome, renderAs, toasts, queries };
}

