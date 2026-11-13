import { inAvailabilityWindows, localTimeOfDayMs, type Unit } from '@pos/domain';
import type { BranchConfig, ConfigItem } from '@pos/events';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { navigate } from '../../../../app/router';
import { language, t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico, Ring } from '../../../alerts/ui';
import { timeText } from '../../../alerts/labels';
import { useShell } from '../../shell/hooks';
import { tableHref } from '../../shell/routes';
import { LockBanner } from '../../tables/lock/LockBanner';
import { useTableLock } from '../../tables/lock/useTableLock';
import { OfflineBar } from '../../tables/offline/OfflineBar';
import type { SeatingRef } from '../../tables/contracts';
import type { Draft, DraftStore, EtaDraft, OrderType, OrdersCatchUp, ZoneStockBody } from '../contracts';
import { createAvailability, dealAvailability, itemAvailability, type ItemAvailability } from '../live/availability';
import { createStockMirror } from '../live/stock-mirror';
import { createIdbDraftStore } from '../drafts/idb-drafts';
import { newUlid } from '../../../../app/ulid';
import {
  EMPTY_CART,
  addLine,
  addTap,
  replaceLine,
  cartCount,
  cartTotal,
  groupCart,
  kitchenUnits,
  zoneCovered,
  lineProblems,
  readyBy,
  removeLine,
  setUnits,
  toEtaDraft,
  unitsOf,
  type Cart as CartModel,
  type DraftTarget,
} from './cart';
import { Cart, CartList, SendBar } from './Cart';
import type { LineView } from './CartLine';
import { MenuPills, MenuRail, type RailCategory } from './MenuRail';
import { MenuTiles, itemSub, variantsSub, type TileModel } from './MenuTiles';
import { DealSheet } from '../sheets/DealSheet';
import { NoteSheet, ORDER_NOTE_MAX } from '../sheets/NoteSheet';
import { OptionsSheet } from '../sheets/OptionsSheet';
import { createPreview, type PreviewState } from './preview';

// 02b §8 Ordering screen (02-S05 Order, OrderEmpty, OrderLoading, OrderKiosk, OrderPortrait, OrderUrdu; 02-S10 phone
// Menu / Cart tabs + sticky Send; 02-B03 draft back, B04 offline, B05 / B07 line problems), 02a §8 Order screen (the
// table lock). #/order/<type>/<id>: dine_in → id = seating_id; takeaway / parking → the new order's draft id.
// The screen keeps the cart (cart.ts) as a device draft per (device, person) (#35: it survives reload and comes back
// after sign-in), shows live times from eta-preview (preview.ts), stock / hours / slow chips from the device stock
// mirror (26a, Q-22), and mounts 02a's lock hook + banner for a dine-in seating (Send follows `canSend`).
// The sheets (options, deal, weight, notes: 26c) and Send / Hold / Held (26d) attach to `sheet` and `onSend`.

export interface OrderScreenProps {
  order_type: OrderType;
  id: string;
}

/** What a tile tap or Edit asks the sheets (26c) to open. */
export type SheetRequest =
  | { kind: 'item'; item_id: string; from_zone: boolean }
  | { kind: 'variants'; variant_group_id: string }
  | { kind: 'deal'; deal_id: string }
  | { kind: 'edit'; key: string }
  | { kind: 'order_note' };

/** The device's draft store: 25a's IndexedDB store unless a provider (a test, 01d 9b's SQLite store) gives another. */
export const DraftStoreContext = createContext<DraftStore | null>(null);

let deviceDrafts: DraftStore | null = null;
/** 25a's IndexedDB store (`pos-queue`), opened on first use. */
function idbDrafts(): DraftStore {
  deviceDrafts ??= createIdbDraftStore();
  return deviceDrafts;
}

function useVersion(subscribe: (l: () => void) => () => void): number {
  const [v, setV] = useState(0);
  useEffect(() => subscribe(() => setV((x) => x + 1)), [subscribe]);
  return v;
}

function isCart(v: unknown): v is CartModel {
  return typeof v === 'object' && v !== null && Array.isArray((v as { lines?: unknown }).lines);
}

/** A tile tap adds a line straight away only for a plain piece item; anything with a choice opens a sheet (26c). */
function needsSheet(item: ConfigItem, unit: Unit | null): boolean {
  return item.modifier_group_ids.length > 0 || item.requires_weighing || unit !== 'piece' || item.variant_group_id !== null;
}

/** The sheet's item / deal is still on the menu (an edited line still in the cart and on the menu). */
function sheetTargetPresent(sheet: SheetRequest, config: BranchConfig, cart: CartModel): boolean {
  const item = (id: string | undefined) => id !== undefined && config.items.some((i) => i.item_id === id);
  const deal = (id: string | undefined) => id !== undefined && config.deals.some((d) => d.deal_id === id);
  switch (sheet.kind) {
    case 'item':
      return item(sheet.item_id);
    case 'variants':
      return config.items.some((i) => i.variant_group_id === sheet.variant_group_id);
    case 'deal':
      return deal(sheet.deal_id);
    case 'edit': {
      const line = cart.lines.find((l) => l.key === sheet.key);
      return line !== undefined && (line.deal_id !== undefined ? deal(line.deal_id) : item(line.item_id));
    }
    case 'order_note':
      return true;
  }
}

/** The variant group tile: orderable when any variant is; else the first variant's state. */
function bestOf(states: ItemAvailability[]): ItemAvailability {
  return states.find((s) => s.orderable) ?? states[0]!;
}

function zoneCounts(part: unknown): ZoneStockBody[] {
  const zs = (part as Partial<OrdersCatchUp> | undefined)?.zone_stock;
  return Array.isArray(zs) ? zs : [];
}

export function OrderScreen({ order_type, id }: OrderScreenProps) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const given = useContext(DraftStoreContext);
  const drafts = given ?? idbDrafts();
  const ur = language() === 'ur';

  // ------------------------------------------------------------------------------------- live inputs
  const configVersion = useVersion(shell.config.subscribe);
  const config: BranchConfig | null = shell.config.snapshot();
  const mirror = useMemo(() => createStockMirror({ live: shell.live, snapshot: () => shellRef.current.config.snapshot(), hubNow: () => shellRef.current.clock.nowMs() }), [shell.live]);
  const availability = useMemo(
    () => createAvailability({ live: shell.live, config: shell.config, stock: mirror, clock: () => shellRef.current.clock }),
    [shell.live, shell.config, mirror],
  );
  useEffect(() => () => {
    availability.dispose();
    mirror.dispose();
  }, [availability, mirror]);
  useVersion(availability.subscribe);
  const preview = useMemo(() => createPreview({ etaPreview: (d) => shellRef.current.orders.etaPreview(d), live: shell.live, online: () => shellRef.current.online }), [shell.live]);
  useEffect(() => () => preview.dispose(), [preview]);
  useVersion(preview.subscribe);
  const pv: PreviewState = preview.state();
  // a reply's times stand only while the hub is reachable: offline they read "—" at once (the reconnect refetches)
  const body = pv.kind === 'ok' && shell.online ? pv.body : null;
  // 01c V20: the day-frozen sale unit (the mirror's BusinessDay), the config's until the mirror is seeded
  const unitOf = (item_id: string) => mirror.saleUnit(item_id);

  // zone counts (02b §8 Zone items, §3.10): catch-up `orders.zone_stock`, ZoneStock* frames, a zone-served ItemAdded
  // (−), and an ItemRemoved of a zone-served line (+, always; the line's zone and item from the catch-up or its ItemAdded)
  const [zones, setZones] = useState<ZoneStockBody[]>(() => zoneCounts(shell.live.part('orders')));
  const zoneLines = useRef(new Map<string, { zone_id: string; item_id: string; live: number }>());
  useEffect(() => {
    const seedLines = (part: unknown) => {
      zoneLines.current = new Map();
      for (const o of (part as Partial<OrdersCatchUp> | undefined)?.orders ?? [])
        for (const l of o.lines)
          if (l.served_from_zone_id !== null && l.item_id !== null && l.live_units > 0) zoneLines.current.set(l.order_item_id, { zone_id: l.served_from_zone_id, item_id: l.item_id, live: l.live_units });
    };
    seedLines(shell.live.part('orders'));
    return shell.live.subscribe((m) => {
      if (m.kind === 'catch_up') {
        setZones(zoneCounts(m.state['orders']));
        seedLines(m.state['orders']);
      }
      if (m.kind !== 'event') return;
      const p = m.event.payload as { zone_id?: string; item_id?: string; on_hand?: number; quantity?: number; units?: number; order_item_id?: string; served_from_zone_id?: string | null };
      const bump = (zone_id: string, item_id: string, f: (n: number) => number) =>
        setZones((zs) => zs.map((z) => (z.zone_id !== zone_id ? z : { ...z, items: z.items.map((i) => (i.item_id === item_id ? { ...i, on_hand: f(i.on_hand) } : i)) })));
      const type = m.event.event_type;
      if (type === 'ZoneStockSet' && p.zone_id !== undefined && p.item_id !== undefined && typeof p.on_hand === 'number') {
        const on_hand = p.on_hand;
        bump(p.zone_id, p.item_id, () => on_hand);
      }
      if (type === 'ZoneStockAdded' && p.zone_id !== undefined && p.item_id !== undefined && typeof p.quantity === 'number') {
        const q = p.quantity;
        bump(p.zone_id, p.item_id, (n) => n + q);
      }
      if (type === 'ItemAdded' && typeof p.served_from_zone_id === 'string' && p.item_id !== undefined && typeof p.quantity === 'number' && p.order_item_id !== undefined) {
        const q = p.quantity;
        zoneLines.current.set(p.order_item_id, { zone_id: p.served_from_zone_id, item_id: p.item_id, live: q });
        bump(p.served_from_zone_id, p.item_id, (n) => Math.max(0, n - q));
      }
      if (type === 'ItemRemoved' && p.order_item_id !== undefined) {
        const zl = zoneLines.current.get(p.order_item_id);
        if (zl === undefined) return;
        const n = Math.min(p.units ?? zl.live, zl.live);
        zl.live -= n;
        if (n > 0) bump(zl.zone_id, zl.item_id, (x) => x + n);
      }
    });
  }, [shell.live]);

  // ------------------------------------------------------------------------------------ the seating
  const [seat, setSeat] = useState<{ ref: SeatingRef; zone_id: string | null; round: number } | null>(null);
  // dine-in: the seating on the current map; not found (moved, closed) → "This table changed — refreshed", one more
  // read, then Send stays off with a message (Global constraints, TABLE_SEATING_CHANGED rule)
  const [seatMissing, setSeatMissing] = useState(false);
  useEffect(() => {
    if (order_type !== 'dine_in') return;
    let live = true;
    const find = async (): Promise<boolean> => {
      const [map, orders] = await Promise.all([shellRef.current.tables.tableMap(), shellRef.current.orders.seatingOrders(id)]);
      if (!live || !map.ok) return false;
      for (const floor of map.data.floors)
        for (const zone of floor.zones)
          for (const tile of zone.tables) {
            if (tile.seating_id !== id || (tile.primary_table_id !== null && tile.primary_table_id !== tile.table_id)) continue;
            setSeat({ ref: { table_id: tile.table_id, seating_id: id }, zone_id: zone.zone_id, round: (orders.ok ? orders.data.orders.length : 0) + 1 });
            return true;
          }
      return false;
    };
    void (async () => {
      if (await find()) return;
      if (!live) return;
      shellRef.current.toasts.show({ text: t('tables.changed'), tone: 'info' });
      if (!(await find()) && live) setSeatMissing(true);
    })();
    return () => {
      live = false;
    };
  }, [order_type, id]);
  const lock = useTableLock(order_type === 'dine_in' ? (seat?.ref ?? null) : null);
  const target: DraftTarget | null = order_type !== 'dine_in' ? { order_type } : seat === null ? null : { order_type, table_id: seat.ref.table_id, seating_id: id };

  // ----------------------------------------------------------------------------------------- the cart
  const [cart, setCart] = useState<CartModel>(EMPTY_CART);
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const [restored, setRestored] = useState(false);
  const [back, setBack] = useState<number | null>(null);
  // one draft per (device, person, order): a dine-in seating's own, or the new order's draft id (the route's)
  const draftId = useRef<string>(id);
  const staffId = shell.me?.staff_id ?? null;
  const deviceId = shell.device.id;
  // #35: the stored draft is read once per (person, order): the effect's deps are strings, so a re-render with a new
  // `me` object (the shell builds one on every render) reads nothing; a StrictMode remount reads again, which is
  // harmless. It never lands over lines typed meanwhile, and a store that cannot be read still saves.
  useEffect(() => {
    if (staffId === null) return;
    setRestored(false);
    let live = true;
    const done = (d: Draft | undefined) => {
      if (!live) return;
      draftId.current = d?.draft_id ?? (order_type === 'dine_in' ? newUlid() : id);
      if (d !== undefined && isCart(d.cart) && d.cart.lines.length > 0) {
        // typed before the read answered: keep it (it is saved next), no banner
        if (cartRef.current.lines.length === 0) {
          setCart(d.cart);
          setBack(d.updated_at);
        }
      }
      setRestored(true);
    };
    drafts
      .list(deviceId, staffId)
      .then((list) => done(list.find((x) => !x.held && (order_type === 'dine_in' ? x.order_type === 'dine_in' && x.seating_id === id : x.draft_id === id))))
      .catch(() => done(undefined));
    return () => {
      live = false;
    };
  }, [drafts, deviceId, staffId, id, order_type]);
  const seatTable = seat?.ref.table_id ?? null;
  useEffect(() => {
    if (!restored || staffId === null) return;
    const saved = cart.lines.length === 0 ? drafts.remove(draftId.current) : drafts.put({
      draft_id: draftId.current,
      device_id: deviceId,
      staff_id: staffId,
      order_type,
      ...(order_type !== 'dine_in' ? {} : { seating_id: id, ...(seatTable === null ? {} : { table_id: seatTable }) }),
      cart,
      updated_at: Math.floor(shellRef.current.clock.nowMs()),
      held: false,
    });
    // a failed write keeps the cart on screen; the next change writes again
    saved.catch(() => undefined);
  }, [cart, restored, drafts, staffId, id, order_type, seatTable, deviceId]);

  // the draft as JSON: a new preview only when what it sends changed (target is rebuilt each render)
  const draftJson = target === null || cart.lines.length === 0 ? null : JSON.stringify(toEtaDraft(cart, target));
  useEffect(() => {
    preview.set(draftJson === null ? null : (JSON.parse(draftJson) as EtaDraft));
  }, [preview, draftJson]);

  const [sheet, setSheet] = useState<SheetRequest | null>(null);
  // a menu change (BranchConfigApplied) that removed the open sheet's item or deal closes it: "pick again"
  useEffect(() => {
    const c = shellRef.current.config.snapshot();
    if (sheet === null || c === null || sheetTargetPresent(sheet, c, cartRef.current)) return;
    setSheet(null);
    shellRef.current.toasts.show({ text: t('sheet.changed'), tone: 'warn' });
  }, [sheet, configVersion]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'menu' | 'cart'>('menu');

  if (config === null) {
    return (
      <div className="osc" dir={ur ? 'rtl' : 'ltr'}>
        <div className="empty">{t('common.loading')}</div>
      </div>
    );
  }
  const inputs = availability.inputs();
  const avail = (item_id: string): ItemAvailability =>
    inputs === null ? { state: { kind: 'ok' }, orderable: true, cap: null } : itemAvailability(item_id, inputs);
  const capOf = (item_id: string) => avail(item_id).cap;
  const zone = seat?.zone_id == null ? null : (zones.find((z) => z.zone_id === seat.zone_id) ?? null);
  const zoneItem = (item_id: string) => zone?.items.find((i) => i.item_id === item_id) ?? null;
  // §3.2 step 5 / §3.10: the from_zone lines the zone count covers skip the kitchen's stock (cap, sold out)
  const covered = zoneCovered(cart, (item_id) => zoneItem(item_id)?.on_hand ?? null);
  /** The stock cap left for a line: the item's cap minus the other kitchen lines of it (covered lines don't count). */
  const lineCap = (key: string, item_id: string): number | null => {
    if (covered.has(key)) return null;
    const cap = capOf(item_id);
    return cap === null ? null : Math.max(0, cap - kitchenUnits(cart, item_id, covered, key));
  };
  /** A zone item with units at the counter: Off and hours still apply (step 4), the kitchen's stock does not. */
  const zoneAvail = (a: ItemAvailability, on_hand: number): ItemAvailability =>
    on_hand > 0 && (a.orderable || a.state.kind === 'sold_out' || a.state.kind === 'not_counted') ? { state: { kind: 'ok' }, orderable: true, cap: null } : a;

  // ------------------------------------------------------------------------------------- menu tiles
  const categories = [...config.categories].sort((a, b) => a.sort_order - b.sort_order);
  const rail: RailCategory[] = categories.map((c) => {
    const items = config.items.filter((i) => i.category_id === c.category_id);
    const groups = new Set(items.flatMap((i) => (i.variant_group_id === null ? [] : [i.variant_group_id])));
    const closed = inputs === null || inAvailabilityWindows(c.availability_windows, localTimeOfDayMs(inputs.nowMs, inputs.utcOffsetMs)) ? null : c.availability_windows;
    return { category_id: c.category_id, name: c.name, items: items.filter((i) => i.variant_group_id === null).length + groups.size, deals: config.deals.filter((d) => d.category_id === c.category_id).length, closed };
  });
  const current = category ?? rail[0]?.category_id ?? null;
  const q = query.trim().toLowerCase();
  const inView = (category_id: string, name: string) => (q === '' ? category_id === current : name.toLowerCase().includes(q));
  const tiles: TileModel[] = [];
  const seenGroups = new Set<string>();
  for (const item of [...config.items].sort((a, b) => a.sort_order - b.sort_order)) {
    if (item.variant_group_id !== null) {
      if (seenGroups.has(item.variant_group_id)) continue;
      seenGroups.add(item.variant_group_id);
      const vg = config.variant_groups.find((v) => v.variant_group_id === item.variant_group_id);
      const variants = config.items.filter((i) => i.variant_group_id === item.variant_group_id);
      const name = vg?.name ?? item.name;
      if (!inView(item.category_id, name)) continue;
      tiles.push({
        id: item.variant_group_id,
        kind: 'variants',
        name,
        sub: variantsSub(config, item.variant_group_id),
        price_minor: Math.min(...variants.map((v) => v.price_minor)),
        from: variants.length > 1,
        per: null,
        availability: bestOf(variants.map((v) => avail(v.item_id))),
        zone: null,
        in_cart: variants.reduce((n, v) => n + unitsOf(cart, v.item_id), 0),
      });
      continue;
    }
    if (!inView(item.category_id, item.name)) continue;
    const z = zoneItem(item.item_id);
    tiles.push({
      id: item.item_id,
      kind: 'item',
      name: item.name,
      sub: itemSub(item, unitOf(item.item_id)),
      price_minor: item.price_minor,
      from: false,
      per: unitOf(item.item_id) === 'g' ? 'kg' : unitOf(item.item_id) === 'ml' ? 'l' : null,
      availability: z === null ? avail(item.item_id) : zoneAvail(avail(item.item_id), z.on_hand),
      zone: z === null ? null : { on_hand: z.on_hand, zone_name: zone?.name ?? null },
      in_cart: unitsOf(cart, item.item_id),
    });
  }
  for (const deal of [...config.deals].sort((a, b) => a.sort_order - b.sort_order)) {
    if (!inView(deal.category_id, deal.name)) continue;
    tiles.push({
      id: deal.deal_id,
      kind: 'deal',
      name: deal.name,
      sub: deal.description,
      price_minor: deal.price_minor,
      from: false,
      per: null,
      availability: inputs === null ? { state: { kind: 'ok' }, orderable: true, cap: null } : dealAvailability(deal.deal_id, inputs),
      zone: null,
      in_cart: cart.lines.filter((l) => l.deal_id === deal.deal_id).reduce((n, l) => n + (l.quantity ?? 0), 0),
    });
  }
  const newKey = () => newUlid();
  const onTap = (tile: TileModel) => {
    if (tile.kind === 'deal') return setSheet({ kind: 'deal', deal_id: tile.id });
    if (tile.kind === 'variants') return setSheet({ kind: 'variants', variant_group_id: tile.id });
    const item = config.items.find((i) => i.item_id === tile.id)!;
    const from_zone = tile.zone !== null;
    if (needsSheet(item, unitOf(item.item_id))) return setSheet({ kind: 'item', item_id: item.item_id, from_zone });
    const next = addTap(cart, item.item_id, newKey, { from_zone });
    // #36: "Only n left" caps the kitchen's units (O15); units the zone covers are not the kitchen's
    const cap = capOf(item.item_id);
    if (cap !== null && kitchenUnits(next, item.item_id, zoneCovered(next, (id) => zoneItem(id)?.on_hand ?? null)) > cap) return;
    setCart(next);
  };

  // ------------------------------------------------------------------------------------------- cart view
  const problems = lineProblems(cart, body, capOf, covered);
  const moved = pv.kind === 'ok' ? pv.moved : new Set<string>();
  const groups = groupCart(cart, body).map((group) => ({
    group,
    lines: group.lines.map(
      (s): LineView => {
        const cap = s.line.item_id === undefined ? null : lineCap(s.line.key, s.line.item_id);
        return {
          line: s.line,
          eta_ms: s.eta_ms,
          moved: moved.has(s.line.key),
          zone_name: s.line.from_zone === true && group.kind === 'counter' ? (zone?.name ?? null) : null,
          problem: problems.get(s.line.key) ?? null,
          open: openKey === s.line.key,
          cap,
        };
      },
    ),
  }));
  const actions = {
    toggle: (key: string) => setOpenKey((k) => (k === key ? null : key)),
    setUnits: (key: string, units: number) => {
      const line = cart.lines.find((l) => l.key === key);
      const cap = line?.item_id === undefined ? null : lineCap(key, line.item_id);
      setCart((c) => setUnits(c, key, units, cap === null ? null : Math.max(1, cap)));
    },
    remove: (key: string) => setCart((c) => removeLine(c, key)),
    edit: (key: string) => setSheet({ kind: 'edit', key }),
  };
  const utcOffsetMs = shell.clock.utcOffsetMs;
  const count = cartCount(cart, unitOf);
  const total = cartTotal(config, cart, unitOf);
  const ready = readyBy(body);
  // dine-in: Send waits for the seating on the map, and follows the table lock
  const canSend = order_type !== 'dine_in' || (seat !== null && lock.canSend);
  const blocked = order_type === 'dine_in' && seatMissing ? t('order.seating_missing') : null;
  const onSend = () => {
    // 26d: SendDialog (freeze, enqueue first, then submit)
  };
  const cartProps = {
    config,
    utcOffsetMs,
    round: order_type === 'dine_in' ? (seat?.round ?? null) : null,
    count,
    groups,
    total_minor: total,
    ready_by: ready,
    problems: problems.size,
    canSend,
    blocked,
    unitOf,
    actions,
    onNote: () => setSheet({ kind: 'order_note' }),
    onHold: () => {
      // 26d: Hold keeps a device draft
    },
    onSend,
  };
  const keepDraft = () => navigate(seat === null ? '/tables' : tableHref(seat.ref.table_id, id));

  const menu = (
    <section className="menu">
      <label className="search" role="search">
        <Ico name="eye" />
        <input type="search" value={query} placeholder={t('menu.search')} aria-label={t('menu.search')} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <MenuTiles tiles={tiles} onTap={onTap} />
    </section>
  );
  const banners = (
    <>
      {!shell.online && <OfflineBar variant="order" />}
      {order_type === 'dine_in' && <LockBanner state={lock.banner} onKeepDraft={keepDraft} />}
    </>
  );
  // 26c: the sheet a tile, Edit or Order note asked for
  const closeSheet = () => setSheet(null);
  const onAdd = (line: CartModel['lines'][number]) => {
    setCart((c) => (c.lines.some((l) => l.key === line.key) ? replaceLine(c, line) : addLine(c, line)));
    setSheet(null);
  };
  const sheetAsBottom = shell.phone || shell.portrait;
  let sheetView: ReactNode = null;
  if (sheet !== null && sheetTargetPresent(sheet, config, cart)) {
    const editing = sheet.kind === 'edit' ? (cart.lines.find((l) => l.key === sheet.key) ?? null) : null;
    const variantsOf = (item_id: string) => {
      const item = config.items.find((i) => i.item_id === item_id);
      if (item?.variant_group_id == null) return [item_id];
      return config.items.filter((i) => i.variant_group_id === item.variant_group_id).sort((a, b) => a.sort_order - b.sort_order).map((i) => i.item_id);
    };
    const common = { config, inputs, unitOf, sheet: sheetAsBottom, newKey, onAdd, onClose: closeSheet };
    // O15: what is left for this line once the cart's other lines of the item are counted
    const sheetCap = (item_id: string) => {
      const cap = capOf(item_id);
      if (cap === null) return null;
      const mine = editing?.item_id === item_id ? (editing.quantity ?? 0) : 0;
      return Math.max(0, cap - (unitsOf(cart, item_id) - mine));
    };
    if (sheet.kind === 'order_note')
      sheetView = (
        <NoteSheet
          title={t('note.order_title')}
          max={ORDER_NOTE_MAX}
          initial={cart.order_note}
          sheet={sheetAsBottom}
          onSave={(note) => {
            setCart((c) => {
              const { order_note: _drop, ...rest } = c;
              void _drop;
              return note === undefined ? rest : { ...rest, order_note: note };
            });
            setSheet(null);
          }}
          onClose={closeSheet}
        />
      );
    else if (sheet.kind === 'deal' || editing?.deal_id !== undefined)
      sheetView = <DealSheet {...common} deal_id={sheet.kind === 'deal' ? sheet.deal_id : editing!.deal_id!} initial={editing} onNotice={(text) => shell.toasts.show({ text, tone: 'warn' })} />;
    else if (sheet.kind === 'variants')
      sheetView = (
        <OptionsSheet
          {...common}
          item_ids={config.items.filter((i) => i.variant_group_id === sheet.variant_group_id).sort((a, b) => a.sort_order - b.sort_order).map((i) => i.item_id)}
          initial={null}
          capOf={sheetCap}
        />
      );
    else if (sheet.kind === 'item') sheetView = <OptionsSheet {...common} item_ids={[sheet.item_id]} initial={null} from_zone={sheet.from_zone} capOf={sheetCap} />;
    else if (editing?.item_id !== undefined) sheetView = <OptionsSheet {...common} item_ids={variantsOf(editing.item_id)} initial={editing} capOf={sheetCap} />;
  }

  const draftBack =
    back === null ? null : (
      <div className="abns">
        <div className="abn abn--info c-info" role="alert">
          <Ring size={56} pct={null} tone="info">
            <Ico name="info" />
          </Ring>
          <div className="ac__body">
            <div className="ac__title">
              <b>{t('draft.back')}</b>
            </div>
            <div className="ac__det">{fill(t('draft.kept_since'), { time: timeText(back, utcOffsetMs) })}</div>
          </div>
          <button type="button" className="btn btn--tone c-info" onClick={() => setBack(null)}>
            {t('draft.ok')}
          </button>
        </div>
      </div>
    );

  if (shell.phone || shell.portrait) {
    return (
      <div className="col grow order order--phone" dir={ur ? 'rtl' : 'ltr'}>
        {banners}
        <div className="ptabs">
          <button type="button" aria-pressed={tab === 'menu'} onClick={() => setTab('menu')}>
            {t('order.tab.menu')}
          </button>
          <button type="button" aria-pressed={tab === 'cart'} onClick={() => setTab('cart')}>
            {t('order.tab.cart')} <span className="n num">{count}</span>
          </button>
        </div>
        {blocked !== null && (
          <div className="msg cart__msg c-warn" role="alert">
            <Ico name="warn" />
            <span>{blocked}</span>
          </div>
        )}
        <div className="ph-body">
          {tab === 'menu' ? (
            <>
              <MenuPills categories={rail} current={current} onPick={setCategory} />
              {menu}
            </>
          ) : (
            <CartList config={config} unitOf={unitOf} utcOffsetMs={utcOffsetMs} groups={groups} actions={actions} />
          )}
        </div>
        <SendBar count={count} total_minor={total} ready_by={ready} utcOffsetMs={utcOffsetMs} problems={problems.size} canSend={canSend} onSend={onSend} />
        {draftBack}
        {sheetView}
      </div>
    );
  }
  return (
    <div className="col grow order" dir={ur ? 'rtl' : 'ltr'}>
      {banners}
      <div className="osc">
        <MenuRail categories={rail} current={current} onPick={setCategory} />
        {menu}
        <Cart {...cartProps} />
      </div>
      {draftBack}
      {sheetView}
    </div>
  );
}

