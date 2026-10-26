import { formatQuantity } from '@pos/domain';
import { Chip } from '../../../components/Chip';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { StockRow } from './badges';

// S46 (01a-B14): one chip per item at `low` (with what is left), then those at `out`; a tap scrolls to
// and focuses the row. Hidden when none.
export function AlertBar({ rows, onPick }: { rows: readonly StockRow[]; onPick: (itemId: string) => void }) {
  const tracked = rows.filter((r) => r.meta.is_stock_tracked);
  const low = tracked.filter((r) => r.item.level === 'low');
  const out = tracked.filter((r) => r.item.level === 'out');
  if (low.length === 0 && out.length === 0) return null;
  return (
    <div className="pos-row" data-alert-bar="">
      {low.map((r) => (
        <Chip key={r.meta.item_id} tone="warn" onClick={() => onPick(r.meta.item_id)}>
          {fill(t('admin_stock.alert.low'), { items: `${r.meta.name} ${formatQuantity(r.item.available, r.meta.stock_unit)}` })}
        </Chip>
      ))}
      {out.map((r) => (
        <Chip key={r.meta.item_id} tone="danger" onClick={() => onPick(r.meta.item_id)}>
          {fill(t('admin_stock.alert.out'), { items: r.meta.name })}
        </Chip>
      ))}
    </div>
  );
}
