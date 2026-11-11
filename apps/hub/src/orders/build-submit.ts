// 02b §3.2 steps 3–7 (ids, lines from config, zone candidates, routing, ProposedOrder), §3.1 identity, §3.10 routing,
// O3–O5, D25; the ItemAdded copies are 01c §4.3 with the money of 01c §3.4. Pure (AD-8, AD-12): no DB, no clock, no
// runtime time zone; hub time and its offset come from ctx. The zone count check and served_from_zone_id are the
// caller's (SubmitOrder): zone candidates are built here as kitchen lines.
import {
  allocateDealMinor,
  checkOptionChoices,
  childQuantity,
  DomainError,
  isItemOrderable,
  isOrderableByTime,
  lineTotalMinor,
  localTimeOfDayMs,
  optionChargeMinor,
  orderLineTotalMinor,
  type AvailabilityWindow,
  type ChosenOption,
  type IsAvailable,
  type Position,
} from '@pos/domain';
import type { ProposedLine, ProposedOrder } from '@pos/engine';
import type { BranchConfig, ConfigCategory, ConfigDeal, ConfigItem, ConfigModifierGroup, ConfigStation, ItemAddedPayload } from '@pos/events';
import type { BuildSubmit, BuildSubmitCtx, OrderType, SubmitInput, SubmitOption } from './contracts.js';

type Line = SubmitInput['lines'][number];
type Zone = BranchConfig['floors'][number]['zones'][number];

const DAY_MS = 86_400_000;
const ORDER_TYPES: readonly string[] = ['dine_in', 'takeaway', 'parking'] satisfies OrderType[];
// A deal line has no item, so no 01a A-11 knobs; the engine never reads them (not an engine line, 03a :245). The
// 01a v2.1 §5.2a item defaults stand in (03a §4.5: weight 100, max_early_ms 60 000, no late / carry limit).
const DEAL_KNOBS = { weight_pct: 100, max_early_ms: 60_000, max_late_ms: null, max_carry_ms: null } as const;

function invalid(path: string, message: string): never {
  throw new DomainError('VALIDATION_FAILED', { issues: [{ path, message }] });
}

// §3.2 step 3 (O3, C6): every id of the payload once (the order id, each line, each linked option child, each part).
function checkIds(input: SubmitInput): void {
  const seen = new Set<string>([input.order_id]);
  const see = (id: string | undefined, path: string): void => {
    if (id === undefined) return;
    if (seen.has(id)) invalid(path, 'id repeated in the payload');
    seen.add(id);
  };
  input.lines.forEach((line, n) => {
    see(line.order_item_id, `lines.${n}.order_item_id`);
    line.options?.forEach((o, k) => see(o.order_item_id, `lines.${n}.options.${k}.order_item_id`));
    line.deal_choices?.forEach((c, k) => {
      see(c.order_item_id, `lines.${n}.deal_choices.${k}.order_item_id`);
      c.options?.forEach((o, j) => see(o.order_item_id, `lines.${n}.deal_choices.${k}.options.${j}.order_item_id`));
    });
  });
}

// §3.1: the order's engine identity. dine_in: the seating; takeaway: the order; parking: car_number_norm.
function orderOf(input: SubmitInput, ctx: BuildSubmitCtx): ProposedOrder['order'] {
  const base = { order_type: input.order_type, follow_up: false, pickup_at_ms: null };
  switch (input.order_type) {
    case 'dine_in':
      if (input.seating_id === undefined) invalid('seating_id', 'dine_in needs seating_id');
      return { ...base, table_id: ctx.primary_table_id, table_key: `dine_in:${input.seating_id}`, follow_up: ctx.follow_up };
    case 'takeaway':
      return { ...base, table_id: null, table_key: `takeaway:${input.order_id}` };
    case 'parking':
      if (input.parking === undefined) invalid('parking', 'parking needs car_number and car_type');
      return { ...base, table_id: null, table_key: `parking:${input.parking.car_number.toUpperCase().replace(/[\s-]/g, '')}` };
  }
}

// §3.10: the primary table's zone (dine-in only); a table without a zone, or an archived zone, has none.
function zoneOf(config: BranchConfig, input: SubmitInput, table_id: string | null): Zone | null {
  if (input.order_type !== 'dine_in' || table_id === null) return null;
  const zone_id = config.floors.flatMap((f) => f.tables).find((t) => t.table_id === table_id)?.zone_id ?? null;
  return config.floors.flatMap((f) => f.zones).find((z) => z.zone_id === zone_id && !z.is_archived) ?? null;
}

export const buildSubmit: BuildSubmit = (config, input, ctx) => {
  if (!ORDER_TYPES.includes(input.order_type)) invalid('order_type', 'order type not taken (dine_in, takeaway, parking)');
  checkIds(input);
  const order = orderOf(input, ctx);
  const zone = zoneOf(config, input, ctx.primary_table_id);

  const itemsById: Record<string, ConfigItem> = Object.fromEntries(config.items.map((i) => [i.item_id, i]));
  const groupsById: Record<string, ConfigModifierGroup> = Object.fromEntries(config.modifier_groups.map((g) => [g.modifier_group_id, g]));
  const stations = new Map<string, ConfigStation>(config.stations.map((s) => [s.station_id, s]));
  const categories = new Map<string, ConfigCategory>(config.categories.map((c) => [c.category_id, c]));
  const variantGroups = new Map(config.variant_groups.map((v) => [v.variant_group_id, v.name]));
  const optionGroup = new Map<string, string>();
  for (const g of config.modifier_groups) for (const o of g.options) optionGroup.set(o.option_id, g.modifier_group_id);
  const categoryOf = (category_id: string): ConfigCategory | null => categories.get(category_id) ?? null;

  const inHours = (entity: { availability_windows: readonly AvailabilityWindow[]; category_id: string }): boolean =>
    isOrderableByTime(entity, categoryOf(entity.category_id), ctx.now, ctx.utc_offset_ms);
  // S47: the next hub-time instant the entity is orderable by time (a window start of its own or its category's),
  // null when its windows and its category's never overlap.
  const opensAt = (entity: { availability_windows: readonly AvailabilityWindow[]; category_id: string }): number | null => {
    const category = categoryOf(entity.category_id);
    const tod = localTimeOfDayMs(ctx.now, ctx.utc_offset_ms);
    let best: number | null = null;
    for (const w of [...entity.availability_windows, ...(category?.availability_windows ?? [])]) {
      const at = ctx.now + ((((w.start_ms - tod) % DAY_MS) + DAY_MS) % DAY_MS || DAY_MS);
      if ((best === null || at < best) && isOrderableByTime(entity, category, at, ctx.utc_offset_ms)) best = at;
    }
    return best;
  };
  // 01c §3.4.6 / V11 d: a linked option's item and a group's satisfiability read "on and inside its windows"; ctx's
  // callback is the manual On / Off (item_availability), the windows are read here on hub time. Sold out is the
  // engine's (§3.2 step 8).
  const available: IsAvailable = (item_id, quantity) => {
    const item = itemsById[item_id];
    return item !== undefined && ctx.isAvailable(item_id, quantity) && inHours(item);
  };

  const itemOf = (item_id: string): ConfigItem => {
    const item = itemsById[item_id];
    if (item === undefined) throw new DomainError('MENU_ITEM_NOT_FOUND', { item_id });
    return item;
  };
  // §3.2 step 4: manual Off → ITEM_UNAVAILABLE; outside its or its category's windows → ITEM_OUT_OF_HOURS; a required
  // group not satisfiable in the position → ITEM_UNAVAILABLE.
  const checkSellable = (item: ConfigItem, quantity: number, position: Position): void => {
    if (!ctx.isAvailable(item.item_id, quantity)) throw new DomainError('ITEM_UNAVAILABLE', { item_id: item.item_id });
    if (!inHours(item)) throw new DomainError('ITEM_OUT_OF_HOURS', { item_id: item.item_id, opens_at_ms: opensAt(item) });
    if (!isItemOrderable(item, groupsById, itemsById, position, quantity, available)) {
      throw new DomainError('ITEM_UNAVAILABLE', { item_id: item.item_id });
    }
  };
  // §3.2 step 4: options through checkOptionChoices → OPTION_CHOICE_INVALID { order_item_id, violations }.
  const checkOptions = (
    order_item_id: string,
    item: ConfigItem,
    options: readonly SubmitOption[],
    position: Position,
    parent: { quantity: number | null; sale_unit: ConfigItem['sale_unit'] },
  ): ChosenOption[] => {
    const chosen = options.map((o) => ({ modifier_group_id: optionGroup.get(o.option_id) ?? '', option_id: o.option_id, quantity: o.quantity }));
    const groups = item.modifier_group_ids.flatMap((id) => groupsById[id] ?? []);
    const violations = checkOptionChoices(groups, chosen, position, parent, groupsById, itemsById, available);
    if (violations.length > 0) throw new DomainError('OPTION_CHOICE_INVALID', { order_item_id, violations });
    return chosen;
  };
  const optionOf = (c: ChosenOption) => groupsById[c.modifier_group_id]!.options.find((o) => o.option_id === c.option_id)!;

  // 01c V20 (owner 2026-11-11 S-1): an item's sale unit and draws are the day-frozen ones (ctx.draws = dayDraws),
  // never the config's own; every quantity and money rule of the line reads that sale unit.
  const unitOf = (item: ConfigItem): ConfigItem['sale_unit'] => ctx.draws(item.item_id).sale_unit;

  // §3.10 / O4: the zone route of the primary table's zone (dine-in only), else the branch route.
  const routeOf = (item: ConfigItem): string => zone?.routes.find((r) => r.item_id === item.item_id)?.station_id ?? item.station_id;
  // 01c §4.3: the D25 copies of the line's item; B1: program cook times from the routed station's programs[] (batch only).
  const fromItem = (item: ConfigItem, quantity: number | null) => {
    const station_id = routeOf(item);
    const day = ctx.draws(item.item_id);
    const station = stations.get(station_id);
    const programCook = (program_id: string | null): number | null =>
      station?.station_type !== 'batch' || program_id === null ? null : (station.programs.find((p) => p.program_id === program_id)?.cook_time_ms ?? null);
    return {
      item_id: item.item_id,
      variant_group_id: item.variant_group_id,
      variant_group_name: item.variant_group_id === null ? null : (variantGroups.get(item.variant_group_id) ?? null),
      variant_name: item.variant_name,
      name: item.name,
      sale_unit: day.sale_unit,
      price_minor: item.price_minor,
      station_id,
      program_id: item.program_id,
      stock_program_id: item.stock_program_id,
      program_cook_time_ms: programCook(item.program_id),
      stock_program_cook_time_ms: programCook(item.stock_program_id),
      serve_mode: item.serve_mode,
      prep_buffer_ms: item.prep_buffer_ms,
      cook_time_ms: item.cook_time_ms,
      stock_time_ms: item.stock_time_ms,
      out_of_stock_behaviour: item.out_of_stock_behaviour,
      // 01c §3.5.2: stock units for the whole line; a weight still pending has none (a weighed item has no draws, V18).
      stock_draws: quantity === null ? [] : day.stock_draws.map((d) => ({ stock_item_id: d.stock_item_id, quantity: d.quantity_per_sale_unit * quantity })),
      is_ready_item: item.is_ready_item,
    };
  };
  const none = {
    parent_order_item_id: null,
    deal_id: null,
    deal_part_id: null,
    option_id: null,
    option_quantity: null,
    extra_price_minor: null,
    allocated_price_minor: null,
    kitchen_note: null,
    served_from_zone_id: null,
  };

  // owner 2026-11-11 S-3 (a): `variant_id` is ignored; a variant is an item with its own item_id (01c V2, §3.4.1).
  const itemLines = (line: Line, n: number, item_id: string): ItemAddedPayload[] => {
    const item = itemOf(item_id);
    if (line.deal_choices !== undefined) invalid(`lines.${n}.deal_choices`, 'deal_choices only on a deal line');
    const quantity = line.quantity ?? (item.requires_weighing ? null : invalid(`lines.${n}.quantity`, 'quantity required'));
    checkSellable(item, quantity ?? 1, 'line');
    const options = line.options ?? [];
    const chosen = checkOptions(line.order_item_id, item, options, 'line', { quantity, sale_unit: unitOf(item) });
    const plain: ItemAddedPayload['options'] = [];
    const children: ItemAddedPayload[] = [];
    chosen.forEach((c, k) => {
      const option = optionOf(c);
      const given = options[k]!;
      if (option.linked_item_id === null) {
        if (given.order_item_id !== undefined) invalid(`lines.${n}.options.${k}.order_item_id`, 'a plain option is not a line');
        const charge_minor = optionChargeMinor(option.price_minor, c.quantity, quantity ?? 0, unitOf(item));
        plain.push({ option_id: option.option_id, modifier_group_id: c.modifier_group_id, name: option.name, price_minor: option.price_minor, quantity: c.quantity, charge_minor });
        return;
      }
      if (given.order_item_id === undefined) invalid(`lines.${n}.options.${k}.order_item_id`, 'a linked option needs its order_item_id');
      // 01c §3.4.2: piece parent → option qty × parent qty; g / ml parent → option qty (its quantity is not read).
      const childQty = childQuantity(c.quantity, quantity ?? 0, unitOf(item));
      const linked = itemOf(option.linked_item_id);
      children.push({
        ...none,
        ...fromItem(linked, childQty),
        order_id: input.order_id,
        order_item_id: given.order_item_id,
        parent_order_item_id: line.order_item_id,
        line_kind: 'option_child',
        option_id: option.option_id,
        option_quantity: c.quantity,
        category_id: linked.category_id,
        requires_weighing: false,
        quantity: childQty,
        sale_unit: 'piece',
        // V19: the option's effective branch price (the builder resolved it into the snapshot).
        price_minor: option.price_minor,
        tax_class_id: linked.tax_class_id,
        options: [],
        line_total_minor: orderLineTotalMinor({ line_kind: 'option_child', price_minor: option.price_minor, quantity: childQty, option_charges_minor: [] }),
      });
    });
    const parent: ItemAddedPayload = {
      ...none,
      ...fromItem(item, quantity),
      order_id: input.order_id,
      order_item_id: line.order_item_id,
      line_kind: 'item',
      category_id: item.category_id,
      requires_weighing: item.requires_weighing,
      quantity,
      tax_class_id: item.tax_class_id,
      options: plain,
      line_total_minor: orderLineTotalMinor({
        line_kind: 'item',
        price_minor: item.price_minor,
        quantity,
        sale_unit: unitOf(item),
        option_charges_minor: plain.map((o) => o.charge_minor),
      }),
      kitchen_note: line.kitchen_note ?? null,
    };
    return [parent, ...children];
  };

  const dealLines = (line: Line, n: number, deal_id: string): ItemAddedPayload[] => {
    const deal: ConfigDeal | undefined = config.deals.find((d) => d.deal_id === deal_id);
    if (deal === undefined) throw new DomainError('DEAL_NOT_FOUND', { deal_id });
    if (line.options !== undefined && line.options.length > 0) invalid(`lines.${n}.options`, 'a deal takes no options');
    const dealQty = line.quantity ?? invalid(`lines.${n}.quantity`, 'quantity required');
    if (!inHours(deal)) throw new DomainError('ITEM_OUT_OF_HOURS', { deal_id, opens_at_ms: opensAt(deal) });
    const choices = line.deal_choices ?? [];
    choices.forEach((c, k) => {
      if (!deal.parts.some((p) => p.deal_part_id === c.deal_part_id)) invalid(`lines.${n}.deal_choices.${k}.deal_part_id`, 'not a part of the deal');
      if (choices.findIndex((x) => x.deal_part_id === c.deal_part_id) !== k) invalid(`lines.${n}.deal_choices.${k}.deal_part_id`, 'part chosen twice');
    });
    const parts = deal.parts.map((part) => {
      const k = choices.findIndex((c) => c.deal_part_id === part.deal_part_id);
      if (k < 0) invalid(`lines.${n}.deal_choices`, `no choice for part ${part.deal_part_id}`);
      const choice = choices[k]!;
      const offered = part.choices.find((c) => c.item_id === choice.item_id);
      if (offered === undefined) invalid(`lines.${n}.deal_choices.${k}.item_id`, 'not a choice of the part');
      const item = itemOf(choice.item_id);
      // 01c §3.4.2: a part's quantity = part quantity × deal quantity (in the item's sale_unit).
      const quantity = part.quantity * dealQty;
      checkSellable(item, quantity, 'child');
      const chosen = checkOptions(choice.order_item_id, item, choice.options ?? [], 'child', { quantity, sale_unit: unitOf(item) });
      // §3.4.3 (B2): a piece part's options per piece of the part; a g / ml part's once per deal.
      const optionParent = unitOf(item) === 'piece' ? quantity : dealQty;
      const options = chosen.map((c) => {
        const o = optionOf(c);
        return { option_id: o.option_id, modifier_group_id: c.modifier_group_id, name: o.name, price_minor: o.price_minor, quantity: c.quantity, charge_minor: optionChargeMinor(o.price_minor, c.quantity, optionParent, 'piece') };
      });
      // V11 c (M9): the weight is the reference choice's (first by sort_order, then item_id) at this branch.
      const reference = part.choices
        .filter((c) => itemsById[c.item_id] !== undefined)
        .sort((a, b) => a.sort_order - b.sort_order || (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0))[0];
      const refItem = reference === undefined ? undefined : itemsById[reference.item_id]!;
      const weight = refItem === undefined ? 0 : lineTotalMinor(refItem.price_minor, quantity, unitOf(refItem));
      // B2: piece part extra × part qty × deal qty; g / ml part extra × deal qty.
      const extraMinor = offered.extra_price_minor * (unitOf(item) === 'piece' ? quantity : dealQty);
      return { part, choice, item, quantity, options, weight, extra: offered.extra_price_minor, extraMinor };
    });
    const shares = allocateDealMinor(
      lineTotalMinor(deal.price_minor, dealQty, 'piece'),
      parts.map((p) => p.weight),
    );
    const header: ItemAddedPayload = {
      ...none,
      order_id: input.order_id,
      order_item_id: line.order_item_id,
      line_kind: 'deal',
      item_id: null,
      deal_id,
      variant_group_id: null,
      variant_group_name: null,
      variant_name: null,
      name: deal.name,
      category_id: deal.category_id,
      requires_weighing: false,
      quantity: dealQty,
      sale_unit: 'piece',
      price_minor: deal.price_minor,
      tax_class_id: deal.tax_class_id,
      station_id: null,
      program_id: null,
      stock_program_id: null,
      program_cook_time_ms: null,
      stock_program_cook_time_ms: null,
      serve_mode: null,
      prep_buffer_ms: null,
      cook_time_ms: null,
      stock_time_ms: null,
      out_of_stock_behaviour: null,
      stock_draws: [],
      options: [],
      line_total_minor: orderLineTotalMinor({
        line_kind: 'deal',
        price_minor: deal.price_minor,
        quantity: dealQty,
        parts: parts.map((p) => ({
          sale_unit: unitOf(p.item),
          quantity: p.part.quantity,
          extra_price_minor: p.extra,
          option_charges_minor: p.options.map((o) => o.charge_minor),
        })),
      }),
      kitchen_note: line.kitchen_note ?? null,
      is_ready_item: false,
    };
    return [
      header,
      ...parts.map((p, i): ItemAddedPayload => {
        const copied = fromItem(p.item, p.quantity);
        return {
          ...none,
          ...copied,
          order_id: input.order_id,
          order_item_id: p.choice.order_item_id,
          parent_order_item_id: line.order_item_id,
          line_kind: 'deal_part',
          deal_id,
          deal_part_id: p.part.deal_part_id,
          // m12: the deal's category; V11 b: the deal's tax class.
          category_id: deal.category_id,
          requires_weighing: false,
          quantity: p.quantity,
          extra_price_minor: p.extra,
          allocated_price_minor: shares[i]! + p.extraMinor,
          tax_class_id: deal.tax_class_id,
          options: p.options,
          line_total_minor: 0,
          // owner 2026-11-11 S-5 (b): the deal's kitchen note reaches every engine part (the header keeps it too).
          kitchen_note: copied.station_id === null ? null : (line.kitchen_note ?? null),
        };
      }),
    ];
  };

  const itemAdded: ItemAddedPayload[] = [];
  const zoneCandidates: string[] = [];
  input.lines.forEach((line, n) => {
    if ((line.item_id === undefined) === (line.deal_id === undefined)) invalid(`lines.${n}`, 'exactly one of item_id, deal_id');
    if (line.deal_id !== undefined) {
      itemAdded.push(...dealLines(line, n, line.deal_id));
      return;
    }
    const item_id = line.item_id!;
    itemAdded.push(...itemLines(line, n, item_id));
    // §3.2 step 5 (O5, AD-8): a candidate before the zone count check, built as a kitchen line.
    if (line.from_zone === true && (line.options ?? []).length === 0 && zone?.stock_items.some((s) => s.item_id === item_id) === true) {
      zoneCandidates.push(line.order_item_id);
    }
  });

  // 03a §4.2 / §3.5.5 (D8, D9), 01a A-9 / A-10: the line's point is its station's; the alternates are the station's rows
  // allowing the order type (home = the row listing it in home_for_order_types); carry = the station's carry_times row
  // for that point, a missing row = 0. The 01a A-11 knobs are the line item's D25 copies.
  const engineLine = (a: ItemAddedPayload): ProposedLine => {
    const item = a.item_id === null ? undefined : itemsById[a.item_id];
    const station = a.station_id === null ? undefined : stations.get(a.station_id);
    const point_id = station?.point_id ?? null;
    const carryOf = (station_id: string): number => stations.get(station_id)?.carry_times.find((c) => c.point_id === point_id)?.carry_ms ?? 0;
    const rows = station?.alternates.filter((r) => r.order_types.includes(order.order_type)) ?? [];
    const home = rows.find((r) => r.home_for_order_types.includes(order.order_type))?.station_id;
    const ids = [...new Set(rows.map((r) => r.station_id))].filter((id) => id !== station?.station_id);
    const knobs = item === undefined ? DEAL_KNOBS : item;
    return {
      ...a,
      alternates: ids.map((id) => ({ station_id: id, carry_ms: carryOf(id), home: id === home })),
      point_id,
      carry_ms: station === undefined ? 0 : carryOf(station.station_id),
      weight_pct: knobs.weight_pct,
      max_early_ms: knobs.max_early_ms,
      max_late_ms: knobs.max_late_ms,
      max_carry_ms: knobs.max_carry_ms,
      cook_ms_override: null,
      return_of: null,
    };
  };

  return { proposed: { order_id: input.order_id, order, lines: itemAdded.map(engineLine) }, itemAdded, zoneCandidates };
};
