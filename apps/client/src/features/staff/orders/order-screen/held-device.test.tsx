import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount } from '../../../../../test/dom';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import type { Draft } from '../contracts';
import { createMemoryDraftStore } from '../drafts/memory-drafts';
import { DraftStoreContext } from './OrderScreen';
import { Held } from './Held';

// 02b-TK C2-5 (02b v1.0.24 §8 Held; frame HeldDrawer; 02b-tk CHANGES §3 "Held: per counter"; ruling R3): the held
// drafts of a device are shared by everyone signed in on it, with who held them and when; the customer's name and phone
// masked for anyone without view-customer-contact.

const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

const T = Date.UTC(2026, 10, 24, 8, 16); // 1:16 PM hub time (UTC offset 5 h)
const base = aBranchConfig();
const config = { ...base, items: [...base.items, { ...base.items.find((i) => i.item_id === 'I2')!, item_id: 'I5', name: 'Naan', price_minor: 4_000 }] };

const draft = (o: Partial<Draft>): Draft => ({
  draft_id: 'D1',
  device_id: 'DV1',
  staff_id: 'ST1',
  order_type: 'takeaway',
  cart: { lines: [{ key: 'L1', item_id: 'I5', quantity: 2, options: [] }] },
  updated_at: T,
  held: true,
  ...o,
});

function shellWith(grants: Record<string, unknown> = {}) {
  return {
    device: { token: 'tok', id: 'DV1', type: 'cashier_kiosk' },
    live: createLiveBus(),
    api: { roster: async () => ({ ok: true, data: { staff: [{ staff_id: 'ST2', display_name: 'Zain', locked_until: null }], active_session: null } }) },
    config: { config: () => null, snapshot: () => config, subscribe: () => () => {} },
    orders: { seatingOrders: async () => ({ ok: true, data: { orders: [], total_minor: 0 } }) },
    permissions: createPermissions(grants as never),
    clock: { nowMs: () => T, utcOffsetMs: 5 * 3_600_000 },
    me: { staff_id: 'ST1', name: 'Sana' },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
}

async function seeded() {
  const drafts = createMemoryDraftStore();
  await drafts.put(draft({ draft_id: 'MINE', updated_at: T - 60_000 }));
  await drafts.put(draft({ draft_id: 'ZAIN', staff_id: 'ST2', cart: { lines: [{ key: 'L1', item_id: 'I5', quantity: 1, options: [] }], takeaway: { customer_name: 'Usman', phone: '03001234567' } } }));
  await drafts.put(draft({ draft_id: 'ZAIN_TABLE', staff_id: 'ST2', order_type: 'dine_in', seating_id: 'SE1', table_id: 'TB1' }));
  await drafts.put(draft({ draft_id: 'OTHER_DEVICE', device_id: 'DV2' }));
  return drafts;
}

function render(drafts: ReturnType<typeof createMemoryDraftStore>, shell: Shell) {
  const m = mount();
  m.render(
    <ShellContext.Provider value={shell}>
      <DraftStoreContext.Provider value={drafts}>
        <Held />
      </DraftStoreContext.Provider>
    </ShellContext.Provider>,
  );
  return m;
}

describe('[02b-TK C2-5] held drafts per device', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    nav.to = [];
  });

  it('[02b §8 Held; frame HeldDrawer] everyone on the device sees its held takeaways, with who held them and when; another\'s table order and another device\'s stay out', async () => {
    const m = render(await seeded(), shellWith());
    await flush();
    const rows = [...m.container.querySelectorAll('.ql')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('by Zain');
    expect(rows[0]!.textContent).toContain('held 1:16 PM');
    expect(rows[1]!.textContent).toContain('by Sana');
    expect(rows[1]!.textContent).toContain('held 1:15 PM');
    expect(m.text()).toContain('Everyone on this counter sees these.');
    m.unmount();
  });

  it('[R3] without view-customer-contact the name and phone are masked; with it they show as typed', async () => {
    const masked = render(await seeded(), shellWith());
    await flush();
    const first = masked.container.querySelector('.ql')!;
    expect(first.querySelector('b')!.textContent).toBe('Takeaway · U•••');
    expect(first.textContent).toContain('••• 4567');
    expect(first.textContent).not.toContain('Usman');
    expect(first.textContent).not.toContain('0300');
    masked.unmount();
    const open = render(await seeded(), shellWith({ 'view-customer-contact': { grant: 'allowed', scope: 'branch' } }));
    await flush();
    const row = open.container.querySelector('.ql')!;
    expect(row.querySelector('b')!.textContent).toBe('Takeaway · Usman');
    expect(row.textContent).toContain('03001234567');
    open.unmount();
  });

  it('[02b-TK C2-5] Resume of another person\'s held takeaway makes it the resumer\'s open draft and opens it', async () => {
    const drafts = await seeded();
    const m = render(drafts, shellWith());
    await flush();
    m.click(m.button('Resume', m.container.querySelector('.ql')!));
    await flush();
    expect(nav.to).toEqual(['/order/takeaway/ZAIN']);
    const mine = await drafts.list('DV1', 'ST1');
    expect(mine.find((d) => d.draft_id === 'ZAIN')).toMatchObject({ staff_id: 'ST1', held: false });
    m.unmount();
  });

  it('[02b-TK C2-5] Discard of another person\'s held takeaway drops it', async () => {
    const drafts = await seeded();
    const m = render(drafts, shellWith());
    await flush();
    m.click(m.button('Discard', m.container.querySelector('.ql')!));
    await flush();
    expect(m.container.querySelectorAll('.ql')).toHaveLength(1);
    expect((await drafts.listDevice!('DV1')).map((d) => d.draft_id).sort()).toEqual(['MINE', 'ZAIN_TABLE']);
    m.unmount();
  });
});
