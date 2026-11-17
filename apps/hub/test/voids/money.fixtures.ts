// Lane T1 (04 §10 #40–#49) helpers shared by money.int.test.ts and money.property.int.test.ts. Test-only: a menu that
// adds 02b test 37's deals (family 320 000 with 4 naan parts, a kg deal with a g part) plus a deal whose part shares
// leave a remainder, and readers of the `orders` projection. Every row still comes from real events (fixtures.ts).
import type { BranchConfig, ConfigItem } from '@pos/events';
import type { LineView } from '../../src/orders/contracts';
import { orderLines } from '../../src/orders/exports';
import type { TestHub } from '../helpers/test-hub';
import { FX, openDay, post, startVoids, voidsMenu, VX, type Reply, type Who } from './fixtures';

export const MX = {
  /** 02b #37's family deal: 320 000; part FP_MAIN 1 × naan, part FP_NAAN 4 × naan (weights 3 000 : 12 000) */
  family: 'D_FAMILY',
  familyParts: ['FP_MAIN', 'FP_NAAN'] as const,
  /** 02b #37's kg deal: 250 000; part KP_MAIN 1 000 g of I_KG, part KP_NAAN 2 × naan */
  kgDeal: 'D_KG',
  kgParts: ['KP_MAIN', 'KP_NAAN'] as const,
  /** g item, not weighed at the counter: price per kg 200 000 */
  kg: 'I_KG',
  /** 100 001 over weights 3 000 : 9 000 → part A 25 000, part B 75 001 (3 units: 25 000, 25 000, 25 001 — #44) */
  odd: 'D_ODD',
  oddParts: ['OP_A', 'OP_B'] as const,
} as const;

/** voidsMenu() plus MX. */
export function moneyMenu(): BranchConfig {
  const menu = voidsMenu();
  const karahi = menu.items.find((i) => i.item_id === FX.piece)!;
  const kg: ConfigItem = { ...karahi, item_id: MX.kg, name: 'Karahi kg', sort_order: 30, sale_unit: 'g', requires_weighing: false, price_minor: 200_000, stock_draws: [], modifier_group_ids: [] };
  const naan = (deal_part_id: string, quantity: number, sort_order: number) => ({ deal_part_id, quantity, sort_order, choices: [{ item_id: FX.naan, extra_price_minor: 0, sort_order: 0 }] });
  const base = menu.deals[0]!;
  return {
    ...menu,
    items: [...menu.items, kg],
    deals: [
      ...menu.deals,
      { ...base, deal_id: MX.family, name: 'Family', price_minor: 320_000, parts: [naan(MX.familyParts[0], 1, 0), naan(MX.familyParts[1], 4, 1)] },
      {
        ...base,
        deal_id: MX.kgDeal,
        name: 'Kg deal',
        price_minor: 250_000,
        parts: [{ deal_part_id: MX.kgParts[0], quantity: 1000, sort_order: 0, choices: [{ item_id: MX.kg, extra_price_minor: 0, sort_order: 0 }] }, naan(MX.kgParts[1], 2, 1)],
      },
      { ...base, deal_id: MX.odd, name: 'Odd deal', price_minor: 100_001, parts: [naan(MX.oddParts[0], 1, 0), naan(MX.oddParts[1], 3, 1)] },
    ],
  };
}

/** startVoids (voidsDirectory: Manager allowed, Cashier / Order taker ask the Manager) with moneyMenu()'s day open. */
export async function startMoney(): Promise<TestHub> {
  const hub = await startVoids({ open: false });
  openDay(hub, { menu: moneyMenu(), stock: { [FX.stock]: 0, [VX.naanStock]: 0 } });
  return hub;
}

/** The order's lines as the `orders` projection reads them (02b orderLines: billed_minor, live_units). */
export function linesOf(hub: TestHub, order_id: string): Map<string, LineView> {
  return new Map((orderLines(hub.deps.db, [order_id]).get(order_id) ?? []).map((l) => [l.order_item_id, l]));
}

export type VoidLine = { order_item_id: string; units?: number; disposition: 'moved' | 'wastage' | 'staff_meal' | 'other' };

export function voidItems(hub: TestHub, who: Who, order_id: string, lines: VoidLine[], o: { reason_code?: string; note?: string | null; disposition_note?: string | null } = {}): Promise<Reply> {
  return post(hub, who, 'void-items', 'VoidItems', {
    order_id,
    reason_code: o.reason_code ?? 'customer_changed_mind',
    note: o.note ?? null,
    disposition_note: o.disposition_note ?? (lines.some((l) => l.disposition === 'other') ? 'given away' : null),
    lines,
  });
}

export function compLine(hub: TestHub, who: Who, order_item_id: string, units: number): Promise<Reply> {
  return post(hub, who, 'comp-line', 'CompLine', { order_item_id, units, reason_code: 'guest', note: 'regular' });
}

export function removeItems(hub: TestHub, who: Who, order_id: string, lines: Array<{ order_item_id: string; units?: number }>): Promise<Reply> {
  return post(hub, who, 'remove-items', 'RemoveItems', { order_id, lines });
}

export function setWeight(hub: TestHub, who: Who, order_item_id: string, quantity: number): Promise<Reply> {
  return post(hub, who, 'set-line-weight', 'SetLineWeight', { order_item_id, quantity });
}

/** Σ of one payload field over a reply's events of one type. */
export const sumOf = (r: Reply, type: string, field: string): number =>
  r.events.filter((e) => e.event_type === type).reduce((a, e) => a + ((e.payload[field] as number | undefined) ?? 0), 0);
