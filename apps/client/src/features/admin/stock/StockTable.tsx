import { formatQuantity } from '@pos/domain';
import { useEffect, useState } from 'react';
import { hubTimeText, type HubClock } from '../../../app/hub-clock';
import { Banner } from '../../../components/Banner';
import { QuantityInput } from '../../../components/QuantityInput';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import { rowBadges, type StockRow } from './badges';

// S47: a window boundary emits no event, so the hours badges are re-evaluated each minute.
export const HOURS_TICK_MS = 60_000;

// §8.2: the count shown in a row. A count in another unit than the day's is not valid (S41), so the
// input starts empty instead of reading 4 pieces as 4 g.
export function shownOnHand({ meta, item }: StockRow): number | null {
  return item.unit === meta.stock_unit && item.set_at !== null ? item.on_hand : null;
}

export function StockTable({
  rows,
  startedAt,
  clock,
  drafts,
  onEdit,
  onConfirm,
  onToggle,
  adds = new Map(),
  onAddEdit = () => {},
  onAdd = () => {},
}: {
  rows: readonly StockRow[];
  startedAt: number | null;
  clock: HubClock;
  drafts: ReadonlyMap<string, number | null>;
  onEdit: (itemId: string, value: number | null) => void;
  onConfirm: (itemId: string) => void;
  onToggle: (itemId: string, isAvailable: boolean) => void;
  // S45: the per-row Add field and its button (AddPrecookedStock for that row).
  adds?: ReadonlyMap<string, number | null>;
  onAddEdit?: (itemId: string, value: number | null) => void;
  onAdd?: (itemId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), HOURS_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // S48: search and category filter are client-side, over items_meta.
  const categories = [...new Set(rows.map((r) => r.meta.category_id))];
  const needle = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) => (needle === '' || r.meta.name.toLowerCase().includes(needle)) && (category === '' || r.meta.category_id === category),
  );

  return (
    <div className="pos-stack">
      <div className="pos-row">
        <input
          className="pos-input"
          type="search"
          aria-label={t('admin_stock.search')}
          placeholder={t('admin_stock.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="pos-select"
          aria-label={t('admin_stock.category')}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">{t('admin_stock.all_categories')}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {rows.length === 0 && <p>{t('admin_stock.empty')}</p>}
      <ul className="pos-stack">
        {shown.map((row) => {
          const { meta, item } = row;
          const id = meta.item_id;
          const value = drafts.has(id) ? (drafts.get(id) ?? null) : shownOnHand(row);
          return (
            <li key={id} className="pos-card pos-stack" data-item-id={id}>
              <div className="pos-row">
                <strong>{meta.name}</strong>
                <button
                  type="button"
                  className="pos-btn"
                  aria-pressed={item.is_available}
                  onClick={() => !item.is_available && onToggle(id, true)}
                >
                  {t('admin_stock.available')}
                </button>
                <button
                  type="button"
                  className="pos-btn"
                  aria-pressed={!item.is_available}
                  onClick={() => item.is_available && onToggle(id, false)}
                >
                  {t('admin_stock.off')}
                </button>
              </div>
              {meta.is_stock_tracked && (
                <div className="pos-row">
                  <span className="pos-field__label">{t('admin_stock.on_hand')}</span>
                  <div data-field="on_hand">
                    <QuantityInput unit={meta.stock_unit} value={value} onChange={(v) => onEdit(id, v)} />
                  </div>
                  <button type="button" className="pos-btn" disabled={shownOnHand(row) === null} onClick={() => onConfirm(id)}>
                    {t('admin_stock.confirm')}
                  </button>
                  <span>
                    {t('admin_stock.reserved')} {formatQuantity(item.reserved, meta.stock_unit)}
                  </span>
                  <span>
                    {t('admin_stock.available_label')} {formatQuantity(item.available, meta.stock_unit)}
                  </span>
                  {item.set_at !== null && (
                    <span>{fill(t('admin_stock.set_at'), { time: hubTimeText(item.set_at, clock.utcOffsetMs) })}</span>
                  )}
                  {meta.out_of_stock_behaviour === 'sold_out' && <span>{t('admin_stock.sold_out_when_0')}</span>}
                  <span className="pos-field__label">{t('admin_stock.add_label')}</span>
                  <div data-field="add">
                    <QuantityInput unit={meta.stock_unit} value={adds.get(id) ?? null} onChange={(v) => onAddEdit(id, v)} />
                  </div>
                  <button
                    type="button"
                    className="pos-btn"
                    disabled={(adds.get(id) ?? null) === null || adds.get(id) === 0}
                    onClick={() => onAdd(id)}
                  >
                    {t('admin_stock.add')}
                  </button>
                </div>
              )}
              {rowBadges(row, startedAt, clock).map((b) => (
                <Banner key={b.kind} tone={b.tone} text={b.text} />
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
