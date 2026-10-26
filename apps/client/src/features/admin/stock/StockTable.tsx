import { formatQuantity } from '@pos/domain';
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
import { rowBadges, type StockRow } from './badges';

// §8.2 (01a-S11, B15, B17): the filters and one row per item in config order: name with its badges,
// Count with Still right, Left to sell with what is on orders, Add (inline on a tablet, a sheet on a
// phone) and the Selling switch. "Available" is not a word on this page (S54 a).
// S47: a window boundary emits no event, so the hours badges are re-evaluated each minute.
export const HOURS_TICK_MS = 60_000;

export type Level = 'to_count' | 'low_out' | 'off' | 'all';

// §8.2: the count shown in a row. A count in another unit than the day's is not valid (S41), so the
// input starts empty instead of reading 4 pieces as 4 g.
export function shownOnHand({ meta, item }: StockRow): number | null {
  return item.unit === meta.stock_unit && item.set_at !== null ? item.on_hand : null;
}

// Not counted in the open day (or never): what the morning count still has to do.
export function toCount(row: StockRow, startedAt: number | null): boolean {
  return row.meta.is_stock_tracked && (row.item.set_at === null || startedAt === null || row.item.set_at < startedAt);
}

function matches(row: StockRow, level: Level, startedAt: number | null): boolean {
  if (level === 'to_count') return toCount(row, startedAt);
  if (level === 'low_out') return row.meta.is_stock_tracked && (row.item.level === 'low' || row.item.level === 'out');
  if (level === 'off') return !row.item.is_available;
  return true;
}

export interface RowNote {
  tone: ChipTone;
  text: string;
}

const UNIT_WORD = { piece: 'admin_stock.unit.piece', g: 'admin_stock.unit.g', ml: 'admin_stock.unit.ml' } as const;

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
  notes = new Map(),
  restored = new Set(),
  focusId = null,
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
  onAdd?: (itemId: string, quantity?: number) => void;
  notes?: ReadonlyMap<string, RowNote>;
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

  // B14: a chip tap shows its row (all levels) and focuses its count, or the row itself.
  useEffect(() => {
    if (focusId === null) return;
    setLevel('all');
    setQuery('');
    setCategory('');
    const timer = setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`[data-item-id="${focusId.id}"]`);
      row?.scrollIntoView?.({ block: 'center' });
      (row?.querySelector<HTMLElement>('input') ?? row)?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [focusId]);

  // S48: search and category filter are client-side, over items_meta.
  // v1.0.2: one option per category, labelled with its name.
  const categories = [...new Map(rows.map((r) => [r.meta.category_id, r.meta.category_name])).entries()];
  const needle = query.trim().toLowerCase();
  const filtered = rows.filter(
    (r) => (needle === '' || r.meta.name.toLowerCase().includes(needle)) && (category === '' || r.meta.category_id === category),
  );
  const count = (l: Level) => filtered.filter((r) => matches(r, l, startedAt)).length;
  const shown = filtered.filter((r) => matches(r, level, startedAt));
  const sheetRow = sheet === null ? undefined : rows.find((r) => r.meta.item_id === sheet);

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
      {rows.length === 0 && <p>{t('admin_stock.empty')}</p>}
      {rows.length > 0 && shown.length === 0 && (
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
      {shown.length > 0 && (
        <List
          preset={phone ? 'stack' : 'stock'}
          head={
            phone
              ? undefined
              : [t('admin_stock.col.item'), t('admin_stock.on_hand'), t('admin_stock.available_label'), t('admin_stock.col.add'), t('admin_stock.col.selling')]
          }
        >
          {shown.map((row) => {
            const { meta, item } = row;
            const id = meta.item_id;
            const value = drafts.has(id) ? (drafts.get(id) ?? null) : shownOnHand(row);
            const note = notes.get(id);
            const counted =
              item.set_at === null
                ? null
                : fill(t(startedAt !== null && item.set_at < startedAt ? 'admin_stock.counted_last_night' : 'admin_stock.set_at'), {
                    time: hubTimeText(item.set_at, clock.utcOffsetMs),
                  });
            const sub = [
              meta.category_name,
              meta.is_stock_tracked ? t(UNIT_WORD[meta.stock_unit]) : null,
              meta.carries_over ? t('admin_stock.keeps_overnight') : null,
            ]
              .filter((p) => p !== null && p !== '')
              .join(' · ');
            return (
              <ListRow key={id} touched={drafts.has(id)} attrs={{ 'data-item-id': id, tabIndex: -1 }}>
                <span className="pos-list__name">
                  <strong>{meta.name}</strong>
                  <span>{sub}</span>
                  <span className="pos-row">
                    {meta.is_stock_tracked && item.level === 'low' && <Chip tone="warn">{t('admin_stock.badge.low')}</Chip>}
                    {meta.is_stock_tracked && item.level === 'out' && <Chip tone="danger">{t('admin_stock.badge.out')}</Chip>}
                    {rowBadges(row, startedAt, clock).map((b) => (
                      <Chip key={b.kind} tone={b.tone}>
                        {b.text}
                      </Chip>
                    ))}
                    {meta.out_of_stock_behaviour === 'sold_out' && <Chip>{t('admin_stock.sold_out_when_0')}</Chip>}
                    {restored.has(id) && <Chip tone="info">{t('admin_stock.kept.not_saved_yet')}</Chip>}
                    {note !== undefined && <Chip tone={note.tone}>{note.text}</Chip>}
                    {meta.is_stock_tracked && counted !== null && !restored.has(id) && <small className="pos-ltr">{counted}</small>}
                  </span>
                </span>
                {meta.is_stock_tracked ? (
                  <>
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
                      <span className="pos-list__num pos-ltr">
                        <small>{t('admin_stock.available_label')}</small> {formatQuantity(item.available, meta.stock_unit)}
                      </span>
                      <small className="pos-ltr">
                        {fill(t('admin_stock.on_orders'), { n: formatQuantity(item.reserved, meta.stock_unit) })}
                      </small>
                    </span>
                    {phone ? (
                      <button type="button" className="pos-btn" onClick={() => setSheet(id)}>
                        {t('admin_stock.add')}
                      </button>
                    ) : (
                      <span className="pos-row">
                        <span className="pos-count pos-ltr" data-field="add">
                          <QuantityInput compact unit={meta.stock_unit} value={adds.get(id) ?? null} onChange={(v) => onAddEdit(id, v)} label={t('admin_stock.add_label')} />
                        </span>
                        <button
                          type="button"
                          className="pos-btn"
                          disabled={(adds.get(id) ?? null) === null || adds.get(id) === 0}
                          onClick={() => onAdd(id)}
                        >
                          {t('admin_stock.add')}
                        </button>
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span />
                    <span />
                    <span />
                  </>
                )}
                <Switch
                  checked={item.is_available}
                  label={t(item.is_available ? 'admin_stock.available' : 'admin_stock.off')}
                  name={`${t('admin_stock.col.selling')}: ${meta.name}`}
                  onChange={(next) => onToggle(id, next)}
                />
              </ListRow>
            );
          })}
        </List>
      )}
      {sheetRow !== undefined && (
        <AddSheet
          row={sheetRow}
          onClose={() => setSheet(null)}
          onAdd={(quantity) => {
            setSheet(null);
            onAdd(sheetRow.meta.item_id, quantity);
          }}
        />
      )}
    </div>
  );
}
