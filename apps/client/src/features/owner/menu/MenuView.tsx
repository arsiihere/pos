import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { formatQuantity } from '@pos/domain';
import type { Category, CloudAdmin, CloudError, CloudResult, MenuItem, MenuPage, MenuQuery, StockItem, TaxClass, VariantGroup } from '../../../api/cloud-admin';
import { navigate, useHashRoute } from '../../../app/router';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Chip } from '../../../components/Chip';
import { ConfirmDialog, Dialog } from '../../../components/Dialog';
import { EmptyState } from '../../../components/EmptyState';
import { SavedChip, useFlash } from '../../../components/FlashChip';
import { Icon } from '../../../components/Icon';
import { List, ListRow } from '../../../components/List';
import { MoreMenu } from '../../../components/MoreMenu';
import { Segmented } from '../../../components/Segmented';
import { fill } from '../../../i18n/en';
import { t, type MessageKey } from '../../../i18n';
import { BlockedDialog, dealNames, itemNames, usedEntity, usedIds, type InUse } from '../BlockedDialog';
import { useBranchName } from '../branch';
import { sizeLabel } from '../c01';
import { loadEveryItem } from '../menu-pages';
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
// filter, an Active / Archived switch (Pulse: "Show archived items" in the app-bar More menu, with an
// "Archived shown" filter chip) and Load more while next_cursor is set; pages are appended and
// de-duplicated by item_id (a rename across the cursor can repeat a row, review 2 nit 3).
// can_edit_tenant false → read-only with one info line and View instead of Edit (S8, B01). An open item
// form replaces the list (one primary button per screen); closing it reloads the list. Category and tax
// rows keep Edit and put Archive in the row's More menu (Pulse CHANGES §2). Archive asks first
// and shows what blocks it (S50 b). The item total shows only once every page is loaded (S50 f).
// 01c (Q12, MenuNested): a size group's row (Open → its page) with its loaded sizes nested under it, each with
// "Draws {qty} from {stock}". #/menu?item=<id> opens that item's form and #/menu?new_size_of=<group> a new
// size of that group (01c-S09 Open / Add a size); closing either goes back to #/menu.
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
    <form className="pos-explain pos-taxadd" data-form="add-tax-class" noValidate onSubmit={(e) => void submit(e)}>
      <label className="pos-field pos-taxadd__name">
        <span className="pos-field__label">{t('owner.menu.new_tax_class')}</span>
        <input className="pos-input" name="name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="pos-field pos-taxadd__rate">
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
      <BusyButton busy={busy} primary disabled={down} type="submit">
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

type Entry = { kind: 'item'; row: MenuItem; size: boolean } | { kind: 'group'; group: VariantGroup; size: number };

// Rows in list order; a size group sits where its first loaded size is, its loaded sizes right under it.
function nest(items: readonly MenuItem[], groups: readonly VariantGroup[]): Entry[] {
  const byId = new Map(groups.map((g) => [g.variant_group_id, g]));
  const entries: Entry[] = [];
  const done = new Set<string>();
  for (const row of items) {
    const group = row.variant_group_id === null ? undefined : byId.get(row.variant_group_id);
    if (group === undefined) {
      entries.push({ kind: 'item', row, size: false });
      continue;
    }
    if (done.has(group.variant_group_id)) continue;
    done.add(group.variant_group_id);
    const sizes = items.filter((i) => i.variant_group_id === group.variant_group_id);
    entries.push({ kind: 'group', group, size: sizes.length });
    for (const size of sizes) entries.push({ kind: 'item', row: size, size: true });
  }
  return entries;
}

const IN_USE_BODY = {
  item: 'archive.in_use_body',
  station: 'archive.in_use_body',
  stock_item: 'archive.in_use_body',
  variant_group: 'archive.in_use_size_groups',
  deal: 'archive.in_use_deals',
} as const;

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
  const leave = useLeave();
  const branchName = useBranchName();
  const down = useCloudDown(api);
  const [editing, setEditing] = useState<
    { kind: 'item'; item: MenuItem | null; newSizeOf?: string } | { kind: 'category'; category: Category | null } | null
  >(null);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const route = useHashRoute();
  const linkQuery = route.startsWith('/menu?') ? new URLSearchParams(route.slice('/menu?'.length)) : null;
  const linkItem = linkQuery?.get('item') ?? null;
  const linkNewSize = linkQuery?.get('new_size_of') ?? null;
  // The link already opened (so closing the form does not open it again before the hash changes).
  const opened = useRef<string | null>(null);
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

  // "Draws {qty} from {stock}" on size rows (§6.6); without it the rows show their description.
  useEffect(() => {
    let live = true;
    void api.listStockItems({}).then((result) => {
      if (live && result.ok && Array.isArray(result.data.stock_items)) setStockItems(result.data.stock_items);
    });
    return () => {
      live = false;
    };
  }, [api]);

  // 01c-S09 links: open the asked item (read from every menu page when it is not on the first) or a new size.
  useEffect(() => {
    if (menu === null || (linkItem === null && linkNewSize === null)) {
      opened.current = null;
      return;
    }
    if (opened.current === route) return;
    opened.current = route;
    if (linkNewSize !== null) {
      setEditing({ kind: 'item', item: null, newSizeOf: linkNewSize });
      return;
    }
    const found = items.find((row) => row.item_id === linkItem);
    if (found !== undefined) {
      setEditing({ kind: 'item', item: found });
      return;
    }
    void loadEveryItem(api).then((result) => {
      const item = result.ok ? result.data.items.find((row) => row.item_id === linkItem) : undefined;
      if (item !== undefined) setEditing({ kind: 'item', item });
      else {
        setError(result.ok ? t('menu.item_gone') : errorText(result.error));
        navigate('/menu');
      }
    });
  }, [api, menu, items, route, linkItem, linkNewSize]);

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
      if (ids !== null) setAsk({ kind: 'blocked', name, inUse: await usersOf(result.error, ids) });
      else setError(errorText(result.error));
    } else flashSaved(id);
    await load();
  }

  // 409 CONFIG_IN_USE names items, size groups (a category's, from the loaded page) or deals (§6.12, §6.13, 01c V16).
  async function usersOf(error: CloudError, ids: string[]): Promise<InUse> {
    const entity = usedEntity(error);
    if (entity === 'variant_group') {
      const groups = menu?.variant_groups ?? [];
      return { ids, names: ids.flatMap((id) => groups.find((g) => g.variant_group_id === id)?.name ?? []), by: 'variant_group' };
    }
    if (entity === 'deal') return dealNames(api, ids);
    return itemNames(api, ids);
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
    if (linkQuery !== null) navigate('/menu');
    void load();
  }

  function cancelForm() {
    setEditing(null);
    if (linkQuery !== null) navigate('/menu');
  }

  // The item form replaces the list; the category form is a dialog over the Categories tab (01a-S06).
  if (editing?.kind === 'item' && menu !== null) {
    return (
      <ItemForm
        api={api}
        item={editing.item}
        taxClasses={menu.tax_classes}
        categories={menu.categories}
        branchIds={branchIds}
        readOnly={!canEdit}
        variantGroups={menu.variant_groups}
        {...(editing.newSizeOf === undefined ? {} : { newSizeOf: editing.newSizeOf })}
        onSaved={closeForm}
        onCancel={cancelForm}
      />
    );
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
  // One primary per screen: while the inline tax form is open its Add tax rate is the primary (CHANGES §2).
  const showPrimary = canEdit && !firstRun && !(tab === 'tax' && addingTax);
  const archivedShown = status === 'archived';
  const groupName = (id: string | null) => (id === null ? undefined : menu?.variant_groups.find((g) => g.variant_group_id === id)?.name);
  // Row sub line (brief 01a-S05): the item's size group, else its short description.
  const subLine = (row: MenuItem) => {
    const group = groupName(row.variant_group_id);
    return group !== undefined ? fill(t('menu.group_n'), { name: group }) : (row.description ?? undefined);
  };
  const editLabel = t(canEdit ? 'owner.common.edit' : 'menu.view');
  // A nested size's sub line (MenuNested): what it draws from its stock item, else its description.
  const sizeSub = (row: MenuItem) => {
    const draw = row.stock_draws[0];
    const stock = draw === undefined ? undefined : stockItems.find((s) => s.stock_item_id === draw.stock_item_id);
    if (draw === undefined || stock === undefined) return row.description ?? undefined;
    return fill(t('size_group.draws'), { qty: formatQuantity(draw.quantity_per_sale_unit, stock.stock_unit), stock: stock.name });
  };

  return (
    <Page
      api={api}
      title={t('owner.menu.title')}
      after={!phone && <Chip tone="info">{t('menu.shared_chip')}</Chip>}
      end={
        <>
          {!firstRun && menu !== null && tab === 'items' && (
            <MoreMenu
              label={t('owner.menu.more')}
              items={[
                {
                  label: t(archivedShown ? 'menu.hide_archived_items' : 'menu.show_archived_items'),
                  icon: 'archive',
                  onSelect: () => setStatus(archivedShown ? 'active' : 'archived'),
                },
              ]}
            />
          )}
          {showPrimary && (
            // Phone (OwnerMenuPhone): the app bar says "New"; its accessible name stays the full label.
            <button
              type="button"
              className="pos-btn pos-btn--primary"
              aria-label={phone ? t(primary[tab].label) : undefined}
              onClick={primary[tab].run}
            >
              <Icon name="plus" />
              {phone ? t('menu.new_short') : t(primary[tab].label)}
            </button>
          )}
        </>
      }
    >
      {menu !== null && !canEdit && <Banner tone="info" text={t('owner.menu.read_only')} detail={t('menu.read_only_body')} />}
      {error !== null && <Banner tone="danger" text={error} />}

      {firstRun ? (
        <FirstRun onCategory={() => setEditing({ kind: 'category', category: null })} onTax={() => { setTab('tax'); setAddingTax(true); }} />
      ) : (
        <>
          <div className="pos-menubar">
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
              <div className="pos-menubar__find">
                {archivedShown && (
                  <button
                    type="button"
                    className="pos-filterchip"
                    aria-label={t('menu.hide_archived_items')}
                    onClick={() => setStatus('active')}
                  >
                    <Icon name="archive" />
                    {t('menu.archived_shown')}
                    <Icon name="x" />
                  </button>
                )}
                <label className="pos-input-affix pos-menubar__search">
                  <span>
                    <Icon name="search" />
                  </span>
                  <input
                    className="pos-input"
                    type="search"
                    name="q"
                    maxLength={60}
                    placeholder={t('owner.menu.search')}
                    aria-label={t('owner.menu.search')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <select
                  className="pos-select pos-menubar__category"
                  name="category_id"
                  aria-label={t('owner.menu.category_filter')}
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
              </div>
            )}
          </div>

          {tab === 'items' && (
            <>
              {!loaded && (
                <List
                  preset={phone ? 'menuphone' : 'menu'}
                  busy
                  head={phone ? undefined : [t('menu.col_item'), t('owner.item.category'), t('menu.col_price'), t('menu.col_notes'), '']}
                >
                  {Array.from({ length: 6 }, (_, i) => (
                    <ListRow key={i}>
                      {Array.from({ length: phone ? 3 : 5 }, (_, j) => (
                        <span key={j} className="pos-skeleton" />
                      ))}
                    </ListRow>
                  ))}
                </List>
              )}
              {loaded && items.length === 0 && (
                <EmptyState
                  card
                  icon="search"
                  title={q === '' ? t('menu.no_items') : fill(t('menu.no_match'), { q })}
                  body={t('menu.no_match_body')}
                >
                  <div className="pos-row pos-row--center">
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
                  preset={phone ? 'menuphone' : 'menu'}
                  head={
                    phone
                      ? undefined
                      : [t('menu.col_item'), t('owner.item.category'), t('menu.col_price'), t('menu.col_notes'), '']
                  }
                >
                  {nest(items, menu?.variant_groups ?? []).map((entry) => {
                    if (entry.kind === 'group') {
                      const { group } = entry;
                      const open = (
                        <span className="pos-rowact">
                          <a
                            className="pos-btn"
                            href={`#/size-groups/${encodeURIComponent(group.variant_group_id)}`}
                            aria-label={fill(t('menu.open_group'), { name: group.name })}
                          >
                            {t('in_use.open')}
                          </a>
                        </span>
                      );
                      const label = (
                        <span className="pos-list__name" data-group-id={group.variant_group_id}>
                          <strong className="pos-list__grouptitle">
                            <Icon name="layers" />
                            {group.name}
                          </strong>
                          <span>{fill(t('menu.size_group_sub'), { n: String(entry.size) })}</span>
                        </span>
                      );
                      return phone ? (
                        <ListRow key={`g-${group.variant_group_id}`} className="pos-list__row--group">
                          {label}
                          <span />
                          {open}
                        </ListRow>
                      ) : (
                        <ListRow key={`g-${group.variant_group_id}`} className="pos-list__row--group">
                          {label}
                          <span>{categoryName(group.category_id)}</span>
                          <span />
                          <span />
                          {open}
                        </ListRow>
                      );
                    }
                    const { row } = entry;
                    const rowClass = entry.size ? 'pos-list__row--size' : undefined;
                    const archived = row.archived_at !== null;
                    const sold = row.routes.filter((r) => branchIds.includes(r.branch_id)).length;
                    const soldText = fill(t('menu.branches_of'), { n: String(sold), m: String(branchIds.length) });
                    const sub = entry.size ? sizeSub(row) : subLine(row);
                    const rowName = entry.size ? sizeLabel(row) : row.name;
                    // S57 e: "{branch} Rs {price}" for each allowed branch with its own price (spec §8.1).
                    const overrides = row.routes
                      .filter((r) => r.price_minor_override !== null && branchIds.includes(r.branch_id))
                      .map((r) => (
                        <Chip key={r.branch_id}>
                          <bdi>{branchName(r.branch_id)}</bdi>{' '}
                          <span className="pos-ltr">{`${t('owner.menu.rupees')} ${shownRupees(r.price_minor_override ?? 0)}`}</span>
                        </Chip>
                      ));
                    const marks = (
                      <>
                        {archived && (
                          <Chip tone="warn" icon="archive">
                            {t('owner.common.archived')}
                          </Chip>
                        )}
                        <SavedChip shown={saved.shown && savedId === row.item_id} />
                      </>
                    );
                    const price = (
                      <span className="pos-list__num pos-ltr">
                        {`${t('owner.menu.rupees')} ${shownRupees(row.price_minor)}`}
                        {!phone && <small>{t(PER_UNIT[row.sale_unit])}</small>}
                      </span>
                    );
                    const actions = (
                      <span className="pos-rowact">
                        <button type="button" className="pos-btn" onClick={() => setEditing({ kind: 'item', item: row })}>
                          {editLabel}
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
                    );
                    return phone ? (
                      <ListRow key={row.item_id} muted={archived} className={rowClass}>
                        <span className="pos-list__name" data-item-id={row.item_id}>
                          <strong>{rowName}</strong>
                          <span>{`${categoryName(row.category_id)} · ${soldText}`}</span>
                          {(overrides.length > 0 || archived) && (
                            <span className="pos-list__tags">
                              {overrides}
                              {marks}
                            </span>
                          )}
                        </span>
                        {price}
                        {actions}
                      </ListRow>
                    ) : (
                      <ListRow key={row.item_id} muted={archived} className={rowClass}>
                        <span className="pos-list__name" data-item-id={row.item_id}>
                          <strong>{rowName}</strong>
                          {sub !== undefined && <span>{sub}</span>}
                        </span>
                        <span>{categoryName(row.category_id)}</span>
                        {price}
                        <span className="pos-list__tags">
                          {sold < branchIds.length ? (
                            <Chip tone="warn" icon="alert">
                              {soldText}
                            </Chip>
                          ) : (
                            <span className="pos-list__meta">{soldText}</span>
                          )}
                          {overrides}
                          {marks}
                        </span>
                        {actions}
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
              <List preset={phone ? 'rows' : 'cats'} head={phone ? undefined : [t('menu.col_order'), t('owner.item.category'), t('item.section.hours'), '']}>
                {menu?.categories.map((category) => {
                  const archived = category.archived_at !== null;
                  const hours = category.availability_windows.map(windowText).join(', ');
                  return (
                    <ListRow key={category.category_id} muted={archived} attrs={{ 'data-category-id': category.category_id }}>
                      <span className="pos-list__num pos-ltr">{category.sort_order}</span>
                      <span className="pos-list__name">
                        <strong>{category.name}</strong>
                      </span>
                      <span className="pos-list__tags">
                        {hours === '' ? (
                          <span className="pos-list__meta">{t('owner.hours.all_day')}</span>
                        ) : (
                          <Chip tone="info" icon="clock">
                            <span className="pos-ltr">{hours}</span>
                          </Chip>
                        )}
                        {archived && (
                          <Chip tone="warn" icon="archive">
                            {t('owner.common.archived')}
                          </Chip>
                        )}
                        <SavedChip shown={saved.shown && savedId === category.category_id} />
                      </span>
                      <span className="pos-rowact">
                        {canEdit && archived && (
                          <button
                            type="button"
                            className="pos-btn"
                            disabled={down}
                            onClick={() => void restore(category.category_id, () => api.patchCategory(category.category_id, { archived: false }))}
                          >
                            {t('owner.common.restore')}
                          </button>
                        )}
                        {canEdit && !archived && (
                          <>
                            <button type="button" className="pos-btn" onClick={() => setEditing({ kind: 'category', category })}>
                              {t('owner.common.edit')}
                            </button>
                            <MoreMenu
                              label={fill(t('common.more_for'), { name: category.name })}
                              info={{
                                title: category.name,
                                detail: hours === '' ? t('owner.hours.all_day') : fill(t('categories.menu_hours'), { hours }),
                              }}
                              items={[
                                {
                                  label: fill(t('categories.menu_archive'), { category: category.name }),
                                  icon: 'archive',
                                  danger: true,
                                  disabled: down,
                                  onSelect: () => setAsk({ kind: 'archive-category', category }),
                                },
                              ]}
                            />
                          </>
                        )}
                      </span>
                    </ListRow>
                  );
                })}
              </List>
              <p className="pos-note">{t('menu.cats_order_help')}</p>
            </>
          )}

          {tab === 'tax' && (
            <>
              <List preset={phone ? 'rows' : 'tax'} head={phone ? undefined : [t('menu.col_tax'), t('tax.rate'), '']}>
                <ListRow>
                  <span className="pos-list__name">
                    <strong>{t('owner.item.no_tax')}</strong>
                    <span>{t('menu.tax_default')}</span>
                  </span>
                  <span className="pos-list__num pos-ltr">
                    0<small>%</small>
                  </span>
                  <span className="pos-rowact" />
                </ListRow>
                {menu?.tax_classes.map((taxClass) => {
                  const archived = taxClass.archived_at !== null;
                  return (
                    <ListRow key={taxClass.tax_class_id} muted={archived} attrs={{ 'data-tax-class-id': taxClass.tax_class_id }}>
                      <span className="pos-list__name">
                        <strong>{taxClass.name}</strong>
                        {archived && (
                          <span className="pos-list__tags">
                            <Chip tone="warn" icon="archive">
                              {t('owner.common.archived')}
                            </Chip>
                          </span>
                        )}
                      </span>
                      <span className="pos-list__num pos-ltr">
                        {taxClass.rate_bp / 100}
                        <small>%</small>
                      </span>
                      <span className="pos-rowact">
                        <SavedChip shown={saved.shown && savedId === taxClass.tax_class_id} />
                        {canEdit && archived && (
                          <button
                            type="button"
                            className="pos-btn"
                            disabled={down}
                            onClick={() => void restore(taxClass.tax_class_id, () => api.patchTaxClass(taxClass.tax_class_id, { archived: false }))}
                          >
                            {t('owner.common.restore')}
                          </button>
                        )}
                        {canEdit && !archived && (
                          <>
                            <button type="button" className="pos-btn" onClick={() => setAsk({ kind: 'tax', taxClass })}>
                              {t('owner.common.edit')}
                            </button>
                            <MoreMenu
                              label={fill(t('common.more_for'), { name: taxClass.name })}
                              info={{ title: taxClass.name, detail: formatRate(taxClass.rate_bp) }}
                              items={[
                                {
                                  label: fill(t('tax.menu_archive'), { rate: taxClass.name }),
                                  icon: 'archive',
                                  danger: true,
                                  disabled: down,
                                  onSelect: () => setAsk({ kind: 'archive-tax', taxClass }),
                                },
                              ]}
                            />
                          </>
                        )}
                      </span>
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
          categories={menu?.categories ?? []}
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
          body={fill(t(IN_USE_BODY[ask.inUse.by ?? 'item']), { n: String(ask.inUse.ids.length) })}
          inUse={ask.inUse}
          onClose={() => setAsk(null)}
          action={
            ask.inUse.by === 'variant_group' || ask.inUse.by === 'deal' ? (
              <button
                type="button"
                className="pos-btn pos-btn--primary"
                onClick={() => leave(() => navigate(ask.inUse.by === 'deal' ? '/deals' : '/size-groups'))}
              >
                {t(ask.inUse.by === 'deal' ? 'archive.open_deals' : 'archive.open_size_groups')}
              </button>
            ) : undefined
          }
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
    <section className="pos-stack pos-firstrun">
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
