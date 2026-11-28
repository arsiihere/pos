import { inAvailabilityWindows, localTimeOfDayMs, PICKUP_MIN_LEAD_MS, type Unit } from '@pos/domain';
import type { BranchConfig, ConfigItem } from '@pos/events';
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { navigate } from '../../../../app/router';
import { language, t } from '../../../../i18n';
import { errorKey, fill } from '../../../../i18n/en';
import { Ico, Ring } from '../../../alerts/ui';
import { timeText } from '../../../alerts/labels';
import { useShell, type Shell } from '../../shell/hooks';
import { orderHref, tableHref } from '../../shell/routes';
import { LockBanner } from '../../tables/lock/LockBanner';
import { useTableLock } from '../../tables/lock/useTableLock';
import { OfflineBar } from '../../tables/offline/OfflineBar';
import type { SeatingRef } from '../../tables/contracts';
import type { Draft, DraftStore, EtaDraft, EtaPreviewBody, OrderType, OrdersCatchUp, ServeMode, ZoneStockBody } from '../contracts';
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
  cartLineMoney,
  cartTotal,
  groupCart,
  kitchenUnits,
  zoneCovered,
  lineProblems,
  readyBy,
  removeLine,
  serveState,
  setUnits,
  toEtaDraft,
  unitsOf,
  type Cart as CartModel,
  type DraftTarget,
} from './cart';
import { Cart, CartList, SendBar } from './Cart';
import type { LineView } from './CartLine';
import { MenuPills, MenuRail, type RailCategory } from './MenuRail';
import { MenuTiles, TilePlaceholder, itemSub, offToast, variantsSub, type TakeawayTileActions, type TileModel } from './MenuTiles';
import { groupsOf } from '../sheets/preselect';
import { DealSheet } from '../sheets/DealSheet';
import { NoteSheet, ORDER_NOTE_MAX } from '../sheets/NoteSheet';
import { OptionsSheet } from '../sheets/OptionsSheet';
import { createPreview, type PreviewState } from './preview';
import { DayNotStarted, startDayMode } from './DayNotStarted';
import { createDayWatch } from './day-open';
import { phoneBad } from './contact';
import { CustomerRow } from './CustomerRow';
import { PickupRow } from './PickupRow';
import { pickupPassed, type PickupBounds } from './pickup';
import { LeaveGuard, useLeaveGuard } from './LeaveGuard';
import { money } from '../money';
import { cartDisplay, createDisplayPublisher, idleDisplay, type DisplayMessage } from '../customer-display/channel';
import { NewOrderSheet } from '../new-order/NewOrderSheet';
import { SendDialog, type SendView } from '../send/SendDialog';
import { announceCompIt, freezeSubmit, refusalText, sendOrder, sentToastText, timeUpdated, toCart, zoneEmpty } from '../send/send';
import { tokenBookOf } from '../takeaway/book';
import { setCurrentTakeawayDraft } from '../takeaway/current-draft';
import { heldOnDevice } from './held-list';
import { QueueRail, type RailVariant } from '../takeaway/QueueRail';
import { billsOf, type QueueToken } from '../takeaway/queue-model';
import { createHandovers } from '../takeaway/handover';
import { allLiveReady, liveLines, TokenView } from '../takeaway/TokenView';
import { candidatesOf, checkHandover, gateOf, lineIds, type Gate } from '../unpaid/candidate';
import { unpaidRequestsOf } from '../unpaid/requests';
import { PayPanel, type PayTarget } from '../takeaway/PayPanel';
import { CartCheckBill, SentTokenPrint } from '../takeaway/CheckBill';
import { printPayLaterSlip, slipMissed, slipMissesOf } from '../takeaway/slips';
import { servedPayload } from '../actions/MarkServedSheet';
import { showEnqueued } from '../view/LineActions';
import { groupParts, type GroupedLine } from '../view/parts';
import { servable } from '../view/stage';
import { takeawayContext } from '../../shell/context-slot';
import { keyEntries, keyMatches, MAX_KEY_QTY, parseKeyQuery, type KeyEntry } from './keyboard';
import { readRushOverride, rushOn, toggledOverride, writeRushOverride } from '../takeaway/rush';
import { deltaText } from './delta';
import { ServeChoice } from './ServeChoice';

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
  /** 02b-TK C2-1 (CHANGES §1): the Takeaway tab (`#/takeaway`, TakeawayHome) — the screen stays after Hold with a
   *  fresh cart on a new current draft; its route is the tab's */
  home?: boolean;
}

/** What a tile tap or Edit asks the sheets (26c) to open. */
export type SheetRequest =
  | { kind: 'item'; item_id: string; from_zone: boolean }
  /** `item_id`: 02b-TK A2 item 3 — the variant tapped on the tile, chosen in the sheet */
  | { kind: 'variants'; variant_group_id: string; item_id?: string }
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

/** The device draft store (the context's, else 25a's IndexedDB store). */
/** 02a §6 table-map: `joined_table_names` holds every table of the seating, itself included ("F4 + F5"); one table → its name. */
function tableCode(tile: { name: string; joined_table_names: readonly string[] }): string {
  return tile.joined_table_names.length > 1 ? tile.joined_table_names.join(' + ') : tile.name;
}

export function useDrafts(): DraftStore {
  return useContext(DraftStoreContext) ?? idbDrafts();
}

/** A cart with nothing to keep: no lines, no takeaway / parking details, not a queue-log copy. */
function blank(c: CartModel): boolean {
  return c.lines.length === 0 && c.takeaway === undefined && c.parking === undefined && c.from_entry_id === undefined && c.order_note === undefined;
}

/** A tile tap adds a line straight away only for a plain piece item; anything with a choice opens a sheet (26c). */
function needsSheet(item: ConfigItem, unit: Unit | null): boolean {
  return item.modifier_group_ids.length > 0 || item.requires_weighing || unit !== 'piece' || item.variant_group_id !== null;
}

/**
 * 02b-TK A2 item 3 (frame TileStates "half/full on tile"; 01c §3.4.6): a variant tapped on its tile is added at once
 * unless it needs a choice — a required group, a default option (the sheet shows the defaults), a weight or a
 * non-piece unit: then its sheet opens with that variant chosen.
 */
function variantNeedsSheet(config: BranchConfig, item: ConfigItem, unit: Unit | null): boolean {
  if (item.requires_weighing || unit !== 'piece') return true;
  return groupsOf(config, item).some((g) => g.min_choices > 0 || g.options.some((o) => o.is_default));
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

/** 02b-TK A2 item 2: a key typed here is text for that field (name, phone, a note…), never a shortcut or the search. */
function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(target.type);
}

/** The variant group tile: orderable when any variant is; else the first variant's state. */
/** L-CLIENT-6a item 9: the sent toast's Print again — `PrintTakeawaySlip { reason: 'reprint' }` (03c §3.11). */
async function reprintSlip(shell: Shell, order_id: string): Promise<void> {
  const answer = await shell.api.command<{ printed: boolean; skipped: string | null }>('PrintTakeawaySlip', { order_id, reason: 'reprint' });
  if (!answer.ok) return shell.toasts.show({ text: answer.error.kind === 'api' ? t(errorKey(answer.error.code)) : t('tables.toast.needs_hub'), tone: 'warn' });
  if (answer.data.printed) {
    slipMissesOf(shell).clear([order_id]);
    return shell.toasts.show({ text: t('takeaway.slip.printing'), tone: 'ok' });
  }
  shell.toasts.show({ text: t(answer.data.skipped === 'setting_off' ? 'takeaway.slip.off' : 'takeaway.slip.no_printer'), tone: 'warn' });
}

/** L-CLIENT-6a item 9: how long "Your unsent order is back" stays (a toast's 4 s and a little more to read it). */
const DRAFT_BACK_MS = 6_000;

function bestOf(states: ItemAvailability[]): ItemAvailability {
  return states.find((s) => s.orderable) ?? states[0]!;
}

function zoneCounts(part: unknown): ZoneStockBody[] {
  const zs = (part as Partial<OrdersCatchUp> | undefined)?.zone_stock;
  return Array.isArray(zs) ? zs : [];
}

export function OrderScreen({ order_type, id, home = false }: OrderScreenProps) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const drafts = useDrafts();
  const lang = language();
  const ur = lang === 'ur';

  // ------------------------------------------------------------------------------------- live inputs
  const configVersion = useVersion(shell.config.subscribe);
  const config: BranchConfig | null = shell.config.snapshot();
  const mirror = useMemo(() => createStockMirror({ live: shell.live, snapshot: () => shellRef.current.config.snapshot(), hubNow: () => shellRef.current.clock.nowMs() }), [shell.live]);
  const availability = useMemo(
    () =>
      createAvailability({
        live: shell.live,
        config: shell.config,
        stock: mirror,
        clock: () => shellRef.current.clock,
        // 02b v1.0.19 §8 (STAB-4): the tiles' station wait follows the kitchen, not only the catch-up
        fetchStationsLive: () => shellRef.current.orders.stationsLive?.() ?? Promise.resolve({ ok: false, error: { kind: 'network' } } as const),
        // 02b-tk C3-3: the tile estimate reads this order type's home station and padding
        orderType: order_type,
      }),
    [shell.live, shell.config, mirror, order_type],
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
  // 02b-TK C1-1: no business day open (catch-up `stock`, BusinessDay* frames), known before the first item
  const dayWatch = useMemo(() => createDayWatch(shell.live), [shell.live]);
  useEffect(() => () => dayWatch.dispose(), [dayWatch]);
  useVersion(dayWatch.subscribe);
  // a reply's times stand only while the hub is reachable: offline they read "—" at once (the reconnect refetches)
  // ⚠️ 02b v1.0.28 QK-4 (BUG-17): while only the pickup is refused, the cart keeps its last ready times (never "—")
  const lastOkBody = useRef<EtaPreviewBody | null>(null);
  if (pv.kind === 'ok') lastOkBody.current = pv.body;
  else if (pv.kind !== 'pickup_invalid') lastOkBody.current = null;
  const body = !shell.online ? null : pv.kind === 'ok' ? pv.body : pv.kind === 'pickup_invalid' ? lastOkBody.current : null;
  // ⚠️ 02b-TK L-CLIENT-5 item 1 (02b v1.0.25 §6.14 pickup_bounds, §8): the last range the hub sent (Time… keeps it
  // while a later preview is refused or pending)
  const pickupBounds = useRef<PickupBounds | null>(null);
  if (pv.kind === 'ok' && pv.body.pickup_bounds != null) pickupBounds.current = pv.body.pickup_bounds;
  const pickupProblem = pv.kind === 'pickup_invalid' && shell.online ? pv.problem : null;
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
  const [seat, setSeat] = useState<{ ref: SeatingRef; zone_id: string | null; round: number; name: string } | null>(null);
  // dine-in: the seating on the current map; not found (moved, closed) → "This table changed — refreshed", one more
  // read, then Send stays off with a message (Global constraints, TABLE_SEATING_CHANGED rule)
  const [seatMissing, setSeatMissing] = useState(false);
  // a Send refused with TABLE_SEATING_CHANGED reads the map once more (its toast is shown by Send)
  const [seatReload, setSeatReload] = useState(0);
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
            setSeat({ ref: { table_id: tile.table_id, seating_id: id }, zone_id: zone.zone_id, round: (orders.ok ? orders.data.orders.length : 0) + 1, name: tableCode(tile) });
            return true;
          }
      return false;
    };
    void (async () => {
      if (seatReload > 0) {
        setSeat(null);
        if (!(await find()) && live) setSeatMissing(true);
        return;
      }
      if (await find()) return;
      if (!live) return;
      shellRef.current.toasts.show({ text: t('tables.changed'), tone: 'info' });
      if (!(await find()) && live) setSeatMissing(true);
    })();
    return () => {
      live = false;
    };
  }, [order_type, id, seatReload]);
  const lock = useTableLock(order_type === 'dine_in' ? (seat?.ref ?? null) : null);
  const target: DraftTarget | null = order_type !== 'dine_in' ? { order_type } : seat === null ? null : { order_type, table_id: seat.ref.table_id, seating_id: id };

  // ----------------------------------------------------------------------------------------- the cart
  const [cart, setCart] = useState<CartModel>(EMPTY_CART);
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const [restored, setRestored] = useState(false);
  const [back, setBack] = useState<number | null>(null);
  // L-CLIENT-6a item 9: "Your unsent order is back" goes by itself, as a toast does (OK still closes it at once)
  useEffect(() => {
    if (back === null) return;
    const timer = setTimeout(() => setBack(null), DRAFT_BACK_MS);
    return () => clearTimeout(timer);
  }, [back]);
  // one draft per (device, person, order): a dine-in seating's own, or the new order's draft id (the route's)
  const draftId = useRef<string>(id);
  const staffId = shell.me?.staff_id ?? null;
  const deviceId = shell.device.id;
  // this screen's route: the Takeaway tab's, or #/order/<type>/<id>
  const here = home ? '/takeaway' : orderHref(order_type, id);
  // 02b-TK C2-1: the Takeaway tab's next customer starts on a new current draft (current-draft.ts)
  const nextDraft = () => {
    draftId.current = newUlid();
    setCurrentTakeawayDraft(deviceId, staffId, draftId.current);
  };
  // #35: the stored draft is read once per (person, order): the effect's deps are strings, so a re-render with a new
  // `me` object (the shell builds one on every render) reads nothing; a StrictMode remount reads again, which is
  // harmless. It never lands over lines typed meanwhile, and a store that cannot be read still saves.
  /** Hold / Send: the screen is leaving with its draft written; no save may undo that */
  const leaving = useRef(false);
  useEffect(() => {
    if (staffId === null) return;
    setRestored(false);
    let live = true;
    const done = (d: Draft | undefined, heldHere = false) => {
      if (!live) return;
      // 02b-TK C1-5: this route's draft was held (auto-hold at sign out / idle lock): it stays in Held, and the
      // screen starts the next order on a new draft id (its own route), so an empty cart never removes the held one
      if (d === undefined && heldHere && order_type !== 'dine_in') {
        if (home) nextDraft();
        else {
          draftId.current = newUlid();
          navigate(orderHref(order_type, draftId.current));
        }
        setRestored(true);
        return;
      }
      draftId.current = d?.draft_id ?? (order_type === 'dine_in' ? newUlid() : id);
      // IR-7 / IR-8: a queue-log copy ({ copy_of, from_entry_id }) becomes a cart with fresh ids
      const stored = d === undefined ? null : toCart(d.cart, newUlid);
      const isCopy = d !== undefined && !Array.isArray((d.cart as { lines?: unknown } | null)?.lines);
      // typed before the read answered: keep it (it is saved next), no banner
      if (stored !== null && !blank(stored) && cartRef.current.lines.length === 0) {
        setCart({ ...stored, ...cartRef.current, lines: stored.lines });
        // E-7 / Q-7 "Send it as a new item": the item comes with its options sheet open (nothing ticked for it)
        const pickLine = stored.lines.find((l) => l.pick_options === true);
        if (pickLine !== undefined) setSheet({ kind: 'edit', key: pickLine.key });
        else if (stored.lines.length > 0 && !isCopy) setBack(d!.updated_at);
      }
      setRestored(true);
    };
    drafts
      .list(deviceId, staffId)
      .then((list) =>
        done(
          list.find((x) => !x.held && (order_type === 'dine_in' ? x.order_type === 'dine_in' && x.seating_id === id : x.draft_id === id)),
          list.some((x) => x.held && x.draft_id === id),
        ),
      )
      .catch(() => done(undefined));
    return () => {
      live = false;
    };
  }, [drafts, deviceId, staffId, id, order_type, home]);
  const seatTable = seat?.ref.table_id ?? null;
  // 02b-TK C1-5 (02b §8 Held, Device idle lock; shell.me.signout_sub "Unsent orders are held first"): sign out, Switch
  // user and the idle lock take the person away from this screen without asking — their unsent takeaway is held. They
  // leave the route as it is; a navigation (the guard's choices, a deep link that returns, 01d #105) does not hold.
  const restoredRef = useRef(restored);
  restoredRef.current = restored;
  useEffect(() => {
    if (staffId === null || order_type !== 'takeaway') return;
    const sid = staffId;
    return () => {
      if (leaving.current || sending.current || !restoredRef.current || cartRef.current.lines.length === 0) return;
      if (window.location.hash.replace(/^#/, '') !== here) return;
      void drafts
        .put({ draft_id: draftId.current, device_id: deviceId, staff_id: sid, order_type, cart: cartRef.current, updated_at: Math.floor(shellRef.current.clock.nowMs()), held: true })
        .catch(() => undefined);
    };
  }, [staffId, drafts, deviceId, order_type, id, here]);
  useEffect(() => {
    if (!restored || staffId === null || leaving.current) return;
    const saved = blank(cart) ? drafts.remove(draftId.current) : drafts.put({
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
  const [send, setSend] = useState<SendView | null>(null);
  const [newOrder, setNewOrder] = useState<'takeaway' | 'parking' | null>(null);
  // #36 day not started: Send answered BUSINESS_DAY_NOT_OPEN; the next BusinessDayOpened lets Send try again
  const [dayClosed, setDayClosed] = useState(false);
  // a BusinessDayOpened frame, or a catch-up after a reconnect (a frame may have been missed), lets Send try again
  useEffect(() => shell.live.subscribe((m) => ((m.kind === 'event' && m.event.event_type === 'BusinessDayOpened') || m.kind === 'catch_up' ? setDayClosed(false) : undefined)), [shell.live]);
  // 02b-TK C1-1 (02b §6.14, §8; audit #1): Send refused, eta-preview answered BUSINESS_DAY_NOT_OPEN, or the socket
  // says no day is open: the cart shows "Times show after Start day" and the day block instead of Send
  const dayNotOpen = dayClosed || pv.kind === 'day_not_open' || dayWatch.state() === 'closed';
  /** #35: one Send at a time — a ref, so two taps inside one render cannot both enqueue */
  const sending = useRef(false);
  // 02b-TK C1-5 (frame LeaveGuard): leaving the takeaway screen with an unsent cart asks first
  const guard = useLeaveGuard(here, () => order_type === 'takeaway' && cartRef.current.lines.length > 0 && !sending.current && !leaving.current);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // 02b-TK A2 item 2 (frame KeyboardMode): the search's chosen suggestion, the search field, this screen's root
  const [sel, setSel] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const keysRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  const [tab, setTab] = useState<'menu' | 'cart' | 'queue'>('menu');
  // 02b-TK C2-1: the takeaway queue rail (its book of tokens, names and phones from this device's frames, R3).
  // BUG-5 (02b v1.0.28 §8): the page's book (one per live bus, emptied at sign-out), never one per mount
  const book = useMemo(() => (order_type === 'takeaway' ? tokenBookOf(shell.live) : null), [shell.live, order_type]);
  const [heldCount, setHeldCount] = useState(0);
  // a Hold that stays on the screen (the Takeaway tab) counts again
  const [heldTick, setHeldTick] = useState(0);
  useEffect(() => {
    if (order_type !== 'takeaway' || staffId === null) return;
    let live = true;
    // 02b-TK C2-5: the counter's held drafts (everyone's on this device, R3)
    void heldOnDevice(drafts, deviceId, staffId)
      .then((all) => live && setHeldCount(all.length))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [drafts, deviceId, staffId, order_type, restored, heldTick]);
  // 02b-TK C2-2: the token view drawer over the menu and the cart (the cart is kept)
  const [openToken, setOpenToken] = useState<QueueToken | null>(null);
  // 02b-TK C3-1: the pay panel over the cart (Send & pay, or Take payment of a token)
  // ⚠️ 02b-TK L-CLIENT-4 item 2 (03c v1.0.16 §8): `send_and_pay` = the panel Send & pay opened (closed unpaid → the slip)
  const [pay, setPay] = useState<(PayTarget & { display?: DisplayMessage | undefined; send_and_pay?: true }) | null>(null);
  const mirrorCart = order_type === 'takeaway' && shell.device.type === 'cashier_kiosk';
  const total = config === null ? null : cartTotal(config, cart, unitOf);
  const ready = readyBy(body);
  const displayCart = !mirrorCart || config === null ? idleDisplay(lang) : cartDisplay(
    cart,
    (line) => line.deal_id === undefined
      ? config.items.find((item) => item.item_id === line.item_id)?.name ?? '—'
      : config.deals.find((deal) => deal.deal_id === line.deal_id)?.name ?? '—',
    (line) => {
      const price = cartLineMoney(config, line, unitOf);
      return price.kind === 'unknown' || (price.kind === 'pending' && price.minor === 0) ? null : price.minor;
    },
    total,
    ready,
    lang,
    (line) => line.item_id !== undefined && unitOf(line.item_id) !== 'piece' ? 1 : line.quantity ?? 1,
  );
  // Next customer clears the public screen even when a different unsent draft was kept behind the pay panel.
  const [clearedDisplayCart, setClearedDisplayCart] = useState<CartModel | null>(null);
  const displayMessage = pay?.display ?? (clearedDisplayCart === cart ? idleDisplay(lang) : displayCart);
  const publisher = useRef<ReturnType<typeof createDisplayPublisher> | null>(null);
  useEffect(() => {
    if (!mirrorCart) return;
    const feed = createDisplayPublisher(lang);
    publisher.current = feed;
    const clear = () => feed.publish(idleDisplay(lang));
    window.addEventListener('pagehide', clear);
    return () => {
      window.removeEventListener('pagehide', clear);
      publisher.current = null;
      feed.close();
    };
  }, [mirrorCart, lang]);
  useEffect(() => publisher.current?.publish(displayMessage), [displayMessage]);
  const payToken = (q: QueueToken) => {
    setOpenToken(null);
    setPay({ order_id: q.newest_order_id, ident: q.token === null ? null : String(q.token), name: q.customer_name, promise_ms: q.promise_ms });
  };
  // 02b-TK C3-1 (frame HomeKiosk keys): F8 Send & pay, F9 Send · pay later — only on the bare screen (no sheet, drawer
  // or panel over it)
  const sendKeys = useRef<((pay: boolean) => void) | null>(null);
  // 02b-TK C3-2: the newest order of the token an addition is for (its bill is the one to print; 05 #44e)
  const addingNewest = useRef<{ root: string; newest: string } | null>(null);
  // ⚠️ 02b-TK L-CLIENT-6b item 4 (frame TokenAddItems): who the token is, its bill state and its Ready by when Add items began
  const addingInfo = useRef<{ root: string; name: string | null; paid: boolean; promise_ms: number | null } | null>(null);
  useEffect(() => {
    if (order_type !== 'takeaway') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F8' && e.key !== 'F9') return keysRef.current?.(e);
      e.preventDefault();
      sendKeys.current?.(e.key === 'F8');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [order_type]);
  // hand-overs wait UNDO_MS before MarkServed is sent (frame HandoverUndo); the page hiding or the screen closing sends them
  const handovers = useMemo(
    () =>
      createHandovers({
        send: (h) => {
          const s = shellRef.current;
          void s.enqueue('MarkServed', h.payload, { label: `${t('served.title')} · ${h.ident}` }).then((r) => {
            // ⚠️ 02b-TK L-CLIENT-2 item 4 (02b v1.0.25 §6.4, §3.7a; D2): the hub refused an unpaid hand-over → Ask a manager
            if (r.status === 'refused' && r.error.status === 403 && r.error.details['reason'] === 'unpaid_handover_approval_required') {
              const order_id = r.error.details['order_id'];
              if (typeof order_id === 'string') unpaidRequestsOf(s).refused(order_id);
              return s.toasts.show({ text: t('unpaid.refused'), tone: 'warn' });
            }
            showEnqueued(s, r, 'order.toast.served', () => {});
          });
        },
      }),
    [],
  );
  useEffect(() => handovers.attach(), [handovers]);
  useSyncExternalStore(handovers.subscribe, handovers.version);
  // ⚠️ 02b v1.0.25 §6.4 (R3-M-4): a counter hand-over is a staff customer hand-over (takeaway): `customer_handover: true`
  const handOver = (q: QueueToken, lines: readonly GroupedLine[]) => {
    if (lines.length === 0) return;
    handovers.start({ id: newUlid(), token_key: q.key, ident: q.token === null ? '—' : String(q.token), payload: { ...servedPayload(lines), customer_handover: true } });
    setOpenToken(null);
  };
  /** §8 OR-7: line ids already waiting in an Undo window (a second tap cannot take an order's last line) */
  const reservedIds = (): ReadonlySet<string> => new Set(handovers.pending().flatMap((h) => h.payload.lines.flatMap((l) => l.order_item_ids)));
  // the ready tile's one tap: the token's lines from order-view; every live one ready (a line not yet sent to the
  // kitchen counts too, owner ruling 2026-11-24 #1) → its servable lines handed over (R2: paid only); else the view
  const handOverTile = async (q: QueueToken) => {
    if (!shellRef.current.permissions.allowed('mark-served')) return setOpenToken(q);
    const views = await Promise.all(q.order_ids.map((oid) => shellRef.current.orders.orderView(oid)));
    const lines = views.flatMap((v) => (v.ok && v.data.kind === 'order' ? groupParts(v.data.order.lines) : []));
    if (!allLiveReady(lines)) return setOpenToken(q);
    // ⚠️ 02b-TK L-CLIENT-2 item 4 (02b v1.0.25 §3.7a, §8 OR-7; D2): the shared check at the tap — blocked (Due,
    // unapproved, or unknown billing) → the token view, which offers Take payment and Ask a manager
    const approved = unpaidRequestsOf(shellRef.current).approvedDue;
    // the order-view just read is fresher than the rail's row: a billed order is free (as the token view's gate), so a
    // payment the rail has not re-read yet never sends a paid token to the drawer
    const billed = new Set(views.flatMap((v) => (v.ok && v.data.kind === 'order' && v.data.order.billed ? [v.data.order.order_id] : [])));
    const gate = (order_id: string): Gate => (billed.has(order_id) ? { kind: 'free' } : gateOf(billsOf(q).find((b) => b.order_id === order_id), { approvedDue: approved(order_id) }));
    const give = lines.filter(servable);
    if (!checkHandover(candidatesOf(q.order_ids, liveLines(lines), gate), lineIds(give), reservedIds()).ok) return setOpenToken(q);
    handOver(q, give);
  };
  // 02b-TK C2-3 (02b §3.2 step 2; 05 #44a): Add items starts an addition to the token's root on an empty cart (a cart
  // with lines is another customer's: it is sent or held first)
  const addTo = (q: QueueToken) => {
    if (sending.current) return;
    if (cartRef.current.lines.length > 0) return shellRef.current.toasts.show({ text: t('c.add_busy'), tone: 'warn' });
    // ⚠️ 02b-TK L-CLIENT-5 item 1 (02b v1.0.25 §3.1 m-8, §8): the addition carries its own pickup — pre-filled with the
    // root's (effective) one only while it is ≥ hub now + PICKUP_MIN_LEAD_MS, so the pre-fill never fails too_early
    const rootPickup = q.effective_pickup_at_ms ?? null;
    const prefill = rootPickup !== null && rootPickup >= shellRef.current.clock.nowMs() + PICKUP_MIN_LEAD_MS ? { pickup: { chip: 'time' as const, at_ms: rootPickup } } : {};
    setCart((c) => ({ ...c, adds_to: { order_id: q.order_ids[0]!, token: q.token }, ...prefill }));
    addingNewest.current = { root: q.order_ids[0]!, newest: q.newest_order_id };
    addingInfo.current = { root: q.order_ids[0]!, name: q.customer_name, paid: q.paid, promise_ms: q.promise_ms };
    setOpenToken(null);
    setTab('menu');
  };
  // 02b-TK A2 item 4 (frame HomeRush; R9 UI only): rush mode at RUSH_OPEN_ORDERS open tokens (the rail's count) or by
  // the shell's pill (a manual override kept on this device); dense tiles, the folded customer row, the compact queue
  const [openCount, setOpenCount] = useState(0);
  const [rushManual, setRushManual] = useState<boolean | null>(() => (order_type === 'takeaway' ? readRushOverride() : null));
  const rush = order_type === 'takeaway' && rushOn(openCount, rushManual);
  const rushCount = useRef(openCount);
  rushCount.current = openCount;
  useEffect(() => {
    if (book === null) return;
    shellRef.current.rush?.set({
      on: rush,
      count: openCount,
      toggle: () =>
        setRushManual((manual) => {
          const next = toggledOverride(rushCount.current, manual);
          writeRushOverride(next);
          return next;
        }),
    });
  }, [book, rush, openCount]);
  useEffect(() => () => shellRef.current.rush?.set(null), []);
  const dense = rush && !shell.phone && !shell.portrait;
  const pendingKeys = new Set(handovers.pending().map((h) => h.token_key));
  const lastHandover = handovers.pending().at(-1) ?? null;
  const railVariant: RailVariant = shell.phone || shell.portrait ? 'tab' : shell.device.type === 'cashier_kiosk' ? 'column' : 'strip';
  const tabletTakeaway = book !== null && railVariant === 'strip';
  const queueRail = (variant: RailVariant) =>
    book === null ? null : (
      <QueueRail
        variant={variant}
        book={book}
        selected={openToken?.key ?? null}
        onOpen={setOpenToken}
        heldCount={heldCount}
        onHandOver={shell.permissions.allowed('mark-served') ? (q) => void handOverTile(q) : undefined}
        onPay={shell.online && shell.permissions.allowed('take-payment') ? payToken : undefined}
        hidden={pendingKeys}
        onCount={setOpenCount}
        onGone={(key) => setOpenToken((t) => (t?.key === key ? null : t))}
        compact={dense}
      />
    );
  const tokenView =
    openToken === null || book === null ? null : (
      <TokenView token={openToken} book={book} reserved={reservedIds()} onClose={() => setOpenToken(null)} onHandOver={(lines) => handOver(openToken, lines)} onAddItems={() => addTo(openToken)} onPay={() => payToken(openToken)} />
    );
  const payView = (fixed: boolean) =>
    pay === null ? null : (
      <PayPanel
        key={pay.order_id ?? 'sending'}
        target={pay}
        fixed={fixed}
        onLater={({ unpaid }) => {
          // ⚠️ 02b-TK L-CLIENT-4 item 2 (03c v1.0.16 §3.11 trigger 2, §8; 02b v1.0.25 §3.2 step 10a): a Send & pay
          // panel closed with the bill still open → the token slip (`pay_later`), once; Take payment of a token does not
          if (unpaid && pay.send_and_pay === true && pay.order_id !== null) printPayLaterSlip(shellRef.current, pay.order_id);
          setPay(null);
        }}
        onDone={() => {
          if (pay.display?.kind === 'paid') setClearedDisplayCart(cart);
          setPay(null);
        }}
        onClosed={(payment, totalMinor) => {
          setPay((current) => mirrorCart && current !== null && current.order_id === pay.order_id
            ? { ...current, display: { ...(current.display ?? idleDisplay(lang)), ...payment, total_minor: totalMinor } }
            : current);
        }}
      />
    );
  const undoToast =
    lastHandover === null ? null : (
      <div className="tk-toast tk-toast--ok tk-toast--bottom" role="status">
        <span>
          <b dir="ltr">{lastHandover.ident}</b> {t('t.collected')}
        </span>
        <button type="button" className="tk-btn" onClick={() => handovers.undo(lastHandover.id)}>
          {t('t.undo')}
        </button>
      </div>
    );

  // 02b-TK A2 item 1 (frames ShellAnatomy, TokenReady, PayCard; MAPPING TK-SH01; R3): this screen fills the top bar's
  // context slot — the pay panel, the open token view, an addition or the new cart — and clears it when it goes
  const seeContact = shell.permissions.allowed('view-customer-contact');
  const slotJson =
    order_type !== 'takeaway'
      ? null
      : JSON.stringify(
          takeawayContext({
            adding: cart.adds_to === undefined ? null : { token: cart.adds_to.token },
            token: openToken === null ? null : { token: openToken.token, name: openToken.customer_name, paid: openToken.paid },
            paying: pay === null ? null : { ident: pay.ident, name: pay.name },
            cartName: cart.takeaway?.customer_name ?? null,
            seeContact,
          }),
        );
  useEffect(() => {
    if (slotJson !== null) shellRef.current.contextSlot?.set(JSON.parse(slotJson) as ReturnType<typeof takeawayContext>);
  }, [slotJson]);
  useEffect(() => () => shellRef.current.contextSlot?.set(null), []);

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
  // 02b-TK A2 item 2 (frame KeyboardMode): on takeaway a number prefix is the quantity ("4n"); the rest also finds by
  // word starts and initials (keyboard.ts); the tiles show every match
  const keyQuery = order_type === 'takeaway' ? parseKeyQuery(query) : { qty: null, term: query.trim().toLowerCase() };
  const q = keyQuery.term;
  const keyed = order_type !== 'takeaway' || q === '' ? null : keyMatches(keyEntries(config), q);
  const keyedIds = new Set(keyed?.map((e) => e.id) ?? []);
  const inView = (category_id: string, name: string, id?: string) =>
    q === '' ? category_id === current : name.toLowerCase().includes(q) || (id !== undefined && keyedIds.has(id));
  /** 02b-TK A2 item 3 (frame TileStates "Tandoor paused"): the paused station's name */
  const stationName = (a: ItemAvailability): string | null => (a.state.kind !== 'paused' ? null : (config.stations.find((st) => st.station_id === (a.state as { station_id: string }).station_id)?.name ?? null));
  const tiles: TileModel[] = [];
  // L-CLIENT-6a (frame HomeKiosk): the takeaway tile's placeholder follows its category
  const catOf = (category_id: string) => {
    const index = categories.findIndex((c) => c.category_id === category_id);
    return index < 0 ? null : { name: categories[index]!.name, index };
  };
  const seenGroups = new Set<string>();
  for (const item of [...config.items].sort((a, b) => a.sort_order - b.sort_order)) {
    if (item.variant_group_id !== null) {
      if (seenGroups.has(item.variant_group_id)) continue;
      seenGroups.add(item.variant_group_id);
      const vg = config.variant_groups.find((v) => v.variant_group_id === item.variant_group_id);
      const variants = config.items.filter((i) => i.variant_group_id === item.variant_group_id);
      const name = vg?.name ?? item.name;
      if (!inView(item.category_id, name) && !variants.some((v) => keyedIds.has(v.item_id))) continue;
      const groupAvail = bestOf(variants.map((v) => avail(v.item_id)));
      tiles.push({
        id: item.variant_group_id,
        kind: 'variants',
        name,
        sub: variantsSub(config, item.variant_group_id),
        price_minor: Math.min(...variants.map((v) => v.price_minor)),
        from: variants.length > 1,
        per: null,
        availability: groupAvail,
        zone: null,
        in_cart: variants.reduce((n, v) => n + unitsOf(cart, v.item_id), 0),
        category: catOf(item.category_id),
        // 02b-TK A2 item 3: Half / Full on the tile (takeaway)
        ...(order_type !== 'takeaway'
          ? {}
          : {
              variants: [...variants].sort((a, b) => a.sort_order - b.sort_order).map((v) => ({ item_id: v.item_id, name: v.variant_name ?? v.name, price_minor: v.price_minor, availability: avail(v.item_id) })),
              station_name: stationName(groupAvail),
            }),
      });
      continue;
    }
    if (!inView(item.category_id, item.name, item.item_id)) continue;
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
      station_name: stationName(avail(item.item_id)),
      category: catOf(item.category_id),
    });
  }
  for (const deal of [...config.deals].sort((a, b) => a.sort_order - b.sort_order)) {
    if (!inView(deal.category_id, deal.name, deal.deal_id)) continue;
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
      category: catOf(deal.category_id),
    });
  }
  const newKey = () => newUlid();
  const onTap = (tile: TileModel) => {
    if (sending.current) return; // #35: the cart is frozen while it is sent (a ref: a same-tick tap is refused too)
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
  // 02b-TK A2 item 3 (frame TileStates): Half / Full on the tile, and an off tile's tap says why (never silent)
  const tk: TakeawayTileActions | undefined =
    order_type !== 'takeaway'
      ? undefined
      : {
          onOff: (name, state, station) => shell.toasts.show({ text: offToast(name, state, station), tone: 'warn' }),
          onVariant: (tile, item_id) => {
            if (sending.current) return;
            const item = config.items.find((i) => i.item_id === item_id);
            if (item === undefined) return;
            if (variantNeedsSheet(config, item, unitOf(item_id))) return setSheet({ kind: 'variants', variant_group_id: tile.id, item_id });
            const next = addTap(cart, item_id, newKey);
            const cap = capOf(item_id);
            if (cap !== null && kitchenUnits(next, item_id, zoneCovered(next, () => null)) > cap) return;
            setCart(next);
          },
        };

  // ------------------------------------------------------------------------------------------- cart view
  const problems = lineProblems(cart, body, capOf, covered);
  const moved = pv.kind === 'ok' ? pv.moved : new Set<string>();
  // 02b-TK A2 item 5a (frame CartTimeDelta): the line that moved Ready by later says why (takeaway)
  const delta = order_type === 'takeaway' && pv.kind === 'ok' && body !== null ? pv.delta : null;
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
          ...(s.parts === undefined ? {} : { parts: s.parts }),
          ...(delta === null || delta.key !== s.line.key ? {} : { delta: deltaText(config, s.line, delta.ms, order_type, (id) => inputs?.stationBand?.(id) ?? null) }),
        };
      },
    ),
  }));
  const actions = {
    toggle: (key: string) => (sending.current ? undefined : setOpenKey((k) => (k === key ? null : key))),
    setUnits: (key: string, units: number) => {
      if (sending.current) return; // the cart is frozen while it is sent
      const line = cart.lines.find((l) => l.key === key);
      const cap = line?.item_id === undefined ? null : lineCap(key, line.item_id);
      setCart((c) => setUnits(c, key, units, cap === null ? null : Math.max(1, cap)));
    },
    remove: (key: string) => (sending.current ? undefined : setCart((c) => removeLine(c, key))),
    edit: (key: string) => (sending.current ? undefined : setSheet({ kind: 'edit', key })),
  };
  const utcOffsetMs = shell.clock.utcOffsetMs;
  const count = cartCount(cart, unitOf);
  // dine-in: Send waits for the seating on the map, and follows the table lock; 02b-TK C1-2: a typed takeaway phone
  // the hub would refuse waits to be fixed or cleared (R1: the phone stays optional)
  const contactBad = order_type === 'takeaway' && phoneBad(cart.takeaway?.phone);
  // ⚠️ 02b-TK L-CLIENT-5 item 1 (02b v1.0.25 §3.2 step 2b, §8): a pickup the hub refused waits to be changed
  const canSend = (order_type !== 'dine_in' || (seat !== null && lock.canSend)) && !contactBad && !(order_type === 'takeaway' && cart.pickup !== undefined && (pickupProblem !== null || pickupPassed(cart.pickup, shell.clock.nowMs())));
  const blocked = order_type === 'dine_in' && seatMissing ? t('order.seating_missing') : null;
  // 02b-TK C3-1 (frames HomeKiosk, HomeOffline): a takeaway of a take-payment holder sends and pays, or pays later; an
  // addition to a token keeps its one "Add to token 53" (it is paid from the token view)
  const canPay = order_type === 'takeaway' && cart.adds_to === undefined && shell.permissions.allowed('take-payment');
  // 26d: Send freezes the cart (#35), enqueues it first (stored before the first send, 25b), then the queue submits
  const onSend = async (opts: { pay?: boolean } = {}) => {
    // the button's state is not the only guard: lock, line problems and the day are checked here too
    if (sending.current || target === null || cart.lines.length === 0 || !canSend || problems.size > 0 || dayNotOpen) return;
    // 02b-TK C3-1 (05 B12): money is never queued — Send & pay only for a take-payment holder while the hub is live
    const andPay = opts.pay === true && canPay && shellRef.current.online;
    sending.current = true;
    const frozen = cart;
    const before = body;
    // ⚠️ 02b-TK L-CLIENT-3 item 2 (02b v1.0.25 §3.2 step 2b; 03c v1.0.16 §3.11, §8 Q-TK-4): every takeaway Send that is
    // not Send & pay is pay later (an addition, a Send without take-payment, offline): it asks for the token slip
    const payload = freezeSubmit(frozen, target, newUlid(), { print_slip: order_type === 'takeaway' && !andPay });
    const shownName = railVariant === 'column' || seeContact ? payload.takeaway?.customer_name : undefined;
    const title = order_type === 'dine_in' ? (seat?.name ?? null) : null;
    const label =
      order_type === 'dine_in'
        ? fill(t('send.label_table'), { table: title ?? '' })
        : order_type === 'takeaway'
          ? t('order.takeaway') + (shownName === undefined ? '' : ` · ${shownName}`)
          : `${t('order.parking')} · ${frozen.parking?.car_number ?? ''}`;
    // 02b-TK C1-3 (02b §6.1, §3.12; frames SentToast, SentQueued; audit #7, #27): a takeaway sends in the background —
    // no dialog, a fresh cart at once (it takes no tap until the queue answered, #35), a toast with the token after;
    // a refusal brings the frozen cart back. Dine-in and parking keep the Send dialog.
    const background = order_type === 'takeaway';
    const restore = () => {
      if (andPay) setPay(null);
      if (background) setCart(frozen);
    };
    // 02b-TK C3-1 (frame PayCash): the pay panel opens at once over the fresh cart; its bill is read once the order is in
    const paymentDisplay = andPay && mirrorCart ? displayCart : undefined;
    if (andPay) setPay({ order_id: null, ident: null, name: shownName ?? null, promise_ms: null, display: paymentDisplay, send_and_pay: true });
    if (background) setCart(EMPTY_CART);
    else setSend({ kind: 'sending', sub: [title, fill(t('cart.items'), { n: String(count) })].filter((x) => x !== null).join(' · ') });
    let outcome: Awaited<ReturnType<typeof sendOrder>>;
    try {
      outcome = await sendOrder(shellRef.current.enqueue, payload, label);
    } catch {
      // the queue never rejects by contract; if it does, "Sending…" does not stay up — the cart is kept
      sending.current = false;
      setSend(null);
      restore();
      shellRef.current.toasts.show({ text: t('send.failed'), tone: 'warn' });
      return;
    }
    if (background && (outcome.kind === 'sent' || outcome.kind === 'queued')) {
      sending.current = false;
      if (outcome.kind === 'sent') {
        announceCompIt(payload, frozen);
        const r = outcome.result;
        if (andPay) {
          const promises = r?.groups.map((g) => g.promise_ms) ?? [];
          setPay({ order_id: payload.order_id, ident: r?.token == null ? null : String(r.token), name: shownName ?? null, promise_ms: promises.length === 0 ? null : Math.max(...promises), display: paymentDisplay, send_and_pay: true });
        }
        const moved = r === undefined ? null : timeUpdated(config, frozen, before, r);
        // ⚠️ 02b-TK L-CLIENT-3 item 2 (03c v1.0.16 §3.11 Result, §8; frame SentToast "slip printing"): the result's
        // slip, briefly; a miss marks the token "Slip not printed — Print slip" (setting_off / slip_held: nothing)
        const slip = r?.slip ?? null;
        if (slipMissed(slip)) slipMissesOf(shellRef.current).mark(payload.order_id);
        const slipText = slip?.printed === true ? t('takeaway.slip.printing') : slipMissed(slip) ? t('takeaway.slip.not_printed') : null;
        const sub = [moved === null ? null : fill(t('send.time_updated'), { item: moved.name, time: timeText(moved.eta_ms, shellRef.current.clock.utcOffsetMs) }), slipText].filter((x) => x !== null).join(' · ');
        // L-CLIENT-6a item 9 (frame SentToast): the token big at the toast's start; a pay-later token whose slip went to
        // the printer offers Print again (03c §3.11 reprint, as the token view's Print token)
        const sentId = payload.order_id;
        const reprint = !andPay && r?.token != null && slip !== null && (slip.printed || slipMissed(slip));
        shellRef.current.toasts.show({
          text: sentToastText(r, shownName, shellRef.current.clock.utcOffsetMs),
          ...(sub === '' ? {} : { sub }),
          tone: 'ok',
          ...(r?.token == null ? {} : { token: String(r.token) }),
          ...(reprint ? { action: { label: t('t.print'), run: () => void reprintSlip(shellRef.current, sentId) } } : {}),
        });
      } else {
        // queued (the hub is not answering): no payment now — the order stays Due (05 B12)
        if (andPay) setPay(null);
        announceCompIt(payload, frozen, { queued: true });
        shellRef.current.toasts.show(outcome.logged === true ? { text: t('queue.in_log'), tone: 'warn' } : { text: t('t.queued'), tone: 'info' });
      }
      return;
    }
    if (outcome.kind === 'sent') {
      announceCompIt(payload, frozen);
      const r = outcome.result;
      setSend({ kind: 'sent', result: r, cart: frozen, updated: r === undefined ? null : timeUpdated(config, frozen, before, r), zone_empty: r === undefined ? [] : zoneEmpty(config, frozen, r) });
      setCart(EMPTY_CART);
    } else if (outcome.kind === 'queued') {
      // lane T (27a2): a queued comp-it round is announced too; the prompt waits for its ItemAdded frame
      announceCompIt(payload, frozen, { queued: true });
      setSend(outcome.logged === true ? { kind: 'queued', logged: true } : { kind: 'queued' });
      setCart(EMPTY_CART);
    } else if (outcome.kind === 'day_not_open') {
      sending.current = false;
      setSend(null);
      restore();
      setDayClosed(true);
    } else {
      // refused: the cart is kept; the reason by its code
      sending.current = false;
      setSend(null);
      restore();
      shellRef.current.toasts.show({ text: refusalText(config, outcome, shellRef.current.clock.utcOffsetMs), tone: 'warn' });
      if (outcome.kind === 'refused' && outcome.error.code === 'TABLE_SEATING_CHANGED') setSeatReload((n) => n + 1);
      // a line refusal: the preview runs again so the line shows its problem (B05 / B07)
      else if (target !== null) preview.set(toEtaDraft(frozen, target));
    }
  };
  sendKeys.current = (andPay: boolean) => {
    if (sheet !== null || openToken !== null || pay !== null || send !== null || guard.pending !== null) return;
    if (andPay && !(canPay && shell.online)) return;
    void onSend({ pay: andPay });
  };
  // 02b-TK C2-1: a takeaway goes back to the Takeaway tab (the order screen with a fresh cart), not the open-orders list
  const goBack = () => navigate(order_type === 'dine_in' ? (seat === null ? '/tables' : tableHref(seat.ref.table_id, id)) : order_type === 'takeaway' ? '/takeaway' : '/orders');
  // Hold (02-S08): the draft stays on this device, held for this person; the screen goes back — on the Takeaway tab it
  // stays, with a fresh cart on a new draft (02b-TK C2-1)
  const onHold = async (to?: string) => {
    if (sending.current || staffId === null || cart.lines.length === 0) return;
    leaving.current = true;
    await drafts
      .put({
        draft_id: draftId.current,
        device_id: deviceId,
        staff_id: staffId,
        order_type,
        ...(order_type !== 'dine_in' ? {} : { seating_id: id, ...(seatTable === null ? {} : { table_id: seatTable }) }),
        cart,
        updated_at: Math.floor(shellRef.current.clock.nowMs()),
        held: true,
      })
      .catch(() => undefined);
    if (to === undefined && home) {
      nextDraft();
      setCart(EMPTY_CART);
      setBack(null);
      leaving.current = false;
      setHeldTick((n) => n + 1);
      return;
    }
    if (to === undefined) goBack();
    else navigate(to);
  };
  // the leave guard's Throw away: the draft goes, then the person goes where they were going
  const onDiscard = async (to: string) => {
    if (sending.current) return;
    leaving.current = true;
    setCart(EMPTY_CART);
    await drafts.remove(draftId.current).catch(() => undefined);
    navigate(to);
  };
  const leaveView =
    guard.pending === null ? null : (
      <LeaveGuard
        items={String(count)}
        money={total === null ? '—' : money(total)}
        sheet={shell.phone || shell.portrait}
        onStay={guard.clear}
        onHold={() => {
          const to = guard.pending!;
          guard.clear();
          // 02b-TK A2 item 2: F2 on the Takeaway tab asked with this route: Hold it = Hold (a fresh cart here)
          void onHold(to === here ? undefined : to);
        }}
        onDiscard={() => {
          const to = guard.pending!;
          guard.clear();
          if (to === here) return void (sending.current ? undefined : setCart(EMPTY_CART));
          void onDiscard(to);
        }}
      />
    );
  const compItLine = cart.lines.find((l) => l.comp_it === true);
  const compItInfo = () => fill(t('compit.cart_info'), { item: config.items.find((i) => i.item_id === compItLine?.item_id)?.name ?? '', table: seat?.name ?? '' });
  // 02b-TK C2-3 (frame TokenAddItems): adding to a sent token says so and its primary is "Add to token 53"
  const addingTo = order_type === 'takeaway' ? (cart.adds_to ?? null) : null;
  const addingToken = addingTo === null ? '' : addingTo.token === null ? '—' : String(addingTo.token);
  // ⚠️ L-CLIENT-6b item 4 (frame TokenAddItems "Add to token 53 · Rs 390"): the amount on the primary
  const primary = addingTo === null ? undefined : `${t('c.add_to')} ${addingToken}${total !== null && cart.lines.length > 0 ? ` · ${money(total)}` : ''}`;
  const adding = addingTo !== null && addingInfo.current?.root === addingTo.order_id ? addingInfo.current : null;
  // 02b-TK C3-2 (05 §6.3; R6): the cart of an addition prints the sent token's check bill (a restored draft: its root's)
  const checkOrder = addingTo === null ? null : addingNewest.current?.root === addingTo.order_id ? addingNewest.current.newest : addingTo.order_id;
  // ⚠️ 02b-TK L-CLIENT-3 item 1 (05 v1.0.35 §6.3a, §8; 02b v1.0.25 §8 OR-5 / R6; D9; 05 #60h): a takeaway / parking cart
  // with unsent lines → PrintCartCheckBill { draft } (an addition: `adds_to_order_id`, the root as Send names it); greyed
  // on a parking cart without its car number (R2-m-7). An addition cart before any line keeps the sent token's action:
  // Print check bill while money is due, Print receipt again once paid (SentTokenPrint).
  const checkBill =
    order_type !== 'dine_in' && cart.lines.length > 0 && target !== null ? (
      shell.permissions.allowed('take-order') ? (
        <CartCheckBill
          draft={{ ...toEtaDraft(cart, target), ...(addingTo === null ? {} : { adds_to_order_id: addingTo.order_id }) }}
          names={{ items: config.items, deals: config.deals, lines: cart.lines }}
          off={order_type === 'parking' && (cart.parking?.car_number ?? '') === ''}
          onLine={(key) => setOpenKey(key)}
        />
      ) : undefined
    ) : checkOrder !== null && cart.lines.length === 0 ? (
      <SentTokenPrint key={checkOrder} order_id={checkOrder} />
    ) : undefined;
  const setServe = (mode: ServeMode) => (sending.current ? undefined : setCart((c) => ({ ...c, serve_mode: mode })));
  // 02b-TK A2 item 5b: the lines ready now — a ready item, or a stock item served at once (stock_time_ms 0, in stock:
  // the tile's "Now", 02b-tk C3-3) — named in cart order; null unless the order also has a kitchen line
  const readyNowNames = (() => {
    const isNow = (item_id: string | undefined) => {
      const item = item_id === undefined ? undefined : config.items.find((i) => i.item_id === item_id);
      if (item === undefined) return false;
      const left = inputs?.stock.available(item.item_id) ?? null;
      return item.is_ready_item || (item.stock_time_ms === 0 && left !== null && left >= 1);
    };
    const now = cart.lines.filter((l) => l.deal_id === undefined && isNow(l.item_id));
    if (now.length === 0 || now.length === cart.lines.length) return null;
    return [...new Set(now.map((l) => config.items.find((i) => i.item_id === l.item_id)!.name))];
  })();
  const cartProps = {
    primary,
    config,
    utcOffsetMs,
    round: order_type === 'dine_in' ? (seat?.round ?? null) : null,
    count,
    groups,
    total_minor: total,
    ready_by: ready,
    // ⚠️ 02b-TK L-CLIENT-5 item 1 (frame PickupLater `.tk-readyby--later`): a pickup's Ready by is "Kitchen times it for"
    readyLater: order_type === 'takeaway' && cart.pickup !== undefined,
    offline: !shell.online,
    note: cart.order_note,
    // ⚠️ 02b v1.0.26 §8 (owner 2026-11-28, QA BUG-5; 03a v1.2.12 PK-2): the kitchen cannot make the asked pickup — say
    // so before Send; the order keeps the asked pickup (PQ-1)
    pickupLate: order_type === 'takeaway' && cart.pickup !== undefined && ready !== null && ready > cart.pickup.at_ms ? { can_ms: ready, asked_ms: cart.pickup.at_ms } : null,
    problems: problems.size,
    canSend,
    blocked,
    unitOf,
    actions,
    onNote: () => (sending.current ? undefined : setSheet({ kind: 'order_note' })),
    onHold: () => void onHold(),
    onSend: () => void onSend(),
    pay: canPay ? { online: shell.online, onSendPay: () => void onSend({ pay: true }) } : undefined,
    checkBill,
    holdKey: order_type === 'takeaway' && shell.device.type === 'cashier_kiosk' && !shell.phone && !shell.portrait,
    // 02b-TK A2 item 3 (frame HomeRush): ×2 ×4 ×6 ×8 on the open line
    qchips: order_type === 'takeaway',
    day: dayNotOpen ? <DayNotStarted mode={startDayMode(shell.permissions)} /> : null,
    info: cart.lines.find((l) => l.comp_it === true) === undefined ? null : compItInfo(),
    // 02b v1.0.21 §8 (STAB-5, owner option C): the order switch; a line override in its edit sheet wins. 02b-TK A2
    // item 5b (frame ServeChoice): a takeaway asks the plain question instead, and only when something is ready now
    // and something comes from the kitchen
    serve: order_type === 'takeaway' ? undefined : { state: serveState(cart, config), onSet: setServe },
    serveChoice:
      order_type !== 'takeaway' || readyNowNames === null ? null : (
        <ServeChoice now={readyNowNames} ready_by={ready} utcOffsetMs={utcOffsetMs} state={serveState(cart, config)} onSet={setServe} />
      ),
  };
  const customer =
    order_type !== 'takeaway' ? null : (
      <>
        {/* ⚠️ L-CLIENT-6b item 4 (frame TokenAddItems): an addition goes on the token's customer — no empty name / phone */}
        {addingTo === null && <CustomerRow
          value={cart.takeaway}
          disabled={sending.current}
          compact={dense}
          onChange={(next) => {
            if (sending.current) return; // the cart is frozen while it is sent
            setCart((c) => {
              const { takeaway: _drop, ...rest } = c;
              void _drop;
              return next === undefined ? rest : { ...rest, takeaway: next };
            });
          }}
        />}
        {/* ⚠️ 02b-TK L-CLIENT-5 item 1 (02b v1.0.25 §8 Phone and pickup, R4; frame PickupLater): Now / +15 / +30 / +45 / Time… */}
        <PickupRow
          value={cart.pickup}
          nowMs={() => shellRef.current.clock.nowMs()}
          utcOffsetMs={utcOffsetMs}
          bounds={pickupBounds.current}
          problem={cart.pickup === undefined ? null : pickupProblem}
          disabled={sending.current}
          onChange={(next) => {
            if (sending.current) return;
            setCart((c) => {
              const { pickup: _drop, ...rest } = c;
              void _drop;
              return next === undefined ? rest : { ...rest, pickup: next };
            });
          }}
        />
      </>
    );
  const keepDraft = () => navigate(seat === null ? '/tables' : tableHref(seat.ref.table_id, id));

  // ------------------------------------------------------------------------- 02b-TK A2 item 2: keyboard speed mode
  // (frame KeyboardMode; MAPPING TK-S02): "/" focuses the search, typing on the bare screen goes to it (never from the
  // name / phone field or any other field), a number prefix is the quantity ("4n" Enter = 4 naan), ↑ / ↓ choose, Enter
  // adds, Esc clears the search; Esc on the screen closes the token view; F2 new takeaway, F4 Hold. F8 / F9 above.
  const kiosk = shell.device.type === 'cashier_kiosk' && !shell.phone && !shell.portrait;
  const orderable = (e: KeyEntry) => (e.kind === 'deal' ? inputs === null || dealAvailability(e.id, inputs).orderable : avail(e.id).orderable);
  const suggestions = keyed === null ? [] : keyed.filter(orderable).slice(0, 3);
  const qty = keyQuery.qty ?? 1;
  const chosen = Math.min(sel, Math.max(0, suggestions.length - 1));
  const addKey = (e: KeyEntry) => {
    setQuery('');
    setSel(0);
    if (sending.current) return;
    if (e.kind === 'deal') return setSheet({ kind: 'deal', deal_id: e.id });
    const item = config.items.find((i) => i.item_id === e.id);
    if (item === undefined) return;
    // the variant is already chosen by the search: a sheet only for options, weight or a non-piece unit
    if (item.modifier_group_ids.length > 0 || item.requires_weighing || unitOf(item.item_id) !== 'piece') return setSheet({ kind: 'item', item_id: item.item_id, from_zone: false });
    setCart((c) => {
      let next = c;
      const cap = capOf(item.item_id);
      for (let n = 0; n < qty; n += 1) {
        const more = addTap(next, item.item_id, newKey);
        if (cap !== null && kitchenUnits(more, item.item_id, zoneCovered(more, () => null)) > cap) break;
        next = more;
      }
      return next;
    });
  };
  const overlay = sheet !== null || pay !== null || send !== null || guard.pending !== null || newOrder !== null;
  const newTakeaway = () => {
    if (!home) return navigate('/takeaway'); // the leave guard asks on the way if the cart has lines
    setOpenToken(null);
    if (cart.lines.length > 0) return guard.ask(here);
    if (cart.adds_to !== undefined) setCart(EMPTY_CART);
    searchRef.current?.focus();
  };
  keysRef.current = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const target = e.target instanceof Element ? e.target : null;
    // another layer (a dialog, a menu, the lock) or another part of the page owns this key
    if (target?.closest('[role="dialog"]:not(.tk-drawer), [role="menu"], [role="alertdialog"], .idle') != null) return;
    // ⚠️ 02b v1.0.28 QK-5 (BUG-21): "/" focuses the search from anywhere on the page that is not a field (a top-bar
    // tab just clicked, a rail row), the token drawer open or not; other keys only on the screen itself
    if (e.key === '/' && !editable(target) && !overlay && searchRef.current !== null) {
      e.preventDefault();
      return searchRef.current.focus();
    }
    if (target !== null && target !== document.body && !(rootRef.current?.contains(target) ?? false)) return;
    if (e.key === 'Escape') {
      if (target === searchRef.current || openToken === null || overlay) return;
      e.preventDefault();
      return setOpenToken(null);
    }
    if (e.key === 'F4' || e.key === 'F2') {
      e.preventDefault();
      if (overlay) return;
      if (e.key === 'F2') return newTakeaway();
      if (openToken === null && cart.lines.length > 0) void onHold();
      return;
    }
    if (editable(target) || overlay || openToken !== null || searchRef.current === null) return;
    if (e.key === '/') {
      e.preventDefault();
      return searchRef.current.focus();
    }
    if ([...e.key].length !== 1 || e.key === ' ') return;
    e.preventDefault();
    searchRef.current.focus();
    setQuery((v) => v + e.key);
    setSel(0);
  };
  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (order_type !== 'takeaway') return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setSel(Math.max(0, Math.min(suggestions.length - 1, chosen + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter') {
      const pick = suggestions[chosen];
      if (pick === undefined) return;
      e.preventDefault();
      addKey(pick);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setQuery('');
      setSel(0);
      e.currentTarget.blur();
    }
  };
  const kbd = (k: string) => (
    <span className="tk-kbd" dir="ltr">
      {k}
    </span>
  );
  const menu = (
    <section className="menu">
      <div className="tk-ksearch">
        <label className="search" role="search">
          <Ico name={order_type === 'takeaway' ? 'search' : 'eye'} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder={t(order_type === 'takeaway' ? 'm.search' : 'menu.search')}
            aria-label={t(order_type === 'takeaway' ? 'm.search' : 'menu.search')}
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            onKeyDown={onSearchKey}
          />
          {order_type === 'takeaway' && kiosk && kbd('/')}
        </label>
        {suggestions.length > 0 && (
          <div className="tk-sugg" role="listbox" aria-label={t('m.search')}>
            {suggestions.map((e, i) => (
              <div
                key={e.id}
                role="option"
                aria-selected={i === chosen}
                className={i === chosen ? 'tk-sugg__r is-sel' : 'tk-sugg__r'}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  addKey(e);
                }}
              >
                {/* L-CLIENT-6a (frame KeyboardMode): each suggestion with its tile's placeholder */}
                <TilePlaceholder category={catOf(e.kind === 'deal' ? (config.deals.find((d) => d.deal_id === e.id)?.category_id ?? '') : (config.items.find((i) => i.item_id === e.id)?.category_id ?? ''))} />
                <b>
                  <span className="num" dir="ltr">
                    {qty}×
                  </span>{' '}
                  {e.name}
                </b>
                <span className="muted" dir="ltr">
                  {money(e.price_minor * qty)}
                </span>
                {kbd(i === chosen ? 'Enter' : '↓')}
              </div>
            ))}
            {/* ⚠️ 02b v1.0.28 QK-7 (BUG-24): "999n" adds 99 and says so */}
            {keyQuery.over === true && (
              <div className="tk-hint c-warn" role="status" data-max-qty="">
                {fill(t('m.max_qty'), { n: String(MAX_KEY_QTY) })}
              </div>
            )}
            <div className="tk-hint">
              {kbd('4n')} = {t('m.hint_qty')} · {kbd('hk')} = {t('m.hint_initials')} · {kbd('Enter')} {t('m.hint_add')} · {kbd('Esc')} {t('m.hint_clear')}
            </div>
          </div>
        )}
      </div>
      {/* L-CLIENT-6a item 2 (frames HomeKiosk, HomeRush): the takeaway's sections are a chip row on every device */}
      {(book !== null || shell.phone || shell.portrait) && <MenuPills categories={rail} current={current} onPick={setCategory} />}
      <MenuTiles
        tiles={tiles}
        onTap={onTap}
        tk={tk}
        rush={dense}
        wait={order_type === 'takeaway' ? (shell.online ? 'live' : 'offline') : undefined}
      />
      {order_type === 'takeaway' && kiosk && (
        <div className="tk-hint">
          {kbd('/')} {t('m.keys')}: {kbd('4n')} {kbd('Enter')} · {kbd('F2')} {t('ctx.new')} ·{' '}
          {canPay && (
            <>
              {kbd('F8')} {t('c.send_pay')} · {kbd('F9')} {t('c.send_later')} ·{' '}
            </>
          )}
          {kbd('Esc')} {t('shell.back')}
        </div>
      )}
    </section>
  );
  const banners = (
    <>
      {!shell.online && <OfflineBar variant="order" />}
      {order_type === 'dine_in' && <LockBanner state={lock.banner} onKeepDraft={keepDraft} />}
      {addingTo !== null && (
        <div className="tk-banner tk-banner--adding" role="status">
          <Ico name="repeat" />
          <span>
            {t('ctx.adding')} <b dir="ltr">{addingToken}</b>
            {adding?.name != null && seeContact && (
              <>
                {' · '}
                <b>
                  <bdi>{adding.name}</bdi>
                </b>
              </>
            )}
            {adding !== null && <> · {t(adding.paid ? 'q.paid' : 'q.due')}</>}
            {/* frame TokenAddItems "Ready by #53: 1:31 PM → 1:33 PM": the token's time before and with these items */}
            {adding?.promise_ms != null && ready !== null && ready > adding.promise_ms && (
              <small className="tk-banner__delta">
                {fill(t('c.add_delta'), { token: `#${addingToken}` })}{' '}
                <span dir="ltr" className="num">
                  {timeText(adding.promise_ms, utcOffsetMs)} → {timeText(ready, utcOffsetMs)}
                </span>
              </small>
            )}
          </span>
          <button
            type="button"
            className="tk-btn"
            onClick={() =>
              setCart((c) => {
                const { adds_to: _drop, ...rest } = c;
                void _drop;
                return rest;
              })
            }
          >
            {t('common.cancel')}
          </button>
        </div>
      )}
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
    // 02b-TK C1-4: an edited line's sheet offers Remove (Save changes is the sheets' primary)
    const onRemove = editing === null ? {} : { onRemove: () => (setCart((c) => removeLine(c, editing.key)), setSheet(null)) };
    // ⚠️ 02b-TK L-CLIENT-6b item 3: the takeaway screen's sheets as the frames draw them (ItemSheet, DealSheet)
    const common = { config, inputs, unitOf, sheet: sheetAsBottom, newKey, onAdd, onClose: closeSheet, ...onRemove, ...(order_type === 'takeaway' ? { look: 'tk' as const } : {}) };
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
          {...(sheet.item_id === undefined ? {} : { start_item_id: sheet.item_id })}
          capOf={sheetCap}
        />
      );
    else if (sheet.kind === 'item') sheetView = <OptionsSheet {...common} item_ids={[sheet.item_id]} initial={null} from_zone={sheet.from_zone} capOf={sheetCap} />;
    else if (editing?.item_id !== undefined) sheetView = <OptionsSheet {...common} item_ids={variantsOf(editing.item_id)} initial={editing} capOf={sheetCap} />;
  }

  const sendView =
    send === null ? null : (
      <SendDialog
        view={send}
        config={config}
        order_type={order_type}
        utcOffsetMs={utcOffsetMs}
        title={order_type === 'dine_in' ? (seat?.name ?? null) : null}
        sheet={shell.phone || shell.portrait}
        onDone={() => {
          if (send.kind === 'sending') return;
          leaving.current = true;
          sending.current = false;
          setSend(null);
          goBack();
        }}
        onNew={() => {
          sending.current = false;
          setSend(null);
          setNewOrder(order_type === 'parking' ? 'parking' : 'takeaway');
        }}
      />
    );
  const newOrderView = newOrder === null ? null : <NewOrderSheet initial={newOrder} onClose={() => setNewOrder(null)} />;

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
      <div className={book === null ? "col grow order order--phone" : "col grow order order--phone order--tk-phone"} dir={ur ? 'rtl' : 'ltr'} ref={rootRef}>
        {banners}
        <div className="ptabs">
          <button type="button" aria-pressed={tab === 'menu'} onClick={() => setTab('menu')}>
            {t('order.tab.menu')}
          </button>
          <button type="button" aria-pressed={tab === 'cart'} onClick={() => setTab('cart')}>
            {t('order.tab.cart')} <span className="n num">{count}</span>
          </button>
          {book !== null && (
            <button type="button" aria-pressed={tab === 'queue'} onClick={() => setTab('queue')}>
              {t('q.tab')}
            </button>
          )}
        </div>
        {blocked !== null && (
          <div className="msg cart__msg c-warn" role="alert">
            <Ico name="warn" />
            <span>{blocked}</span>
          </div>
        )}
        {cartProps.info !== null && (
          <div className="msg cart__msg c-info" role="status">
            <Ico name="info" />
            <span>{cartProps.info}</span>
          </div>
        )}
        <div className="ph-body">
          {tab === 'queue' && book !== null ? (
            queueRail(railVariant)
          ) : tab === 'menu' ? (
            menu
          ) : (
            <>
              {customer}
              <CartList config={config} unitOf={unitOf} utcOffsetMs={utcOffsetMs} groups={groups} actions={actions} qchips={order_type === 'takeaway'} phoneTakeaway={book !== null} />
              {checkBill}
            </>
          )}
        </div>
        {cartProps.day}
        {!dayNotOpen && tab !== 'queue' && <SendBar phoneTakeaway={book !== null} count={count} total_minor={total} ready_by={ready} utcOffsetMs={utcOffsetMs} problems={problems.size} canSend={canSend} primary={primary} pay={cartProps.pay} onSend={() => void onSend()} />}
        {draftBack}
        {sheetView}
        {sendView}
        {newOrderView}
        {leaveView}
        {tokenView}
        {payView(true)}
        {undoToast}
      </div>
    );
  }
  return (
    <div className="col grow order" dir={ur ? 'rtl' : 'ltr'} ref={rootRef}>
      {banners}
      <div className={['osc', book && 'osc--tk', dense && 'osc--rush', tabletTakeaway && 'osc--tk-tablet'].filter(Boolean).join(' ')}>
        {/* 02b-TK C2-1 (frames HomeKiosk, QueueTablet): kiosk queue rail | menu | cart; a tablet's ready strip over the menu */}
        {railVariant === 'column' && queueRail('column')}
        {book === null && <MenuRail categories={rail} current={current} onPick={setCategory} />}
        {tabletTakeaway ? (
          <div className="tk-mid">
            {queueRail('strip')}
            {menu}
          </div>
        ) : (
          menu
        )}
        <Cart {...cartProps} customer={customer} overlay={payView(false)} itemsLabel={order_type === 'takeaway'} />
      </div>
      {draftBack}
      {sheetView}
      {sendView}
      {newOrderView}
      {leaveView}
      {tokenView}
      {undoToast}
    </div>
  );
}

