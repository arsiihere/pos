import { formatQuantity, type Unit } from '@pos/domain';
import { saleUnitsAvailable } from '@pos/engine';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { hubTimeText, type HubClock } from '../../../app/hub-clock';
import { usePhone } from '../../../app/phone';
import { Chip, type ChipTone } from '../../../components/Chip';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
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

// A quantity with its unit word for a sentence: "3 kg", "8 pcs".
function withUnit(value: number, unit: Unit): string {
  const text = formatQuantity(value, unit);
  return unit === 'piece' ? `${text} ${t('quantity.pcs')}` : text;
}

// A formatted quantity as the frames draw it: the number, then the unit in small type. `.pos-list__num` keeps
// formatQuantity's text ("2.6 kg", "8"); a piece count gets "pcs" beside it unless `bare` (a dish's "12 left").
function Qty({ text, unit, bare = false }: { text: string; unit: Unit; bare?: boolean }) {
  const space = text.indexOf(' ');
  return (
    <>
      <span className="pos-list__num">
        {space < 0 ? text : text.slice(0, space)}
        {space >= 0 && <small>{text.slice(space)}</small>}
      </span>
      {unit === 'piece' && !bare && <small>{t('quantity.pcs')}</small>}
    </>
  );
}

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
  alerts = null,
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
  // B14: the low / out chips, shown between the filters and the rows (01a hand-off Main).
  alerts?: ReactNode;
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
    return [
      ...itemBadges(row, startedAt, clock).map((b) => (
        <Chip key={b.kind} tone={b.tone}>
          {b.text}
        </Chip>
      )),
      ...(row.meta.out_of_stock_behaviour === 'sold_out' ? [<Chip key="sold_out">{t('admin_stock.sold_out_when_0')}</Chip>] : []),
      ...(note !== undefined ? [<Chip key="note" tone={note.tone}>{note.text}</Chip>] : []),
    ];
  };
  const tags = (chips: ReactNode[]) => (chips.length === 0 ? null : <div className="pos-list__tags">{chips}</div>);

  // The chips a stock row carries: level, not counted / not used here, kept counts, a note, when it was counted.
  const stockChips = (row: StockRow) => {
    const { stock } = row;
    const id = row.meta.stock_item_id;
    const note = notes.get(id);
    const counted =
      stock.set_at === null
        ? null
        : fill(t(startedAt !== null && stock.set_at < startedAt ? 'admin_stock.counted_last_night' : 'admin_stock.set_at'), {
            time: hubTimeText(stock.set_at, clock.utcOffsetMs),
          });
    return [
      ...(stock.level === 'low' ? [<Chip key="low" tone="warn" icon="alert">{t('admin_stock.badge.low')}</Chip>] : []),
      ...(stock.level === 'out' ? [<Chip key="out" tone="danger" icon="x">{t('admin_stock.badge.out')}</Chip>] : []),
      ...stockBadges(row).map((b) => (
        <Chip key={b.kind} tone={b.tone} icon={b.kind === 'unused' ? 'info' : 'clock'}>
          {b.text}
        </Chip>
      )),
      ...(restored.has(id) ? [<Chip key="kept" tone="warn">{t('admin_stock.kept.not_saved_yet')}</Chip>] : []),
      ...(note !== undefined ? [<Chip key="note" tone={note.tone}>{note.text}</Chip>] : []),
      ...(counted !== null && !restored.has(id) ? [<small key="counted" className="pos-list__meta pos-ltr">{counted}</small>] : []),
    ];
  };

  // Count now: the input in the stock unit and Still right (shown once there is a count to confirm).
  const countField = (row: StockRow) => {
    const id = row.meta.stock_item_id;
    const value = drafts.has(id) ? (drafts.get(id) ?? null) : shownOnHand(row);
    return (
      <div className="pos-count pos-ltr" data-field="on_hand">
        <QuantityInput
          compact
          unit={row.meta.stock_unit}
          value={value}
          onChange={(v) => onEdit(id, v)}
          label={`${row.meta.name}: ${t('admin_stock.on_hand')}`}
        />
        {shownOnHand(row) !== null && (
          <button
            type="button"
            className="pos-count__same"
            aria-pressed={drafts.has(id) && drafts.get(id) === shownOnHand(row)}
            onClick={() => onConfirm(id)}
          >
            <Icon name="check" />
            <span className="pos-vh">{t('admin_stock.confirm')}</span>
          </button>
        )}
      </div>
    );
  };

  const addButton = (onClick: () => void, disabled = false) => (
    <button type="button" className="pos-btn" disabled={disabled} onClick={onClick}>
      <Icon name="plus" />
      {t('admin_stock.add')}
    </button>
  );

  const stockRow = (row: StockRow) => {
    const { meta, stock } = row;
    const id = meta.stock_item_id;
    const sub = [t(UNIT_WORD[meta.stock_unit]), meta.carries_over ? t('admin_stock.keeps_overnight') : null].filter((p) => p !== null).join(' · ');
    const left = formatQuantity(stock.available, meta.stock_unit);
    const hint = fill(t('admin_stock.left_hint'), { n: withUnit(stock.available, meta.stock_unit), m: withUnit(stock.reserved, meta.stock_unit) });
    return (
      <ListRow key={`stock:${id}`} touched={drafts.has(id)} attrs={{ 'data-stock-item-id': id, tabIndex: -1 }}>
        <div className="pos-list__name">
          <strong>{meta.name}</strong>
          <span>{sub}</span>
          {tags(stockChips(row))}
        </div>
        {countField(row)}
        {/* 01a hand-off CHANGES §2: "{n} on orders" sits in the Left to sell number's tooltip. */}
        {stock.reserved > 0 ? (
          <span className="pos-numhint">
            <button type="button" className="pos-numbtn" aria-label={hint} aria-describedby={`onorders-${id}`}>
              <Qty text={left} unit={meta.stock_unit} />
              <Icon name="info" />
            </button>
            <span className="pos-numhint__tip pos-ltr" role="tooltip" id={`onorders-${id}`}>
              {fill(t('admin_stock.on_orders'), { n: formatQuantity(stock.reserved, meta.stock_unit) })}
            </span>
          </span>
        ) : (
          <span className="pos-stock__left">
            <Qty text={left} unit={meta.stock_unit} />
          </span>
        )}
        <span className="pos-stock__add">
          <span className="pos-count pos-ltr" data-field="add">
            <QuantityInput
              compact
              showUnit={false}
              unit={meta.stock_unit}
              value={adds.get(id) ?? null}
              onChange={(v) => onAddEdit(id, v)}
              label={`${meta.name}: ${t('admin_stock.add_label')}`}
            />
          </span>
          {addButton(() => onAdd(id), (adds.get(id) ?? null) === null || adds.get(id) === 0)}
        </span>
        <span />
      </ListRow>
    );
  };

  // 01c §8: a drawer under its stock row, with the whole sale units the stock covers; the Selling switch
  // when its menu item is on this page (under `my_stations` a drawer may be another station's item).
  const drawerLeft = (row: StockRow, drawer: StockRow['drawers'][number]['drawer']) =>
    formatQuantity(saleUnitsAvailable(row.stock.available, drawer.quantity_per_sale_unit), drawer.sale_unit);

  const drawerRow = (row: StockRow, { drawer, row: item }: StockRow['drawers'][number]) => (
    <li
      key={`drawer:${row.meta.stock_item_id}:${drawer.item_id}`}
      data-item-id={drawer.item_id}
      className={`pos-list__row pos-list__row--dish${item !== null && !item.item.is_available ? ' is-muted' : ''}`}
    >
      <div className="pos-list__name">
        <strong>{drawer.name}</strong>
        {item !== null && tags(itemChips(item))}
      </div>
      <span />
      <span className="pos-stock__left">
        <Qty text={drawerLeft(row, drawer)} unit={drawer.sale_unit} bare />
        <small>{t('admin_stock.left')}</small>
      </span>
      <span />
      {item !== null ? selling(item) : <span />}
    </li>
  );

  const itemRow = (row: ItemRow) => (
    <ListRow key={`item:${row.meta.item_id}`} muted={!row.item.is_available} attrs={{ 'data-item-id': row.meta.item_id, tabIndex: -1 }}>
      <div className="pos-list__name">
        <strong>{row.meta.name}</strong>
        <span>{row.meta.category_name}</span>
        {tags(itemChips(row))}
      </div>
      <span />
      <span />
      <span />
      {selling(row)}
    </ListRow>
  );

  // Phone (StockPhone, HubStockPhone): one card per stock item, its dishes under it with their switches.
  // The sub line: level, what is left and on orders; quantities isolated so an Urdu line keeps them whole.
  const phoneLine = (row: StockRow) => {
    const { meta, stock } = row;
    const level =
      stock.level === 'low'
        ? t('admin_stock.badge.low')
        : stock.level === 'out'
          ? t('admin_stock.badge.out')
          : stock.level === 'not_counted'
            ? t('admin_stock.badge.not_counted')
            : null;
    const [ordersLead, ordersTail] = t('admin_stock.on_orders').split('{n}');
    const parts: ReactNode[] = [
      ...(level === null ? [] : [level]),
      ...(stock.level === 'not_counted'
        ? []
        : [
            <>
              <bdi>{withUnit(stock.available, meta.stock_unit)}</bdi> {t('admin_stock.left')}
            </>,
          ]),
      ...(stock.reserved > 0
        ? [
            <>
              {ordersLead}
              <bdi>{withUnit(stock.reserved, meta.stock_unit)}</bdi>
              {ordersTail}
            </>,
          ]
        : []),
    ];
    return parts.map((part, i) => (
      <Fragment key={i}>
        {i > 0 && ' · '}
        {part}
      </Fragment>
    ));
  };

  const stockCard = (row: StockRow) => {
    const { meta } = row;
    const id = meta.stock_item_id;
    const chips = stockChips(row).filter((c) => c.key !== 'low' && c.key !== 'out' && c.key !== 'not_counted');
    return (
      <li key={`stock:${id}`} className={`pos-pcard${drafts.has(id) ? ' is-touched' : ''}`} data-stock-item-id={id} tabIndex={-1}>
        <div className="pos-pcard__top">
          <div>
            <strong>{meta.name}</strong>
            <span className="sub">{phoneLine(row)}</span>
          </div>
        </div>
        {tags(chips)}
        <div className="pos-pcard__count">
          {countField(row)}
          {addButton(() => setSheet(id))}
        </div>
        {row.drawers.map(({ drawer, row: item }) => (
          <div key={drawer.item_id} className="pos-prow pos-pcard__dish" data-item-id={drawer.item_id}>
            <div className="pos-list__name">
              <strong>{drawer.name}</strong>
              <span className="pos-stock__left">
                <Qty text={drawerLeft(row, drawer)} unit={drawer.sale_unit} bare />
                <small>{t('admin_stock.left')}</small>
              </span>
              {item !== null && tags(itemChips(item))}
            </div>
            {item !== null && selling(item)}
          </div>
        ))}
      </li>
    );
  };

  const itemCard = (row: ItemRow) => (
    <li key={`item:${row.meta.item_id}`} className="pos-pcard" data-item-id={row.meta.item_id} tabIndex={-1}>
      <div className="pos-prow">
        <div className="pos-list__name">
          <strong>{row.meta.name}</strong>
          <span>{row.meta.category_name}</span>
        </div>
        {selling(row)}
      </div>
      {tags(itemChips(row))}
    </li>
  );

  return (
    <div className="pos-stock">
      <div className="pos-stock__bar">
        <Segmented
          label={t('admin_stock.filter')}
          value={level}
          onChange={setLevel}
          block={phone}
          options={[
            { value: 'to_count', label: t('admin_stock.filter.to_count'), count: count('to_count') },
            { value: 'low_out', label: t('admin_stock.filter.low_out'), count: count('low_out') },
            { value: 'off', label: t('admin_stock.filter.off'), count: count('off') },
            { value: 'all', label: t('admin_stock.filter.all'), count: count('all') },
          ]}
        />
        <span className="pos-stock__find">
          <label className="pos-input-affix">
            <span>
              <Icon name="search" />
            </span>
            <input
              className="pos-input"
              type="search"
              aria-label={t('admin_stock.search')}
              placeholder={t('admin_stock.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
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
        </span>
      </div>
      {alerts}
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
      {(shownStock.length > 0 || shownItems.length > 0) &&
        (phone ? (
          <ul className="pos-stock__cards">
            {shownStock.map(stockCard)}
            {shownItems.map(itemCard)}
          </ul>
        ) : (
          <List
            preset="stock"
            head={[
              t('admin_stock.col.stock_item'),
              t('admin_stock.on_hand'),
              t('admin_stock.available_label'),
              t('admin_stock.col.add'),
              t('admin_stock.col.selling'),
            ]}
          >
            {shownStock.flatMap((row) => [stockRow(row), ...row.drawers.map((d) => drawerRow(row, d))])}
            {shownItems.map(itemRow)}
          </List>
        ))}
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
