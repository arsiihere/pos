import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Category, CloudAdmin, CloudResult, MenuItem, MenuPage, MenuQuery } from '../../../api/cloud-admin';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { t } from '../../../i18n';
import { errorText, isKeyMismatch, useIdempotencyKey } from '../form';
import { formatRupees } from '../money';
import { CategoryForm } from './CategoryForm';
import { ItemForm } from './ItemForm';

// §8.1 #/menu: tax classes, categories and items. Items come a page at a time (§6.11, S48): a search
// box sent 300 ms after typing stops, a category filter, an Active / Archived switch and Load more while
// next_cursor is set; pages are appended and de-duplicated by item_id (a rename across the cursor can
// repeat a row, review 2 nit 3). can_edit_tenant false → read-only with one info line (S8). An open item
// or category form replaces the list (one primary button per screen); closing it reloads the list.
export const SEARCH_DELAY_MS = 300;

type Status = NonNullable<MenuQuery['status']>;

const PERCENT_RE = /^[0-9]+(\.[0-9]{1,2})?$/;

function parseRateBp(text: string): number | null {
  const trimmed = text.trim();
  return PERCENT_RE.test(trimmed) ? Math.round(Number(trimmed) * 100) : null;
}

function formatRate(rateBp: number): string {
  return `${rateBp / 100} %`;
}

function appendUnique(rows: MenuItem[], more: MenuItem[]): MenuItem[] {
  const seen = new Set(rows.map((row) => row.item_id));
  return [...rows, ...more.filter((row) => !seen.has(row.item_id))];
}

function AddTaxClassForm({ api, onCreated }: { api: CloudAdmin; onCreated: () => void }) {
  const { key, renew } = useIdempotencyKey();
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const rateBp = parseRateBp(rate);
    if (rateBp === null) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await api.createTaxClass({ name: name.trim(), rate_bp: rateBp }, key);
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result.error));
      if (isKeyMismatch(result.error)) {
        renew();
        onCreated();
      }
      return;
    }
    renew();
    setName('');
    setRate('');
    onCreated();
  }

  return (
    <form className="pos-row" data-form="add-tax-class" noValidate onSubmit={(e) => void submit(e)}>
      <label className="pos-field">
        <span className="pos-field__label">{t('owner.menu.new_tax_class')}</span>
        <input className="pos-input" name="name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="pos-field">
        <span className="pos-field__label">{t('owner.menu.rate_percent')}</span>
        <input
          className="pos-input pos-input--mono"
          name="rate_percent"
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
      </label>
      {error !== null && <Banner tone="danger" text={error} />}
      <BusyButton busy={busy} type="submit">
        {t('owner.menu.add_tax_class')}
      </BusyButton>
    </form>
  );
}

export function MenuView({ api }: { api: CloudAdmin }) {
  const [menu, setMenu] = useState<Omit<MenuPage, 'items'> | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<Status>('active');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<
    { kind: 'item'; item: MenuItem | null } | { kind: 'category'; category: Category | null } | null
  >(null);
  // The route picker's branches: the owner's allowed branches (§6.14 routes only for those).
  const branchIds = useMemo(() => api.currentUser()?.allowed_branch_ids ?? [], [api]);
  // Only the latest request's answer is shown, so a slow older search never replaces a newer one.
  const latest = useRef(0);

  const query = useCallback(
    (cursor?: string): MenuQuery => ({
      ...(q === '' ? {} : { q }),
      ...(categoryId === '' ? {} : { category_id: categoryId }),
      status,
      ...(cursor === undefined ? {} : { cursor }),
    }),
    [q, categoryId, status],
  );

  const load = useCallback(async () => {
    const request = ++latest.current;
    const result = await api.getMenu(query());
    if (request !== latest.current) return;
    if (!result.ok) {
      setError(errorText(result.error));
      return;
    }
    const { items: first, ...rest } = result.data;
    setMenu(rest);
    setItems(appendUnique([], first));
  }, [api, query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const next = search.trim().slice(0, 60);
    if (next === q) return;
    const timer = setTimeout(() => setQ(next), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, q]);

  async function loadMore() {
    if (menu?.next_cursor == null || busy) return;
    const request = ++latest.current;
    setBusy(true);
    const result = await api.getMenu(query(menu.next_cursor));
    setBusy(false);
    if (request !== latest.current) return;
    if (!result.ok) {
      setError(errorText(result.error));
      return;
    }
    const { items: more, ...rest } = result.data;
    setMenu(rest);
    setItems((rows) => appendUnique(rows, more));
  }

  async function save(call: Promise<CloudResult<unknown>>) {
    setError(null);
    const result = await call;
    if (!result.ok) setError(errorText(result.error));
    await load();
  }

  const canEdit = menu?.can_edit_tenant === true;
  const categoryName = (id: string) => menu?.categories.find((c) => c.category_id === id)?.name ?? '';

  function closeForm(notice?: string | null) {
    setEditing(null);
    setError(notice ?? null);
    void load();
  }

  if (editing !== null && menu !== null && canEdit) {
    return (
      <section className="pos-stack">
        {editing.kind === 'item' ? (
          <ItemForm
            api={api}
            item={editing.item}
            taxClasses={menu.tax_classes}
            categories={menu.categories}
            branchIds={branchIds}
            onSaved={closeForm}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <CategoryForm
            api={api}
            category={editing.category}
            onSaved={closeForm}
            onCancel={() => setEditing(null)}
          />
        )}
      </section>
    );
  }

  return (
    <section className="pos-stack">
      <h1 className="title">{t('owner.menu.title')}</h1>
      {menu !== null && !canEdit && <Banner tone="info" text={t('owner.menu.read_only')} />}
      {error !== null && <Banner tone="danger" text={error} />}

      <h2 className="pos-field__label">{t('owner.menu.tax_classes')}</h2>
      <ul className="pos-stack">
        {menu?.tax_classes.map((taxClass) => {
          const archived = taxClass.archived_at !== null;
          return (
            <li key={taxClass.tax_class_id} className="pos-row" data-tax-class-id={taxClass.tax_class_id}>
              <span>{taxClass.name}</span>
              <span className="pos-ltr">{formatRate(taxClass.rate_bp)}</span>
              {archived && <span>{t('owner.common.archived')}</span>}
              {canEdit && (
                <button
                  type="button"
                  className="pos-btn"
                  onClick={() => void save(api.patchTaxClass(taxClass.tax_class_id, { archived: !archived }))}
                >
                  {t(archived ? 'owner.common.restore' : 'owner.common.archive')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && <AddTaxClassForm api={api} onCreated={() => void load()} />}

      <h2 className="pos-field__label">{t('owner.menu.categories')}</h2>
      <ul className="pos-stack">
        {menu?.categories.map((category) => {
          const archived = category.archived_at !== null;
          return (
            <li key={category.category_id} className="pos-row" data-category-id={category.category_id}>
              <span>{category.name}</span>
              {archived && <span>{t('owner.common.archived')}</span>}
              {canEdit && (
                <button type="button" className="pos-btn" onClick={() => setEditing({ kind: 'category', category })}>
                  {t('owner.common.edit')}
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  className="pos-btn"
                  onClick={() => void save(api.patchCategory(category.category_id, { archived: !archived }))}
                >
                  {t(archived ? 'owner.common.restore' : 'owner.common.archive')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <button type="button" className="pos-btn" onClick={() => setEditing({ kind: 'category', category: null })}>
          {t('owner.menu.new_category')}
        </button>
      )}

      <h2 className="pos-field__label">{t('owner.menu.items')}</h2>
      {canEdit && (
        <button type="button" className="pos-btn" onClick={() => setEditing({ kind: 'item', item: null })}>
          {t('owner.menu.new_item')}
        </button>
      )}
      <div className="pos-row">
        <label className="pos-field">
          <span className="pos-field__label">{t('owner.menu.search')}</span>
          <input
            className="pos-input"
            type="search"
            name="q"
            maxLength={60}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="pos-field">
          <span className="pos-field__label">{t('owner.menu.category_filter')}</span>
          <select
            className="pos-select"
            name="category_id"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">{t('owner.menu.all_categories')}</option>
            {menu?.categories.map((category) => (
              <option key={category.category_id} value={category.category_id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="pos-field">
          <span className="pos-field__label">{t('owner.menu.status')}</span>
          <select
            className="pos-select"
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
          >
            <option value="active">{t('owner.menu.status_active')}</option>
            <option value="archived">{t('owner.menu.status_archived')}</option>
          </select>
        </label>
      </div>
      <ul className="pos-stack">
        {items.map((row) => {
          const archived = row.archived_at !== null;
          return (
            <li key={row.item_id} className="pos-row" data-item-id={row.item_id}>
              <span>{row.name}</span>
              {row.group_label !== null && <span>{row.group_label}</span>}
              <span>{categoryName(row.category_id)}</span>
              <span className="pos-ltr">{`${t('owner.menu.rupees')} ${formatRupees(row.price_minor)}`}</span>
              {canEdit && (
                <button type="button" className="pos-btn" onClick={() => setEditing({ kind: 'item', item: row })}>
                  {t('owner.common.edit')}
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  className="pos-btn"
                  onClick={() => void save(api.patchMenuItem(row.item_id, { archived: !archived }))}
                >
                  {t(archived ? 'owner.common.restore' : 'owner.common.archive')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {menu?.next_cursor != null && (
        <BusyButton busy={busy} onClick={() => void loadMore()}>
          {t('owner.menu.load_more')}
        </BusyButton>
      )}
    </section>
  );
}
