import type { BranchConfig } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubResult } from '../../../../api/hub-admin';
import { flush, mount } from '../../../../../test/dom';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import type { EnqueueMeta, EnqueueResult, QueueableCommand } from '../../tables/contracts';
import type { DraftStore, EtaDraft, EtaPreviewBody, SubmitOrderPayload, SubmitResult } from '../contracts';
import { createMemoryDraftStore } from '../drafts/memory-drafts';
import { createDayWatch } from './day-open';
import { DraftStoreContext, OrderScreen } from './OrderScreen';

// 02b-TK batch C1 (docs/plans/02b-tk-plan.md): the takeaway cart and Send on the order screen.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

const HOUR = 3_600_000;
const T = Date.UTC(2025, 9, 20, 15); // 8:00 PM hub time (utc offset 5 h)
const at = (h: number, m: number) => Date.UTC(2025, 9, 20, h - 5, m);

function cfg(): BranchConfig {
  const base = aBranchConfig();
  const plain = (id: string, name: string, o: Record<string, unknown> = {}) => ({ ...base.items.find((i) => i.item_id === 'I2')!, item_id: id, name, category_id: 'C2', ...o });
  return {
    ...base,
    categories: [...base.categories, { category_id: 'C2', name: 'Sides', sort_order: 2, availability_windows: [] }],
    items: [...base.items, plain('I4', 'Raita', { price_minor: 8_000 }), plain('I5', 'Naan', { price_minor: 4_000 })],
  };
}

type Answer = EnqueueResult<SubmitResult | undefined>;
const DAY_CLOSED = { ok: false, error: { kind: 'api', status: 409, code: 'BUSINESS_DAY_NOT_OPEN', details: {} } } as const;

function harness(o: { answer?: (p: SubmitOrderPayload) => Promise<Answer>; preview?: (d: EtaDraft) => HubResult<EtaPreviewBody>; drafts?: DraftStore; phone?: boolean; online?: boolean } = {}) {
  const live = createLiveBus();
  const config = cfg();
  const sent: Array<{ type: QueueableCommand; payload: SubmitOrderPayload; meta: EnqueueMeta }> = [];
  const previews: EtaDraft[] = [];
  const toasts: Array<{ text: string; sub?: string; tone?: string }> = [];
  const drafts = o.drafts ?? createMemoryDraftStore();
  const enqueue = Object.assign(
    async (type: QueueableCommand, payload: unknown, meta: EnqueueMeta) => {
      sent.push({ type, payload: payload as SubmitOrderPayload, meta });
      return (o.answer ?? (async () => ({ status: 'queued', entry_id: 'Q1' }) as Answer))(payload as SubmitOrderPayload);
    },
    { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} },
  );
  const shell = {
    device: { token: 'tok', id: 'DV1', type: 'kiosk' },
    live,
    config: { config: () => null, snapshot: () => config, refresh: async () => {}, subscribe: () => () => {}, dispose: () => {} },
    orders: {
      etaPreview: async (d: EtaDraft) => {
        previews.push(d);
        return o.preview?.(d) ?? { ok: false, error: { kind: 'network' } };
      },
      seatingOrders: async () => ({ ok: true, data: { orders: [], total_minor: 0 } }),
    },
    tables: { tableMap: async () => ({ ok: true, data: { as_of_seq: 1, floors: [] } }) },
    toasts: { show: (x: { text: string; sub?: string; tone?: string }) => toasts.push(x) },
    permissions: { allowed: () => false, requiresApproval: () => false, resolution: () => ({ grant: 'not_granted' }), scope: () => null },
    enqueue,
    clock: { nowMs: () => T, utcOffsetMs: 5 * HOUR },
    me: { staff_id: 'ST1', name: 'Sana' },
    online: o.online ?? true,
    phone: o.phone === true,
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
  return { live, sent, previews, toasts, drafts, render, shell };
}

const tile = (m: ReturnType<typeof mount>, name: string) => m.container.querySelector<HTMLElement>(`.mi[aria-label="${name}"]`)!;
const pick = (m: ReturnType<typeof mount>, category: string) => m.click(m.button(category, m.container.querySelector('.cats')!));
const tick = async (ms = 300) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
};
const dayFrame = (seq: number, event_type: 'BusinessDayOpened' | 'BusinessDayClosed') => ({ type: 'event' as const, seq, event: { event_id: `E${seq}`, event_type, schema_version: event_type === 'BusinessDayOpened' ? 2 : 1, payload: event_type === 'BusinessDayOpened' ? { business_date: '2025-10-20', stock_units: {}, draws: {} } : { business_date: '2025-10-20' } } });
const stockPart = (business_day: unknown) => ({ business_day, business_day_started_at: null, items: {} });
const openDay = { business_date: '2025-10-20', opened_at: T - HOUR, closed_at: null, stock_units: {}, draws: {} };

describe('[02b-TK C1-1] day not open from eta-preview and the socket', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }));
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    nav.to = [];
  });

  it('[02b §6.14; 02b-TK C1-1] eta-preview 409 BUSINESS_DAY_NOT_OPEN → "Times show after Start day", the day block, no Send', async () => {
    const h = harness({ preview: () => DAY_CLOSED });
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await tick();
    expect(h.previews).toHaveLength(1);
    expect(m.text()).toContain('Times show after Start day');
    expect(m.text()).not.toContain('Times will be set when sent');
    expect(m.text()).toContain("The day hasn't started");
    expect(m.buttons().filter((b) => (b.textContent ?? '').includes('Send') && !(b as HTMLButtonElement).disabled)).toHaveLength(0);
    expect(h.sent).toEqual([]);
    m.unmount();
  });

  it('[02b §6.14] another preview failure keeps "Times will be set when sent" and Send', async () => {
    const h = harness({ preview: () => ({ ok: false, error: { kind: 'api', status: 400, code: 'VALIDATION_FAILED', details: {} } }) });
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await tick();
    expect(m.text()).toContain('Times will be set when sent');
    expect((m.button('Send to kitchen') as HTMLButtonElement).disabled).toBe(false);
    m.unmount();
  });

  it('[02b §8 Queue; 02b-TK C1-1] catch-up stock with no business day blocks Send before the first item; BusinessDayOpened clears it without a reload', async () => {
    const h = harness();
    h.live.frame({ type: 'catch_up', as_of_seq: 1, state: { stock: stockPart(null) } });
    const m = h.render();
    await flush();
    expect(m.text()).toContain("The day hasn't started");
    expect(m.text()).toContain('Times show after Start day');
    act(() => h.live.frame(dayFrame(2, 'BusinessDayOpened')));
    expect(m.text()).not.toContain("The day hasn't started");
    expect(m.button('Send to kitchen')).toBeTruthy();
    act(() => h.live.frame(dayFrame(3, 'BusinessDayClosed')));
    expect(m.text()).toContain("The day hasn't started");
    // a catch-up after a reconnect with the day open clears it too
    act(() => h.live.frame({ type: 'catch_up', as_of_seq: 4, state: { stock: stockPart(openDay) } }));
    expect(m.text()).not.toContain("The day hasn't started");
    m.unmount();
  });

  it('[02b-TK C1-1] a day_not_open preview is asked again when the day opens', async () => {
    let open = false;
    const ok = (d: EtaDraft): HubResult<EtaPreviewBody> => ({ ok: true, data: { as_of_seq: 1, groups: [{ promise_ms: at(20, 29), keys: d.lines.map((l) => l.key) }], lines: d.lines.map((l) => ({ key: l.key, eta_ms: at(20, 29), from_stock: false, zone_served: false })) } });
    const h = harness({ preview: (d) => (open ? ok(d) : DAY_CLOSED) });
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await tick();
    expect(m.text()).toContain('Times show after Start day');
    open = true;
    act(() => h.live.frame(dayFrame(2, 'BusinessDayOpened')));
    await tick();
    expect(m.text()).not.toContain('Times show after Start day');
    expect(m.text()).toContain('All ready by');
    m.unmount();
  });

  it('[02b-TK C1-1] the day watch: unknown without a stock part; closed / open from the business day and the frames', () => {
    const live = createLiveBus();
    const w = createDayWatch(live);
    expect(w.state()).toBe('unknown');
    live.frame({ type: 'catch_up', as_of_seq: 1, state: { orders: {} } });
    expect(w.state()).toBe('unknown');
    live.frame({ type: 'catch_up', as_of_seq: 2, state: { stock: stockPart({ ...openDay, closed_at: T }) } });
    expect(w.state()).toBe('closed');
    live.frame(dayFrame(3, 'BusinessDayOpened'));
    expect(w.state()).toBe('open');
    w.dispose();
  });
});
