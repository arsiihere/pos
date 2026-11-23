import { formatQuantity, parseQuantity } from '@pos/domain';
import type { CostCategory, PatchStockItemRequest } from '@pos/events';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { CloudAdmin, CloudError, StockItem, StockItemBranch, StockItemKind, StockUnit } from '../../../api/cloud-admin';
import { usePhone } from '../../../app/phone';
import { navigate } from '../../../app/router';
import { ActionBar } from '../../../components/ActionBar';
import { Banner } from '../../../components/Banner';
import { BranchRow } from '../../../components/BranchRow';
import { BusyButton } from '../../../components/BusyButton';
import { ErrorSummary, type FixEntry } from '../../../components/ErrorSummary';
import { Gone } from '../../../components/Gone';
import { Icon } from '../../../components/Icon';
import { InUseDialog } from '../../../components/InUseDialog';
import { MoreMenu } from '../../../components/MoreMenu';
import { Segmented } from '../../../components/Segmented';
import { Skeleton } from '../../../components/Skeleton';
import { StaleBanner } from '../../../components/StaleBanner';
import { Switch } from '../../../components/Switch';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { useBranchName } from '../branch';
import { apiCode, BackLink, itemHref, referenceText } from '../c01';
import { useCloudDown } from '../cloud';
import { errorText, isKeyMismatch, useIdempotencyKey } from '../form';
import { useDirtyForm, useLeave } from '../guard';
import { Page } from '../Shell';
import { loadStations, quantityAffix, quantityInput, unitOption, type StationsByBranch } from './stock';

// 01c-S07 (§8 "Views", §6.6–§6.9; Q15, Q18): name, "Counted in" and "Keeps overnight" (POST with the form's
// Idempotency-Key; PATCH with expected_version and only the changed fields), the unit-change notice before
// Save, "At each branch" rows ("Counted here" · station · alert below) each saved on its own with its own
// version (§6.9 PUT, no key), and the dishes that draw from it. 409 CONFIG_STALE → 01c-B03 (on the form, or on
// that row only); 409 CONFIG_IN_USE on Archive → 01c-D04 with the dishes; 404 → the form is replaced (Q17).
// With can_edit_tenant false the stock item's own fields are read-only; branch rows stay editable (§8).
const UNITS: readonly StockUnit[] = ['piece', 'g', 'ml'];
const MAX_THRESHOLD = 1_000_000;
// 08a §8.2 (I1, I2, C-8): kind, code, cost category and A-item; Keeps overnight only on Prepared; a packet is in g.
// The branch rows and the dishes (01c) stay with Prepared stock items (I9).
const KINDS: readonly StockItemKind[] = ['prepared', 'ingredient', 'packet'];
const COST_CATEGORIES: readonly CostCategory[] = ['food', 'packaging', 'cleaning', 'beverage'];
const CODE_RE = /^[A-Z0-9-]{1,16}$/;
// §3.3: trim + uppercase; empty → null (cleared, never '').
function codeValue(text: string): string | null {
  const v = text.trim().toUpperCase();
  return v === '' ? null : v;
}

interface Loaded {
  canEditTenant: boolean;
  item: StockItem | null;
  stations: StationsByBranch;
}

async function findStockItem(api: CloudAdmin, stockItemId: string) {
  const [active, archived] = await Promise.all([api.listStockItems(), api.listStockItems({ status: 'archived' })]);
  if (!active.ok) return active;
  // An id not among the active items needs the archived read; a failed one is an error, not "not found".
  if (!archived.ok && !active.data.stock_items.some((s) => s.stock_item_id === stockItemId) && stockItemId !== 'new') return archived;
  const all = [...active.data.stock_items, ...(archived.ok ? archived.data.stock_items : [])];
  return {
    ok: true as const,
    data: { canEditTenant: active.data.can_edit_tenant, item: all.find((s) => s.stock_item_id === stockItemId) ?? null },
  };
}

export function StockItemForm({
  api,
  stockItemId,
  branchIds,
  initialKind = 'prepared',
}: {
  api: CloudAdmin;
  stockItemId: string;
  branchIds: readonly string[];
  // 08a §8.2: the kind a new stock item starts with (the list tab it was opened from).
  initialKind?: StockItemKind;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  const load = useCallback(async () => {
    const [found, stations] = await Promise.all([findStockItem(api, stockItemId), loadStations(api, branchIds)]);
    if (!found.ok) {
      setLoadError(errorText(found.error));
      return;
    }
    setLoaded({ ...found.data, stations });
    setLoadError(null);
    setGeneration((g) => g + 1);
  }, [api, stockItemId, branchIds]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = <BackLink href="#/stock-items" list={t('stock_items.title')} label={t('stock_item.back_label')} />;

  if (loaded === null) {
    return (
      <Page api={api} title={t('stock_items.title')} start={back}>
        {loadError !== null ? <Banner tone="danger" text={loadError} /> : <Skeleton lines={6} />}
      </Page>
    );
  }
  if (stockItemId !== 'new' && loaded.item === null) return <StockItemGone api={api} back={back} />;
  return (
    <Editor
      key={generation}
      api={api}
      canEditTenant={loaded.canEditTenant}
      item={stockItemId === 'new' ? null : loaded.item}
      initialKind={initialKind}
      stations={loaded.stations}
      back={back}
      onReload={() => void load()}
    />
  );
}

function StockItemGone({ api, back }: { api: CloudAdmin; back: ReactNode }) {
  return (
    <Page api={api} title={t('stock_item.title')} start={back}>
      <Gone
        title={t('stock_item.gone_title')}
        body={t('c01.gone_body')}
        back={fill(t('c01.back_to'), { list: t('stock_items.title') })}
        onBack={() => navigate('/stock-items')}
      />
    </Page>
  );
}

type Field = 'name' | 'stock_unit' | 'code';
const FIELD_ID: Record<Field, string> = { name: 'si-name', stock_unit: 'si-unit', code: 'si-code' };

function Editor({
  api,
  canEditTenant,
  item,
  initialKind,
  stations,
  back,
  onReload,
}: {
  api: CloudAdmin;
  canEditTenant: boolean;
  item: StockItem | null;
  initialKind: StockItemKind;
  stations: StationsByBranch;
  back: ReactNode;
  onReload: () => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  // Brief S07 "Counted in" default for a new stock item: piece (CHANGES §2).
  const [unit, setUnit] = useState<StockUnit>(item?.stock_unit ?? 'piece');
  const [keeps, setKeeps] = useState(item?.carries_over ?? false);
  const [kind, setKind] = useState<StockItemKind>(item?.kind ?? initialKind);
  const [code, setCode] = useState(item?.code ?? '');
  const [costCategory, setCostCategory] = useState<CostCategory>(item?.cost_category ?? 'food');
  const [aItem, setAItem] = useState(item?.is_a_item ?? false);
  // R4 (08a §6.3): a kind change refused while counted at a branch or drawn by an active dish.
  const [kindBlocked, setKindBlocked] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [banner, setBanner] = useState<{ tone: 'danger' | 'warn'; text: string } | null>(null);
  const [stale, setStale] = useState(false);
  const [gone, setGone] = useState(false);
  const [inUse, setInUse] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowDirty, setRowDirty] = useState<ReadonlySet<string>>(new Set());
  const { key, renew } = useIdempotencyKey();
  const down = useCloudDown(api);
  const leave = useLeave();
  const phone = usePhone();
  const branchName = useBranchName();

  const archived = item !== null && item.archived_at !== null;
  const readOnly = !canEditTenant || archived;
  const title = item === null ? t('stock_item.new_title') : item.name;

  const prepared = kind === 'prepared';
  // §3.3 R6: carries_over only on Prepared; §3.2: a packet is counted in g.
  const sentKeeps = prepared && keeps;
  const sentUnit: StockUnit = kind === 'packet' ? 'g' : unit;
  const patch: Omit<PatchStockItemRequest, 'expected_version'> = {};
  if (item !== null) {
    if (name.trim() !== item.name) patch.name = name.trim();
    if (sentUnit !== item.stock_unit) patch.stock_unit = sentUnit;
    if (sentKeeps !== item.carries_over) patch.carries_over = sentKeeps;
    if (kind !== item.kind) patch.kind = kind;
    if (codeValue(code) !== item.code) patch.code = codeValue(code);
    if (costCategory !== item.cost_category) patch.cost_category = costCategory;
    if (aItem !== item.is_a_item) patch.is_a_item = aItem;
  }
  const labels: Record<Field | 'carries_over' | 'kind' | 'cost_category' | 'is_a_item', string> = {
    name: t('stock_item.name'),
    stock_unit: t('stock_item.unit'),
    carries_over: t('stock_item.keeps_short'),
    kind: t('stock_item.f08a_kind'),
    code: t('stock_item.f08a_code'),
    cost_category: t('stock_item.f08a_cost_category'),
    is_a_item: t('stock_inv.a_item'),
  };
  const changed = [
    ...(item === null ? (name.trim() !== '' ? [labels.name] : []) : Object.keys(patch).map((k) => labels[k as keyof typeof labels])),
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
    const found: Partial<Record<Field, string>> = {};
    const trimmed = name.trim();
    if (trimmed === '' || trimmed.length > 60) found.name = t('stock_item.name_required');
    const sentCode = codeValue(code);
    if (sentCode !== null && !CODE_RE.test(sentCode)) found.code = t('stock_item.f08a_code_invalid');
    setErrors(found);
    setBanner(null);
    setKindBlocked(null);
    return Object.keys(found).length === 0;
  }

  function showError(error: CloudError) {
    const code = apiCode(error);
    if (code === 'CONFIG_STALE') {
      setStale(true);
      setBanner(null);
      return;
    }
    if (code === 'STOCK_ITEM_NOT_FOUND') {
      setGone(true);
      return;
    }
    if (code === 'CONFIG_NAME_TAKEN') {
      // 08a §3.3: a code clash names entity stock_item_code (its own text, on the code field).
      if (error.kind === 'api' && error.details['entity'] === 'stock_item_code') setErrors({ code: t('errors.CONFIG_NAME_TAKEN_stock_item_code') });
      else setErrors({ name: t('errors.CONFIG_NAME_TAKEN') });
      return;
    }
    if (code === 'CONFIG_REFERENCE_INVALID' && error.kind === 'api') {
      const field = error.details['field'];
      const text = referenceText(error.details);
      if (field === 'stock_unit' || field === 'name') setErrors({ [field]: text });
      else setBanner({ tone: 'danger', text });
      return;
    }
    if (code === 'CONFIG_IN_USE' && error.kind === 'api') {
      const usedBy = error.details['used_by'] as { entity?: unknown; ids?: unknown } | undefined;
      const ids = Array.isArray(usedBy?.ids) ? usedBy.ids.filter((id): id is string => typeof id === 'string') : [];
      // 08a R4: a kind change away from Prepared names the branches that count it, or the dishes that draw from it.
      if (item !== null && patch.kind !== undefined) {
        const names =
          usedBy?.entity === 'stock_item_branch'
            ? ids.map(branchName)
            : ids.map((id) => item.drawers.find((d) => d.item_id === id)?.name ?? id);
        setKindBlocked(fill(t(usedBy?.entity === 'stock_item_branch' ? 'stock_item.f08a_kind_branches' : 'stock_item.f08a_kind_dishes'), { names: names.join(', ') }));
        return;
      }
      setInUse(ids);
      return;
    }
    setBanner({ tone: error.kind === 'network' ? 'warn' : 'danger', text: errorText(error) ?? '' });
  }

  async function save() {
    if (!validate()) return;
    if (item === null) {
      setBusy(true);
      const sentCode = codeValue(code);
      const result = await api.createStockItem(
        {
          name: name.trim(),
          stock_unit: sentUnit,
          carries_over: sentKeeps,
          kind,
          ...(sentCode === null ? {} : { code: sentCode }),
          cost_category: costCategory,
          is_a_item: aItem,
        },
        key,
      );
      setBusy(false);
      if (result.ok) {
        renew();
        // The branch rows need the stock item's id, so a new stock item opens as an edit (S07 "At each branch").
        navigate(`/stock-items/${encodeURIComponent(result.data.stock_item.stock_item_id)}`);
        return;
      }
      if (isKeyMismatch(result.error)) renew();
      showError(result.error);
      return;
    }
    // A branch row with unsaved changes is asked about before the page is left (the rows save on their own).
    const done = () => (rowDirty.size === 0 ? navigate('/stock-items') : leave(() => navigate('/stock-items')));
    if (Object.keys(patch).length === 0) {
      done();
      return;
    }
    setBusy(true);
    const result = await api.patchStockItem(item.stock_item_id, { expected_version: item.version, ...patch });
    setBusy(false);
    if (result.ok) {
      done();
      return;
    }
    showError(result.error);
  }

  async function setArchived(next: boolean) {
    if (item === null) return;
    setBanner(null);
    setBusy(true);
    const result = await api.patchStockItem(item.stock_item_id, { expected_version: item.version, archived: next });
    setBusy(false);
    if (result.ok) {
      if (next) navigate('/stock-items');
      else onReload();
      return;
    }
    showError(result.error);
  }

  if (gone) return <StockItemGone api={api} back={back} />;

  const fixes: FixEntry[] = (Object.keys(errors) as Field[])
    .filter((field) => errors[field] !== undefined)
    .map((field) => ({ target: FIELD_ID[field], label: labels[field] }));
  const saveButton = !readOnly && (
    <BusyButton primary busy={busy} disabled={down || stale} onClick={() => void save()}>
      {item === null ? t('stock_item.create') : t('stock_item.save')}
    </BusyButton>
  );
  const more =
    item !== null && canEditTenant ? (
      <MoreMenu
        label={fill(t('common.more_for'), { name: item.name })}
        info={archived ? undefined : { title: t('owner.common.archive'), detail: t('stock_item.archive_info') }}
        items={
          archived
            ? [{ label: t('stock_item.restore'), icon: 'reload', disabled: down || busy, onSelect: () => void setArchived(false) }]
            : [{ label: t('stock_item.archive'), icon: 'archive', danger: true, disabled: down || busy, onSelect: () => void setArchived(true) }]
        }
      />
    ) : undefined;
  const unitChanged = item !== null && sentUnit !== item.stock_unit;
  const clearError = (field: Field) =>
    setErrors((prev) => {
      // The key goes, so the summary banner's count drops with the inline error (01c-B01).
      const rest = { ...prev };
      delete rest[field];
      return rest;
    });

  return (
    <Page
      api={api}
      title={title}
      start={back}
      end={
        <>
          {more}
          {!phone && !readOnly && (
            <button type="button" className="pos-btn" onClick={() => leave(() => navigate('/stock-items'))}>
              {t('common.cancel')}
            </button>
          )}
          {!phone && saveButton}
        </>
      }
    >
      {stale && (
        <StaleBanner
          // Reload re-reads the whole form, so unsaved branch rows are asked about first.
          onReload={() => (rowDirty.size === 0 ? onReload() : leave(onReload))}
        />
      )}
      <ErrorSummary entries={fixes} />
      {banner !== null && <Banner tone={banner.tone} text={banner.text} />}
      {kindBlocked !== null && (
        <div className="pos-banner pos-banner--danger" role="alert" data-kind-blocked="">
          <Icon name="alert" />
          <p>{kindBlocked}</p>
        </div>
      )}
      {archived && <Banner tone="info" text={t('stock_item.archived_note')} />}
      <div className="pos-stack pos-c01form">
        <section className="pos-section">
          <div className="pos-fold__head">
            <div className="pos-section__head">
              <h2>{t('stock_item.section')}</h2>
            </div>
          </div>
          <div className="pos-grid">
            <label className={`pos-field${errors.name !== undefined ? ' pos-field--error' : ''}`}>
              <span className="pos-field__label">{t('stock_item.name')}</span>
              <input
                id={FIELD_ID.name}
                className="pos-input"
                name="name"
                maxLength={60}
                placeholder={t('stock_item.name_placeholder')}
                value={name}
                disabled={readOnly}
                onChange={(e) => setName(e.target.value)}
              />
              {errors.name !== undefined && <span className="pos-field__error">{errors.name}</span>}
            </label>
            <label className="pos-field">
              <span className="pos-field__label">{t('stock_item.f08a_kind')}</span>
              <select
                className="pos-select"
                name="kind"
                value={kind}
                disabled={readOnly}
                onChange={(e) => {
                  setKind(e.target.value as StockItemKind);
                  setKindBlocked(null);
                }}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`stock_inv.kind_${k}`)}
                  </option>
                ))}
              </select>
              {!phone && <span className="pos-field__help">{t('stock_item.f08a_kind_help')}</span>}
            </label>
            <label className={`pos-field${errors.code !== undefined ? ' pos-field--error' : ''}`}>
              <span className="pos-field__label">{t('stock_item.f08a_code')}</span>
              <input
                id={FIELD_ID.code}
                className="pos-input pos-input--mono"
                name="code"
                maxLength={16}
                value={code}
                disabled={readOnly}
                onChange={(e) => {
                  setCode(e.target.value);
                  clearError('code');
                }}
              />
              {errors.code !== undefined ? (
                <span className="pos-field__error">{errors.code}</span>
              ) : (
                <span className="pos-field__help">{t('stock_item.f08a_code_help')}</span>
              )}
            </label>
            <div className={`pos-field${errors.stock_unit !== undefined ? ' pos-field--error' : ''}`} id={FIELD_ID.stock_unit}>
              <span className="pos-field__label">{t('stock_item.unit')}</span>
              <Segmented<StockUnit>
                label={t('stock_item.unit')}
                block
                value={sentUnit}
                locked={readOnly || kind === 'packet'}
                onChange={(next) => {
                  setUnit(next);
                  clearError('stock_unit');
                }}
                options={UNITS.map((u) => ({ value: u, label: unitOption(u) }))}
              />
              {errors.stock_unit !== undefined && (
                <span className="pos-field__error">
                  <Icon name="alert" />
                  {errors.stock_unit}
                </span>
              )}
              {!phone && <span className="pos-field__help">{t(kind === 'packet' ? 'stock_item.f08a_packet_g' : 'stock_item.unit_help')}</span>}
            </div>
            <label className="pos-field">
              <span className="pos-field__label">{t('stock_item.f08a_cost_category')}</span>
              <select
                className="pos-select"
                name="cost_category"
                value={costCategory}
                disabled={readOnly}
                onChange={(e) => setCostCategory(e.target.value as CostCategory)}
              >
                {COST_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`stock_item.f08a_cost_${c}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {unitChanged && (
            <div className="pos-banner pos-banner--warn" role="status" data-unit-notice="">
              <Icon name="clock" />
              <p>
                {t('stock_item.unit_notice')}
                <small>
                  {fill(t('stock_item.unit_notice_body'), { old: unitOption(item.stock_unit), new: unitOption(unit) })}
                </small>
              </p>
            </div>
          )}
          {prepared && (
            <Switch
              checked={keeps}
              disabled={readOnly}
              label={phone ? t('stock_item.keeps_short') : t('stock_item.keeps')}
              onChange={setKeeps}
            />
          )}
          <div data-a-item="">
            <Switch checked={aItem} disabled={readOnly} label={t('stock_item.f08a_a_item')} onChange={setAItem} />
          </div>
          {item !== null && (
            <p className="pos-linkline">
              <Icon name="grid" />
              <a
                href={`#/stock-items/${encodeURIComponent(item.stock_item_id)}/inventory`}
                onClick={(e) => {
                  e.preventDefault();
                  leave(() => navigate(`/stock-items/${encodeURIComponent(item.stock_item_id)}/inventory`));
                }}
              >
                {t('stock_item.f08a_open_page')}
                <Icon name="forward" flip />
              </a>
            </p>
          )}
        </section>

        {(item === null ? prepared : item.kind === 'prepared') && (
        <section className="pos-section" data-branches="">
          <div className="pos-fold__head">
            <div className="pos-section__head">
              <h2>{t('c01.at_each_branch')}</h2>
              {!phone && <p>{t('stock_item.branches_help')}</p>}
            </div>
          </div>
          {item === null ? (
            <p className="pos-note">{t('stock_item.branches_after_create')}</p>
          ) : (
            <div className="pos-branches">
              {item.branches.map((entry) => (
                <StockBranchRow
                  key={entry.branch_id}
                  api={api}
                  stockItemId={item.stock_item_id}
                  unit={item.stock_unit}
                  entry={entry}
                  stations={stations.get(entry.branch_id) ?? []}
                  down={down}
                  archived={archived}
                  onDirty={onRowDirty}
                />
              ))}
            </div>
          )}
        </section>
        )}

        {item !== null && item.kind === 'prepared' && (
          <section className="pos-section" data-dishes="">
            <div className="pos-fold__head">
              <div className="pos-section__head">
                <h2>{t('stock_item.dishes_title')}</h2>
                <p>{t('stock_item.dishes_help')}</p>
              </div>
            </div>
            {item.drawers.length === 0 ? (
              <p className="pos-note">{t('stock_item.no_dishes')}</p>
            ) : (
              <ul className="pos-list pos-list--dishes">
                {item.drawers.map((drawer) => (
                  <li key={drawer.item_id} className="pos-list__row" data-item-id={drawer.item_id}>
                    <div className="pos-list__name">
                      <strong>{drawer.name}</strong>
                      <span>
                        {fill(t('stock_item.uses'), { qty: formatQuantity(drawer.quantity_per_sale_unit, item.stock_unit) })}
                      </span>
                    </div>
                    <a
                      className="pos-btn"
                      href={itemHref(drawer.item_id)}
                      aria-label={fill(t('c01.open_named'), { name: drawer.name })}
                      onClick={(e) => {
                        e.preventDefault();
                        leave(() => navigate(itemHref(drawer.item_id).slice(1)));
                      }}
                    >
                      {t('in_use.open')}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
      {phone && !readOnly && <ActionBar>{saveButton}</ActionBar>}
      {inUse !== null && item !== null && (
        <InUseDialog
          name={item.name}
          body={t('stock_item.in_use_body')}
          rows={inUse.flatMap((id) => {
            const drawer = item.drawers.find((d) => d.item_id === id);
            return drawer === undefined ? [] : [{ name: drawer.name, href: itemHref(id) }];
          })}
          unnamed={inUse.filter((id) => !item.drawers.some((d) => d.item_id === id)).length}
          onClose={() => setInUse(null)}
        />
      )}
    </Page>
  );
}

// One "At each branch" row: "Counted here" switch · station · alert below, saved with its own §6.9 PUT and that
// row's version. "Counted here" off sends station_id null and no threshold (§6.9; a threshold with it is a 400).
function StockBranchRow({
  api,
  stockItemId,
  unit,
  entry,
  stations,
  down,
  archived,
  onDirty,
}: {
  api: CloudAdmin;
  stockItemId: string;
  unit: StockUnit;
  entry: StockItemBranch;
  stations: readonly { station_id: string; name: string; archived_at: number | null }[];
  down: boolean;
  // An archived stock item's rows are shown, not edited (a set would get 422 stock_item_id archived, §6.9).
  archived: boolean;
  onDirty: (branchId: string, dirty: boolean) => void;
}) {
  const branchName = useBranchName();
  // StockItemPhone: shorter chips ("Karahi counter", "Not counted") so the row Save fits beside them.
  const phone = usePhone();
  const [stored, setStored] = useState(entry);
  const [counted, setCounted] = useState(entry.station_id !== null);
  const [stationId, setStationId] = useState(entry.station_id ?? '');
  const [threshold, setThreshold] = useState(entry.low_stock_threshold === null ? '' : quantityInput(entry.low_stock_threshold, unit));
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [fieldError, setFieldError] = useState<{ station?: string; threshold?: string }>({});
  const name = branchName(stored.branch_id);

  const storedThreshold = stored.low_stock_threshold === null ? '' : quantityInput(stored.low_stock_threshold, unit);
  const dirty = counted
    ? stored.station_id !== stationId || storedThreshold !== threshold.trim()
    : stored.station_id !== null;
  useEffect(() => onDirty(stored.branch_id, dirty), [onDirty, stored.branch_id, dirty]);

  const stationName = (id: string | null) => stations.find((s) => s.station_id === id)?.name ?? '';
  const options = stations.filter((s) => s.archived_at === null || s.station_id === stored.station_id);

  function reset(next: StockItemBranch) {
    setStored(next);
    setCounted(next.station_id !== null);
    setStationId(next.station_id ?? '');
    setThreshold(next.low_stock_threshold === null ? '' : quantityInput(next.low_stock_threshold, unit));
    setStale(false);
    setError(undefined);
    setFieldError({});
  }

  async function reread(): Promise<void> {
    const found = await findStockItem(api, stockItemId);
    if (!found.ok) {
      setError(errorText(found.error) ?? undefined);
      return;
    }
    const next = found.data.item?.branches.find((b) => b.branch_id === stored.branch_id);
    if (next === undefined) setError(t('stock_item.branch_gone'));
    else reset(next);
  }

  async function save() {
    setError(undefined);
    setFieldError({});
    let value: number | null = null;
    if (counted) {
      if (stationId === '') {
        setFieldError({ station: t('stock_item.station_required') });
        return;
      }
      if (threshold.trim() !== '') {
        const parsed = parseQuantity(threshold, unit);
        if (!parsed.ok || parsed.value > MAX_THRESHOLD) {
          setFieldError({ threshold: t('stock_item.alert_invalid') });
          return;
        }
        value = parsed.value;
      }
    }
    setBusy(true);
    const result = await api.putStockItemBranch(
      stockItemId,
      stored.branch_id,
      counted
        ? { expected_version: stored.version, station_id: stationId, low_stock_threshold: value }
        : { expected_version: stored.version, station_id: null },
    );
    setBusy(false);
    if (result.ok) {
      // A removed row answers { branch: null }; its new "no row" version comes from a re-read (§5.4, §6.9).
      if (result.data.branch === null) await reread();
      else reset(result.data.branch);
      return;
    }
    const code = apiCode(result.error);
    if (code === 'CONFIG_STALE') setStale(true);
    else if (code === 'CONFIG_REFERENCE_INVALID' && result.error.kind === 'api') {
      const text = referenceText(result.error.details);
      if (result.error.details['field'] === 'station_id') setFieldError({ station: text });
      else setError(text);
    } else if (code === 'BRANCH_NOT_FOUND') setError(t('stock_item.branch_gone'));
    else if (code === 'VALIDATION_FAILED') setFieldError({ threshold: t('stock_item.alert_invalid') });
    else setError(errorText(result.error) ?? undefined);
  }

  const chips =
    stored.station_id === null ? (
      <span className="pos-chip">
        <Icon name="x" />
        {phone ? t('stock_item.not_counted_short') : t('stock_item.not_counted_here')}
      </span>
    ) : (
      <>
        <span className="pos-chip pos-chip--ok">
          <Icon name="check" />
          {phone ? stationName(stored.station_id) : fill(t('stock_item.counted_at'), { station: stationName(stored.station_id) })}
        </span>
        {stored.low_stock_threshold !== null && (
          <span className="pos-chip">
            {t('stock_item.alert_below')} <span className="num">{formatQuantity(stored.low_stock_threshold, unit)}</span>
          </span>
        )}
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
          checked={counted}
          disabled={archived}
          label={t('stock_item.counted_here')}
          onChange={(next) => {
            setCounted(next);
            if (next && stationId === '' && options.length === 1) setStationId(options[0]?.station_id ?? '');
          }}
        />
        <span />
        {counted && (
          <>
            <label className={`pos-field${fieldError.station !== undefined ? ' pos-field--error' : ''}`}>
              <span className="pos-field__label">{t('stock_item.station')}</span>
              <select
                className="pos-select"
                name="station_id"
                value={stationId}
                disabled={archived}
                onChange={(e) => setStationId(e.target.value)}>
                {stationId === '' && <option value="">{t('stock_item.station_pick')}</option>}
                {options.map((s) => (
                  <option key={s.station_id} value={s.station_id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {fieldError.station !== undefined && <span className="pos-field__error">{fieldError.station}</span>}
            </label>
            <label className={`pos-field${fieldError.threshold !== undefined ? ' pos-field--error' : ''}`}>
              <span className="pos-field__label">{t('stock_item.alert_below')}</span>
              <span className="pos-input-affix">
                <input
                  className="pos-input pos-input--mono"
                  name="low_stock_threshold"
                  disabled={archived}
                  inputMode="decimal"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                />
                <span>{quantityAffix(unit)}</span>
              </span>
              {fieldError.threshold !== undefined && <span className="pos-field__error">{fieldError.threshold}</span>}
            </label>
          </>
        )}
      </div>
    </BranchRow>
  );
}
