import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Category, CloudAdmin, CloudResult, MenuItem, MenuPage, MenuQuery, TaxClass } from '../../../api/cloud-admin';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Chip } from '../../../components/Chip';
import { ConfirmDialog, Dialog } from '../../../components/Dialog';
import { EmptyState } from '../../../components/EmptyState';
import { SavedChip, useFlash } from '../../../components/FlashChip';
import { Icon } from '../../../components/Icon';
import { List, ListRow } from '../../../components/List';
import { Segmented } from '../../../components/Segmented';
import { Skeleton } from '../../../components/Skeleton';
import { fill } from '../../../i18n/en';
import { t, type MessageKey } from '../../../i18n';
import { BlockedDialog, itemNames, usedIds, type InUse } from '../BlockedDialog';
import { useBranchName } from '../branch';
import { useCloudDown } from '../cloud';
import { errorText, isKeyMismatch, useIdempotencyKey } from '../form';
import { useDirtyForm, useLeave } from '../guard';
import { shownRupees } from '../money';
import { usePhone } from '../../../app/phone';
import { Page } from '../Shell';
import { CategoryForm } from './CategoryForm';
import { ItemForm } from './ItemForm';
import { windowText } from './WindowsField';

// §8.1 #/menu (01a-S05): one page, three tabs (items, categories, tax rates); it needs no branch (S52).
// Items come a page at a time (§6.11, S48): a search box sent 300 ms after typing stops, a category
// filter, an Active / Archived switch and Load more while next_cursor is set; pages are appended and
// de-duplicated by item_id (a rename across the cursor can repeat a row, review 2 nit 3).
// can_edit_tenant false → read-only with one info line and View instead of Edit (S8, B01). An open item
// form replaces the list (one primary button per screen); closing it reloads the list. Archive asks first
// and shows what blocks it (S50 b). The item total shows only once every page is loaded (S50 f).
export const SEARCH_DELAY_MS = 300;

type Status = NonNullable<MenuQuery['status']>;
type Tab = 'items' | 'categories' | 'tax';

const PERCENT_RE = /^[0-9]+(\.[0-9]{1,2})?$/;
const PER_UNIT: Record<MenuItem['sale_unit'], MessageKey> = { piece: 'menu.per.piece', g: 'menu.per.kg', ml: 'menu.per.l' };

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

function AddTaxClassForm({ api, onCreated, onCancel }: { api: CloudAdmin; onCreated: () => void; onCancel: () => void }) {
  const { key, renew } = useIdempotencyKey();
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const down = useCloudDown(api);

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
    <form className="pos-explain pos-row" data-form="add-tax-class" noValidate onSubmit={(e) => void submit(e)}>
      <label className="pos-field">
        <span className="pos-field__label">{t('owner.menu.new_tax_class')}</span>
        <input className="pos-input" name="name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="pos-field">
        <span className="pos-field__label">{t('owner.menu.rate_percent')}</span>
        <span className="pos-input-affix pos-ltr">
          <input
            className="pos-input pos-input--mono"
            name="rate_percent"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <span>%</span>
        </span>
      </label>
      {error !== null && <Banner tone="danger" text={error} />}
      <button type="button" className="pos-btn" onClick={onCancel}>
        {t('common.cancel')}
      </button>
      <BusyButton busy={busy} disabled={down} type="submit">
        {t('owner.menu.add_tax_class')}
      </BusyButton>
    </form>
  );
}

// OwnerTaxDialog: name and rate (both editable, §6.12); archive from here asks first.
function TaxDialog({
  api,
  taxClass,
  onSaved,
  onArchive,
  onClose,
}: {
  api: CloudAdmin;
  taxClass: TaxClass;
  onSaved: () => void;
  onArchive: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(taxClass.name);
  const [rate, setRate] = useState(String(taxClass.rate_bp / 100));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const down = useCloudDown(api);
  const leave = useLeave();
  const rateBp = parseRateBp(rate);
  const changed = [
    ...(name.trim() !== taxClass.name ? [t('tax.name').toLowerCase()] : []),
    ...(rateBp !== taxClass.rate_bp ? [t('tax.rate').toLowerCase()] : []),
  ];
  useDirtyForm(changed.length === 0 ? null : { name: taxClass.name, fields: changed });

  async function save() {
    if (rateBp === null || name.trim() === '') {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    if (changed.length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    const result = await api.patchTaxClass(taxClass.tax_class_id, {
      ...(name.trim() !== taxClass.name ? { name: name.trim() } : {}),
      ...(rateBp !== taxClass.rate_bp ? { rate_bp: rateBp } : {}),
    });
    setBusy(false);
    if (result.ok) onSaved();
    else setError(errorText(result.error));
  }

  return (
    <Dialog
      title={t('tax.edit')}
      onClose={() => leave(onClose)}
      footer={
        <>
          <button type="button" className="pos-btn" onClick={() => leave(onClose)}>
            {t('common.cancel')}
          </button>
          <BusyButton busy={busy} primary disabled={down} onClick={() => void save()}>
            {t('tax.save')}
          </BusyButton>
        </>
      }
    >
      <label className="pos-field">
        <span className="pos-field__label">{t('tax.name')}</span>
        <input className="pos-input" name="name" value={name} onChange={(e) => setName(e.target.value)} />
        <span className="pos-field__help">{t('tax.name_help')}</span>
      </label>
      <label className="pos-field">
        <span className="pos-field__label">{t('tax.rate')}</span>
        <span className="pos-input-affix pos-ltr">
          <input className="pos-input pos-input--mono" name="rate_percent" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          <span>%</span>
        </span>
        <span className="pos-field__help">{t('tax.rate_help')}</span>
      </label>
      <p className="pos-explain">{t('tax.applies_note')}</p>
      <div className="pos-dialog__danger">
        <strong>{t('tax.archive_title')}</strong>
        <button type="button" className="pos-btn pos-btn--danger" disabled={down} onClick={onArchive}>
          {t('owner.common.archive')}
        </button>
      </div>
      {error !== null && <Banner tone="danger" text={error} />}
    </Dialog>
  );
}

type Ask =
  | { kind: 'archive-category'; category: Category }
  | { kind: 'archive-tax'; taxClass: TaxClass }
  | { kind: 'blocked'; name: string; inUse: InUse }
  | { kind: 'tax'; taxClass: TaxClass }
  | null;

export function MenuView({ api }: { api: CloudAdmin }) {
  const [menu, setMenu] = useState<Omit<MenuPage, 'items'> | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('items');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<Status>('active');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingTax, setAddingTax] = useState(false);
  const [ask, setAsk] = useState<Ask>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const saved = useFlash();
  const phone = usePhone();
  const branchName = useBranchName();
  const down = useCloudDown(api);
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
    setError(null);
    const { items: first, ...rest } = result.data;
    setMenu(rest);
    setItems(appendUnique([], first));
    setLoaded(true);
  }, [api, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const wasDown = useRef(down);
  useEffect(() => {
    if (wasDown.current && !down && menu === null) void load();
    wasDown.current = down;
  }, [down, menu, load]);

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

  function flashSaved(id: string) {
    setSavedId(id);
    saved.flash();
  }

  async function archive(id: string, name: string, call: () => Promise<CloudResult<unknown>>) {
    setAsk(null);
    setError(null);
    const result = await call();
    if (!result.ok) {
      const ids = usedIds(result.error);
      if (ids !== null) setAsk({ kind: 'blocked', name, inUse: await itemNames(api, ids) });
      else setError(errorText(result.error));
    } else flashSaved(id);
    await load();
  }

  async function restore(id: string, call: () => Promise<CloudResult<unknown>>) {
    setError(null);
    const result = await call();
    if (!result.ok) setError(errorText(result.error));
    else flashSaved(id);
    await load();
  }

  const canEdit = menu?.can_edit_tenant === true;
  const categoryName = (id: string) => menu?.categories.find((c) => c.category_id === id)?.name ?? '';

  function closeForm(notice?: string | null) {
    setEditing(null);
    setError(notice ?? null);
    void load();
  }

  if (editing !== null && menu !== null) {
    return editing.kind === 'item' ? (
      <ItemForm
        api={api}
        item={editing.item}
        taxClasses={menu.tax_classes}
        categories={menu.categories}
        branchIds={branchIds}
        readOnly={!canEdit}
        onSaved={closeForm}
        onCancel={() => setEditing(null)}
      />
    ) : null;
  }

  const activeCategories = menu?.categories.filter((c) => c.archived_at === null) ?? [];
  const activeTaxes = menu?.tax_classes.filter((x) => x.archived_at === null) ?? [];
  const firstRun = loaded && canEdit && items.length === 0 && q === '' && categoryId === '' && status === 'active' && activeCategories.length === 0;
  const total = menu?.next_cursor === null && q === '' && categoryId === '' && status === 'active' ? items.length : undefined;

  const primary: Record<Tab, { label: MessageKey; run: () => void }> = {
    items: { label: 'owner.menu.new_item', run: () => setEditing({ kind: 'item', item: null }) },
    categories: { label: 'owner.menu.new_category', run: () => setEditing({ kind: 'category', category: null }) },
    tax: { label: 'menu.new_tax', run: () => setAddingTax(true) },
  };

  return (
    <Page
      api={api}
      title={t('owner.menu.title')}
      after={!phone && <Chip tone="info">{t('menu.shared_chip')}</Chip>}
      end={
        canEdit &&
        !firstRun && (
          <button type="button" className="pos-btn pos-btn--primary" onClick={primary[tab].run}>
            <Icon name="plus" />
            {t(primary[tab].label)}
          </button>
        )
      }
    >
      {menu !== null && !canEdit && <Banner tone="info" text={t('owner.menu.read_only')} detail={t('menu.read_only_body')} />}
      {error !== null && <Banner tone="danger" text={error} />}

      {firstRun ? (
        <FirstRun onCategory={() => setEditing({ kind: 'category', category: null })} onTax={() => { setTab('tax'); setAddingTax(true); }} />
      ) : (
        <>
          <Segmented
            label={t('menu.section')}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'items', label: t('owner.menu.items'), ...(total === undefined ? {} : { count: total }) },
              { value: 'categories', label: t('owner.menu.categories'), count: activeCategories.length },
              { value: 'tax', label: t('menu.tax_rates'), count: activeTaxes.length },
            ]}
          />

          {tab === 'items' && (
            <>
              <div className="pos-row">
                <label className="pos-field">
                  <span className="pos-field__label">{t('owner.menu.search')}</span>
                  <span className="pos-input-affix">
                    <input
                      className="pos-input"
                      type="search"
                      name="q"
                      maxLength={60}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <span>
                      <Icon name="search" />
                    </span>
                  </span>
                </label>
                <label className="pos-field">
                  <span className="pos-field__label">{t('owner.menu.category_filter')}</span>
                  <select className="pos-select" name="category_id" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">{t('owner.menu.all_categories')}</option>
                    {menu?.categories.map((category) => (
                      <option key={category.category_id} value={category.category_id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Segmented
                  label={t('owner.menu.status')}
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: 'active', label: t('owner.menu.status_active') },
                    { value: 'archived', label: t('owner.menu.status_archived') },
                  ]}
                />
              </div>
              {!loaded && (
                <List preset="menu" busy>
                  <ListRow>
                    <Skeleton lines={5} />
                  </ListRow>
                </List>
              )}
              {loaded && items.length === 0 && (
                <EmptyState
                  title={q === '' ? t('menu.no_items') : fill(t('menu.no_match'), { q })}
                  body={t('menu.no_match_body')}
                >
                  <div className="pos-row">
                    {q !== '' && (
                      <button
                        type="button"
                        className="pos-btn"
                        onClick={() => {
                          setSearch('');
                          setQ('');
                        }}
                      >
                        {t('menu.clear_search')}
                      </button>
                    )}
                    {status === 'active' && (
                      <button type="button" className="pos-btn" onClick={() => setStatus('archived')}>
                        {t('menu.show_archived')}
                      </button>
                    )}
                  </div>
                </EmptyState>
              )}
              {items.length > 0 && (
                <List
                  preset={phone ? 'stack' : 'menu'}
                  head={
                    phone
                      ? undefined
                      : [t('menu.col_item'), t('owner.item.category'), t('menu.col_price'), t('menu.col_notes'), '']
                  }
                >
                  {items.map((row) => {
                    const archived = row.archived_at !== null;
                    const sold = row.routes.filter((r) => branchIds.includes(r.branch_id)).length;
                    return (
                      <ListRow key={row.item_id} muted={archived}>
                        <span className="pos-list__name" data-item-id={row.item_id}>
                          <strong>{row.name}</strong>
                          {phone && <span>{categoryName(row.category_id)}</span>}
                        </span>
                        {!phone && <span>{categoryName(row.category_id)}</span>}
                        <span className="pos-list__num pos-ltr">
                          {`${t('owner.menu.rupees')} ${shownRupees(row.price_minor)}`}
                          <small>{` ${t(PER_UNIT[row.sale_unit])}`}</small>
                        </span>
                        <span className="pos-list__tags">
                          <Chip tone={sold < branchIds.length ? 'warn' : undefined}>
                            {fill(t('menu.branches_of'), { n: String(sold), m: String(branchIds.length) })}
                          </Chip>
                          {row.routes
                            .filter((r) => r.price_minor_override !== null && branchIds.includes(r.branch_id))
                            .map((r) => (
                              // S57 e: "{branch} Rs {price}" for a branch with its own price.
                              <Chip key={r.branch_id}>
                                <bdi>{branchName(r.branch_id)}</bdi>{' '}
                                <span className="pos-ltr">{`${t('owner.menu.rupees')} ${shownRupees(r.price_minor_override ?? 0)}`}</span>
                              </Chip>
                            ))}
                          {row.availability_windows.length > 0 && (
                            <Chip>
                              <span className="pos-ltr">{row.availability_windows.map(windowText).join(', ')}</span>
                            </Chip>
                          )}
                          {row.out_of_stock_behaviour === 'sold_out' && <Chip>{t('menu.sold_out_when_gone')}</Chip>}
                          {archived && <Chip tone="warn">{t('owner.common.archived')}</Chip>}
                          <SavedChip shown={saved.shown && savedId === row.item_id} />
                        </span>
                        <span className="pos-row">
                          <button type="button" className="pos-btn" onClick={() => setEditing({ kind: 'item', item: row })}>
                            {t(canEdit ? 'owner.common.edit' : 'menu.view')}
                          </button>
                          {canEdit && archived && (
                            <button
                              type="button"
                              className="pos-btn"
                              disabled={down}
                              onClick={() => void restore(row.item_id, () => api.patchMenuItem(row.item_id, { archived: false }))}
                            >
                              {t('owner.common.restore')}
                            </button>
                          )}
                        </span>
                      </ListRow>
                    );
                  })}
                </List>
              )}
              {menu?.next_cursor != null && (
                <BusyButton busy={busy} onClick={() => void loadMore()}>
                  {t('owner.menu.load_more')}
                </BusyButton>
              )}
            </>
          )}

          {tab === 'categories' && (
            <>
              <List preset="stack">
                {menu?.categories.map((category) => {
                  const archived = category.archived_at !== null;
                  return (
                    <ListRow key={category.category_id} muted={archived}>
                      <div className="pos-row" data-category-id={category.category_id}>
                        <span className="pos-list__num pos-ltr">{category.sort_order}</span>
                        <span className="pos-list__name">
                          <strong>{category.name}</strong>
                        </span>
                        <Chip>
                          <span className="pos-ltr">
                            {category.availability_windows.length === 0
                              ? t('owner.hours.all_day')
                              : category.availability_windows.map(windowText).join(', ')}
                          </span>
                        </Chip>
                        {archived && <Chip tone="warn">{t('owner.common.archived')}</Chip>}
                        <SavedChip shown={saved.shown && savedId === category.category_id} />
                        {canEdit && (
                          <span className="pos-appbar__end">
                            {!archived && (
                              <button type="button" className="pos-btn" onClick={() => setEditing({ kind: 'category', category })}>
                                {t('owner.common.edit')}
                              </button>
                            )}
                            <button
                              type="button"
                              className="pos-btn"
                              disabled={down}
                              onClick={() =>
                                archived
                                  ? void restore(category.category_id, () => api.patchCategory(category.category_id, { archived: false }))
                                  : setAsk({ kind: 'archive-category', category })
                              }
                            >
                              {t(archived ? 'owner.common.restore' : 'owner.common.archive')}
                            </button>
                          </span>
                        )}
                      </div>
                    </ListRow>
                  );
                })}
              </List>
              <p className="pos-field__help">{t('menu.cats_order_help')}</p>
            </>
          )}

          {tab === 'tax' && (
            <>
              <List preset="stack">
                <ListRow>
                  <div className="pos-row">
                    <span className="pos-list__name">
                      <strong>{t('owner.item.no_tax')}</strong>
                      <span>{t('menu.tax_default')}</span>
                    </span>
                    <span className="pos-list__num pos-ltr">0 %</span>
                  </div>
                </ListRow>
                {menu?.tax_classes.map((taxClass) => {
                  const archived = taxClass.archived_at !== null;
                  return (
                    <ListRow key={taxClass.tax_class_id} muted={archived}>
                      <div className="pos-row" data-tax-class-id={taxClass.tax_class_id}>
                        <span className="pos-list__name">
                          <strong>{taxClass.name}</strong>
                        </span>
                        <span className="pos-list__num pos-ltr">{formatRate(taxClass.rate_bp)}</span>
                        {archived && <Chip tone="warn">{t('owner.common.archived')}</Chip>}
                        <SavedChip shown={saved.shown && savedId === taxClass.tax_class_id} />
                        {canEdit && (
                          <span className="pos-appbar__end">
                            {!archived && (
                              <button type="button" className="pos-btn" onClick={() => setAsk({ kind: 'tax', taxClass })}>
                                {t('owner.common.edit')}
                              </button>
                            )}
                            <button
                              type="button"
                              className="pos-btn"
                              disabled={down}
                              onClick={() =>
                                archived
                                  ? void restore(taxClass.tax_class_id, () => api.patchTaxClass(taxClass.tax_class_id, { archived: false }))
                                  : setAsk({ kind: 'archive-tax', taxClass })
                              }
                            >
                              {t(archived ? 'owner.common.restore' : 'owner.common.archive')}
                            </button>
                          </span>
                        )}
                      </div>
                    </ListRow>
                  );
                })}
              </List>
              {canEdit && addingTax && (
                <AddTaxClassForm
                  api={api}
                  onCancel={() => setAddingTax(false)}
                  onCreated={() => {
                    setAddingTax(false);
                    void load();
                  }}
                />
              )}
            </>
          )}
        </>
      )}

      {editing?.kind === 'category' && (
        <CategoryForm
          api={api}
          category={editing.category}
          onSaved={(notice) => {
            if (editing.category !== null) flashSaved(editing.category.category_id);
            closeForm(notice);
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {ask?.kind === 'tax' && (
        <TaxDialog
          api={api}
          taxClass={ask.taxClass}
          onClose={() => setAsk(null)}
          onSaved={() => {
            flashSaved(ask.taxClass.tax_class_id);
            setAsk(null);
            void load();
          }}
          onArchive={() => setAsk({ kind: 'archive-tax', taxClass: ask.taxClass })}
        />
      )}
      {ask?.kind === 'archive-category' && (
        <ConfirmDialog
          title={fill(t('archive.item_title'), { name: ask.category.name })}
          body={t('archive.category_body')}
          confirmLabel={fill(t('archive.archive_name'), { name: ask.category.name })}
          tone="danger"
          onConfirm={() =>
            void archive(ask.category.category_id, ask.category.name, () => api.patchCategory(ask.category.category_id, { archived: true }))
          }
          onCancel={() => setAsk(null)}
        />
      )}
      {ask?.kind === 'archive-tax' && (
        <ConfirmDialog
          title={fill(t('archive.item_title'), { name: ask.taxClass.name })}
          body={t('archive.tax_body')}
          confirmLabel={fill(t('archive.archive_name'), { name: ask.taxClass.name })}
          tone="danger"
          onConfirm={() =>
            void archive(ask.taxClass.tax_class_id, ask.taxClass.name, () => api.patchTaxClass(ask.taxClass.tax_class_id, { archived: true }))
          }
          onCancel={() => setAsk(null)}
        />
      )}
      {ask?.kind === 'blocked' && (
        <BlockedDialog
          title={fill(t('archive.blocked_title'), { name: ask.name })}
          body={fill(t('archive.in_use_body'), { n: String(ask.inUse.ids.length) })}
          inUse={ask.inUse}
          onClose={() => setAsk(null)}
        />
      )}
    </Page>
  );
}

// OwnerMenuFirstRun: an empty menu shows the five setup steps (no counts the API does not give, S50 f).
function FirstRun({ onCategory, onTax }: { onCategory: () => void; onTax: () => void }) {
  const steps: { title: MessageKey; body: MessageKey; action: ReactNode }[] = [
    { title: 'owner.nav.stations', body: 'menu.first.stations', action: <a className="pos-btn" href="#/stations">{t('owner.common.edit')}</a> },
    { title: 'owner.nav.floors', body: 'menu.first.floors', action: <a className="pos-btn" href="#/floors">{t('owner.common.edit')}</a> },
    {
      title: 'owner.menu.categories',
      body: 'menu.first.categories',
      action: (
        <button type="button" className="pos-btn pos-btn--primary" onClick={onCategory}>
          {t('menu.first.add_categories')}
        </button>
      ),
    },
    {
      title: 'menu.first.tax_title',
      body: 'menu.first.tax',
      action: (
        <button type="button" className="pos-btn" onClick={onTax}>
          {t('menu.first.add')}
        </button>
      ),
    },
    {
      title: 'owner.menu.items',
      body: 'menu.first.items',
      action: (
        <button type="button" className="pos-btn" disabled>
          {t('menu.first.add_items')}
        </button>
      ),
    },
  ];
  return (
    <section className="pos-stack">
      <div className="pos-section__head">
        <h2>{t('menu.first.title')}</h2>
        <p>{t('menu.first.body')}</p>
      </div>
      <ol className="pos-checklist">
        {steps.map((step, i) => (
          <li key={step.title} className="pos-checklist__item">
            <span className="pos-checklist__num pos-ltr">{i + 1}</span>
            <span className="pos-list__name">
              <strong>{t(step.title)}</strong>
              <span>{t(step.body)}</span>
            </span>
            {step.action}
          </li>
        ))}
      </ol>
    </section>
  );
}
