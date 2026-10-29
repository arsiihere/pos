import type { Unit } from '@pos/domain';
import { useEffect, useState, type FormEvent } from 'react';
import type {
  AvailabilityWindow,
  Category,
  CloudAdmin,
  CloudError,
  CreateMenuItemBody,
  MenuItem,
  OutOfStockBehaviour,
  PatchMenuItemBody,
  Program,
  ServeMode,
  Station,
  TaxClass,
} from '../../../api/cloud-admin';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { ConfirmDialog } from '../../../components/Dialog';
import { Icon } from '../../../components/Icon';
import { Segmented } from '../../../components/Segmented';
import { Skeleton } from '../../../components/Skeleton';
import { Switch } from '../../../components/Switch';
import { fill } from '../../../i18n/en';
import { t, type MessageKey, typeClass } from '../../../i18n';
import { useBranchName } from '../branch';
import { useCloudDown } from '../cloud';
import { errorText, isKeyMismatch, useIdempotencyKey } from '../form';
import { useDirtyForm, useLeave } from '../guard';
import { formatMinutes, parseMinutes } from '../minutes';
import { formatRupees, parseRupees, shownRupees } from '../money';
import { usePhone } from '../../../app/phone';
import { Page } from '../Shell';
import { windowText, WindowsField } from './WindowsField';

// §8.1, §6.14–§6.16 (01a-S07): the item form. Sections: what customers see, price (Sold by, price, tax
// with "No tax" first and selected, S34), kitchen (a station per branch, programs only for a batch station,
// S11) with a price per branch (S57), ready-made stock (stock time, when it runs out S32), hours (S47);
// an aside shows how staff will see it. 01c moves the stock units onto the stock item (V4; the form's
// variant, stock and weighed sections are 01c §8). A client check
// lists what to fix before anything is sent. A new item POSTs with its routes and the form's key; an edit
// PATCHes the changed fields, then PUTs each changed route (§6.16); a PUT that fails after the PATCH saved
// shows which branch was not saved, and Save sends only what is still different (B03, S50 h). On a phone an
// edit opens price first (S50 g). Read-only (S8) shows the same form without saving.
type StationRow = Station & { programs: Program[] };

interface RouteChoice {
  station_id: string;
  program_id: string;
  stock_program_id: string;
  // S57: "Price here" as typed; '' = the main price.
  price: string;
}

const NO_ROUTE: RouteChoice = { station_id: '', program_id: '', stock_program_id: '', price: '' };
const MAX_COOK_MS = 4 * 3_600_000;

// §8.1 names these pickers; the labels stay the spec's (owner.item.unit_*).
const UNIT_OPTIONS: Record<Unit, MessageKey> = {
  piece: 'owner.item.unit_piece',
  g: 'owner.item.unit_g',
  ml: 'owner.item.unit_ml',
};
const PER_UNIT: Record<Unit, MessageKey> = { piece: 'item.per_piece', g: 'item.per_kg', ml: 'item.per_l' };

const active = (row: { archived_at: number | null }) => row.archived_at === null;

function routeOf(item: MenuItem | null, branchId: string): RouteChoice {
  const route = item?.routes.find((r) => r.branch_id === branchId);
  return route === undefined
    ? NO_ROUTE
    : {
        station_id: route.station_id,
        program_id: route.program_id ?? '',
        stock_program_id: route.stock_program_id ?? '',
        price: route.price_minor_override === null ? '' : formatRupees(route.price_minor_override),
      };
}

// S57: '' = the main price (null); undefined = not a price, which check() marks on the branch row.
function overrideOf(text: string): number | null | undefined {
  if (text.trim() === '') return null;
  const parsed = parseRupees(text);
  return parsed.ok ? parsed.value : undefined;
}

function sameRoute(a: RouteChoice, b: RouteChoice): boolean {
  const price = (choice: RouteChoice) => overrideOf(choice.price) ?? choice.price;
  return (
    a.station_id === b.station_id &&
    a.program_id === b.program_id &&
    a.stock_program_id === b.stock_program_id &&
    price(a) === price(b)
  );
}

interface Problem {
  id: string;
  section: MessageKey;
  text: string;
}

function Select({
  name,
  label,
  value,
  options,
  onChange,
  id,
}: {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (next: string) => void;
  id?: string;
}) {
  return (
    <label className="pos-field">
      <span className="pos-field__label">{label}</span>
      <select className="pos-select" id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextField({
  name,
  label,
  value,
  onChange,
  numeric = false,
  help,
  error,
  unit,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  numeric?: boolean;
  help?: string;
  error?: string;
  unit?: string;
}) {
  const input = (
    <input
      className={numeric ? 'pos-input pos-input--mono' : 'pos-input'}
      id={`item-${name}`}
      name={name}
      inputMode={numeric ? 'decimal' : undefined}
      aria-invalid={error !== undefined ? true : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  return (
    <label className={`pos-field${error === undefined ? '' : ' pos-field--error'}`}>
      <span className="pos-field__label">{label}</span>
      {unit === undefined ? (
        input
      ) : (
        <span className="pos-input-affix pos-ltr">
          {input}
          <span>{unit}</span>
        </span>
      )}
      {help !== undefined && <span className="pos-field__help">{help}</span>}
      {error !== undefined && <span className="pos-field__error">{error}</span>}
    </label>
  );
}

export function ItemForm({
  api,
  item,
  taxClasses,
  categories,
  branchIds,
  onSaved,
  onCancel,
  readOnly = false,
}: {
  api: CloudAdmin;
  item: MenuItem | null;
  taxClasses: readonly TaxClass[];
  categories: readonly Category[];
  branchIds: readonly string[];
  onSaved: (notice?: string | null) => void;
  onCancel: () => void;
  readOnly?: boolean;
}) {
  const branchName = useBranchName();
  const { key } = useIdempotencyKey();
  const phone = usePhone();
  const down = useCloudDown(api);
  const leave = useLeave();
  // What is saved: the item as loaded, moved forward by a PATCH that succeeded before a PUT failed (B03).
  const [base, setBase] = useState<MenuItem | null>(item);
  const [baseRoutes, setBaseRoutes] = useState<Record<string, RouteChoice>>(() =>
    Object.fromEntries(branchIds.map((b) => [b, routeOf(item, b)])),
  );
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [categoryId, setCategoryId] = useState(item?.category_id ?? categories.find(active)?.category_id ?? '');
  const [taxId, setTaxId] = useState(item?.tax_class_id ?? '');
  const [price, setPrice] = useState(item === null ? '' : formatRupees(item.price_minor));
  const [serveMode, setServeMode] = useState<ServeMode>(item?.serve_mode ?? 'immediate');
  const [cook, setCook] = useState(item === null ? '' : formatMinutes(item.cook_time_ms));
  const [prep, setPrep] = useState(item === null ? '' : formatMinutes(item.prep_buffer_ms));
  const [stockTime, setStockTime] = useState(item?.stock_time_ms == null ? '' : formatMinutes(item.stock_time_ms));
  const [outOfStock, setOutOfStock] = useState<OutOfStockBehaviour>(item?.out_of_stock_behaviour ?? 'cook_fresh');
  const [saleUnit, setSaleUnit] = useState<Unit>(item?.sale_unit ?? 'piece');
  const [windows, setWindows] = useState<AvailabilityWindow[] | null>(item?.availability_windows ?? []);
  const [routes, setRoutes] = useState<Record<string, RouteChoice>>(() =>
    Object.fromEntries(branchIds.map((b) => [b, routeOf(item, b)])),
  );
  // Kept ready = the item can be served from stock: a stock time (slot) or a stock program (batch), §4.3.
  const [keptReady, setKeptReady] = useState(
    item !== null && (item.stock_time_ms !== null || item.routes.some((r) => r.stock_program_id !== null)),
  );
  const [stations, setStations] = useState<Record<string, StationRow[]> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [archiving, setArchiving] = useState(false);
  const [full, setFull] = useState(item === null);

  useEffect(() => {
    let live = true;
    void Promise.all(branchIds.map(async (b) => [b, await api.listStations(b)] as const)).then((results) => {
      if (!live) return;
      const next: Record<string, StationRow[]> = {};
      for (const [b, result] of results) {
        if (result.ok) next[b] = result.data.stations;
        else setError(errorText(result.error));
      }
      setStations(next);
    });
    return () => {
      live = false;
    };
  }, [api, branchIds]);

  function changeKeptReady(next: boolean) {
    setKeptReady(next);
    if (!next) {
      setStockTime('');
      setRoutes(Object.fromEntries(Object.entries(routes).map(([b, r]) => [b, { ...r, stock_program_id: '' }])));
    }
  }

  function stationOf(branchId: string, stationId: string): StationRow | undefined {
    return stations?.[branchId]?.find((s) => s.station_id === stationId);
  }

  function chooseStation(branchId: string, stationId: string) {
    const station = stationOf(branchId, stationId);
    const firstProgram = station?.station_type === 'batch' ? (station.programs.find(active)?.program_id ?? '') : '';
    const price = stationId === '' ? '' : (routes[branchId] ?? NO_ROUTE).price;
    setRoutes({ ...routes, [branchId]: { station_id: stationId, program_id: firstProgram, stock_program_id: '', price } });
  }

  function routeBody(branchId: string) {
    const choice = routes[branchId] ?? NO_ROUTE;
    const batch = stationOf(branchId, choice.station_id)?.station_type === 'batch';
    return {
      station_id: choice.station_id,
      program_id: batch && choice.program_id !== '' ? choice.program_id : null,
      stock_program_id: batch && choice.stock_program_id !== '' ? choice.stock_program_id : null,
      price_minor_override: overrideOf(choice.price) ?? null,
    };
  }

  // A time whose text was not touched keeps its stored _ms, which minutes with 2 decimals may not round-trip.
  const untouched = (text: string, ms: number | null | undefined) =>
    item !== null && ms != null && text === formatMinutes(ms);
  const cookMs = untouched(cook, item?.cook_time_ms) ? (item?.cook_time_ms ?? null) : parseMinutes(cook);
  const prepMs = untouched(prep, item?.prep_buffer_ms)
    ? (item?.prep_buffer_ms ?? 0)
    : prep.trim() === ''
      ? 0
      : parseMinutes(prep);
  const stockTimeMs = untouched(stockTime, item?.stock_time_ms)
    ? (item?.stock_time_ms ?? null)
    : stockTime.trim() === ''
      ? null
      : parseMinutes(stockTime);
  const priceValue = parseRupees(price);

  function check(): Problem[] {
    const found: Problem[] = [];
    if (name.trim() === '' || name.trim().length > 60)
      found.push({ id: 'item-name', section: 'item.section.customers', text: t('item.need_name') });
    if (!priceValue.ok) found.push({ id: 'item-price', section: 'item.section.price', text: t('item.need_price') });
    if (cookMs === null || cookMs < 60_000 || cookMs > MAX_COOK_MS)
      found.push({ id: 'item-cook_minutes', section: 'item.section.kitchen', text: t('item.need_cook') });
    if (prepMs === null) found.push({ id: 'item-prep_minutes', section: 'item.section.kitchen', text: t('item.need_prep') });
    if (stockTime.trim() !== '' && (stockTimeMs === null || (cookMs !== null && stockTimeMs >= cookMs))) {
      found.push({
        id: 'item-stock_time_minutes',
        section: 'item.section.stock',
        text: fill(t('item.stock_time_long'), { n: cookMs === null ? '…' : formatMinutes(cookMs) }),
      });
    }
    for (const b of branchIds) {
      const choice = routes[b] ?? NO_ROUTE;
      if (stationOf(b, choice.station_id)?.station_type === 'batch' && choice.program_id === '') {
        found.push({ id: `route-${b}`, section: 'item.section.kitchen', text: t('errors.reference.program_required') });
      }
      if (choice.station_id !== '' && overrideOf(choice.price) === undefined) {
        found.push({ id: `route-${b}`, section: 'item.branches_title', text: t('item.need_price') });
      }
    }
    if (windows === null) found.push({ id: 'item-hours', section: 'item.section.hours', text: t('owner.hours.invalid') });
    return found;
  }

  function fields(): Omit<CreateMenuItemBody, 'routes'> | null {
    if (!priceValue.ok || cookMs === null || prepMs === null || windows === null) return null;
    return {
      category_id: categoryId,
      tax_class_id: taxId === '' ? null : taxId,
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
      price_minor: priceValue.value,
      serve_mode: serveMode,
      prep_buffer_ms: prepMs,
      cook_time_ms: cookMs,
      stock_time_ms: stockTimeMs,
      out_of_stock_behaviour: outOfStock,
      sale_unit: saleUnit,
      availability_windows: windows,
    };
  }

  function patchOf(current: MenuItem, next: Omit<CreateMenuItemBody, 'routes'>): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(next)) {
      if (JSON.stringify(value) !== JSON.stringify(current[field as keyof MenuItem])) patch[field] = value;
    }
    return patch;
  }

  // S50 c: what changed, by section label, for the discard question.
  const now = fields();
  const changedLabels: string[] = [];
  if (base === null) {
    if (name !== '' || price !== '' || cook !== '') changedLabels.push(t('item.section.customers').toLowerCase());
  } else {
    const diff = now === null ? { price_minor: true } : patchOf(base, now);
    const labels: Record<string, MessageKey> = {
      price_minor: 'item.changed.price',
      cook_time_ms: 'item.changed.cook',
      name: 'item.changed.name',
    };
    for (const field of Object.keys(diff)) {
      const label = t(labels[field] ?? 'item.changed.other');
      if (!changedLabels.includes(label)) changedLabels.push(label);
    }
    if (branchIds.some((b) => !sameRoute(routes[b] ?? NO_ROUTE, baseRoutes[b] ?? NO_ROUTE))) {
      changedLabels.push(t('item.changed.kitchen'));
    }
  }
  useDirtyForm(readOnly || changedLabels.length === 0 ? null : { name: base?.name ?? (name.trim() || t('owner.item.new')), fields: changedLabels });

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (busy || readOnly) return;
    const found = check();
    setProblems(found);
    const next = fields();
    if (found.length > 0 || next === null) return;
    setBusy(true);
    setError(null);
    const result = base === null ? await create(next) : await update(base, next);
    setBusy(false);
    if (result === null) {
      onSaved();
      return;
    }
    if (result === 'partial') return;
    if (isKeyMismatch(result)) {
      // The form closes (a new one gets a new key) and the list is reloaded (form.ts).
      onSaved(errorText(result));
      return;
    }
    setError(errorText(result));
  }

  async function create(next: Omit<CreateMenuItemBody, 'routes'>): Promise<CloudError | null> {
    const body: CreateMenuItemBody = {
      ...next,
      routes: branchIds
        .filter((b) => (routes[b] ?? NO_ROUTE).station_id !== '')
        .map((b) => ({ branch_id: b, ...routeBody(b) })),
    };
    const result = await api.createMenuItem(body, key);
    return result.ok ? null : result.error;
  }

  async function update(current: MenuItem, next: Omit<CreateMenuItemBody, 'routes'>): Promise<CloudError | 'partial' | null> {
    const patch = patchOf(current, next);
    if (Object.keys(patch).length > 0) {
      const result = await api.patchMenuItem(current.item_id, patch as PatchMenuItemBody);
      if (!result.ok) return result.error;
      setBase({ ...current, ...next });
    }
    const failures: Record<string, string> = {};
    const savedRoutes = { ...baseRoutes };
    for (const b of branchIds) {
      const choice = routes[b] ?? NO_ROUTE;
      if (sameRoute(choice, baseRoutes[b] ?? NO_ROUTE)) continue;
      const result = await api.putItemRoute(current.item_id, b, choice.station_id === '' ? { station_id: null } : routeBody(b));
      if (result.ok) savedRoutes[b] = choice;
      else failures[b] = errorText(result.error) ?? '';
    }
    setBaseRoutes(savedRoutes);
    setFailed(failures);
    return Object.keys(failures).length > 0 ? 'partial' : null;
  }

  async function archive() {
    if (base === null) return;
    setArchiving(false);
    setBusy(true);
    const result = await api.patchMenuItem(base.item_id, { archived: true });
    setBusy(false);
    if (result.ok) onSaved();
    else setError(errorText(result.error));
  }

  const taxOptions = [
    { value: '', label: t('owner.item.no_tax') },
    ...taxClasses
      .filter((x) => active(x) || x.tax_class_id === item?.tax_class_id)
      .map((x) => ({ value: x.tax_class_id, label: `${x.name} (${x.rate_bp / 100} %)` })),
  ];
  const categoryOptions = categories
    .filter((c) => active(c) || c.category_id === item?.category_id)
    .map((c) => ({ value: c.category_id, label: c.name }));
  const category = categories.find((c) => c.category_id === categoryId);
  const problemFor = (id: string) => problems.find((p) => p.id === id)?.text;
  const soldAt = branchIds.filter((b) => (routes[b] ?? NO_ROUTE).station_id !== '').length;
  const failedBranches = Object.keys(failed);
  const title = t(item === null ? 'owner.item.new' : 'owner.item.edit');
  const saveLabel = t(item === null ? 'item.add' : 'item.save');

  const back = (
    <a
      className="pos-btn"
      href="#/menu"
      onClick={(e) => {
        e.preventDefault();
        leave(onCancel);
      }}
    >
      <Icon name="back" flip />
      {t('owner.nav.menu')}
    </a>
  );

  const actions = readOnly ? (
    <button type="button" className="pos-btn" onClick={onCancel}>
      {t('common.close')}
    </button>
  ) : (
    <>
      <button type="button" className="pos-btn" onClick={() => leave(onCancel)}>
        {t('owner.common.cancel')}
      </button>
      <BusyButton busy={busy} primary disabled={down || categoryOptions.length === 0} type="submit" form="item-form">
        {saveLabel}
      </BusyButton>
    </>
  );

  const banners = (
    <>
      {problems.length > 0 && (
        <div className="pos-banner pos-banner--danger" role="alert">
          <Icon name="alert" />
          <p>
            {fill(t('item.fix_n'), { n: String(problems.length) })}
            <small className="pos-row">
              {problems.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="pos-btn"
                  onClick={() => document.getElementById(p.id)?.focus()}
                >
                  {`${t(p.section)}: ${p.text}`}
                </button>
              ))}
            </small>
          </p>
        </div>
      )}
      {failedBranches.length > 0 && (
        <div className="pos-stack">
          <Banner
            tone="warn"
            text={t('item.partial')}
            detail={failedBranches
              .map((b) => fill(t('item.partial_body'), { branch: branchName(b), reason: failed[b] ?? '' }))
              .join(' ')}
          />
          <BusyButton busy={busy} disabled={down} onClick={() => void submit()}>
            {fill(t('item.save_branch_again'), { branch: failedBranches.map(branchName).join(', ') })}
          </BusyButton>
        </div>
      )}
      {categoryOptions.length === 0 && <Banner tone="info" text={t('item.need_category')} />}
      {error !== null && <Banner tone="danger" text={error} />}
    </>
  );

  // S50 g: an edit on a phone opens price first; Edit on Kitchen or Hours opens the whole form.
  if (phone && !full && item !== null) {
    return (
      <Page api={api} title={item.name} start={back}>
        <form className="pos-stack" id="item-form" data-form="item" noValidate onSubmit={(e) => void submit(e)}>
          <fieldset className="pos-stack" disabled={readOnly}>
            {banners}
            <TextField
              name="price"
              label={t('owner.item.price')}
              value={price}
              onChange={setPrice}
              numeric
              unit={t(PER_UNIT[saleUnit])}
              help={fill(t('item.price_was'), { old: shownRupees(item.price_minor) })}
              error={problemFor('item-price')}
            />
            <Select name="tax_class_id" label={t('owner.item.tax_class')} value={taxId} options={taxOptions} onChange={setTaxId} />
            <p className={typeClass('body')} data-on-sale="">
              {fill(t('menu.branches_of'), { n: String(soldAt), m: String(branchIds.length) })}
            </p>
            <ul className="pos-list pos-list--stack">
              <li className="pos-list__row">
                <span className="pos-list__name">
                  <strong>{t('item.section.kitchen')}</strong>
                  <span>{fill(t('item.cook_n'), { n: formatMinutes(cookMs ?? 0) })}</span>
                </span>
                <button type="button" className="pos-btn" onClick={() => setFull(true)}>
                  {t('owner.common.edit')}
                </button>
              </li>
              <li className="pos-list__row">
                <span className="pos-list__name">
                  <strong>{t('item.section.hours')}</strong>
                  <span>{(windows ?? []).length === 0 ? t('owner.hours.all_day') : (windows ?? []).map(windowText).join(', ')}</span>
                </span>
                <button type="button" className="pos-btn" onClick={() => setFull(true)}>
                  {t('owner.common.edit')}
                </button>
              </li>
            </ul>
            <p className="pos-field__help">{t('item.reach_branches')}</p>
          </fieldset>
          {!readOnly && (
            <BusyButton busy={busy} primary disabled={down} type="submit">
              {t('item.save_price')}
            </BusyButton>
          )}
        </form>
      </Page>
    );
  }

  return (
    <Page api={api} title={title} start={back} end={actions}>
      {banners}
      <form className="pos-split" id="item-form" data-form="item" noValidate onSubmit={(e) => void submit(e)}>
        <fieldset className="pos-stack" disabled={readOnly}>
          <section className="pos-section">
            <div className="pos-section__head">
              <h2>{t('item.section.customers')}</h2>
            </div>
            <TextField name="name" label={t('owner.item.name')} value={name} onChange={setName} error={problemFor('item-name')} />
            <Select name="category_id" label={t('owner.item.category')} value={categoryId} options={categoryOptions} onChange={setCategoryId} />
            <TextField name="description" label={t('owner.item.description')} value={description} onChange={setDescription} />
          </section>

          <section className="pos-section">
            <div className="pos-section__head">
              <h2>{t('item.section.price')}</h2>
            </div>
            <div className="pos-field">
              <span className="pos-field__label">{t('owner.item.sale_unit')}</span>
              <Segmented
                label={t('owner.item.sale_unit')}
                value={saleUnit}
                options={(['piece', 'g', 'ml'] as const).map((u) => ({ value: u, label: t(UNIT_OPTIONS[u]) }))}
                onChange={setSaleUnit}
              />
            </div>
            <TextField
              name="price"
              label={t('owner.item.price')}
              value={price}
              onChange={setPrice}
              numeric
              unit={t(PER_UNIT[saleUnit])}
              error={problemFor('item-price')}
            />
            <Select name="tax_class_id" label={t('owner.item.tax_class')} value={taxId} options={taxOptions} onChange={setTaxId} />
          </section>

          <section className="pos-section">
            <div className="pos-section__head">
              <h2>{t('item.branches_title')}</h2>
              <p>{fill(t('item.branches_body'), { price: priceValue.ok ? shownRupees(priceValue.value) : '…' })}</p>
            </div>
            {stations === null ? (
              <Skeleton lines={2} />
            ) : (
              <ul className="pos-list">
                {branchIds.map((b) => {
                  const choice = routes[b] ?? NO_ROUTE;
                  const station = stationOf(b, choice.station_id);
                  const programs = station?.station_type === 'batch' ? station.programs.filter(active) : [];
                  const set = (patch: Partial<RouteChoice>) => setRoutes({ ...routes, [b]: { ...choice, ...patch } });
                  const problem = problemFor(`route-${b}`);
                  const routeFailed = failed[b];
                  return (
                    <li
                      key={b}
                      id={`route-${b}`}
                      tabIndex={-1}
                      className={`pos-list__row${problem !== undefined || routeFailed !== undefined ? ' pos-field--error' : ''}`}
                      data-route-branch={b}
                    >
                      <span className="pos-list__name">
                        <strong>
                          <bdi>{branchName(b)}</bdi>
                        </strong>
                      </span>
                      <div className="pos-row">
                        <label className="pos-field">
                          <span className="pos-field__label">{t('item.price_here')}</span>
                          <span className="pos-input-affix pos-ltr">
                            <span>{t('owner.menu.rupees')}</span>
                            <input
                              className="pos-input pos-input--mono"
                              name="price_minor_override"
                              inputMode="decimal"
                              aria-label={fill(t('item.price_at'), { branch: branchName(b) })}
                              aria-invalid={problem !== undefined ? true : undefined}
                              disabled={choice.station_id === ''}
                              placeholder={
                                choice.station_id === ''
                                  ? t('owner.item.not_sold_here')
                                  : fill(t('item.price_same'), { price: priceValue.ok ? shownRupees(priceValue.value) : '…' })
                              }
                              value={choice.price}
                              onChange={(e) => set({ price: e.target.value })}
                            />
                          </span>
                        </label>
                        <Select
                          name="station_id"
                          label={t('owner.item.station')}
                          value={choice.station_id}
                          options={[
                            { value: '', label: t('owner.item.not_sold_here') },
                            ...(stations[b] ?? [])
                              .filter((s) => active(s) || s.station_id === choice.station_id)
                              .map((s) => ({ value: s.station_id, label: s.name })),
                          ]}
                          onChange={(next) => chooseStation(b, next)}
                        />
                        {station?.station_type === 'batch' ? (
                          <>
                            <Select
                              name="program_id"
                              label={t('owner.item.program')}
                              value={choice.program_id}
                              options={programs.map((p) => ({ value: p.program_id, label: p.name }))}
                              onChange={(next) => set({ program_id: next })}
                            />
                            <Select
                              name="stock_program_id"
                              label={t('owner.item.stock_program')}
                              value={choice.stock_program_id}
                              options={[
                                { value: '', label: t('owner.item.no_stock_program') },
                                ...programs.map((p) => ({ value: p.program_id, label: p.name })),
                              ]}
                              onChange={(next) => {
                                set({ stock_program_id: next });
                                if (next !== '') setKeptReady(true);
                              }}
                            />
                          </>
                        ) : (
                          station !== undefined && <span className="pos-field__help">{t('item.no_recipe_needed')}</span>
                        )}
                      </div>
                      {problem !== undefined && <span className="pos-field__error">{problem}</span>}
                      {routeFailed !== undefined && <span className="pos-field__error">{routeFailed}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="pos-row">
              <TextField
                name="cook_minutes"
                label={t('owner.item.cook_minutes')}
                value={cook}
                onChange={setCook}
                numeric
                error={problemFor('item-cook_minutes')}
              />
              <TextField
                name="prep_minutes"
                label={t('owner.item.prep_minutes')}
                value={prep}
                onChange={setPrep}
                numeric
                error={problemFor('item-prep_minutes')}
              />
            </div>
            <div className="pos-field">
              <span className="pos-field__label">{t('owner.item.serve_mode')}</span>
              <Segmented
                label={t('owner.item.serve_mode')}
                value={serveMode}
                options={[
                  { value: 'immediate', label: t('owner.item.serve_immediate') },
                  { value: 'sync', label: t('owner.item.serve_sync') },
                ]}
                onChange={setServeMode}
              />
            </div>
          </section>

          <section className="pos-section">
            <div className="pos-section__head">
              <h2>{t('item.section.stock')}</h2>
              <p>{t('item.stock_body')}</p>
            </div>
            <Switch checked={keptReady} label={t('item.kept_ready')} onChange={changeKeptReady} />
            {keptReady && (
              <>
                <TextField
                  name="stock_time_minutes"
                  label={t('owner.item.stock_time_minutes')}
                  value={stockTime}
                  onChange={setStockTime}
                  numeric
                  error={problemFor('item-stock_time_minutes')}
                />
                <div className="pos-field">
                  <span className="pos-field__label">{t('owner.item.out_of_stock')}</span>
                  <Segmented
                    label={t('owner.item.out_of_stock')}
                    value={outOfStock}
                    options={[
                      { value: 'cook_fresh', label: t('owner.item.cook_fresh') },
                      { value: 'sold_out', label: t('owner.item.sold_out') },
                    ]}
                    onChange={setOutOfStock}
                  />
                </div>
              </>
            )}
          </section>

          <section className="pos-section" id="item-hours" tabIndex={-1}>
            <WindowsField
              value={item?.availability_windows ?? []}
              onChange={setWindows}
              outer={category?.availability_windows ?? []}
              outerName={category?.name}
            />
          </section>

          {item !== null && !readOnly && (
            <div className="pos-dialog__danger">
              <div>
                <strong>{t('item.archive_title')}</strong>
                <p className="pos-field__help">{t('item.archive_body')}</p>
              </div>
              <button type="button" className="pos-btn pos-btn--danger" disabled={down} onClick={() => setArchiving(true)}>
                {t('item.archive')}
              </button>
            </div>
          )}
        </fieldset>

        <aside className="pos-card pos-stack" aria-label={t('item.preview')}>
          <h2 className={typeClass('heading')}>{t('item.preview')}</h2>
          <p className="pos-list__name">
            <strong>{name.trim() === '' ? t('owner.item.new') : name.trim()}</strong>
            {priceValue.ok && (
              <span className="pos-ltr">{`${t('owner.menu.rupees')} ${shownRupees(priceValue.value)} ${t(PER_UNIT[saleUnit])}`}</span>
            )}
          </p>
          <ul className="pos-stack">
            <li>{fill(t('menu.branches_of'), { n: String(soldAt), m: String(branchIds.length) })}</li>
            <li>
              {(windows ?? []).length === 0
                ? t('owner.hours.all_day')
                : (windows ?? []).map(windowText).join(', ')}
            </li>
          </ul>
        </aside>
      </form>
      {archiving && base !== null && (
        <ConfirmDialog
          title={fill(t('archive.item_title'), { name: base.name })}
          body={t('archive.item_body')}
          confirmLabel={fill(t('archive.archive_name'), { name: base.name })}
          tone="danger"
          onConfirm={() => void archive()}
          onCancel={() => setArchiving(false)}
        />
      )}
    </Page>
  );
}
