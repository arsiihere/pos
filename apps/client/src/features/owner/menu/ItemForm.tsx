import type { Unit } from '@pos/domain';
import { useEffect, useState, type FormEvent } from 'react';
import type {
  AvailabilityWindow,
  Category,
  CloudAdmin,
  CloudResult,
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
import { QuantityInput } from '../../../components/QuantityInput';
import { t, type MessageKey } from '../../../i18n';
import { errorText, isKeyMismatch, useIdempotencyKey } from '../form';
import { parseRupees, formatRupees } from '../money';
import { formatMinutes, parseMinutes } from '../stations/StationsView';
import { WindowsField } from './WindowsField';

// §8.1, §6.14–§6.16: the item form. Tax picker with "No tax" first and selected by default (S34);
// per-branch route picker whose program selects appear only for a batch station (S11); prices in
// rupees (money.ts); times in minutes; When pre-cooked stock runs out (S32); Stock unit / Sold by with
// the stock-per-piece field only when they differ and the next-day warning on any unit change (S44);
// Low stock alert at in the stock unit (S46); Keeps overnight (S41); Available hours (S47).
// Archived tax classes, categories, stations and programs are not offered (an edited item keeps the one
// it has). A new item POSTs with its routes and the form's key; an edit PATCHes the changed fields and
// PUTs each changed route (§6.16).
type StationRow = Station & { programs: Program[] };

interface RouteChoice {
  station_id: string;
  program_id: string;
  stock_program_id: string;
}

const NO_ROUTE: RouteChoice = { station_id: '', program_id: '', stock_program_id: '' };
const WHOLE_RE = /^[0-9]+$/;

const UNIT_OPTIONS: Record<Unit, MessageKey> = {
  piece: 'owner.item.unit_piece',
  g: 'owner.item.unit_g',
  ml: 'owner.item.unit_ml',
};
const PER_PIECE_LABEL: Record<'g' | 'ml', MessageKey> = { g: 'owner.item.per_piece_g', ml: 'owner.item.per_piece_ml' };

const active = (row: { archived_at: number | null }) => row.archived_at === null;

function routeOf(item: MenuItem | null, branchId: string): RouteChoice {
  const route = item?.routes.find((r) => r.branch_id === branchId);
  return route === undefined
    ? NO_ROUTE
    : { station_id: route.station_id, program_id: route.program_id ?? '', stock_program_id: route.stock_program_id ?? '' };
}

function sameRoute(a: RouteChoice, b: RouteChoice): boolean {
  return a.station_id === b.station_id && a.program_id === b.program_id && a.stock_program_id === b.stock_program_id;
}

function Select({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (next: string) => void;
}) {
  return (
    <label className="pos-field">
      <span className="pos-field__label">{label}</span>
      <select className="pos-select" name={name} value={value} onChange={(e) => onChange(e.target.value)}>
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
}: {
  name: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  numeric?: boolean;
}) {
  return (
    <label className="pos-field">
      <span className="pos-field__label">{label}</span>
      <input
        className={numeric ? 'pos-input pos-input--mono' : 'pos-input'}
        name={name}
        inputMode={numeric ? 'decimal' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
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
}: {
  api: CloudAdmin;
  item: MenuItem | null;
  taxClasses: readonly TaxClass[];
  categories: readonly Category[];
  branchIds: readonly string[];
  onSaved: (notice?: string | null) => void;
  onCancel: () => void;
}) {
  const { key } = useIdempotencyKey();
  const [name, setName] = useState(item?.name ?? '');
  const [groupLabel, setGroupLabel] = useState(item?.group_label ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [categoryId, setCategoryId] = useState(item?.category_id ?? categories.find(active)?.category_id ?? '');
  const [taxId, setTaxId] = useState(item?.tax_class_id ?? '');
  const [price, setPrice] = useState(item === null ? '' : formatRupees(item.price_minor));
  const [serveMode, setServeMode] = useState<ServeMode>(item?.serve_mode ?? 'immediate');
  const [cook, setCook] = useState(item === null ? '' : formatMinutes(item.cook_time_ms));
  const [prep, setPrep] = useState(item === null ? '' : formatMinutes(item.prep_buffer_ms));
  const [stockTime, setStockTime] = useState(item?.stock_time_ms == null ? '' : formatMinutes(item.stock_time_ms));
  const [outOfStock, setOutOfStock] = useState<OutOfStockBehaviour>(item?.out_of_stock_behaviour ?? 'cook_fresh');
  const [stockUnit, setStockUnit] = useState<Unit>(item?.stock_unit ?? 'piece');
  const [saleUnit, setSaleUnit] = useState<Unit>(item?.sale_unit ?? 'piece');
  const [perPiece, setPerPiece] = useState(
    item !== null && item.stock_unit !== item.sale_unit ? String(item.stock_per_sale_unit) : '',
  );
  const [threshold, setThreshold] = useState<number | null>(item?.low_stock_threshold ?? null);
  const [carriesOver, setCarriesOver] = useState(item?.carries_over ?? false);
  const [windows, setWindows] = useState<AvailabilityWindow[] | null>(item?.availability_windows ?? []);
  const [routes, setRoutes] = useState<Record<string, RouteChoice>>(() =>
    Object.fromEntries(branchIds.map((b) => [b, routeOf(item, b)])),
  );
  const [stations, setStations] = useState<Record<string, StationRow[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const unitsDiffer = stockUnit !== saleUnit;
  const saleOptions: Unit[] = stockUnit === 'piece' ? ['piece'] : ['piece', stockUnit];
  const startUnits = {
    stock: item?.stock_unit ?? 'piece',
    sale: item?.sale_unit ?? 'piece',
    per: item?.stock_per_sale_unit ?? 1,
  };
  const perPieceValue = unitsDiffer ? (WHOLE_RE.test(perPiece.trim()) ? Number(perPiece.trim()) : null) : 1;
  const unitsChanged =
    stockUnit !== startUnits.stock ||
    saleUnit !== startUnits.sale ||
    (perPieceValue !== null && perPieceValue !== startUnits.per);

  function changeStockUnit(next: Unit) {
    setStockUnit(next);
    if (saleUnit !== 'piece' && saleUnit !== next) setSaleUnit('piece');
  }

  function stationOf(branchId: string, stationId: string): StationRow | undefined {
    return stations[branchId]?.find((s) => s.station_id === stationId);
  }

  function chooseStation(branchId: string, stationId: string) {
    const station = stationOf(branchId, stationId);
    const firstProgram = station?.station_type === 'batch' ? (station.programs.find(active)?.program_id ?? '') : '';
    setRoutes({ ...routes, [branchId]: { station_id: stationId, program_id: firstProgram, stock_program_id: '' } });
  }

  function routeBody(branchId: string) {
    const choice = routes[branchId] ?? NO_ROUTE;
    const batch = stationOf(branchId, choice.station_id)?.station_type === 'batch';
    return {
      station_id: choice.station_id,
      program_id: batch && choice.program_id !== '' ? choice.program_id : null,
      stock_program_id: batch && choice.stock_program_id !== '' ? choice.stock_program_id : null,
    };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const priceValue = parseRupees(price);
    const cookMs = parseMinutes(cook);
    const prepMs = prep.trim() === '' ? 0 : parseMinutes(prep);
    const stockTimeMs = stockTime.trim() === '' ? null : parseMinutes(stockTime);
    if (
      !priceValue.ok ||
      cookMs === null ||
      prepMs === null ||
      (stockTime.trim() !== '' && stockTimeMs === null) ||
      perPieceValue === null ||
      windows === null
    ) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    const fields = {
      category_id: categoryId,
      tax_class_id: taxId === '' ? null : taxId,
      name: name.trim(),
      group_label: groupLabel.trim() === '' ? null : groupLabel.trim(),
      description: description.trim() === '' ? null : description.trim(),
      price_minor: priceValue.value,
      serve_mode: serveMode,
      prep_buffer_ms: prepMs,
      cook_time_ms: cookMs,
      stock_time_ms: stockTimeMs,
      out_of_stock_behaviour: outOfStock,
      stock_unit: stockUnit,
      sale_unit: saleUnit,
      stock_per_sale_unit: perPieceValue,
      low_stock_threshold: threshold,
      carries_over: carriesOver,
      availability_windows: windows,
    };
    setBusy(true);
    setError(null);
    const result = item === null ? await create(fields) : await update(item, fields);
    setBusy(false);
    if (result === null) {
      onSaved();
      return;
    }
    if (isKeyMismatch(result)) {
      // The form closes (a new one gets a new key) and the list is reloaded (form.ts).
      onSaved(errorText(result));
      return;
    }
    setError(errorText(result));
  }

  async function create(fields: Omit<CreateMenuItemBody, 'routes'>) {
    const body: CreateMenuItemBody = {
      ...fields,
      routes: branchIds
        .filter((b) => (routes[b] ?? NO_ROUTE).station_id !== '')
        .map((b) => ({ branch_id: b, ...routeBody(b) })),
    };
    const result = await api.createMenuItem(body, key);
    return result.ok ? null : result.error;
  }

  async function update(current: MenuItem, fields: Omit<CreateMenuItemBody, 'routes'>) {
    const patch: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(fields)) {
      if (JSON.stringify(value) !== JSON.stringify(current[field as keyof MenuItem])) patch[field] = value;
    }
    const calls: (() => Promise<CloudResult<unknown>>)[] = [];
    if (Object.keys(patch).length > 0) calls.push(() => api.patchMenuItem(current.item_id, patch as PatchMenuItemBody));
    for (const b of branchIds) {
      const choice = routes[b] ?? NO_ROUTE;
      if (sameRoute(choice, routeOf(current, b))) continue;
      calls.push(() =>
        api.putItemRoute(current.item_id, b, choice.station_id === '' ? { station_id: null } : routeBody(b)),
      );
    }
    for (const call of calls) {
      const result = await call();
      if (!result.ok) return result.error;
    }
    return null;
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

  return (
    <form className="pos-stack pos-card" data-form="item" noValidate onSubmit={(e) => void submit(e)}>
      <h2 className="title">{t(item === null ? 'owner.item.new' : 'owner.item.edit')}</h2>
      <TextField name="name" label={t('owner.item.name')} value={name} onChange={setName} />
      <TextField name="group_label" label={t('owner.item.group_label')} value={groupLabel} onChange={setGroupLabel} />
      <TextField name="description" label={t('owner.item.description')} value={description} onChange={setDescription} />
      <Select name="category_id" label={t('owner.item.category')} value={categoryId} options={categoryOptions} onChange={setCategoryId} />
      <Select name="tax_class_id" label={t('owner.item.tax_class')} value={taxId} options={taxOptions} onChange={setTaxId} />
      <TextField name="price" label={t('owner.item.price')} value={price} onChange={setPrice} numeric />
      <Select
        name="serve_mode"
        label={t('owner.item.serve_mode')}
        value={serveMode}
        options={[
          { value: 'immediate', label: t('owner.item.serve_immediate') },
          { value: 'sync', label: t('owner.item.serve_sync') },
        ]}
        onChange={(next) => setServeMode(next as ServeMode)}
      />
      <TextField name="cook_minutes" label={t('owner.item.cook_minutes')} value={cook} onChange={setCook} numeric />
      <TextField name="prep_minutes" label={t('owner.item.prep_minutes')} value={prep} onChange={setPrep} numeric />
      <TextField
        name="stock_time_minutes"
        label={t('owner.item.stock_time_minutes')}
        value={stockTime}
        onChange={setStockTime}
        numeric
      />
      <Select
        name="out_of_stock_behaviour"
        label={t('owner.item.out_of_stock')}
        value={outOfStock}
        options={[
          { value: 'cook_fresh', label: t('owner.item.cook_fresh') },
          { value: 'sold_out', label: t('owner.item.sold_out') },
        ]}
        onChange={(next) => setOutOfStock(next as OutOfStockBehaviour)}
      />
      <Select
        name="stock_unit"
        label={t('owner.item.stock_unit')}
        value={stockUnit}
        options={(['piece', 'g', 'ml'] as const).map((u) => ({ value: u, label: t(UNIT_OPTIONS[u]) }))}
        onChange={(next) => changeStockUnit(next as Unit)}
      />
      <Select
        name="sale_unit"
        label={t('owner.item.sale_unit')}
        value={saleUnit}
        options={saleOptions.map((u) => ({ value: u, label: t(UNIT_OPTIONS[u]) }))}
        onChange={(next) => setSaleUnit(next as Unit)}
      />
      {unitsDiffer && stockUnit !== 'piece' && (
        <TextField
          name="stock_per_sale_unit"
          label={t(PER_PIECE_LABEL[stockUnit])}
          value={perPiece}
          onChange={setPerPiece}
          numeric
        />
      )}
      {unitsChanged && <Banner tone="warn" text={t('owner.item.unit_change_warning')} />}
      <div className="pos-field" data-field="low_stock_threshold">
        <span className="pos-field__label">{t('owner.item.low_stock')}</span>
        <QuantityInput unit={stockUnit} value={threshold} onChange={setThreshold} />
      </div>
      <label className="pos-row">
        <input
          type="checkbox"
          name="carries_over"
          checked={carriesOver}
          onChange={(e) => setCarriesOver(e.target.checked)}
        />
        <span>{t('owner.item.carries_over')}</span>
      </label>
      <WindowsField value={item?.availability_windows ?? []} onChange={setWindows} />
      <fieldset className="pos-stack">
        <legend className="pos-field__label">{t('owner.item.routes')}</legend>
        {branchIds.map((b) => {
          const choice = routes[b] ?? NO_ROUTE;
          const station = stationOf(b, choice.station_id);
          const programs = station?.station_type === 'batch' ? station.programs.filter(active) : [];
          const set = (patch: Partial<RouteChoice>) => setRoutes({ ...routes, [b]: { ...choice, ...patch } });
          return (
            <div key={b} className="pos-row" data-route-branch={b}>
              <span className="pos-ltr">{b}</span>
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
              {station?.station_type === 'batch' && (
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
                    onChange={(next) => set({ stock_program_id: next })}
                  />
                </>
              )}
            </div>
          );
        })}
      </fieldset>
      {error !== null && <Banner tone="danger" text={error} />}
      <div className="pos-row">
        <BusyButton busy={busy} primary type="submit">
          {t('owner.common.save')}
        </BusyButton>
        <button type="button" className="pos-btn" onClick={onCancel}>
          {t('owner.common.cancel')}
        </button>
      </div>
    </form>
  );
}
