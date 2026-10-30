import { parseQuantity } from '@pos/domain';
import type { PatchDealRequest } from '@pos/events';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AvailabilityWindow, CloudAdmin, CloudError, Deal, DealBranch, MenuItem } from '../../../api/cloud-admin';
import { usePhone } from '../../../app/phone';
import { navigate } from '../../../app/router';
import { ActionBar } from '../../../components/ActionBar';
import { Banner } from '../../../components/Banner';
import { BranchRow } from '../../../components/BranchRow';
import { BusyButton } from '../../../components/BusyButton';
import { ErrorSummary, type FixEntry } from '../../../components/ErrorSummary';
import { Gone } from '../../../components/Gone';
import { Icon } from '../../../components/Icon';
import { MoreMenu } from '../../../components/MoreMenu';
import { RemovedRows } from '../../../components/RemovedRows';
import { Skeleton } from '../../../components/Skeleton';
import { StaleBanner } from '../../../components/StaleBanner';
import { Switch } from '../../../components/Switch';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { useBranchName } from '../branch';
import { apiCode, BackLink, referenceText } from '../c01';
import { useCloudDown } from '../cloud';
import { errorText, isKeyMismatch, useIdempotencyKey } from '../form';
import { useDirtyForm, useLeave } from '../guard';
import { windowText, WindowsField } from '../menu/WindowsField';
import { loadWholeMenu, type WholeMenu } from '../menu-pages';
import { formatRupees, parseRupees, shownRupees } from '../money';
import { Page } from '../Shell';
import { ChoicePicker, MAX_CHOICES } from './ChoicePicker';
import { omissions, omissionText, partAffix, quantityInput, unitWord, type SaleUnit } from './deals';

// 01c-S05 (§8 "Views", §6.13–§6.15; CHANGES §2, Q14) and 01c-S11 (§6.16). Name, deal price, category, tax,
// Hours (a disclosure, 01a-C01), description and order; numbered part cards with the quantity in the choices'
// sale unit, "Fixed" (one choice, "Included") or "Customer picks one" (extra price per choice); choices added with
// 01c-D03. A new deal is a POST with the form's Idempotency-Key (no ids); an edit PATCHes the changed fields
// with expected_version, the parts sent whole with their deal_part_id (§8 "Ids"); a part left out is archived
// and listed under "Removed" with Restore (archived parts come back by id, "A removed part" until the wire
// carries their content, Q14). 422 parts.N.choices.M… map to the row as sent (§8 "Errors"); 409 CONFIG_STALE
// → 01c-B03; 404 → the form is replaced (Q17). "At each branch": Sold here · Price here, each row its own §6.16
// PUT with its version, plus the 01c-B04 warning. Read-only with can_edit_tenant false; branch rows stay editable.
const MAX_PARTS = 10;
const MAX_MINOR = 1_000_000_000;
const MAX_QUANTITY = 1_000_000;

interface Loaded {
  canEditTenant: boolean;
  deal: Deal | null;
  menu: WholeMenu;
}

async function findDeal(api: CloudAdmin, dealId: string) {
  const [active, archived] = await Promise.all([api.listDeals(), api.listDeals({ status: 'archived' })]);
  if (!active.ok) return active;
  const all = [...active.data.deals, ...(archived.ok ? archived.data.deals : [])];
  return { ok: true as const, data: { canEditTenant: active.data.can_edit_tenant, deal: all.find((d) => d.deal_id === dealId) ?? null } };
}

export function DealForm({ api, dealId }: { api: CloudAdmin; dealId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  const load = useCallback(async () => {
    const [found, menu] = await Promise.all([findDeal(api, dealId), loadWholeMenu(api)]);
    if (!found.ok || !menu.ok) {
      setLoadError(errorText(!found.ok ? found.error : (menu as { ok: false; error: CloudError }).error));
      return;
    }
    setLoaded({ ...found.data, menu: menu.data });
    setLoadError(null);
    setGeneration((g) => g + 1);
  }, [api, dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = <BackLink href="#/deals" list={t('deals.title')} label={t('deal.back_label')} />;

  if (loaded === null) {
    return (
      <Page api={api} title={t('deals.title')} start={back}>
        {loadError !== null ? <Banner tone="danger" text={loadError} /> : <Skeleton lines={6} />}
      </Page>
    );
  }
  if (dealId !== 'new' && loaded.deal === null) return <DealGone api={api} back={back} />;
  return (
    <Editor
      key={generation}
      api={api}
      canEditTenant={loaded.canEditTenant}
      deal={dealId === 'new' ? null : loaded.deal}
      menu={loaded.menu}
      back={back}
      onReload={() => void load()}
    />
  );
}

function DealGone({ api, back }: { api: CloudAdmin; back: ReactNode }) {
  return (
    <Page api={api} title={t('deal.title')} start={back}>
      <Gone
        title={t('deal.gone_title')}
        body={t('c01.gone_body')}
        back={fill(t('c01.back_to'), { list: t('deals.title') })}
        onBack={() => navigate('/deals')}
      />
    </Page>
  );
}

interface ChoiceDraft {
  item_id: string;
  extra: string;
}
interface PartDraft {
  key: string;
  deal_part_id?: string;
  quantity: string;
  choices: ChoiceDraft[];
  restored?: boolean;
}

let draftSeq = 0;
const nextKey = () => `p${++draftSeq}`;

function storedParts(deal: Deal | null, items: ReadonlyMap<string, MenuItem>): PartDraft[] {
  if (deal === null) return [];
  return [...deal.parts]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((part) => {
      const choices = [...part.choices].sort((a, b) => a.sort_order - b.sort_order);
      const unit = items.get(choices[0]?.item_id ?? '')?.sale_unit ?? 'piece';
      return {
        key: nextKey(),
        deal_part_id: part.deal_part_id,
        quantity: quantityInput(part.quantity, unit),
        choices: choices.map((c) => ({ item_id: c.item_id, extra: formatRupees(c.extra_price_minor) })),
      };
    });
}

type Errors = Record<string, string>;

// A 422 field path → the row as sent (§8 "Errors"): parts.N.choices.M… → that choice, parts.N… → that part.
function errorKeyOf(field: string): string {
  const choice = /^parts\.(\d+)\.choices\.(\d+)/.exec(field);
  if (choice !== null) return `parts.${choice[1]}.choices.${choice[2]}`;
  const part = /^parts\.(\d+)/.exec(field);
  if (part !== null) return `parts.${part[1]}`;
  return field.split('.')[0] ?? field;
}

const FIELD_ID: Record<string, string> = {
  name: 'deal-name',
  price_minor: 'deal-price',
  category_id: 'deal-category',
  tax_class_id: 'deal-tax',
  availability_windows: 'deal-hours',
  sort_order: 'deal-sort',
  parts: 'deal-parts',
};

function Editor({
  api,
  canEditTenant,
  deal,
  menu,
  back,
  onReload,
}: {
  api: CloudAdmin;
  canEditTenant: boolean;
  deal: Deal | null;
  menu: WholeMenu;
  back: ReactNode;
  onReload: () => void;
}) {
  const items = new Map(menu.items.map((item) => [item.item_id, item]));
  const [initialParts] = useState(() => storedParts(deal, items));
  const categories = menu.categories.filter((c) => c.archived_at === null || c.category_id === deal?.category_id);
  const taxes = menu.tax_classes.filter((x) => x.archived_at === null || x.tax_class_id === deal?.tax_class_id);
  const [name, setName] = useState(deal?.name ?? '');
  const [price, setPrice] = useState(deal === null ? '' : shownRupees(deal.price_minor));
  // DealNew draws the first category chosen (brief: default UNKNOWN).
  const [categoryId, setCategoryId] = useState(deal?.category_id ?? categories.find((c) => c.archived_at === null)?.category_id ?? '');
  const [taxId, setTaxId] = useState(deal?.tax_class_id ?? '');
  const [windows, setWindows] = useState<AvailabilityWindow[] | null>(deal?.availability_windows ?? []);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [description, setDescription] = useState(deal?.description ?? '');
  const [sortOrder, setSortOrder] = useState(String(deal?.sort_order ?? 0));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [parts, setParts] = useState<PartDraft[]>(initialParts);
  // Parts removed in this session (archived on save; Restore brings the whole draft back).
  const [dropped, setDropped] = useState<PartDraft[]>([]);
  const [restoredIds, setRestoredIds] = useState<string[]>([]);
  const [picking, setPicking] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<{ tone: 'danger' | 'warn'; text: string } | null>(null);
  const [stale, setStale] = useState(false);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rowDirty, setRowDirty] = useState<ReadonlySet<string>>(new Set());
  const { key, renew } = useIdempotencyKey();
  const down = useCloudDown(api);
  const leave = useLeave();
  const phone = usePhone();
  const branchName = useBranchName();

  const archived = deal !== null && deal.archived_at !== null;
  const readOnly = !canEditTenant || archived;
  const title = deal === null ? t('deal.new_title') : deal.name;
  const unitOf = (part: PartDraft): SaleUnit | null => items.get(part.choices[0]?.item_id ?? '')?.sale_unit ?? null;

  // The body the form would send: the parts whole, in order, each with its id when it has one.
  function partsBody(withIds: boolean) {
    return parts.map((part, i) => {
      const unit = unitOf(part) ?? 'piece';
      const q = parseQuantity(part.quantity, unit);
      return {
        ...(withIds && part.deal_part_id !== undefined ? { deal_part_id: part.deal_part_id } : {}),
        quantity: q.ok ? q.value : NaN,
        sort_order: i,
        choices: part.choices.map((c, j) => {
          const extra = part.choices.length === 1 ? { ok: true as const, value: 0 } : parseRupees(c.extra === '' ? '0' : c.extra);
          return { item_id: c.item_id, extra_price_minor: extra.ok ? extra.value : NaN, sort_order: j };
        }),
      };
    });
  }
  const sentWindows = windows ?? [];
  const priceValue = parseRupees(price);
  const descriptionValue = description.trim() === '' ? null : description.trim();
  const sortValue = /^-?\d+$/.test(sortOrder.trim()) ? Number(sortOrder.trim()) : NaN;

  const patch: Omit<PatchDealRequest, 'expected_version'> = {};
  if (deal !== null) {
    if (name.trim() !== deal.name) patch.name = name.trim();
    if (!priceValue.ok || priceValue.value !== deal.price_minor) patch.price_minor = priceValue.ok ? priceValue.value : NaN;
    if (categoryId !== deal.category_id) patch.category_id = categoryId;
    if ((taxId === '' ? null : taxId) !== deal.tax_class_id) patch.tax_class_id = taxId === '' ? null : taxId;
    if (JSON.stringify(sentWindows) !== JSON.stringify(deal.availability_windows.map((w) => ({ start_ms: w.start_ms, end_ms: w.end_ms }))))
      patch.availability_windows = sentWindows;
    if (descriptionValue !== deal.description) patch.description = descriptionValue;
    if (sortValue !== deal.sort_order) patch.sort_order = sortValue;
    const stored = JSON.stringify(
      [...deal.parts]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((p, i) => ({
          deal_part_id: p.deal_part_id,
          quantity: p.quantity,
          sort_order: i,
          choices: [...p.choices].sort((a, b) => a.sort_order - b.sort_order).map((c, j) => ({ item_id: c.item_id, extra_price_minor: c.extra_price_minor, sort_order: j })),
        })),
    );
    if (JSON.stringify(partsBody(true)) !== stored) patch.parts = partsBody(true);
  }
  const labels: Record<string, string> = {
    name: t('deal.name'),
    price_minor: t('deal.price'),
    category_id: t('owner.item.category'),
    tax_class_id: t('deal.tax'),
    availability_windows: t('deal.hours'),
    description: t('size_group.description'),
    sort_order: t('size_group.sort_order'),
    parts: t('deal.parts'),
  };
  const changed = [
    ...(deal === null ? (name.trim() !== '' || parts.length > 0 ? [labels.name ?? ''] : []) : Object.keys(patch).map((k) => labels[k] ?? k)),
    ...[...rowDirty].map(branchName),
  ];
  useDirtyForm(changed.length === 0 || gone ? null : { name: name.trim() || title, fields: changed });

  const onRowDirty = useCallback((branchId: string, dirty: boolean) => {
    setRowDirty((prev) => {
      if (prev.has(branchId) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(branchId);
      else next.delete(branchId);
      return next;
    });
  }, []);

  function validate(): boolean {
    const found: Errors = {};
    const trimmed = name.trim();
    if (trimmed === '' || trimmed.length > 60) found.name = t('deal.name_required');
    if (!priceValue.ok || priceValue.value > MAX_MINOR) found.price_minor = t('deal.price_invalid');
    if (categoryId === '') found.category_id = t('deal.category_required');
    if (windows === null) found.availability_windows = t('owner.hours.invalid');
    if (!Number.isSafeInteger(sortValue)) found.sort_order = t('size_group.sort_invalid');
    if (parts.length === 0) found.parts = t('deal.parts_required');
    partsBody(false).forEach((part, i) => {
      if (part.choices.length === 0) found[`parts.${i}`] = t('deal.part_needs_choice');
      else if (!Number.isSafeInteger(part.quantity) || part.quantity < 1 || part.quantity > MAX_QUANTITY)
        found[`parts.${i}`] = t('deal.quantity_invalid');
      part.choices.forEach((c, j) => {
        if (!Number.isSafeInteger(c.extra_price_minor) || c.extra_price_minor > MAX_MINOR) found[`parts.${i}.choices.${j}`] = t('deal.extra_invalid');
      });
    });
    setErrors(found);
    setBanner(null);
    if (found.availability_windows !== undefined) setHoursOpen(true);
    if (found.sort_order !== undefined) setDetailsOpen(true);
    return Object.keys(found).length === 0;
  }

  function showError(error: CloudError) {
    const code = apiCode(error);
    if (code === 'CONFIG_STALE') {
      setStale(true);
      setBanner(null);
      return;
    }
    if (code === 'DEAL_NOT_FOUND') {
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
      if (typeof field === 'string' && field !== '') setErrors({ [errorKeyOf(field)]: text });
      else setBanner({ tone: 'danger', text });
      return;
    }
    setBanner({ tone: error.kind === 'network' ? 'warn' : 'danger', text: errorText(error) ?? '' });
  }

  async function save() {
    if (!validate()) return;
    if (deal === null) {
      setBusy(true);
      const result = await api.createDeal(
        {
          name: name.trim(),
          category_id: categoryId,
          tax_class_id: taxId === '' ? null : taxId,
          description: descriptionValue,
          sort_order: sortValue,
          price_minor: priceValue.ok ? priceValue.value : 0,
          availability_windows: sentWindows,
          parts: partsBody(false).map((part) => ({ quantity: part.quantity, sort_order: part.sort_order, choices: part.choices })),
        },
        key,
      );
      setBusy(false);
      if (result.ok) {
        renew();
        // A new deal is sold nowhere until a branch says "Sold here", so it opens as an edit (S11 rows).
        navigate(`/deals/${encodeURIComponent(result.data.deal.deal_id)}`);
        return;
      }
      if (isKeyMismatch(result.error)) renew();
      showError(result.error);
      return;
    }
    const done = () => (rowDirty.size === 0 ? navigate('/deals') : leave(() => navigate('/deals')));
    if (Object.keys(patch).length === 0) {
      done();
      return;
    }
    setBusy(true);
    const result = await api.patchDeal(deal.deal_id, { expected_version: deal.version, ...patch });
    setBusy(false);
    if (result.ok) {
      done();
      return;
    }
    showError(result.error);
  }

  async function setArchived(next: boolean) {
    if (deal === null) return;
    setBanner(null);
    setBusy(true);
    const result = await api.patchDeal(deal.deal_id, { expected_version: deal.version, archived: next });
    setBusy(false);
    if (result.ok) {
      if (next) navigate('/deals');
      else onReload();
      return;
    }
    showError(result.error);
  }

  function updatePart(index: number, change: (part: PartDraft) => PartDraft) {
    setParts((prev) => prev.map((p, i) => (i === index ? change(p) : p)));
    setErrors((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) if (k === `parts.${index}` || k.startsWith(`parts.${index}.`) || k === 'parts') delete next[k];
      return next;
    });
  }
  function removePart(index: number) {
    const part = parts[index];
    if (part === undefined) return;
    if (part.deal_part_id !== undefined) setDropped((prev) => [...prev, part]);
    setParts((prev) => prev.filter((_, i) => i !== index));
    setErrors({});
  }
  function restore(id: string) {
    const draft = dropped.find((p) => p.key === id);
    if (draft !== undefined) {
      setDropped((prev) => prev.filter((p) => p.key !== id));
      setParts((prev) => [...prev, draft]);
      return;
    }
    // An archived part (§6.15 "restored by its id"): the wire has its id only (Q14), so it comes back empty.
    setRestoredIds((prev) => [...prev, id]);
    setParts((prev) => [...prev, { key: nextKey(), deal_part_id: id, quantity: '1', choices: [], restored: true }]);
  }

  if (gone) return <DealGone api={api} back={back} />;

  const errorFor = (prefix: string) => Object.entries(errors).filter(([k]) => k === prefix || k.startsWith(`${prefix}.`));
  const fixes: FixEntry[] = [
    ...['name', 'price_minor', 'category_id', 'tax_class_id', 'availability_windows', 'sort_order', 'parts']
      .filter((k) => errors[k] !== undefined)
      .map((k) => ({ target: FIELD_ID[k] ?? k, label: labels[k] ?? k })),
    ...parts.flatMap((_, i) =>
      errorFor(`parts.${i}`).length > 0 ? [{ target: `deal-part-${i}`, label: fill(t('deal.part_n'), { n: String(i + 1) }) }] : [],
    ),
  ];
  const saveButton = !readOnly && (
    <BusyButton primary busy={busy} disabled={down || stale || picking !== null} onClick={() => void save()}>
      {deal === null ? t('deal.create') : t('deal.save')}
    </BusyButton>
  );
  const more =
    deal !== null && canEditTenant ? (
      <MoreMenu
        label={fill(t('common.more_for'), { name: deal.name })}
        info={archived ? undefined : { title: t('owner.common.archive'), detail: t('deal.archive_info') }}
        items={
          archived
            ? [{ label: t('deal.restore'), icon: 'reload', disabled: down || busy, onSelect: () => void setArchived(false) }]
            : [{ label: t('deal.archive'), icon: 'archive', danger: true, disabled: down || busy, onSelect: () => void setArchived(true) }]
        }
      />
    ) : undefined;
  const fieldClass = (k: string) => `pos-field${errors[k] !== undefined ? ' pos-field--error' : ''}`;
  const fieldError = (k: string) => errors[k] !== undefined && <span className="pos-field__error">{errors[k]}</span>;
  const removedRows = [
    ...dropped.map((p) => ({ id: p.key, label: partLabel(p, items) })),
    ...(deal?.archived_parts ?? []).filter((p) => !restoredIds.includes(p.deal_part_id)).map((p) => ({ id: p.deal_part_id, label: t('deal.removed_part') })),
  ];
  const addPart = (
    <button
      type="button"
      className={`pos-btn${phone ? ' pos-btn--block' : ''}`}
      disabled={readOnly || parts.length >= MAX_PARTS}
      onClick={() => {
        setParts((prev) => [...prev, { key: nextKey(), quantity: '1', choices: [] }]);
        setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== 'parts')));
      }}
    >
      <Icon name="plus" />
      {t('deal.add_part')}
    </button>
  );
  const pickingIndex = parts.findIndex((p) => p.key === picking);
  const pickingPart = parts[pickingIndex];
  const hoursSummary = sentWindows.length === 0 ? t('deal.all_day') : sentWindows.map(windowText).join(', ');

  return (
    <Page
      api={api}
      title={title}
      start={back}
      end={
        <>
          {more}
          {!phone && !readOnly && (
            <button type="button" className="pos-btn" onClick={() => leave(() => navigate('/deals'))}>
              {t('common.cancel')}
            </button>
          )}
          {!phone && saveButton}
        </>
      }
    >
      {stale && <StaleBanner onReload={onReload} />}
      <ErrorSummary entries={fixes} />
      {banner !== null && <Banner tone={banner.tone} text={banner.text} />}
      {archived && <Banner tone="info" text={t('deal.archived_note')} />}
      <div className="pos-stack pos-c01form pos-dealform">
        <section className="pos-section">
          <div className="pos-fold__head">
            <div className="pos-section__head">
              <h2>{t('deal.section')}</h2>
            </div>
          </div>
          <div className="pos-grid">
            <label className={fieldClass('name')}>
              <span className="pos-field__label">{t('deal.name')}</span>
              <input
                id={FIELD_ID.name}
                className="pos-input"
                name="name"
                maxLength={60}
                placeholder={t('deal.name_placeholder')}
                value={name}
                disabled={readOnly}
                onChange={(e) => setName(e.target.value)}
              />
              {fieldError('name')}
            </label>
            <label className={fieldClass('price_minor')}>
              <span className="pos-field__label">{t('deal.price')}</span>
              <span className="pos-input-affix">
                <span>{t('owner.menu.rupees')}</span>
                <input
                  id={FIELD_ID.price_minor}
                  className="pos-input pos-input--mono"
                  name="price_minor"
                  inputMode="decimal"
                  value={price}
                  disabled={readOnly}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </span>
              {fieldError('price_minor')}
            </label>
          </div>
          <div className="pos-grid">
            <label className={fieldClass('category_id')}>
              <span className="pos-field__label">{t('owner.item.category')}</span>
              <select
                id={FIELD_ID.category_id}
                className="pos-select"
                name="category_id"
                value={categoryId}
                disabled={readOnly}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                {categoryId === '' && <option value="">{t('deal.category_pick')}</option>}
                {categories.map((c) => (
                  <option key={c.category_id} value={c.category_id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {fieldError('category_id')}
            </label>
            <label className={fieldClass('tax_class_id')}>
              <span className="pos-field__label">{t('deal.tax')}</span>
              <select
                id={FIELD_ID.tax_class_id}
                className="pos-select"
                name="tax_class_id"
                value={taxId}
                disabled={readOnly}
                onChange={(e) => setTaxId(e.target.value)}
              >
                <option value="">{t('deal.no_tax')}</option>
                {taxes.map((x) => (
                  <option key={x.tax_class_id} value={x.tax_class_id}>
                    {`${x.name} (${x.rate_bp / 100} %)`}
                  </option>
                ))}
              </select>
              {fieldError('tax_class_id')}
              {!phone && <span className="pos-field__help">{t('deal.tax_help')}</span>}
            </label>
          </div>
          <button
            type="button"
            id={FIELD_ID.availability_windows}
            className="pos-disclosure pos-disclosure--soft"
            aria-expanded={hoursOpen}
            aria-controls={hoursOpen ? 'deal-hours-body' : undefined}
            onClick={() => setHoursOpen(!hoursOpen)}
          >
            <Icon name="clock" />
            <span>
              {t('deal.hours')} <small>· {hoursSummary}</small>
            </span>
            <Icon name="chevron" />
          </button>
          {hoursOpen && (
            <fieldset className={`pos-dealform__hours ${fieldClass('availability_windows')}`} id="deal-hours-body" disabled={readOnly}>
              <WindowsField value={deal?.availability_windows ?? []} onChange={setWindows} />
              {fieldError('availability_windows')}
            </fieldset>
          )}
          <button
            type="button"
            className="pos-disclosure pos-disclosure--soft"
            aria-expanded={detailsOpen}
            aria-controls={detailsOpen ? 'deal-details' : undefined}
            onClick={() => setDetailsOpen(!detailsOpen)}
          >
            <Icon name="edit" />
            <span>
              {t('size_group.details')} <small>· {t('size_group.optional')}</small>
            </span>
            <Icon name="chevron" />
          </button>
          {detailsOpen && (
            <div className="pos-grid" id="deal-details">
              <label className="pos-field">
                <span className="pos-field__label">{t('size_group.description')}</span>
                <input
                  className="pos-input"
                  name="description"
                  maxLength={200}
                  value={description}
                  disabled={readOnly}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label className={fieldClass('sort_order')}>
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
                {fieldError('sort_order')}
              </label>
            </div>
          )}
        </section>

        <section className="pos-section" id={FIELD_ID.parts} data-parts="">
          <div className="pos-fold__head">
            <div className="pos-section__head">
              <h2>{t('deal.parts')}</h2>
              {!phone && <p>{t('deal.parts_help')}</p>}
            </div>
            {!phone && !readOnly && addPart}
          </div>
          {parts.length === 0 && <p className={`pos-note${errors.parts !== undefined ? ' pos-field__error' : ''}`}>{errors.parts ?? t('deal.first_part')}</p>}
          {parts.length > 0 && (
            <div className="pos-parts">
              {parts.map((part, i) => {
                const unit = unitOf(part);
                const q = parseQuantity(part.quantity, unit ?? 'piece');
                const partErrors = errorFor(`parts.${i}`);
                const n = String(i + 1);
                return (
                  <div key={part.key} className={`pos-part${partErrors.length > 0 ? ' is-error' : ''}`} id={`deal-part-${i}`} data-part={i + 1}>
                    <div className="pos-part__head">
                      <span className="pos-part__n">{n}</span>
                      <div className="pos-part__title">
                        {fill(t('deal.part_n'), { n })}
                        <small>
                          {part.choices.length === 0
                            ? t('deal.part_no_choice')
                            : part.choices.length === 1
                              ? t('deal.part_fixed')
                              : t('deal.part_pick_one')}
                        </small>
                      </div>
                      <span className="pos-input-affix">
                        <input
                          className="pos-input pos-input--mono"
                          name={`parts.${i}.quantity`}
                          inputMode={unit === null || unit === 'piece' ? 'numeric' : 'decimal'}
                          aria-label={t('deal.quantity')}
                          value={part.quantity}
                          disabled={readOnly}
                          onChange={(e) => updatePart(i, (p) => ({ ...p, quantity: e.target.value }))}
                        />
                        <span>{partAffix(unit ?? 'piece', q.ok ? q.value : null)}</span>
                      </span>
                      {!readOnly && (
                        <button
                          type="button"
                          className="pos-iconbtn"
                          aria-label={fill(t('deal.remove_part'), { n })}
                          onClick={() => removePart(i)}
                        >
                          <Icon name="trash" />
                        </button>
                      )}
                    </div>
                    {part.restored === true && part.choices.length === 0 && <p className="pos-note">{t('deal.restored_note')}</p>}
                    {part.choices.length > 0 && (
                      <div className="pos-choices">
                        {part.choices.map((choice, j) => {
                          const item = items.get(choice.item_id);
                          const itemName = item?.name ?? '…';
                          const category = menu.categories.find((c) => c.category_id === item?.category_id)?.name ?? '';
                          return (
                            <div
                              key={choice.item_id}
                              className={`pos-choice${errors[`parts.${i}.choices.${j}`] !== undefined ? ' is-error' : ''}`}
                              data-choice={choice.item_id}
                            >
                              <span>
                                {itemName}
                                <small>
                                  {[category, item === undefined ? '' : fill(t('deal.sold_by'), { unit: unitWord(item.sale_unit) })]
                                    .filter((s) => s !== '')
                                    .join(' · ')}
                                </small>
                              </span>
                              {part.choices.length === 1 ? (
                                <span className="pos-choice__fixed">{t('deal.included')}</span>
                              ) : (
                                <span className="pos-input-affix">
                                  <span>+{t('owner.menu.rupees')}</span>
                                  <input
                                    className="pos-input pos-input--mono"
                                    name={`parts.${i}.choices.${j}.extra_price_minor`}
                                    inputMode="decimal"
                                    aria-label={`${t('deal.extra')} · ${itemName}`}
                                    value={choice.extra}
                                    disabled={readOnly}
                                    onChange={(e) =>
                                      updatePart(i, (p) => ({
                                        ...p,
                                        choices: p.choices.map((c, k) => (k === j ? { ...c, extra: e.target.value } : c)),
                                      }))
                                    }
                                  />
                                </span>
                              )}
                              {!readOnly ? (
                                <button
                                  type="button"
                                  className="pos-iconbtn"
                                  aria-label={fill(t('deal.remove_choice'), { name: itemName })}
                                  onClick={() =>
                                    updatePart(i, (p) => {
                                      const rest = p.choices.filter((_, k) => k !== j);
                                      // A single choice is "Included" (§6.14: extra 0).
                                      return { ...p, choices: rest.length === 1 ? rest.map((c) => ({ ...c, extra: '0' })) : rest };
                                    })
                                  }
                                >
                                  <Icon name="x" />
                                </button>
                              ) : (
                                <span />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {partErrors.map(([k, text]) => (
                      <span key={k} className="pos-field__error" data-part-error={k}>
                        <Icon name="alert" />
                        {/\.choices\.\d+$/.test(k) ? `${items.get(part.choices[Number(k.split('.').at(-1))]?.item_id ?? '')?.name ?? ''}: ${text}` : text}
                      </span>
                    ))}
                    {!readOnly && (
                      <div className="pos-row">
                        <button
                          type="button"
                          className="pos-btn"
                          disabled={part.choices.length >= MAX_CHOICES}
                          onClick={() => setPicking(part.key)}
                        >
                          <Icon name="plus" />
                          {t('deal.add_choice')}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {phone && !readOnly && addPart}
          <RemovedRows rows={removedRows} onRestore={restore} disabled={readOnly || parts.length >= MAX_PARTS} />
        </section>

        <section className="pos-section" data-branches="">
          <div className="pos-fold__head">
            <div className="pos-section__head">
              <h2>{t('c01.at_each_branch')}</h2>
              {!phone && <p>{t('deal.branches_help')}</p>}
            </div>
          </div>
          {deal === null ? (
            <p className="pos-note">{t('deal.branches_after_create')}</p>
          ) : (
            <div className="pos-branches">
              {deal.branches.map((entry) => (
                <DealBranchRow
                  key={entry.branch_id}
                  api={api}
                  deal={deal}
                  entry={entry}
                  items={items}
                  down={down}
                  onDirty={onRowDirty}
                  onGone={() => setGone(true)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
      {phone && !readOnly && <ActionBar>{saveButton}</ActionBar>}
      {pickingPart !== undefined && (
        <ChoicePicker
          part={pickingIndex + 1}
          quantity={(() => {
            const q = parseQuantity(pickingPart.quantity, unitOf(pickingPart) ?? 'piece');
            return q.ok ? q.value : null;
          })()}
          unit={unitOf(pickingPart)}
          items={menu.items}
          categories={menu.categories}
          current={pickingPart.choices.map((c) => c.item_id)}
          inOtherParts={new Set(parts.filter((p) => p.key !== pickingPart.key).flatMap((p) => p.choices.map((c) => c.item_id)))}
          onClose={() => setPicking(null)}
          onAdd={(ids) => {
            updatePart(pickingIndex, (p) => {
              const choices = [...p.choices, ...ids.map((item_id) => ({ item_id, extra: '0' }))];
              return { ...p, choices };
            });
            setPicking(null);
          }}
        />
      )}
    </Page>
  );
}

// "4 × Naan or Roghni naan" for a part removed in this session.
function partLabel(part: PartDraft, items: ReadonlyMap<string, MenuItem>): string {
  const names = part.choices.map((c) => items.get(c.item_id)?.name ?? '…').join(' / ');
  return names === '' ? t('deal.removed_part') : `${part.quantity} × ${names}`;
}

// 01c-S11: one "At each branch" row, "Sold here" switch · "Price here" (empty = the deal price), saved with its
// own §6.16 PUT and that row's version (no key). "Sold here" off sends no price (§6.16: a price with it is a 400);
// a withdraw answers { branch: null } and the row's new "no row" version is re-read (§5.4). The 01c-B04 warning
// for this branch shows on the row.
function DealBranchRow({
  api,
  deal,
  entry,
  items,
  down,
  onDirty,
  onGone,
}: {
  api: CloudAdmin;
  deal: Deal;
  entry: DealBranch;
  items: ReadonlyMap<string, MenuItem>;
  down: boolean;
  onDirty: (branchId: string, dirty: boolean) => void;
  onGone: () => void;
}) {
  const branchName = useBranchName();
  const [stored, setStored] = useState(entry);
  const [sold, setSold] = useState(entry.is_sold);
  const [price, setPrice] = useState(entry.price_minor_override === null ? '' : shownRupees(entry.price_minor_override));
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [priceError, setPriceError] = useState<string | undefined>(undefined);
  const name = branchName(stored.branch_id);

  const storedPrice = stored.price_minor_override === null ? '' : formatRupees(stored.price_minor_override);
  const typed = price.trim() === '' ? '' : (() => {
    const p = parseRupees(price);
    return p.ok ? formatRupees(p.value) : price.trim();
  })();
  const dirty = sold !== stored.is_sold || (sold && typed !== storedPrice);
  useEffect(() => onDirty(stored.branch_id, dirty), [onDirty, stored.branch_id, dirty]);

  function reset(next: DealBranch) {
    setStored(next);
    setSold(next.is_sold);
    setPrice(next.price_minor_override === null ? '' : shownRupees(next.price_minor_override));
    setStale(false);
    setError(undefined);
    setPriceError(undefined);
  }

  async function reread(): Promise<void> {
    const found = await findDeal(api, deal.deal_id);
    if (!found.ok) {
      setError(errorText(found.error) ?? undefined);
      return;
    }
    const next = found.data.deal?.branches.find((b) => b.branch_id === stored.branch_id);
    if (next === undefined) setError(t('errors.NOT_FOUND_stale'));
    else reset(next);
  }

  async function save() {
    setError(undefined);
    setPriceError(undefined);
    let override: number | null = null;
    if (sold && price.trim() !== '') {
      const parsed = parseRupees(price);
      if (!parsed.ok || parsed.value > MAX_MINOR) {
        setPriceError(t('deal.price_invalid'));
        return;
      }
      override = parsed.value;
    }
    setBusy(true);
    const result = await api.putDealBranch(deal.deal_id, stored.branch_id, {
      expected_version: stored.version,
      is_sold: sold,
      price_minor_override: sold ? override : null,
    });
    setBusy(false);
    if (result.ok) {
      if (result.data.branch === null) await reread();
      else reset(result.data.branch);
      return;
    }
    const code = apiCode(result.error);
    if (code === 'CONFIG_STALE') setStale(true);
    else if (code === 'DEAL_NOT_FOUND') onGone();
    else if (code === 'CONFIG_REFERENCE_INVALID' && result.error.kind === 'api')
      setError(result.error.details['reason'] === 'archived' ? t('deal.archived_sell') : referenceText(result.error.details));
    else if (code === 'BRANCH_NOT_FOUND') setError(t('stock_item.branch_gone'));
    else if (code === 'VALIDATION_FAILED') setPriceError(t('deal.price_invalid'));
    else setError(errorText(result.error) ?? undefined);
  }

  const warn = omissions({ parts: deal.parts, branches: [stored] }, items);
  const chips = (
    <>
      {stored.is_sold ? (
        <>
          <span className="pos-chip pos-chip--ok">
            <Icon name="check" />
            {t('deal.sold_here')}
          </span>
          {stored.price_minor_override === null ? (
            <span className="pos-chip">{t('deal.price_chip')}</span>
          ) : (
            <span className="pos-chip pos-chip--accent">
              <span className="num">{`${t('owner.menu.rupees')} ${shownRupees(stored.price_minor_override)}`}</span>
            </span>
          )}
        </>
      ) : (
        <span className="pos-chip">
          <Icon name="x" />
          {t('deal.not_sold_here')}
        </span>
      )}
      {warn.map((o) => (
        <span key={o.part} className="pos-chip pos-chip--warn" data-omission="">
          <Icon name="alert" />
          {omissionText(o, branchName)}
        </span>
      ))}
    </>
  );

  return (
    <BranchRow
      name={name}
      chips={chips}
      dirty={dirty}
      busy={busy}
      disabled={down}
      stale={stale}
      error={error}
      onSave={() => void save()}
      onReload={() => void reread()}
    >
      <div className="pos-brow__grid">
        <Switch
          checked={sold}
          label={t('deal.sold_here')}
          onChange={(next) => {
            setSold(next);
            if (!next) setPrice('');
          }}
        />
        <label className={`pos-field${priceError !== undefined ? ' pos-field--error' : ''}`}>
          <span className="pos-field__label">{t('deal.price_here')}</span>
          <span className="pos-input-affix">
            <span>{t('owner.menu.rupees')}</span>
            <input
              className="pos-input pos-input--mono"
              name="price_minor_override"
              inputMode="decimal"
              placeholder={shownRupees(deal.price_minor)}
              value={price}
              disabled={!sold}
              onChange={(e) => setPrice(e.target.value)}
            />
          </span>
          {priceError !== undefined && <span className="pos-field__error">{priceError}</span>}
          <span className="pos-field__help">{t('deal.price_help')}</span>
        </label>
      </div>
    </BranchRow>
  );
}
