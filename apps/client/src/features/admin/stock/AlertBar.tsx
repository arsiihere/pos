import { formatQuantity } from '@pos/domain';
import { Banner } from '../../../components/Banner';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { StockRow } from './badges';

// S46: the stock-tracked items at `low` (with what is left), then those at `out`; hidden when none.
export function AlertBar({ rows }: { rows: readonly StockRow[] }) {
  const tracked = rows.filter((r) => r.meta.is_stock_tracked);
  const low = tracked.filter((r) => r.item.level === 'low');
  const out = tracked.filter((r) => r.item.level === 'out');
  if (low.length === 0 && out.length === 0) return null;
  const parts: string[] = [];
  if (low.length > 0) {
    const names = low.map((r) => `${r.meta.name} ${formatQuantity(r.item.available, r.meta.stock_unit)}`).join(', ');
    parts.push(fill(t('admin_stock.alert.low'), { items: names }));
  }
  if (out.length > 0) parts.push(fill(t('admin_stock.alert.out'), { items: out.map((r) => r.meta.name).join(', ') }));
  return (
    <div data-alert-bar="">
      <Banner tone="warn" text={parts.join(' · ')} />
    </div>
  );
}
