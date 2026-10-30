import { formatQuantity } from '@pos/domain';
import type { PatchVariantGroupRequest } from '@pos/events';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { CloudAdmin, CloudError, MenuItem, StockItem, VariantGroup } from '../../../api/cloud-admin';
import { usePhone } from '../../../app/phone';
import { navigate } from '../../../app/router';
import { ActionBar } from '../../../components/ActionBar';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { ErrorSummary, type FixEntry } from '../../../components/ErrorSummary';
import { Gone } from '../../../components/Gone';
import { Icon } from '../../../components/Icon';
import { InUseDialog } from '../../../components/InUseDialog';
import { MoreMenu } from '../../../components/MoreMenu';
import { Skeleton } from '../../../components/Skeleton';
import { StaleBanner } from '../../../components/StaleBanner';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { apiCode, BackLink, bySortThenName, itemHref, newSizeHref, referenceText } from '../c01';
import { useCloudDown } from '../cloud';
import { errorText, isKeyMismatch, useIdempotencyKey } from '../form';
import { useDirtyForm, useLeave } from '../guard';
import { loadEveryItem, type WholeMenu } from '../menu-pages';
import { shownRupees } from '../money';
import { Page } from '../Shell';

// 01c-S09 (§8 "Views", §6.1, §6.2; Q16): name, category, and (folded) description and order; the sizes are
// listed read-only with Open, and "Add a size" opens a new item form with the group and its category filled
// in. A new group is a POST with the form's Idempotency-Key; an edit PATCHes only the changed fields with
// `expected_version`. 409 CONFIG_STALE → 01c-B03 with the draft kept; 409 CONFIG_IN_USE on Archive → 01c-D04
// naming the active sizes; 404 → the form is replaced (Q17). Read-only with can_edit_tenant false.
interface Loaded {
  menu: WholeMenu;
  stock: StockItem[];
}

export function SizeGroupForm({ api, groupId }: { api: CloudAdmin; groupId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  const load = useCallback(async () => {
    const [menu, stock] = await Promise.all([loadEveryItem(api), api.listStockItems()]);
    if (!menu.ok) {
      setLoadError(errorText(menu.error));
      return;
    }
    setLoaded({ menu: menu.data, stock: stock.ok ? stock.data.stock_items : [] });
    setLoadError(null);
    setGeneration((g) => g + 1);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = <BackLink href="#/size-groups" list={t('size_groups.title')} label={t('size_group.back_label')} />;

  if (loaded === null) {
    return (
      <Page api={api} title={t('size_groups.title')} start={back}>
        {loadError !== null ? <Banner tone="danger" text={loadError} /> : <Skeleton lines={6} />}
      </Page>
    );
  }
  const group = groupId === 'new' ? null : (loaded.menu.variant_groups.find((g) => g.variant_group_id === groupId) ?? null);
  if (groupId !== 'new' && group === null) return <SizeGroupGone api={api} back={back} />;
  return <Editor key={generation} api={api} loaded={loaded} group={group} back={back} onReload={() => void load()} />;
}

function SizeGroupGone({ api, back }: { api: CloudAdmin; back: ReactNode }) {
  return (
    <Page api={api} title={t('size_group.title')} start={back}>
      <Gone
        title={t('size_group.gone_title')}
        body={t('c01.gone_body')}
        back={fill(t('c01.back_to'), { list: t('size_groups.title') })}
        onBack={() => navigate('/size-groups')}
      />
    </Page>
  );
}

type Field = 'name' | 'category_id' | 'sort_order';
const FIELD_ID: Record<Field, string> = { name: 'sg-name', category_id: 'sg-category', sort_order: 'sg-sort' };

function Editor({
  api,
  loaded,
  group,
  back,
  onReload,
}: {
  api: CloudAdmin;
  loaded: Loaded;
  group: VariantGroup | null;
  back: ReactNode;
  onReload: () => void;
}) {
  const { menu, stock } = loaded;
  const [name, setName] = useState(group?.name ?? '');
  const [categoryId, setCategoryId] = useState(group?.category_id ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [sortOrder, setSortOrder] = useState(String(group?.sort_order ?? 0));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [banner, setBanner] = useState<{ tone: 'danger' | 'warn'; text: string } | null>(null);
  const [stale, setStale] = useState(false);
  const [gone, setGone] = useState(false);
  const [inUse, setInUse] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const { key, renew } = useIdempotencyKey();
  const down = useCloudDown(api);
  const leave = useLeave();
  const phone = usePhone();

  const archived = group !== null && group.archived_at !== null;
  const readOnly = !menu.can_edit_tenant || archived;
  const title = group === null ? t('size_group.new_title') : group.name;
  const items = new Map(menu.items.map((item) => [item.item_id, item]));
  const members = (group?.member_ids ?? []).flatMap((id) => items.get(id) ?? []).sort(bySortThenName);
  const categories = menu.categories.filter((c) => c.archived_at === null || c.category_id === group?.category_id);
  const sortValue = /^-?\d+$/.test(sortOrder.trim()) ? Number(sortOrder.trim()) : NaN;

  const patch: Omit<PatchVariantGroupRequest, 'expected_version'> = {};
  if (group !== null) {
    if (name.trim() !== group.name) patch.name = name.trim();
    if (categoryId !== group.category_id) patch.category_id = categoryId;
    if ((description.trim() === '' ? null : description.trim()) !== group.description)
      patch.description = description.trim() === '' ? null : description.trim();
    if (sortValue !== group.sort_order) patch.sort_order = sortValue;
  }
  const labels: Record<Field | 'description', string> = {
    name: t('size_group.name'),
    category_id: t('owner.item.category'),
    sort_order: t('size_group.sort_order'),
    description: t('size_group.description'),
  };
  const changed =
    group === null
      ? name.trim() !== '' || categoryId !== ''
        ? [labels.name]
        : []
      : Object.keys(patch).map((k) => labels[k as Field | 'description']);
  useDirtyForm(changed.length === 0 || gone ? null : { name: name.trim() || title, fields: changed });

  function validate(): boolean {
    const found: Partial<Record<Field, string>> = {};
    const trimmed = name.trim();
    if (trimmed === '' || trimmed.length > 60) found.name = t('size_group.name_required');
    if (categoryId === '') found.category_id = t('size_group.category_required');
    // The server's sort_order is an int32 (01a SortOrder).
    if (!Number.isInteger(sortValue) || sortValue < -2_147_483_648 || sortValue > 2_147_483_647) {
      found.sort_order = t('size_group.sort_invalid');
      setDetailsOpen(true);
    }
    setErrors(found);
    setBanner(null);
    return Object.keys(found).length === 0;
  }

  function showError(error: CloudError) {
    const code = apiCode(error);
    if (code === 'CONFIG_STALE') {
      setStale(true);
      setBanner(null);
      return;
    }
    if (code === 'VARIANT_GROUP_NOT_FOUND') {
      setGone(true);
      return;
    }
    if (code === 'CONFIG_NAME_TAKEN') {
      setErrors({ name: t('errors.CONFIG_NAME_TAKEN') });
      return;
    }
    if (code === 'CONFIG_REFERENCE_INVALID' && error.kind === 'api') {
      const field = error.details['field'];
      const text = referenceText(error.details);
      if (field === 'category_id' || field === 'name' || field === 'sort_order') {
        setErrors({ [field]: text });
        return;
      }
      setBanner({ tone: 'danger', text });
      return;
    }
    if (code === 'CONFIG_IN_USE' && error.kind === 'api') {
      const usedBy = error.details['used_by'] as { ids?: unknown } | undefined;
      setInUse(Array.isArray(usedBy?.ids) ? usedBy.ids.filter((id): id is string => typeof id === 'string') : []);
      return;
    }
    setBanner({ tone: error.kind === 'network' ? 'warn' : 'danger', text: errorText(error) ?? '' });
  }

  async function save() {
    if (!validate()) return;
    if (group === null) {
      setBusy(true);
      const result = await api.createVariantGroup(
        {
          name: name.trim(),
          category_id: categoryId,
          description: description.trim() === '' ? null : description.trim(),
          sort_order: sortValue,
        },
        key,
      );
      setBusy(false);
      if (result.ok) {
        renew();
        navigate(`/size-groups/${encodeURIComponent(result.data.variant_group.variant_group_id)}`);
        return;
      }
      if (isKeyMismatch(result.error)) renew();
      showError(result.error);
      return;
    }
    // C9: a PATCH with only expected_version is refused, so an unchanged form just goes back.
    if (Object.keys(patch).length === 0) {
      navigate('/size-groups');
      return;
    }
    setBusy(true);
    const result = await api.patchVariantGroup(group.variant_group_id, { expected_version: group.version, ...patch });
    setBusy(false);
    if (result.ok) {
      navigate('/size-groups');
      return;
    }
    showError(result.error);
  }

  async function setArchived(next: boolean) {
    if (group === null) return;
    setBanner(null);
    setBusy(true);
    const result = await api.patchVariantGroup(group.variant_group_id, { expected_version: group.version, archived: next });
    setBusy(false);
    if (result.ok) {
      if (next) navigate('/size-groups');
      else onReload();
      return;
    }
    showError(result.error);
  }

  if (gone) return <SizeGroupGone api={api} back={back} />;

  const fixes: FixEntry[] = (Object.keys(errors) as Field[])
    .filter((field) => errors[field] !== undefined)
    .map((field) => ({ target: FIELD_ID[field], label: labels[field] }));
  const saveButton = !readOnly && (
    <BusyButton primary busy={busy} disabled={down || stale} onClick={() => void save()}>
      {group === null ? t('size_group.create') : t('size_group.save')}
    </BusyButton>
  );
  const cancel = (
    <button type="button" className="pos-btn" onClick={() => leave(() => navigate('/size-groups'))}>
      {t('common.cancel')}
    </button>
  );
  const more =
    group !== null && menu.can_edit_tenant ? (
      <MoreMenu
        label={fill(t('common.more_for'), { name: group.name })}
        info={archived ? undefined : { title: t('owner.common.archive'), detail: t('size_group.archive_info') }}
        items={
          archived
            ? [{ label: t('size_group.restore'), icon: 'reload', disabled: down || busy, onSelect: () => void setArchived(false) }]
            : [{ label: t('size_group.archive'), icon: 'archive', danger: true, disabled: down || busy, onSelect: () => void setArchived(true) }]
        }
      />
    ) : undefined;

  const stockById = new Map(stock.map((s) => [s.stock_item_id, s]));
  const drawLine = (item: MenuItem) => {
    const draw = item.stock_draws[0];
    const source = draw === undefined ? undefined : stockById.get(draw.stock_item_id);
    if (draw === undefined || source === undefined) return null;
    return fill(t('size_group.draws'), { qty: formatQuantity(draw.quantity_per_sale_unit, source.stock_unit), stock: source.name });
  };

  return (
    <Page
      api={api}
      title={title}
      start={back}
      end={
        <>
          {more}
          {!phone && !readOnly && cancel}
          {!phone && saveButton}
        </>
      }
    >
      {stale && <StaleBanner onReload={onReload} />}
      <ErrorSummary entries={fixes} />
      {banner !== null && <Banner tone={banner.tone} text={banner.text} />}
      {archived && <Banner tone="info" text={t('size_group.archived_note')} />}
      <div className="pos-stack pos-c01form">
        <section className="pos-section">
          <div className="pos-fold__head">
            <div className="pos-section__head">
              <h2>{t('size_group.section')}</h2>
            </div>
          </div>
          <div className="pos-grid">
            <label className={`pos-field${errors.name !== undefined ? ' pos-field--error' : ''}`}>
              <span className="pos-field__label">{t('size_group.name')}</span>
              <input
                id={FIELD_ID.name}
                className="pos-input"
                name="name"
                maxLength={60}
                placeholder={t('size_group.name_placeholder')}
                value={name}
                disabled={readOnly}
                onChange={(e) => setName(e.target.value)}
              />
              {errors.name !== undefined && <span className="pos-field__error">{errors.name}</span>}
              <span className="pos-field__help">{t('size_group.name_help')}</span>
            </label>
            <label className={`pos-field${errors.category_id !== undefined ? ' pos-field--error' : ''}`}>
              <span className="pos-field__label">{t('owner.item.category')}</span>
              <select
                id={FIELD_ID.category_id}
                className="pos-select"
                name="category_id"
                value={categoryId}
                disabled={readOnly}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                {categoryId === '' && <option value="">{t('size_group.category_pick')}</option>}
                {categories.map((c) => (
                  <option key={c.category_id} value={c.category_id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {errors.category_id !== undefined && <span className="pos-field__error">{errors.category_id}</span>}
              <span className="pos-field__help">{t('size_group.category_help')}</span>
            </label>
          </div>
          <button
            type="button"
            className="pos-disclosure pos-disclosure--soft"
            aria-expanded={detailsOpen}
            aria-controls={detailsOpen ? 'sg-details' : undefined}
            onClick={() => setDetailsOpen(!detailsOpen)}
          >
            <Icon name="edit" />
            <span>
              {t('size_group.details')} <small>· {t('size_group.optional')}</small>
            </span>
            <Icon name="chevron" />
          </button>
          {detailsOpen && (
            <div className="pos-grid" id="sg-details">
              <label className="pos-field">
                <span className="pos-field__label">{t('size_group.description')}</span>
                <input
                  className="pos-input"
                  name="description"
                  maxLength={300}
                  value={description}
                  disabled={readOnly}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label className={`pos-field${errors.sort_order !== undefined ? ' pos-field--error' : ''}`}>
                <span className="pos-field__label">{t('size_group.sort_order')}</span>
                <input
                  id={FIELD_ID.sort_order}
                  className="pos-input pos-input--mono"
                  name="sort_order"
                  inputMode="numeric"
                  value={sortOrder}
                  disabled={readOnly}
                  onChange={(e) => setSortOrder(e.target.value)}
                />
                {errors.sort_order !== undefined && <span className="pos-field__error">{errors.sort_order}</span>}
              </label>
            </div>
          )}
        </section>

        <section className="pos-section" data-sizes="">
          <div className="pos-fold__head">
            <div className="pos-section__head">
              <h2>{t('size_group.sizes')}</h2>
              {group !== null && <p>{t('size_group.sizes_help')}</p>}
            </div>
            {group === null ? (
              <button type="button" className="pos-btn" disabled>
                <Icon name="plus" />
                {t('size_group.add_size')}
              </button>
            ) : (
              menu.can_edit_tenant &&
              !archived && (
                <a className="pos-btn" href={newSizeHref(group.variant_group_id)} onClick={(e) => {
                  e.preventDefault();
                  leave(() => navigate(newSizeHref(group.variant_group_id).slice(1)));
                }}>
                  <Icon name="plus" />
                  {t('size_group.add_size')}
                </a>
              )
            )}
          </div>
          {group === null ? (
            <p className="pos-note">{t('size_group.sizes_note_new')}</p>
          ) : (
            <>
              {members.length === 0 ? (
                <p className="pos-note">{t('size_group.no_sizes')}</p>
              ) : (
                <ul className="pos-list pos-list--sizes">
                  {members.map((item) => {
                    const line = drawLine(item);
                    return (
                      <li key={item.item_id} className="pos-list__row" data-item-id={item.item_id}>
                        <div className="pos-list__name">
                          <strong>{item.name}</strong>
                          {line !== null && <span>{line}</span>}
                        </div>
                        <span className="pos-list__num">
                          {t('owner.menu.rupees')} <span className="num">{shownRupees(item.price_minor)}</span>
                        </span>
                        {item.archived_at === null ? (
                          <span className="pos-chip pos-chip--ok">
                            <Icon name="check" />
                            {t('size_group.on_sale')}
                          </span>
                        ) : (
                          <span className="pos-chip">
                            <Icon name="archive" />
                            {t('owner.common.archived')}
                          </span>
                        )}
                        <a
                          className="pos-btn"
                          href={itemHref(item.item_id)}
                          aria-label={fill(t('c01.open_named'), { name: item.name })}
                          onClick={(e) => {
                            e.preventDefault();
                            leave(() => navigate(itemHref(item.item_id).slice(1)));
                          }}
                        >
                          {t('in_use.open')}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="pos-note">{t('size_group.sizes_note')}</p>
            </>
          )}
        </section>
      </div>
      {phone && !readOnly && <ActionBar>{saveButton}</ActionBar>}
      {inUse !== null && group !== null && (
        <InUseDialog
          name={group.name}
          body={t('size_group.in_use_body')}
          rows={inUse.flatMap((id) => {
            const item = items.get(id);
            return item === undefined ? [] : [{ name: item.name, href: itemHref(id) }];
          })}
          unnamed={inUse.filter((id) => !items.has(id)).length}
          onClose={() => setInUse(null)}
        />
      )}
    </Page>
  );
}
