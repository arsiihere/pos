import { formatQuantity, parseQuantity, type Unit } from '@pos/domain';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
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
  StockItem,
  StockUnit,
  TaxClass,
  VariantGroup,
} from '../../../api/cloud-admin';
import { navigate } from '../../../app/router';
import { newUlid } from '../../../app/ulid';
import { ActionBar } from '../../../components/ActionBar';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { ConfirmDialog } from '../../../components/Dialog';
import { Disclosure } from '../../../components/Disclosure';
import { Icon } from '../../../components/Icon';
import { InUseDialog, type InUseRow } from '../../../components/InUseDialog';
import { MoreMenu } from '../../../components/MoreMenu';
import { Segmented } from '../../../components/Segmented';
import { Skeleton } from '../../../components/Skeleton';
import { Switch } from '../../../components/Switch';
import { fill } from '../../../i18n/en';
import { t, type MessageKey, typeClass } from '../../../i18n';
import { idTail, useBranchName } from '../branch';
import { apiCode, bySortThenName, referenceText } from '../c01';
import { useCloudDown } from '../cloud';
import { errorText, isKeyMismatch, useIdempotencyKey } from '../form';
import { useDirtyForm, useLeave } from '../guard';
import { formatMinutes, parseMinutes } from '../minutes';
import { formatRupees, parseRupees, shownRupees } from '../money';
import { usePhone } from '../../../app/phone';
import { Page } from '../Shell';
import { quantityAffix, quantityInput, unitOption } from '../stock-items/stock';
import { linkStock, type LinkPlan, type LinkStep } from './linkStock';
import { GoesWithPicker, goesWithState, sameGoesWith, useEveryItem, type GoesWithLink } from './GoesWith';
import { KNOBS, knobText, knobValue, rangeText, weightValue, type Knob } from './timing';
import { windowText, WindowsField } from './WindowsField';

// §8.1, §6.14–§6.16 (01a-S07): the item form. Sections: what customers see, price (Sold by, price, tax
// with "No tax" first and selected, S34), kitchen (a station per branch, programs only for a batch station,
// S11) with a price per branch (S57), ready-made stock (stock time, when it runs out S32), hours (S47);
// an aside shows how staff will see it. 01c moves the stock units onto the stock item (V4; the form's
// variant, stock and weighed sections are 01c §8). Pulse (CHANGES §2): Archive item is in the app-bar More
// menu (edit only); Kept ready off folds the stock section; the aside is a collapsible summary. A client check
// lists what to fix before anything is sent. A new item POSTs with its routes and the form's key; an edit
// PATCHes the changed fields, then PUTs each changed route (§6.16); a PUT that fails after the PATCH saved
// shows which branch was not saved, and Save sends only what is still different (B03, S50 h). On a phone an
// edit opens price first (S50 g). Read-only (S8) shows the same form without saving.
// 01c §8 (01c-S01, contract §2): "Size group" (folds to one line when plain; Remove sends variant_group_id and
// variant_name null together), "Weighed when served" (kg / L items only; on hides the stock link) and "Stock"
// (a stock item, uses per sale in its unit, a read-only summary, and the inline "Create a stock item with this
// name" mini-form, linkStock.ts). Server field errors land on their field under the one summary banner (01c-B01);
// CONFIG_IN_USE opens 01c-D04.
// Owner decision 2026-10-30 (O5): Branches and kitchen, Ready-made stock and Hours fold into the frames' one
// "Branches and kitchen, Hours" disclosure (01c-S01). Its row sums up the stock draw ("Karahi pot · 0.5 kg per
// sale", or "Not counted", 01c A2). It is open for a new item, and opens on an error inside; it stays mounted
// while closed so nothing typed inside is lost.
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
const PER_UNIT_SHORT: Record<Unit, MessageKey> = { piece: 'menu.per.piece', g: 'menu.per.kg', ml: 'menu.per.l' };
// The summary aside starts open on a laptop and closed under 1200 px wide (CHANGES §2).
const SUMMARY_OPEN_QUERY = '(min-width: 1200px)';

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
  labelClass,
  ariaLabel,
  error,
  disabled,
}: {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (next: string) => void;
  id?: string;
  labelClass?: string;
  ariaLabel?: string;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`pos-field${error === undefined ? '' : ' pos-field--error'}`}>
      <span className={labelClass === undefined ? 'pos-field__label' : `pos-field__label ${labelClass}`}>{label}</span>
      <select
        className="pos-select"
        id={id}
        name={name}
        aria-label={ariaLabel}
        aria-invalid={error !== undefined ? true : undefined}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error !== undefined && <span className="pos-field__error">{error}</span>}
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
  prefix,
  placeholder,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  numeric?: boolean;
  help?: string;
  error?: string;
  unit?: string;
  prefix?: string;
  placeholder?: string;
}) {
  const input = (
    <input
      className={numeric ? 'pos-input pos-input--mono' : 'pos-input'}
      id={`item-${name}`}
      name={name}
      inputMode={numeric ? 'decimal' : undefined}
      aria-invalid={error !== undefined ? true : undefined}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  return (
    <label className={`pos-field${error === undefined ? '' : ' pos-field--error'}`}>
      <span className="pos-field__label">{label}</span>
      {unit === undefined && prefix === undefined ? (
        input
      ) : (
        <span className="pos-input-affix pos-ltr">
          {prefix !== undefined && <span>{prefix}</span>}
          {input}
          {unit !== undefined && <span>{unit}</span>}
        </span>
      )}
      {help !== undefined && <span className="pos-field__help">{help}</span>}
      {error !== undefined && <span className="pos-field__error">{error}</span>}
    </label>
  );
}

// 01c contract §2, 01c-B01: a 422 / name-taken refusal on a 01c field marks that field (the row as sent).
function serverProblem(error: CloudError, weighedOn: boolean): Problem | null {
  if (error.kind !== 'api') return null;
  const field = error.details['field'];
  if (error.code === 'CONFIG_NAME_TAKEN' && error.details['entity'] === 'variant') {
    return { id: 'item-variant_name', section: 'item.size_title', text: t('errors.CONFIG_NAME_TAKEN') };
  }
  if (error.code !== 'CONFIG_REFERENCE_INVALID' || typeof field !== 'string') return null;
  if (field === 'goes_with') return { id: 'item-goes_with', section: 'goeswith.title', text: t('goeswith.field_error') };
  const text = referenceText(error.details);
  if (field === 'variant_group_id') return { id: 'item-variant_group_id', section: 'item.size_title', text };
  if (field === 'variant_name') return { id: 'item-variant_name', section: 'item.size_title', text };
  if (field === 'category_id') return { id: 'item-category_id', section: 'item.section.customers', text };
  if (field === 'requires_weighing') return { id: 'item-requires_weighing', section: 'item.weighed_title', text };
  // While weighed is on the stock fields are hidden: the error shows on the switch.
  if (field.startsWith('stock_draws') && weighedOn) return { id: 'item-requires_weighing', section: 'item.weighed_title', text };
  if (field.startsWith('stock_draws')) {
    return field.endsWith('quantity_per_sale_unit')
      ? { id: 'item-uses', section: 'item.draw_title', text }
      : { id: 'item-stock_item_id', section: 'item.draw_title', text };
  }
  return null;
}

// 01c-D04 for an item: what still uses it (choice groups first, §6.5), one row per kind with its list.
function inUseOf(error: CloudError): InUseRow[] | null {
  if (error.kind !== 'api' || error.code !== 'CONFIG_IN_USE') return null;
  const usedBy = error.details['used_by'] as { entity?: unknown; ids?: unknown } | undefined;
  const n = Array.isArray(usedBy?.ids) ? usedBy.ids.length : 0;
  if (usedBy?.entity === 'modifier_group') {
    return [{ name: fill(t('item.in_use_groups'), { n: String(n) }), href: '#/choice-groups' }];
  }
  if (usedBy?.entity === 'deal') return [{ name: fill(t('item.in_use_deals'), { n: String(n) }), href: '#/deals' }];
  // Any other user: the generic "Still in use…" banner (errorText), never an empty dialog.
  return null;
}

interface Mini {
  name: string;
  unit: StockUnit;
  uses: string;
}

interface PartWay {
  plan: LinkPlan;
  stockItemId: string | null;
  error: string | null;
}

const MAX_USES = 1_000_000;

// The fields inside the folded disclosure: an error on any of them opens it.
const IN_FOLD = (id: string) =>
  id.startsWith('route-') ||
  ['item-cook_minutes', 'item-prep_minutes', 'item-stock_time_minutes', 'item-hours', 'item-kept_ready', 'item-weight_pct', 'item-max_early_minutes', 'item-max_carry_minutes', 'item-max_late_minutes', 'item-adjust_time_minutes', 'item-goes_with'].includes(id);

const storedLinks = (item: MenuItem | null): GoesWithLink[] =>
  item === null ? [] : item.goes_with.map((l) => ({ target_kind: l.target_kind, target_id: l.target_id, excluded: l.excluded }));

export function ItemForm({
  api,
  item,
  taxClasses,
  categories,
  branchIds,
  onSaved,
  onCancel,
  readOnly = false,
  variantGroups = [],
  newSizeOf,
}: {
  api: CloudAdmin;
  item: MenuItem | null;
  taxClasses: readonly TaxClass[];
  categories: readonly Category[];
  branchIds: readonly string[];
  onSaved: (notice?: string | null) => void;
  onCancel: () => void;
  readOnly?: boolean;
  // 01c §6.3: the menu read's size groups (archived included).
  variantGroups?: readonly VariantGroup[];
  // 01c-S09 "Add a size" (#/menu?new_size_of=…): a new item with the size group and its category filled in.
  newSizeOf?: string;
}) {
  const groupOf = (id: string) => variantGroups.find((g) => g.variant_group_id === id);
  const prefill = item === null && newSizeOf !== undefined ? groupOf(newSizeOf) : undefined;
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
  const [categoryId, setCategoryId] = useState(
    item?.category_id ?? prefill?.category_id ?? categories.find(active)?.category_id ?? '',
  );
  // 01c-S01 sections.
  const [groupId, setGroupId] = useState(item?.variant_group_id ?? prefill?.variant_group_id ?? '');
  const [sizeName, setSizeName] = useState(item?.variant_name ?? '');
  const [sizeOpen, setSizeOpen] = useState(groupId !== '');
  const [weighed, setWeighed] = useState(item?.requires_weighing ?? false);
  const storedDraw = item?.stock_draws[0];
  const [stockId, setStockId] = useState(storedDraw?.stock_item_id ?? '');
  const [uses, setUses] = useState('');
  const [stockItems, setStockItems] = useState<StockItem[] | null>(null);
  const [mini, setMini] = useState<Mini | null>(null);
  const [miniKey, setMiniKey] = useState('');
  const [miniError, setMiniError] = useState<{ field: 'name' | null; text: string } | null>(null);
  const [linking, setLinking] = useState<LinkStep | 0>(0);
  // The last create's answer was lost: the stock item may exist, so its key is kept for the next try.
  const [keyInDoubt, setKeyInDoubt] = useState(false);
  const [partWay, setPartWay] = useState<PartWay | null>(null);
  const [inUse, setInUse] = useState<{ title: string; rows: InUseRow[] } | null>(null);
  const [taxId, setTaxId] = useState(item?.tax_class_id ?? '');
  const [price, setPrice] = useState(item === null ? '' : formatRupees(item.price_minor));
  const [serveMode, setServeMode] = useState<ServeMode>(item?.serve_mode ?? 'immediate');
  const [cook, setCook] = useState(item === null ? '' : formatMinutes(item.cook_time_ms));
  const [prep, setPrep] = useState(item === null ? '' : formatMinutes(item.prep_buffer_ms));
  const [stockTime, setStockTime] = useState(item?.stock_time_ms == null ? '' : formatMinutes(item.stock_time_ms));
  const [outOfStock, setOutOfStock] = useState<OutOfStockBehaviour>(item?.out_of_stock_behaviour ?? 'cook_fresh');
  const [saleUnit, setSaleUnit] = useState<Unit>(item?.sale_unit ?? 'piece');
  const [windows, setWindows] = useState<AvailabilityWindow[] | null>(item?.availability_windows ?? []);
  // A-11 knobs as typed; A-13 links (archived targets already left out).
  const [weight, setWeight] = useState(String(item?.weight_pct ?? 100));
  const [early, setEarly] = useState(knobText(item?.max_early_ms ?? 60_000));
  const [carry, setCarry] = useState(knobText(item?.max_carry_ms ?? null));
  const [late, setLate] = useState(knobText(item?.max_late_ms ?? null));
  const [adjust, setAdjust] = useState(knobText(item?.adjust_time_ms ?? 180_000));
  // Until the whole menu is read the stored list is held as it is (picker off, never sent); the read then drops
  // the targets known to be archived from the base and the form together, so nothing differs by itself.
  const everyItem = useEveryItem(api, item !== null);
  const [baseLinks, setBaseLinks] = useState<GoesWithLink[]>(() => storedLinks(item));
  const [links, setLinks] = useState<GoesWithLink[]>(baseLinks);
  useEffect(() => {
    if (item === null || everyItem.items === null) return;
    const settled = goesWithState(item.goes_with, categories, everyItem.items, { kind: 'item', id: item.item_id });
    setBaseLinks(settled);
    setLinks(settled);
    // Once, when the read arrives.
  }, [everyItem.items]);
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
  const [foldOpen, setFoldOpen] = useState(item === null);
  const [summaryOpen, setSummaryOpen] = useState(() =>
    typeof window.matchMedia === 'function' ? window.matchMedia(SUMMARY_OPEN_QUERY).matches : true,
  );
  const summaryId = useId();

  // Focus a field, opening the folded part first when the field is inside it (the fix links, the A2 note).
  function reveal(id: string, target: () => HTMLElement | null = () => document.getElementById(id)) {
    if (IN_FOLD(id)) flushSync(() => setFoldOpen(true));
    target()?.focus();
  }

  // An error inside the folded part (a client check, a field refusal or a branch PUT that failed) opens it.
  useEffect(() => {
    if (problems.some((p) => IN_FOLD(p.id)) || Object.keys(failed).length > 0) setFoldOpen(true);
  }, [problems, failed]);

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

  // 01c §6.6: the stock items for the picker and the summary; an archived linked one is read too (R9).
  async function readStockItems(): Promise<StockItem[] | null> {
    const active = await api.listStockItems({});
    if (!active.ok) return null;
    // A reply without the list (an older cloud) reads as no stock items.
    const list = Array.isArray(active.data.stock_items) ? [...active.data.stock_items] : [];
    const linked = storedDraw?.stock_item_id;
    if (linked !== undefined && !list.some((s) => s.stock_item_id === linked)) {
      const archived = await api.listStockItems({ status: 'archived' });
      if (archived.ok && Array.isArray(archived.data.stock_items)) {
        list.push(...archived.data.stock_items.filter((s) => s.stock_item_id === linked));
      }
    }
    return list;
  }

  useEffect(() => {
    let live = true;
    void readStockItems().then((list) => {
      if (!live || list === null) return;
      setStockItems(list);
      const linked = list.find((s) => s.stock_item_id === storedDraw?.stock_item_id);
      if (linked !== undefined && storedDraw !== undefined && linked.stock_unit !== item?.sale_unit) {
        setUses(quantityInput(storedDraw.quantity_per_sale_unit, linked.stock_unit));
      }
    });
    return () => {
      live = false;
    };
    // Read once when the form opens.
  }, [api]);

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
  const weightPct = weightValue(weight);
  const knobMs: Record<Knob['name'], number | null | undefined> = {
    max_early_ms: knobValue(KNOBS[0]!, early, item?.max_early_ms),
    max_carry_ms: knobValue(KNOBS[1]!, carry, item?.max_carry_ms),
    max_late_ms: knobValue(KNOBS[2]!, late, item?.max_late_ms),
    adjust_time_ms: knobValue(KNOBS[3]!, adjust, item?.adjust_time_ms),
  };

  // 01c: the size group, weighing and the stock draw as they will be sent.
  const group = groupId === '' ? undefined : groupOf(groupId);
  const weighedOn = saleUnit !== 'piece' && weighed;
  const stock = stockId === '' ? undefined : stockItems?.find((s) => s.stock_item_id === stockId);
  const sameUnit = stock !== undefined && stock.stock_unit === saleUnit;
  const usesValue = (() => {
    if (stock === undefined || sameUnit) return null;
    const parsed = parseQuantity(uses, stock.stock_unit);
    return parsed.ok && parsed.value >= 1 && parsed.value <= MAX_USES ? parsed.value : null;
  })();
  // V4: equal units → 1; different units → the typed amount (the item must be sold by piece). Until the stock
  // items are read, the stored draw stays as it is. undefined = not sendable (check() says why).
  const draws = ((): MenuItem['stock_draws'] | undefined => {
    if (weighedOn || stockId === '') return [];
    if (stock === undefined) return storedDraw?.stock_item_id === stockId ? [storedDraw] : [];
    if (sameUnit) return [{ stock_item_id: stockId, quantity_per_sale_unit: 1 }];
    return usesValue === null ? undefined : [{ stock_item_id: stockId, quantity_per_sale_unit: usesValue }];
  })();

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
    if (weightPct === undefined) found.push({ id: 'item-weight_pct', section: 'item.timing', text: t('item.timing.need_pct') });
    for (const [knob, id] of [[KNOBS[0]!, 'item-max_early_minutes'], [KNOBS[1]!, 'item-max_carry_minutes'], [KNOBS[2]!, 'item-max_late_minutes'], [KNOBS[3]!, 'item-adjust_time_minutes']] as const) {
      if (knobMs[knob.name] === undefined) found.push({ id, section: 'item.timing', text: rangeText(knob) });
    }
    if (windows === null) found.push({ id: 'item-hours', section: 'item.section.hours', text: t('owner.hours.invalid') });
    if (groupId !== '') {
      if (group !== undefined && group.category_id !== categoryId) {
        found.push({ id: 'item-variant_group_id', section: 'item.size_title', text: t('errors.reference.category_mismatch') });
      }
      if (sizeName.trim() === '' || sizeName.trim().length > 30) {
        found.push({ id: 'item-variant_name', section: 'item.size_title', text: t('item.need_size_name') });
      }
    }
    if (!weighedOn && stock !== undefined && !sameUnit) {
      if (saleUnit !== 'piece') {
        found.push({ id: 'item-stock_item_id', section: 'item.draw_title', text: t('errors.reference.unit_mismatch') });
      } else if (usesValue === null) {
        found.push({ id: 'item-uses', section: 'item.draw_title', text: t('item.need_uses') });
      }
    }
    return found;
  }

  function fields(): Omit<CreateMenuItemBody, 'routes'> | null {
    if (!priceValue.ok || cookMs === null || prepMs === null || windows === null || draws === undefined) return null;
    if (weightPct === undefined || Object.values(knobMs).includes(undefined)) return null;
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
      variant_group_id: groupId === '' ? null : groupId,
      variant_name: groupId === '' ? null : sizeName.trim(),
      requires_weighing: weighedOn,
      stock_draws: draws,
      weight_pct: weightPct,
      max_early_ms: knobMs.max_early_ms as number,
      max_carry_ms: knobMs.max_carry_ms as number | null,
      max_late_ms: knobMs.max_late_ms as number | null,
      adjust_time_ms: knobMs.adjust_time_ms as number,
    };
  }

  function patchOf(current: MenuItem, next: Omit<CreateMenuItemBody, 'routes'>): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(next)) {
      if (JSON.stringify(value) !== JSON.stringify(current[field as keyof MenuItem])) patch[field] = value;
    }
    // §6.5 edge: the size group and the size name go together (one null alone → 400).
    if ('variant_group_id' in patch || 'variant_name' in patch) {
      patch['variant_group_id'] = next.variant_group_id;
      patch['variant_name'] = next.variant_name;
    }
    return patch;
  }

  // S50 c: what changed, by section label, for the discard question.
  const now = fields();
  const changedLabels: string[] = [];
  if (base === null) {
    if (name !== '' || price !== '' || cook !== '') changedLabels.push(t('item.section.customers').toLowerCase());
  } else {
    const diff: Record<string, unknown> = now === null ? { price_minor: true } : patchOf(base, now);
    if (!sameGoesWith(links, baseLinks)) diff['goes_with'] = true;
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
    if (busy || readOnly || mini !== null || linking !== 0) return;
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
    const field = serverProblem(result, weighedOn);
    if (field !== null) {
      setProblems([field]);
      return;
    }
    const users = inUseOf(result);
    if (users !== null) {
      setInUse({ title: fill(t('item.in_use_change'), { name: base?.name ?? name.trim() }), rows: users });
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
    // A-13: the list goes whole, and only when the owner changed it.
    if (!sameGoesWith(links, baseLinks)) patch['goes_with'] = links;
    if (Object.keys(patch).length > 0) {
      const result = await api.patchMenuItem(current.item_id, patch as PatchMenuItemBody);
      if (!result.ok) return result.error;
      setBase({ ...current, ...next });
      setBaseLinks(links);
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
    if (result.ok) {
      onSaved();
      return;
    }
    const users = inUseOf(result.error);
    if (users !== null) setInUse({ title: fill(t('in_use.title'), { name: base.name }), rows: users });
    else setError(errorText(result.error));
  }

  // 01c-S01 mini-form (Q9): named after the size group, else the item; counted in the item's own unit.
  function openMini() {
    setMini({ name: (group?.name ?? name.trim()).slice(0, 60), unit: saleUnit, uses: '' });
    // N9: after a POST whose answer was lost, the next attempt keeps that key (a replay, never name-taken).
    if (!keyInDoubt) setMiniKey(newUlid());
    setMiniError(null);
  }

  const miniDiffers = mini !== null && mini.unit !== saleUnit;
  const miniUses = (() => {
    if (mini === null || !miniDiffers) return 1;
    const parsed = parseQuantity(mini.uses, mini.unit);
    return parsed.ok && parsed.value >= 1 && parsed.value <= MAX_USES ? parsed.value : null;
  })();
  const miniMismatch = miniDiffers && saleUnit !== 'piece';
  // Step 3 PATCHes the stored item and step 2 uses the routes: an unsaved Sold by or station waits for Save.
  const miniUnsaved =
    base !== null &&
    (saleUnit !== base.sale_unit || branchIds.some((b) => !sameRoute(routes[b] ?? NO_ROUTE, baseRoutes[b] ?? NO_ROUTE)));
  const miniReady = !miniUnsaved && mini !== null && mini.name.trim() !== '' && mini.name.trim().length <= 60 && !miniMismatch && miniUses !== null;

  async function runLink(plan: LinkPlan, known: string | null) {
    setLinking(1);
    setMiniError(null);
    const result = await linkStock(api, plan, known, setLinking);
    setLinking(0);
    if (result.ok) {
      const draw = { stock_item_id: result.stockItemId, quantity_per_sale_unit: plan.quantity };
      setMini(null);
      setPartWay(null);
      setKeyInDoubt(false);
      setStockId(result.stockItemId);
      setUses(plan.stockUnit === saleUnit ? '' : quantityInput(plan.quantity, plan.stockUnit));
      if (base !== null) setBase({ ...base, stock_draws: [draw] });
      const list = await readStockItems();
      if (list !== null) setStockItems(list);
      return;
    }
    const text = errorText(result.error);
    if (result.stockItemId === null && mini !== null) {
      // Step 1 refused or lost: the mini-form stays; Create and link retries with the same key.
      if (isKeyMismatch(result.error)) setMiniKey(newUlid());
      setKeyInDoubt(result.error.kind !== 'api');
      const taken = apiCode(result.error) === 'CONFIG_NAME_TAKEN';
      setMiniError({ field: taken ? 'name' : null, text: taken ? t('errors.CONFIG_NAME_TAKEN') : (text ?? '') });
      return;
    }
    setMini(null);
    setPartWay({ plan, stockItemId: result.stockItemId, error: text });
  }

  function createAndLink() {
    if (mini === null || !miniReady || miniUses === null) return;
    void runLink(
      {
        name: mini.name.trim(),
        stockUnit: mini.unit,
        key: miniKey,
        stations: branchIds
          .filter((b) => (routes[b] ?? NO_ROUTE).station_id !== '')
          .map((b) => ({ branch_id: b, station_id: (routes[b] ?? NO_ROUTE).station_id })),
        quantity: miniUses,
        itemId: base?.item_id ?? null,
      },
      null,
    );
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
      aria-label={phone ? t('owner.nav.menu') : undefined}
      onClick={(e) => {
        e.preventDefault();
        leave(onCancel);
      }}
    >
      <Icon name="back" flip />
      {!phone && t('owner.nav.menu')}
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
      <BusyButton
        busy={busy}
        primary
        disabled={down || categoryOptions.length === 0 || mini !== null || linking !== 0}
        type="submit"
        form="item-form"
      >
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
            {problems.length === 1 ? t('fix.one') : fill(t('item.fix_n'), { n: String(problems.length) })}
            <small className="pos-fixlinks">
              {problems.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="pos-fixlinks__link"
                  onClick={() => reveal(p.id)}
                >
                  {`${t(p.section)}: ${p.text}`}
                </button>
              ))}
            </small>
          </p>
        </div>
      )}
      {failedBranches.length > 0 && (
        // B03 (OwnerItemPartial): the warn banner holds its Save {branch} again button.
        <div className="pos-banner pos-banner--warn" role="status">
          <Icon name="alert" />
          <p>
            {t('item.partial')}
            <small>
              {failedBranches.map((b) => fill(t('item.partial_body'), { branch: branchName(b), reason: failed[b] ?? '' })).join(' ')}
            </small>
          </p>
          <span className="pos-banner__action">
            <BusyButton busy={busy} disabled={down} onClick={() => void submit()}>
              {fill(t('item.save_branch_again'), { branch: failedBranches.map(branchName).join(', ') })}
            </BusyButton>
          </span>
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
        <form className="pos-stack pos-quickprice" id="item-form" data-form="item" noValidate onSubmit={(e) => void submit(e)}>
          <fieldset className="pos-stack" disabled={readOnly}>
            {banners}
            {/* Q11: the quick-price page names the size group and shows no 01c sections. */}
            {group !== undefined && <p className="pos-note">{fill(t('item.quick_group'), { name: group.name })}</p>}
            <section className="pos-card pos-quickprice__card">
              <TextField
                name="price"
                label={t('owner.item.price')}
                value={price}
                onChange={setPrice}
                numeric
                prefix={t('owner.menu.rupees')}
                unit={t(PER_UNIT[saleUnit])}
                help={fill(t('item.price_was'), { old: shownRupees(item.price_minor) })}
                error={problemFor('item-price')}
              />
              <Select name="tax_class_id" label={t('owner.item.tax_class')} value={taxId} options={taxOptions} onChange={setTaxId} />
              <p className={typeClass('body')} data-on-sale="">
                {fill(t('menu.branches_of'), { n: String(soldAt), m: String(branchIds.length) })}
              </p>
            </section>
            <ul className="pos-list pos-list--stack">
              <li className="pos-list__row">
                <span className="pos-list__name">
                  <strong>{t('item.section.kitchen')}</strong>
                  <span>{fill(t('item.cook_n'), { n: formatMinutes(cookMs ?? 0) })}</span>
                </span>
                <button
                  type="button"
                  className="pos-btn"
                  onClick={() => {
                    setFull(true);
                    setFoldOpen(true);
                  }}
                >
                  {t('owner.common.edit')}
                </button>
              </li>
              <li className="pos-list__row">
                <span className="pos-list__name">
                  <strong>{t('item.section.hours')}</strong>
                  <span>{(windows ?? []).length === 0 ? t('owner.hours.all_day') : (windows ?? []).map(windowText).join(', ')}</span>
                </span>
                <button
                  type="button"
                  className="pos-btn"
                  onClick={() => {
                    setFull(true);
                    setFoldOpen(true);
                  }}
                >
                  {t('owner.common.edit')}
                </button>
              </li>
            </ul>
            <p className="pos-note">{t('item.reach_branches')}</p>
          </fieldset>
          {!readOnly && (
            <ActionBar>
              <BusyButton busy={busy} primary disabled={down} type="submit">
                {t('item.save_price')}
              </BusyButton>
            </ActionBar>
          )}
        </form>
      </Page>
    );
  }

  const hoursText = (windows ?? []).length === 0 ? t('owner.hours.all_day') : (windows ?? []).map(windowText).join(', ');

  // 01c-S01 "Size group": plain → one quiet line with Put in a size group; in a group → picker + size name.
  const groupOptions = [
    { value: '', label: t('item.size_pick') },
    ...[...variantGroups]
      .filter((g) => g.archived_at === null || g.variant_group_id === item?.variant_group_id)
      .sort(bySortThenName)
      .map((g) => ({ value: g.variant_group_id, label: g.name })),
  ];
  const sizeSection = sizeOpen ? (
    <section className="pos-section" data-section="size">
      <div className="pos-fold__head">
        <div className="pos-section__head">
          <h2>{t('item.size_title')}</h2>
        </div>
        {!readOnly && (
          <button
            type="button"
            className="pos-btn"
            onClick={() => {
              setGroupId('');
              setSizeName('');
              setSizeOpen(false);
            }}
          >
            {t('item.size_remove')}
          </button>
        )}
      </div>
      <div className="pos-grid">
        <Select
          name="variant_group_id"
          id="item-variant_group_id"
          label={t('item.size_title')}
          value={groupId}
          options={groupOptions}
          onChange={(next) => {
            setGroupId(next);
            const picked = groupOf(next);
            if (picked !== undefined) setCategoryId(picked.category_id);
          }}
          error={problemFor('item-variant_group_id')}
        />
        <TextField
          name="variant_name"
          label={t('item.size_name')}
          value={sizeName}
          onChange={setSizeName}
          placeholder={t('item.size_name_placeholder')}
          help={t('item.size_name_help')}
          error={problemFor('item-variant_name')}
        />
      </div>
    </section>
  ) : (
    <section className="pos-section pos-section--quiet" data-section="size">
      <div className="pos-fold__head">
        <div className="pos-section__head">
          <h2>{t('item.size_title')}</h2>
          <p>{t('item.size_section_plain')}</p>
        </div>
        {!readOnly && (
          <button type="button" className="pos-btn" onClick={() => setSizeOpen(true)}>
            <Icon name="layers" />
            {t('item.put_in_group')}
          </button>
        )}
      </div>
    </section>
  );

  // V18: "Weighed when served" only for kg / L items.
  const weighedSection = saleUnit !== 'piece' && (
    <section className="pos-section" data-section="weighed">
      <div className="pos-fold__head pos-itemform__switchhead" id="item-requires_weighing" tabIndex={-1}>
        <div className="pos-section__head">
          <h2>{t('item.weighed_title')}</h2>
          <p>{t('item.weighed_help')}</p>
        </div>
        <Switch checked={weighed} label={t('item.weighed_title')} onChange={setWeighed} />
      </div>
      {problemFor('item-requires_weighing') !== undefined && (
        <span className="pos-field__error">{problemFor('item-requires_weighing')}</span>
      )}
    </section>
  );

  // 01c-S01 "Stock": picker, uses per sale in the stock item's unit, the summary, the mini-form.
  const stockOptions = [
    { value: '', label: t('item.stock_none') },
    ...(stockItems ?? [])
      .filter((s) => s.archived_at === null || s.stock_item_id === stockId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ value: s.stock_item_id, label: s.name })),
    ...(stockId !== '' && stockItems?.some((s) => s.stock_item_id === stockId) !== true
      ? [{ value: stockId, label: stockItems === null ? '…' : t('owner.common.archived') }]
      : []),
  ];
  const stationName = (branchId: string, stationId: string) =>
    stations?.[branchId]?.find((x) => x.station_id === stationId)?.name ?? idTail(stationId);
  const summaryLines =
    stock === undefined
      ? []
      : branchIds.map((b) => {
          const row = stock.branches.find((r) => r.branch_id === b);
          if (row === undefined || row.station_id === null) return fill(t('item.stock_line_none'), { branch: branchName(b) });
          const at = { branch: branchName(b), station: stationName(b, row.station_id) };
          return row.low_stock_threshold === null
            ? fill(t('stock_items.at'), at)
            : fill(t('item.stock_line_alert'), { ...at, n: formatQuantity(row.low_stock_threshold, stock.stock_unit) });
        });
  const openStock = (id: string) => leave(() => navigate(`/stock-items/${encodeURIComponent(id)}`));
  const usesQty = draws?.[0]?.quantity_per_sale_unit;
  const drawSection = weighedOn ? (
    <section className="pos-section pos-section--quiet" data-section="draw">
      <div className="pos-section__head">
        <h2>{t('item.draw_title')}</h2>
      </div>
      <p className="pos-note">{t('item.stock_not_used')}</p>
    </section>
  ) : (
    <section className="pos-section" data-section="draw">
      <div className="pos-section__head">
        <h2>{t('item.draw_title')}</h2>
        <p>
          {stock === undefined
            ? t('item.stock_help')
            : t(group === undefined ? 'item.stock_linked' : 'item.stock_linked_shared')}
        </p>
      </div>
      <div className={stock === undefined || sameUnit ? 'pos-pickrow' : 'pos-grid'}>
        <Select
          name="stock_item_id"
          id="item-stock_item_id"
          label={t('item.stock_item')}
          value={stockId}
          options={stockOptions}
          disabled={mini !== null || linking !== 0 || partWay !== null}
          onChange={(next) => {
            setStockId(next);
            setUses('');
          }}
          error={problemFor('item-stock_item_id')}
        />
        {stock !== undefined && !sameUnit && (
          <TextField
            name="uses"
            label={t('item.uses')}
            value={uses}
            onChange={setUses}
            numeric
            unit={quantityAffix(stock.stock_unit)}
            help={
              usesQty === undefined
                ? t('item.uses_help')
                : `${t('item.uses_help')} ${fill(t('item.uses_a_sale'), { qty: formatQuantity(usesQty, stock.stock_unit) })}`
            }
            error={problemFor('item-uses')}
          />
        )}
      </div>
      {sameUnit && <p className="pos-note">{t('item.uses_same')}</p>}
      {/* 01c A2: the hub counts an item only with a stock time or stock program and a draw. */}
      {stockId !== '' && !keptReady && (
        <p className="pos-note" data-needs-ready="">
          {t('item.stock_needs_ready')}{' '}
          {/* The Kept ready switch is in the folded row: this opens it and moves to the switch. */}
          <button
            type="button"
            className="pos-fixlinks__link"
            onClick={() => reveal('item-kept_ready', () => document.querySelector<HTMLElement>('[data-section="stock"] [role="switch"]'))}
          >
            {t('item.show_kept_ready')}
          </button>
        </p>
      )}
      {stock !== undefined && (
        <div className="pos-sumlines" data-stock-summary="">
          <b>
            {fill(t('item.stock_head'), {
              name: stock.name,
              unit: unitOption(stock.stock_unit),
              keeps: t(stock.carries_over ? 'item.keeps' : 'item.no_keep'),
            })}
          </b>
          {summaryLines.slice(0, 3).map((line, i) => (
            <span key={i}>{line}</span>
          ))}
          {summaryLines.length > 3 && <span>{fill(t('item.more_n'), { n: String(summaryLines.length - 3) })}</span>}
          <a
            href={`#/stock-items/${encodeURIComponent(stock.stock_item_id)}`}
            onClick={(e) => {
              e.preventDefault();
              openStock(stock.stock_item_id);
            }}
          >
            {t('item.open_stock')}
            <Icon name="forward" flip />
          </a>
        </div>
      )}
      {stockId === '' && mini === null && partWay === null && !readOnly && (
        <div className="pos-row">
          <button type="button" className="pos-btn" onClick={openMini}>
            <Icon name="plus" />
            {t('item.create_stock')}
          </button>
          <span className="pos-note">{t('item.create_stock_note')}</span>
        </div>
      )}
      {mini !== null && (
        <div className="pos-mini" data-mini="">
          <h3 className="pos-mini__title">{t('item.mini_title')}</h3>
          {miniError !== null && miniError.field === null && miniError.text !== '' && <Banner tone="danger" text={miniError.text} />}
          <div className="pos-grid pos-grid--3">
            <label className={`pos-field${miniError?.field === 'name' ? ' pos-field--error' : ''}`}>
              <span className="pos-field__label">{t('stock_item.name')}</span>
              <input
                className="pos-input"
                name="mini_name"
                maxLength={60}
                disabled={linking !== 0}
                value={mini.name}
                onChange={(e) => setMini({ ...mini, name: e.target.value })}
              />
              {miniError?.field === 'name' && <span className="pos-field__error">{miniError.text}</span>}
            </label>
            <div className={`pos-field${miniMismatch ? ' pos-field--error' : ''}`}>
              <span className="pos-field__label">{t('stock_item.unit')}</span>
              <Segmented
                label={t('stock_item.unit')}
                value={mini.unit}
                block
                locked={linking !== 0}
                options={(['piece', 'g', 'ml'] as const).map((u) => ({ value: u, label: unitOption(u) }))}
                onChange={(unit) => setMini({ ...mini, unit, uses: '' })}
              />
              {miniMismatch && <span className="pos-field__error">{t('errors.reference.unit_mismatch')}</span>}
            </div>
            {miniDiffers && !miniMismatch && (
              <label className="pos-field">
                <span className="pos-field__label">{t('item.uses')}</span>
                <span className="pos-input-affix pos-ltr">
                  <input
                    className="pos-input pos-input--mono"
                    name="mini_uses"
                    inputMode="decimal"
                    disabled={linking !== 0}
                    placeholder={t('item.mini_uses_placeholder')}
                    value={mini.uses}
                    onChange={(e) => setMini({ ...mini, uses: e.target.value })}
                  />
                  <span>{quantityAffix(mini.unit)}</span>
                </span>
                <span className="pos-field__help">
                  {fill(t('item.mini_uses_help'), { size: sizeName.trim() || name.trim() || t('owner.item.new') })}
                </span>
              </label>
            )}
          </div>
          <div className="pos-mini__foot">
            {linking !== 0 ? (
              <span className="pos-progress-line" role="status">
                <span className="pos-spin" aria-hidden="true" />
                {fill(t('item.creating'), { n: String(linking), total: String(base === null ? 2 : 3) })}
              </span>
            ) : (
              <span className="pos-note">{t(miniUnsaved ? 'item.mini_save_first' : 'item.mini_note')}</span>
            )}
            <button
              type="button"
              className="pos-btn"
              disabled={linking !== 0}
              onClick={() => {
                setMini(null);
                // A create whose answer was lost may have made it: show it in the picker.
                if (keyInDoubt) void readStockItems().then((list) => list !== null && setStockItems(list));
              }}
            >
              {t('owner.common.cancel')}
            </button>
            <button
              type="button"
              className="pos-btn pos-btn--primary"
              disabled={!miniReady || linking !== 0}
              onClick={createAndLink}
            >
              {t('item.create_link')}
            </button>
          </div>
        </div>
      )}
      {partWay !== null && (
        <div className="pos-banner pos-banner--warn" role="status" data-partway="">
          <Icon name="alert" />
          <p>
            {t('item.partway')}
            <small>
              {fill(t('item.partway_body'), { name: partWay.plan.name })}
              {partWay.error !== null && ` ${partWay.error}`}
            </small>
          </p>
          <span className="pos-banner__action">
            {linking !== 0 ? (
              <span className="pos-progress-line" role="status">
                <span className="pos-spin" aria-hidden="true" />
                {fill(t('item.creating'), { n: String(linking), total: String(base === null ? 2 : 3) })}
              </span>
            ) : (
              <button type="button" className="pos-btn pos-btn--row" onClick={() => void runLink(partWay.plan, partWay.stockItemId)}>
                {t('item.finish_linking')}
              </button>
            )}
          </span>
        </div>
      )}
    </section>
  );

  // The folded row's summary (owner decision 2026-10-30): the stock draw, counted only with a stock time or a
  // stock program and a draw (01c A2); weighed items draw nothing. A2 also needs the stock item counted at the
  // branch; the one-line summary leaves that to the Stock section's branch lines. Equal units draw "the amount
  // sold" (V4, quantity 1), so that summary has no amount.
  const counted =
    !weighedOn &&
    draws !== undefined &&
    draws.length > 0 &&
    (stockTimeMs !== null || branchIds.some((b) => routeBody(b).stock_program_id !== null));
  const foldSummary = !counted
    ? t('item.fold_not_counted')
    : stock === undefined
      ? '…'
      : sameUnit
        ? fill(t('item.fold_draw_same'), { stock: stock.name })
        : fill(t('item.fold_draw'), {
          stock: stock.name,
          // An LTR isolate keeps "0.5 kg" in order inside Urdu text.
          qty: `\u2066${formatQuantity(draws?.[0]?.quantity_per_sale_unit ?? 1, stock.stock_unit)}\u2069`,
        });

  return (
    <Page
      api={api}
      title={title}
      start={back}
      end={
        <>
          {base !== null && !readOnly && (
            <MoreMenu
              label={t('item.more')}
              info={{ title: t('item.menu_info_title'), detail: t('item.archive_body') }}
              items={[
                {
                  label: fill(t('item.menu_archive'), { item: base.name }),
                  icon: 'archive',
                  danger: true,
                  disabled: down,
                  onSelect: () => setArchiving(true),
                },
              ]}
            />
          )}
          {actions}
        </>
      }
    >
      {banners}
      <form className="pos-split pos-itemform" id="item-form" data-form="item" noValidate onSubmit={(e) => void submit(e)}>
        <fieldset className="pos-stack" disabled={readOnly}>
          <section className="pos-section">
            <div className="pos-section__head">
              <h2>{t('item.section.customers')}</h2>
            </div>
            <div className="pos-grid">
              <TextField name="name" label={t('owner.item.name')} value={name} onChange={setName} error={problemFor('item-name')} />
              <Select
                name="category_id"
                id="item-category_id"
                label={t('owner.item.category')}
                value={categoryId}
                options={categoryOptions}
                onChange={setCategoryId}
                error={problemFor('item-category_id')}
              />
              <TextField name="description" label={t('owner.item.description')} value={description} onChange={setDescription} />
            </div>
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
            <div className="pos-grid">
              <TextField
                name="price"
                label={t('owner.item.price')}
                value={price}
                onChange={setPrice}
                numeric
                prefix={t('owner.menu.rupees')}
                unit={t(PER_UNIT[saleUnit])}
                error={problemFor('item-price')}
              />
              <Select name="tax_class_id" label={t('owner.item.tax_class')} value={taxId} options={taxOptions} onChange={setTaxId} />
            </div>
          </section>

          {sizeSection}
          {weighedSection}
          {drawSection}

          <Disclosure
            keepMounted
            icon="home"
            title={t('item.fold_title')}
            summary={foldSummary}
            open={foldOpen}
            onOpenChange={setFoldOpen}
          >
            <section className="pos-section">
              <div className="pos-section__head">
                <h2>{t('item.branches_title')}</h2>
                <p>{fill(t('item.branches_body'), { price: priceValue.ok ? shownRupees(priceValue.value) : '…' })}</p>
              </div>
              {stations === null ? (
                <Skeleton lines={2} />
              ) : (
                <div className="pos-routes">
                  <div className="pos-list__head pos-routes__head" aria-hidden="true">
                    <span>{t('owner.branch')}</span>
                    <span>{t('item.price_here')}</span>
                    <span>{t('owner.item.station')}</span>
                    <span>{t('owner.item.program')}</span>
                  </div>
                  <ul className="pos-list">
                    {branchIds.map((b) => {
                      const choice = routes[b] ?? NO_ROUTE;
                      const station = stationOf(b, choice.station_id);
                      const programs = station?.station_type === 'batch' ? station.programs.filter(active) : [];
                      const set = (patch: Partial<RouteChoice>) => setRoutes({ ...routes, [b]: { ...choice, ...patch } });
                      const problem = problemFor(`route-${b}`);
                      const routeFailed = failed[b];
                      const at = (label: string) => `${label} · ${branchName(b)}`;
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
                            {branchName(b) !== idTail(b) && <span className="pos-ltr pos-routes__tail">{idTail(b)}</span>}
                          </span>
                          <label className="pos-field">
                            <span className="pos-field__label pos-routes__label">{t('item.price_here')}</span>
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
                            labelClass="pos-routes__label"
                            ariaLabel={at(t('owner.item.station'))}
                            value={choice.station_id}
                            options={[
                              { value: '', label: t('owner.item.not_sold_here') },
                              ...(stations[b] ?? [])
                                .filter((s) => active(s) || s.station_id === choice.station_id)
                                .map((s) => ({ value: s.station_id, label: s.name })),
                            ]}
                            onChange={(next) => chooseStation(b, next)}
                          />
                          <div className="pos-routes__recipe">
                            {station?.station_type === 'batch' ? (
                              <>
                                <Select
                                  name="program_id"
                                  label={t('owner.item.program')}
                                  labelClass="pos-routes__label"
                                  ariaLabel={at(t('owner.item.program'))}
                                  value={choice.program_id}
                                  options={programs.map((p) => ({ value: p.program_id, label: p.name }))}
                                  onChange={(next) => set({ program_id: next })}
                                />
                                <Select
                                  name="stock_program_id"
                                  label={t('owner.item.stock_program')}
                                  ariaLabel={at(t('owner.item.stock_program'))}
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
                              station !== undefined && <span className="pos-list__meta">{t('item.no_recipe_needed')}</span>
                            )}
                          </div>
                          {problem !== undefined && <span className="pos-field__error">{problem}</span>}
                          {routeFailed !== undefined && <span className="pos-field__error">{routeFailed}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <div className="pos-grid pos-grid--3">
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
                <div className="pos-field">
                  <span className="pos-field__label">{t('owner.item.serve_mode')}</span>
                  <Segmented
                    label={t('owner.item.serve_mode')}
                    value={serveMode}
                    block
                    options={[
                      { value: 'immediate', label: t('owner.item.serve_immediate') },
                      { value: 'sync', label: t('owner.item.serve_sync') },
                    ]}
                    onChange={setServeMode}
                  />
                </div>
              </div>
            </section>

            {/* Kept ready off folds the section to its head and switch (CHANGES §2, OwnerItemSimple). */}
            <section className={`pos-section${keptReady ? '' : ' pos-section--folded'}`} data-section="stock">
              <div className="pos-section__top">
                <div className="pos-section__head">
                  <h2>{t('item.section.stock')}</h2>
                  <p>{t('item.stock_body')}</p>
                </div>
                <Switch checked={keptReady} label={t('item.kept_ready')} onChange={changeKeptReady} />
              </div>
              {keptReady && (
                <div className="pos-grid">
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
                      block
                      options={[
                        { value: 'cook_fresh', label: t('owner.item.cook_fresh') },
                        { value: 'sold_out', label: t('owner.item.sold_out') },
                      ]}
                      onChange={setOutOfStock}
                    />
                  </div>
                </div>
              )}
            </section>

            <section className="pos-section pos-section--hours" id="item-hours" tabIndex={-1}>
              <WindowsField
                value={item?.availability_windows ?? []}
                onChange={setWindows}
                outer={category?.availability_windows ?? []}
                outerName={category?.name}
              />
            </section>

            <section className="pos-section" data-section="timing">
              <div className="pos-section__head">
                <h2>{t('item.timing')}</h2>
                <p>{t('item.timing_help')}</p>
              </div>
              <div className="pos-grid">
                <TextField name="weight_pct" label={t('item.timing.weight_pct')} value={weight} onChange={setWeight} numeric unit="%" help={t('item.timing.weight_help')} error={problemFor('item-weight_pct')} />
                <TextField name="max_early_minutes" label={t('item.timing.max_early')} value={early} onChange={setEarly} numeric error={problemFor('item-max_early_minutes')} />
                <TextField name="max_carry_minutes" label={t('item.timing.max_carry')} value={carry} onChange={setCarry} numeric help={t('item.timing.max_carry_help')} error={problemFor('item-max_carry_minutes')} />
                <TextField name="max_late_minutes" label={t('item.timing.max_late')} value={late} onChange={setLate} numeric help={t('item.timing.max_late_help')} error={problemFor('item-max_late_minutes')} />
                <TextField name="adjust_time_minutes" label={t('item.timing.adjust')} value={adjust} onChange={setAdjust} numeric help={t('item.timing.adjust_help')} error={problemFor('item-adjust_time_minutes')} />
              </div>
            </section>

            {base !== null && (
              <GoesWithPicker
                value={links}
                onChange={setLinks}
                categories={categories}
                items={everyItem.items ?? []}
                disabled={everyItem.items === null}
                self={{ kind: 'item', id: base.item_id }}
                error={problemFor('item-goes_with')}
              />
            )}
          </Disclosure>
        </fieldset>

        {/* "How staff will see it": a collapsible summary, open by default from 1200 px wide (CHANGES §2). */}
        <aside className="pos-card pos-summary" aria-label={t('item.preview')}>
          <button
            type="button"
            className="pos-summary__toggle"
            aria-expanded={summaryOpen}
            aria-controls={summaryId}
            onClick={() => setSummaryOpen(!summaryOpen)}
          >
            {t('item.preview')}
            <Icon name="chevron" />
          </button>
          {summaryOpen && (
            <div className="pos-summary__body" id={summaryId}>
              <p className="pos-summary__head">
                <strong>{name.trim() === '' ? t('owner.item.new') : name.trim()}</strong>
                {priceValue.ok && (
                  <span className="pos-list__num pos-ltr">
                    {`${t('owner.menu.rupees')} ${shownRupees(priceValue.value)}`}
                    <small>{t(PER_UNIT_SHORT[saleUnit])}</small>
                  </span>
                )}
              </p>
              <ul className="pos-summary__list">
                <li>
                  <Icon name="check" />
                  {fill(t('menu.branches_of'), { n: String(soldAt), m: String(branchIds.length) })}
                </li>
                <li>
                  <Icon name="check" />
                  {hoursText}
                </li>
                <li>
                  <Icon name="check" />
                  {group !== undefined
                    ? fill(t('item.sum_tile'), { group: group.name, size: sizeName.trim() || '…' })
                    : t('item.sum_own_tile')}
                </li>
                <li>
                  <Icon name="check" />
                  {weighedOn
                    ? t('item.sum_weighed')
                    : stock !== undefined && draws !== undefined && draws.length > 0
                      ? fill(t('size_group.draws'), {
                          qty: formatQuantity(draws[0]?.quantity_per_sale_unit ?? 1, stock.stock_unit),
                          stock: stock.name,
                        })
                      : t('item.sum_not_counted')}
                </li>
              </ul>
            </div>
          )}
        </aside>
      </form>
      {inUse !== null && (
        <InUseDialog
          name={base?.name ?? name.trim()}
          title={inUse.title}
          body={t('item.in_use_body')}
          rows={inUse.rows}
          icon="sliders"
          onClose={() => setInUse(null)}
          onOpen={() => setInUse(null)}
        />
      )}
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
