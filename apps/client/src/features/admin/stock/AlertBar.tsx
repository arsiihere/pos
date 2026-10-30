import { formatQuantity } from '@pos/domain';
import { Chip } from '../../../components/Chip';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { StockRow } from './badges';

// S46 (01a-B14; 01c §8): one chip per stock item at `low` (with what is left), then those at `out`; a tap
// scrolls to and focuses the row. Hidden when none.
export function AlertBar({ rows, onPick }: { rows: readonly StockRow[]; onPick: (stockItemId: string) => void }) {
  const low = rows.filter((r) => r.stock.level === 'low');
  const out = rows.filter((r) => r.stock.level === 'out');
  if (low.length === 0 && out.length === 0) return null;
  return (
    <div className="pos-row" data-alert-bar="">
      {low.map((r) => (
        <Chip key={r.meta.stock_item_id} tone="warn" icon="alert" onClick={() => onPick(r.meta.stock_item_id)}>
          {fill(t('admin_stock.alert.low'), { items: `${r.meta.name} ${formatQuantity(r.stock.available, r.meta.stock_unit)}` })}
        </Chip>
      ))}
      {out.map((r) => (
        <Chip key={r.meta.stock_item_id} tone="danger" icon="x" onClick={() => onPick(r.meta.stock_item_id)}>
          {fill(t('admin_stock.alert.out'), { items: r.meta.name })}
        </Chip>
      ))}
    </div>
  );
}
