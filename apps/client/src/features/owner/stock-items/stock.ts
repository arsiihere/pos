import { formatQuantity } from '@pos/domain';
import type { CloudAdmin, Station, StockDrawer, StockUnit } from '../../../api/cloud-admin';
import { t } from '../../../i18n';

// 01c-S06, S07: the stations of each of the owner's branches, read once per view (one §6.8 GET per branch;
// a failed read leaves that branch's stations unnamed).
export type StationsByBranch = ReadonlyMap<string, readonly Station[]>;

export async function loadStations(api: CloudAdmin, branchIds: readonly string[]): Promise<StationsByBranch> {
  const replies = await Promise.all(branchIds.map((id) => api.listStations(id)));
  return new Map(branchIds.map((id, i) => {
    const reply = replies[i];
    return [id, reply?.ok === true ? reply.data.stations : []];
  }));
}

// "Counted in": piece / g / ml on the form (Segmented), "pieces" in the list column (StockItems frame).
export function unitWord(unit: StockUnit): string {
  return unit === 'piece' ? t('quantity.pieces') : t(`stock_unit.${unit}`);
}

export function unitOption(unit: StockUnit): string {
  return t(`stock_unit.${unit}`);
}

// A drawer's amount, in the stock item's unit (01a S44: kg / L for g / ml).
export function drawerText(drawer: StockDrawer, unit: StockUnit): string {
  return `${drawer.variant_name ?? drawer.name} ${formatQuantity(drawer.quantity_per_sale_unit, unit)}`;
}

// The threshold input shows the number without the kg / L word (the affix shows it).
export function quantityInput(n: number, unit: StockUnit): string {
  return formatQuantity(n, unit).replace(/ (kg|L)$/, '');
}

export function quantityAffix(unit: StockUnit): string {
  return unit === 'piece' ? t('quantity.pcs') : unit === 'g' ? t('quantity.kg') : t('quantity.l');
}
