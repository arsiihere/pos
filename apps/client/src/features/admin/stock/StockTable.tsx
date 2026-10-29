import { formatQuantity } from '@pos/domain';
import { saleUnitsAvailable } from '@pos/engine';
import { useEffect, useState } from 'react';
import { hubTimeText, type HubClock } from '../../../app/hub-clock';
import { usePhone } from '../../../app/phone';
import { Chip, type ChipTone } from '../../../components/Chip';
import { EmptyState } from '../../../components/EmptyState';
import { List, ListRow } from '../../../components/List';
import { QuantityInput } from '../../../components/QuantityInput';
import { Segmented } from '../../../components/Segmented';
import { Switch } from '../../../components/Switch';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import { AddSheet } from './AddSheet';
import { itemBadges, stockBadges, type ItemRow, type StockRow } from './badges';

// §8.2 (01a-S11, B15, B17; 01c §3.5.4, §8): the filters, then one row per stock item (name with its badges,
// Count with Still right, Left to sell with what is on orders, Add inline on a tablet or a sheet on a phone),
// its drawers listed under it (sale units available, the Selling switch), then the menu items no stock row
// lists (the Selling switch only). "Available" is not a word on this page (S54 a).
// S47: a window boundary emits no event, so the hours badges are re-evaluated each minute.
export const HOURS_TICK_MS = 60_000;

export type Level = 'to_count' | 'low_out' | 'off' | 'all';

// §8.2: the count shown in a row. A count in another unit than the day's is not valid (S41), so the
// input starts empty instead of reading 4 pieces as 4 g.
export function shownOnHand({ meta, stock }: StockRow): number | null {
  return stock.unit === meta.stock_unit && stock.set_at !== null ? stock.on_hand : null;
}

// Not counted in the open day (or never): what the morning count still has to do.
export function toCount(row: StockRow, startedAt: number | null): boolean {
  return row.stock.set_at === null || startedAt === null || row.stock.set_at < startedAt;
}

function stockMatches(row: StockRow, level: Level, startedAt: number | null): boolean {
  if (level === 'to_count') return toCount(row, startedAt);
  if (level === 'low_out') return row.stock.level === 'low' || row.stock.level === 'out';
  if (level === 'off') return row.drawers.some((d) => d.row !== null && !d.row.item.is_available);
  return true;
}

function itemMatches(row: ItemRow, level: Level): boolean {
  if (level === 'off') return !row.item.is_available;
  return level === 'all';
}

export interface RowNote {
  tone: ChipTone;
  text: string;
}

const UNIT_WORD = { piece: 'admin_stock.unit.piece', g: 'admin_stock.unit.g', ml: 'admin_stock.unit.ml' } as const;

export function StockTable({
  rows,
  items = [],
  startedAt,
  clock,
  drafts,
  onEdit,
  onConfirm,
  onToggle,
  adds = new Map(),
  onAddEdit = () => {},
  onAdd = () => {},
  notes = new Map(),
  itemNotes = new Map(),
  restored = new Set(),
  focusId = null,
}: {
  // 01c §8: the stock item rows (keyed by stock_item_id) and the menu items no stock row lists.
  rows: readonly StockRow[];
  items?: readonly ItemRow[];
  startedAt: number | null;
  clock: HubClock;
  drafts: ReadonlyMap<string, number | null>;
  onEdit: (stockItemId: string, value: number | null) => void;
  onConfirm: (stockItemId: string) => void;
  onToggle: (itemId: string, isAvailable: boolean) => void;
  // S45: the per-row Add field and its button (AddPrecookedStock for that stock item).
  adds?: ReadonlyMap<string, number | null>;
  onAddEdit?: (stockItemId: string, value: number | null) => void;
  onAdd?: (stockItemId: string, quantity?: number) => void;
  notes?: ReadonlyMap<string, RowNote>;
  // B17: per menu item (a switch that failed).
  itemNotes?: ReadonlyMap<string, RowNote>;
  restored?: ReadonlySet<string>;
  focusId?: { id: string } | null;
}) {
  const phone = usePhone();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState<Level>('all');
  const [sheet, setSheet] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), HOURS_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // B14: a chip tap shows its stock row (all levels) and focuses its count, or the row itself.
  useEffect(() => {
    if (focusId === null) return;
    setLevel('all');
    setQuery('');
    setCategory('');
    const timer = setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`[data-stock-item-id="${focusId.id}"]`);
      row?.scrollIntoView?.({ block: 'center' });
      (row?.querySelector<HTMLElement>('input') ?? row)?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [focusId]);

  // S48: search and category filter are client-side, over the rows. A stock row matches by its name or a
  // drawer's, and by its drawers' categories (v1.0.2: one option per category, labelled with its name).
  const listedItems = rows.flatMap((r) => r.drawers.flatMap((d) => (d.row === null ? [] : [d.row])));
  const categories = [...new Map([...listedItems, ...items].map((r) => [r.meta.category_id, r.meta.category_name])).entries()];
  const needle = query.trim().toLowerCase();
  const named = (name: string) => needle === '' || name.toLowerCase().includes(needle);
  const stockFiltered = rows.filter(
    (r) =>
      (named(r.meta.name) || r.drawers.some((d) => named(d.drawer.name))) &&
      (category === '' || r.drawers.some((d) => d.row?.meta.category_id === category)),
  );
  const itemFiltered = items.filter((r) => named(r.meta.name) && (category === '' || r.meta.category_id === category));
  const count = (l: Level) =>
    stockFiltered.filter((r) => stockMatches(r, l, startedAt)).length + itemFiltered.filter((r) => itemMatches(r, l)).length;
  const shownStock = stockFiltered.filter((r) => stockMatches(r, level, startedAt));
  const shownItems = itemFiltered.filter((r) => itemMatches(r, level));
  const empty = rows.length === 0 && items.length === 0;
  const sheetRow = sheet === null ? undefined : rows.find((r) => r.meta.stock_item_id === sheet);

  const selling = (row: ItemRow) => (
    <Switch
      checked={row.item.is_available}
      label={t(row.item.is_available ? 'admin_stock.available' : 'admin_stock.off')}
      name={`${t('admin_stock.col.selling')}: ${row.meta.name}`}
      onChange={(next) => onToggle(row.meta.item_id, next)}
    />
  );

  // The chips a menu item's row carries: its hours or Off badge, sold out at 0, a failed switch.
  const itemChips = (row: ItemRow) => {
    const note = itemNotes.get(row.meta.item_id);
    return (
      <>
        {itemBadges(row, startedAt, clock).map((b) => (
          <Chip key={b.kind} tone={b.tone}>
            {b.text}
          </Chip>
        ))}
        {row.meta.out_of_stock_behaviour === 'sold_out' && <Chip>{t('admin_stock.sold_out_when_0')}</Chip>}
        {note !== undefined && <Chip tone={note.tone}>{note.text}</Chip>}
      </>
    );
  };

  const stockRow = (row: StockRow) => {
    const { meta, stock } = row;
    const id = meta.stock_item_id;
    const value = drafts.has(id) ? (drafts.get(id) ?? null) : shownOnHand(row);
    const note = notes.get(id);
    const counted =
      stock.set_at === null
        ? null
        : fill(t(startedAt !== null && stock.set_at < startedAt ? 'admin_stock.counted_last_night' : 'admin_stock.set_at'), {
            time: hubTimeText(stock.set_at, clock.utcOffsetMs),
          });
    const sub = [t(UNIT_WORD[meta.stock_unit]), meta.carries_over ? t('admin_stock.keeps_overnight') : null].filter((p) => p !== null).join(' · ');
    return (
      <ListRow key={`stock:${id}`} touched={drafts.has(id)} attrs={{ 'data-stock-item-id': id, tabIndex: -1 }}>
        <span className="pos-list__name">
          <strong>{meta.name}</strong>
          <span>{sub}</span>
          <span className="pos-row">
            {stock.level === 'low' && <Chip tone="warn">{t('admin_stock.badge.low')}</Chip>}
            {stock.level === 'out' && <Chip tone="danger">{t('admin_stock.badge.out')}</Chip>}
            {stockBadges(row).map((b) => (
              <Chip key={b.kind} tone={b.tone}>
                {b.text}
              </Chip>
            ))}
            {restored.has(id) && <Chip tone="info">{t('admin_stock.kept.not_saved_yet')}</Chip>}
            {note !== undefined && <Chip tone={note.tone}>{note.text}</Chip>}
            {counted !== null && !restored.has(id) && <small className="pos-ltr">{counted}</small>}
          </span>
        </span>
        <div className="pos-count pos-ltr" data-field="on_hand">
          <QuantityInput compact unit={meta.stock_unit} value={value} onChange={(v) => onEdit(id, v)} label={t('admin_stock.on_hand')} />
          <button
            type="button"
            className="pos-count__same"
            aria-pressed={drafts.has(id) && drafts.get(id) === shownOnHand(row)}
            disabled={shownOnHand(row) === null}
            onClick={() => onConfirm(id)}
          >
            {t('admin_stock.confirm')}
          </button>
        </div>
        <span className="pos-stack">
          {/* The column head says Left to sell; a phone row has no head, so it says it itself. */}
          {phone && <small>{t('admin_stock.available_label')}</small>}
          <span className="pos-list__num pos-ltr">{formatQuantity(stock.available, meta.stock_unit)}</span>
          <small className="pos-ltr">{fill(t('admin_stock.on_orders'), { n: formatQuantity(stock.reserved, meta.stock_unit) })}</small>
        </span>
        {phone ? (
          <button type="button" className="pos-btn" onClick={() => setSheet(id)}>
            {t('admin_stock.add')}
          </button>
        ) : (
          <span className="pos-row">
            <span className="pos-count pos-ltr" data-field="add">
              <QuantityInput
                compact
                showUnit={false}
                unit={meta.stock_unit}
                value={adds.get(id) ?? null}
                onChange={(v) => onAddEdit(id, v)}
                label={t('admin_stock.add_label')}
              />
            </span>
            <button type="button" className="pos-btn" disabled={(adds.get(id) ?? null) === null || adds.get(id) === 0} onClick={() => onAdd(id)}>
              {t('admin_stock.add')}
            </button>
          </span>
        )}
        <span />
      </ListRow>
    );
  };

  // 01c §8: a drawer under its stock row, with the whole sale units the stock covers; the Selling switch
  // when its menu item is on this page (under `my_stations` a drawer may be another station's item).
  const drawerRow = (row: StockRow, { drawer, row: item }: StockRow['drawers'][number]) => (
    <ListRow key={`drawer:${row.meta.stock_item_id}:${drawer.item_id}`} attrs={{ 'data-item-id': drawer.item_id }}>
      <span className="pos-list__name">
        <span>{drawer.name}</span>
        <span className="pos-row">{item !== null && itemChips(item)}</span>
      </span>
      <span />
      <span className="pos-stack">
        {phone && <small>{t('admin_stock.available_label')}</small>}
        <span className="pos-list__num pos-ltr">
          {formatQuantity(saleUnitsAvailable(row.stock.available, drawer.quantity_per_sale_unit), drawer.sale_unit)}
        </span>
      </span>
      <span />
      {item !== null ? selling(item) : <span />}
    </ListRow>
  );

  const itemRow = (row: ItemRow) => (
    <ListRow key={`item:${row.meta.item_id}`} attrs={{ 'data-item-id': row.meta.item_id, tabIndex: -1 }}>
      <span className="pos-list__name">
        <strong>{row.meta.name}</strong>
        <span>{row.meta.category_name}</span>
        <span className="pos-row">{itemChips(row)}</span>
      </span>
      <span />
      <span />
      <span />
      {selling(row)}
    </ListRow>
  );

  return (
    <div className="pos-stack">
      <div className="pos-row">
        <Segmented
          label={t('admin_stock.filter')}
          value={level}
          onChange={setLevel}
          options={[
            { value: 'to_count', label: t('admin_stock.filter.to_count'), count: count('to_count') },
            { value: 'low_out', label: t('admin_stock.filter.low_out'), count: count('low_out') },
            { value: 'off', label: t('admin_stock.filter.off'), count: count('off') },
            { value: 'all', label: t('admin_stock.filter.all'), count: count('all') },
          ]}
        />
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
          {categories.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>
      {empty && <p>{t('admin_stock.empty')}</p>}
      {!empty && shownStock.length === 0 && shownItems.length === 0 && (
        <EmptyState
          title={needle === '' ? t('admin_stock.none_here') : fill(t('admin_stock.no_match'), { q: query.trim() })}
          body={t('admin_stock.no_match_body')}
        >
          <button
            type="button"
            className="pos-btn"
            onClick={() => {
              setQuery('');
              setLevel('all');
              setCategory('');
            }}
          >
            {t('admin_stock.clear_search')}
          </button>
        </EmptyState>
      )}
      {(shownStock.length > 0 || shownItems.length > 0) && (
        <List
          preset={phone ? 'stack' : 'stock'}
          head={
            phone
              ? undefined
              : [t('admin_stock.col.item'), t('admin_stock.on_hand'), t('admin_stock.available_label'), t('admin_stock.col.add'), t('admin_stock.col.selling')]
          }
        >
          {shownStock.flatMap((row) => [stockRow(row), ...row.drawers.map((d) => drawerRow(row, d))])}
          {shownItems.map(itemRow)}
        </List>
      )}
      {sheetRow !== undefined && (
        <AddSheet
          row={sheetRow}
          onClose={() => setSheet(null)}
          onAdd={(quantity) => {
            setSheet(null);
            onAdd(sheetRow.meta.stock_item_id, quantity);
          }}
        />
      )}
    </div>
  );
}
