import { formatQuantity } from '@pos/domain';
import type { Deal, MenuItem, StockUnit } from '../../../api/cloud-admin';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { quantityAffix } from '../stock-items/stock';

// 01c-S04, S05, S11 helpers: part quantities in the choices' sale unit (§3.3, V10), the "1 Full karahi + 4 Naan"
// parts line, and the 01c-B04 omission check (§8 "Omitted at a branch", m11).

export type SaleUnit = StockUnit;

// "sold by piece / weight / volume".
export function unitWord(unit: SaleUnit): string {
  return t(`deal.unit_${unit}`);
}

// "4 pieces", "0.5 kg" (01a S44: grams and millilitres read as kg and L).
export function quantityText(quantity: number, unit: SaleUnit): string {
  if (unit !== 'piece') return formatQuantity(quantity, unit);
  return fill(t(quantity === 1 ? 'deal.qty_piece' : 'deal.qty_pieces'), { n: String(quantity) });
}

// The quantity input's affix: pc / pcs / kg / L (DealForm frame).
export function partAffix(unit: SaleUnit, quantity: number | null): string {
  return unit === 'piece' && quantity === 1 ? t('deal.pc') : quantityAffix(unit);
}

// The quantity as typed: a whole number of pieces, or kg / L without the word (the affix shows it).
export function quantityInput(quantity: number, unit: SaleUnit): string {
  return unit === 'piece' ? String(quantity) : formatQuantity(quantity, unit).replace(/ (kg|L)$/, '');
}

// S04 "Parts": each part as its quantity and its first choice ("1 Full karahi + 4 Naan"); a choice the menu
// read did not return reads as "…".
export function partsLine(deal: Pick<Deal, 'parts'>, items: ReadonlyMap<string, MenuItem>): string {
  return [...deal.parts]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((part) => {
      const first = [...part.choices].sort((a, b) => a.sort_order - b.sort_order)[0];
      const item = first === undefined ? undefined : items.get(first.item_id);
      if (item === undefined) return `${part.quantity} …`;
      const qty = item.sale_unit === 'piece' ? String(part.quantity) : formatQuantity(part.quantity, item.sale_unit);
      return `${qty} ${item.name}`;
    })
    .join(' + ');
}

// 01c-B04 (§8, m11; test #115): for each branch where the deal is sold, the 1-based numbers of its parts that
// have no choice routed at that branch (computed from the §6.3 routes; call only after the last menu page).
export interface Omission {
  branchId: string;
  part: number;
}

export function omissions(deal: Pick<Deal, 'parts' | 'branches'>, items: ReadonlyMap<string, MenuItem>): Omission[] {
  const parts = [...deal.parts].sort((a, b) => a.sort_order - b.sort_order);
  return deal.branches
    .filter((b) => b.is_sold)
    .flatMap((b) =>
      parts.flatMap((part, i) =>
        part.choices.some((c) => items.get(c.item_id)?.routes.some((r) => r.branch_id === b.branch_id) === true)
          ? []
          : [{ branchId: b.branch_id, part: i + 1 }],
      ),
    );
}

export function omissionText(o: Omission, branchName: (id: string) => string): string {
  return fill(t('deals.omitted'), { branch: branchName(o.branchId), n: String(o.part) });
}
