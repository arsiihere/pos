import type { AvailabilityWindow, Unit } from '@pos/domain';
import type { BranchConfig, ConfigItem } from '@pos/events';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico, type IconName, type Tone } from '../../../alerts/ui';
import type { ItemAvailability, TileState } from '../live/availability';
import { MONEY_DIR, money } from '../money';

// 02b-C01 / 02-B06 tile (handoff MenuTiles.dc.html, CHANGES §3 02b-C01): photo or monogram, name, sub, price, one
// chip, the in-cart count. Off tiles are greyed with the price struck (not on takeaway: 02b-TK A2 item 3 below). A zone item shows its count ("6 here", or
// "0 here · kitchen") and the zone's name as its sub (02b §8 Zone items). Prices LTR (R20).

export type TileKind = 'item' | 'variants' | 'deal';

export interface TileModel {
  /** item_id, variant_group_id or deal_id */
  id: string;
  kind: TileKind;
  name: string;
  sub: string | null;
  price_minor: number;
  /** "from Rs …" (variants) */
  from: boolean;
  /** g / ml items: "/ kg", "/ L" */
  per: 'kg' | 'l' | null;
  availability: ItemAvailability;
  /** the zone count when the item is a zone item here (02b §8 Zone items) */
  zone: { on_hand: number; zone_name: string | null } | null;
  in_cart: number;
  /** 02b-TK A2 item 3 (frame TileStates "half/full on tile"): a variant tile's variants, one button each */
  variants?: Array<{ item_id: string; name: string; price_minor: number; availability: ItemAvailability }>;
  /** the paused station's name of a `paused` tile (frame TileStates "Tandoor paused") */
  station_name?: string | null;
  /** L-CLIENT-6a (frame HomeKiosk): the tile's category (name, menu order) — the takeaway tile's placeholder */
  category?: { name: string; index: number } | null;
}

const HOUR = 3_600_000;

function clock(msOfDay: number): { text: string; ampm: 'AM' | 'PM' } {
  const minutes = Math.floor((((msOfDay % (24 * HOUR)) + 24 * HOUR) % (24 * HOUR)) / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { text: m === 0 ? String(h12) : `${h12}:${String(m).padStart(2, '0')}`, ampm: h < 12 ? 'AM' : 'PM' };
}

/** "7–11 AM", "11 AM–3 PM"; several windows joined with ", ". */
export function windowsText(windows: readonly AvailabilityWindow[]): string {
  return windows
    .map((w) => {
      const a = clock(w.start_ms);
      const b = clock(w.end_ms);
      return a.ampm === b.ampm ? `${a.text}–${b.text} ${b.ampm}` : `${a.text} ${a.ampm}–${b.text} ${b.ampm}`;
    })
    .join(', ');
}

/** The rail's "Not now · 7 AM": the start of the first window. */
export function opensText(windows: readonly AvailabilityWindow[]): string {
  const first = windows[0];
  if (first === undefined) return '';
  const a = clock(first.start_ms);
  return `${a.text} ${a.ampm}`;
}

export function chipOf(state: TileState): { tone: Tone; icon: IconName; text: string; title?: string } | null {
  switch (state.kind) {
    case 'ok':
      return null;
    case 'off':
    case 'unavailable':
      return { tone: 'mute', icon: 'x', text: t('menu.not_available') };
    case 'paused':
      return offChip(state, null);
    case 'not_now':
      return { tone: 'mute', icon: 'clock', text: fill(t('menu.not_now'), { window: windowsText(state.windows) }) };
    case 'not_counted':
      return { tone: 'mute', icon: 'info', text: t('menu.not_counted') };
    case 'sold_out':
      return { tone: 'danger', icon: 'x', text: t('menu.sold_out') };
    case 'left':
      return { tone: 'warn', icon: 'warn', text: fill(t('menu.left'), { n: String(state.n) }) };
    // 02b-tk C3-3 (03a To 02 #9): an estimate, not the promise (the cart's eta-preview is); amber when long
    case 'now':
      return { tone: 'ok', icon: 'check', text: t('menu.now') };
    case 'about':
      return { tone: state.long ? 'warn' : 'mute', icon: 'clock', text: fill(t('menu.about'), { n: String(state.minutes) }), title: t('menu.estimate_hint') };
  }
}

// 02b-TK A2 item 3 (frame TileStates; CHANGES §3 Menu): a takeaway tile that cannot be ordered says why — "Sold out",
// "From 7 PM", "Tandoor paused", "Not counted today", "Not available" — the price is never struck through, and a tap
// says it again in a toast (never silent; "Chicken Tikka is sold out — ask the kitchen").
type Chip = NonNullable<ReturnType<typeof chipOf>>;

/** The reason chip of an off tile on takeaway; null for an orderable state. */
export function offChip(state: TileState, station: string | null): Chip | null {
  switch (state.kind) {
    case 'sold_out':
      return { tone: 'danger', icon: 'x', text: t('m.sold_out') };
    case 'not_now':
      return { tone: 'warn', icon: 'clock', text: fill(t('m.not_now'), { time: opensText(state.windows) }) };
    case 'paused':
      return { tone: 'warn', icon: 'warn', text: fill(t('m.paused'), { station: station ?? '' }).trim() };
    case 'not_counted':
      return { tone: 'warn', icon: 'info', text: t('menu.not_counted') };
    case 'off':
    case 'unavailable':
      return { tone: 'mute', icon: 'x', text: t('menu.not_available') };
    default:
      return null;
  }
}

/** The toast of a tap on an off tile. */
export function offToast(name: string, state: TileState, station: string | null): string {
  if (state.kind === 'sold_out') return fill(t('t.sold_out'), { item: name });
  return fill(t('t.off_reason'), { item: name, reason: offChip(state, station)?.text ?? t('menu.not_available') });
}

function monogram(name: string): string {
  const words = name.split(/\s+/).filter((w) => w.length > 0);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/**
 * L-CLIENT-6a (frames HomeKiosk, TileStates; owner: photos after the pilot, the menu has no photo field): the takeaway
 * tile's image slot is a round placeholder in its category's colour with an icon for the kind of food — never initials.
 * The icon is picked from the category's name (English or Urdu words); the colour from its place in the menu.
 */
const LOOKS: Array<[RegExp, IconName]> = [
  [/drink|lassi|juice|tea|chai|cold|shake|water|مشروب|لسی|چائے/i, 'cup'],
  [/deal|combo|family|ڈیل/i, 'tag'],
  [/tandoor|naan|roti|bread|paratha|تندور|نان|روٹی/i, 'bread'],
  [/bbq|tikka|kabab|kebab|grill|tawa|fry|بار|تکہ|کباب|توا/i, 'flame'],
  [/side|raita|salad|chutney|سائیڈ|رائتہ|سلاد/i, 'leaf'],
  [/karahi|handi|curry|qorma|korma|کڑاہی|ہانڈی/i, 'pot'],
];
export function placeholderOf(category: { name: string; index: number } | null | undefined): { icon: IconName; tone: number } {
  const name = category?.name ?? '';
  return { icon: LOOKS.find(([re]) => re.test(name))?.[1] ?? 'bowl', tone: (category?.index ?? 0) % 6 };
}

function Placeholder({ tile }: { tile: TileModel }) {
  return <TilePlaceholder category={tile.category} />;
}

/** The placeholder alone (the keyboard suggestions show it too, frame KeyboardMode). */
export function TilePlaceholder({ category }: { category: TileModel['category'] }) {
  const look = placeholderOf(category);
  return (
    <span className={`tk-ph tk-ph--${look.tone}`} aria-hidden="true">
      <Ico name={look.icon} />
    </span>
  );
}

/** 02b-TK A2 item 3: what a takeaway tile does besides a plain tap. */
export interface TakeawayTileActions {
  /** a tap on an off tile (or an off variant): the toast with the reason */
  onOff(name: string, state: TileState, station: string | null): void;
  /** one variant's button on the tile */
  onVariant(tile: TileModel, item_id: string): void;
}

/** A variant tile with two or three variants shows them as buttons on the tile (frame TileStates; more: the sheet). */
const splits = (tile: TileModel) => tile.variants !== undefined && tile.variants.length >= 2 && tile.variants.length <= 3;

type PhoneWait = 'live' | 'offline';

function timeOnPhone(chip: Chip | null, state: TileState, wait: PhoneWait | undefined): Chip | null {
  if (wait === undefined) return chip;
  // L-CLIENT-6a (frames HomeKiosk, TileStates "wait chip"): a takeaway tile's wait reads "17 min" (an estimate, 02b §8
  // Tile wait estimate; the cart's Ready by is the promise)
  if (wait === 'live' && state.kind === 'about') return { tone: state.long ? 'warn' : 'mute', icon: 'clock', text: fill(t('m.min'), { n: String(state.minutes) }), title: t('menu.estimate_hint') };
  if (chip === null || wait === 'offline' && (state.kind === 'about' || state.kind === 'now')) {
    return { tone: 'mute', icon: 'clock', text: '—' };
  }
  return chip;
}

function SplitTile({ tile, tk, wait }: { tile: TileModel; tk: TakeawayTileActions; wait: PhoneWait | undefined }) {
  const off = !tile.availability.orderable;
  const chip = timeOnPhone(offChip(tile.availability.state, tile.station_name ?? null) ?? chipOf(tile.availability.state), tile.availability.state, wait);
  const classes = ['mi', 'mi--h', 'mi--tk', 'mi--split', off ? 'off' : null, tile.in_cart > 0 ? 'picked' : null].filter((c) => c !== null).join(' ');
  return (
    <div className={classes} role="group" aria-label={tile.name}>
      <div className="mi__body">
        <div className="tk-tile__top">
          <Placeholder tile={tile} />
          <span className="mi__name">{tile.name}</span>
        </div>
        <div className="tk-split">
          {tile.variants!.map((v) => (
            <button
              key={v.item_id}
              type="button"
              aria-label={`${tile.name} · ${v.name}`}
              aria-disabled={!v.availability.orderable}
              onClick={() => (v.availability.orderable ? tk.onVariant(tile, v.item_id) : tk.onOff(`${tile.name} · ${v.name}`, v.availability.state, tile.station_name ?? null))}
            >
              {v.name}
              <small className="money" dir={MONEY_DIR}>
                {money(v.price_minor)}
              </small>
            </button>
          ))}
        </div>
        {chip !== null && (
          <div className="mi__foot">
            <span className={`tag c-${chip.tone}`} title={chip.title}>
              <Ico name={chip.icon} />
              {chip.text}
            </span>
          </div>
        )}
      </div>
      {tile.in_cart > 0 && (
        <span className="qty num" aria-label={fill(t('menu.in_order'), { n: String(tile.in_cart) })}>
          {tile.in_cart}
        </span>
      )}
    </div>
  );
}

export function Tile({ tile, onTap, tk, wait }: { tile: TileModel; onTap(tile: TileModel): void; tk?: TakeawayTileActions | undefined; wait?: PhoneWait | undefined }) {
  if (tk !== undefined && splits(tile)) return <SplitTile tile={tile} tk={tk} wait={wait} />;
  const off = !tile.availability.orderable;
  const chip = timeOnPhone(tile.zone !== null ? null : tk !== undefined ? (offChip(tile.availability.state, tile.station_name ?? null) ?? chipOf(tile.availability.state)) : chipOf(tile.availability.state), tile.availability.state, wait);
  const classes = ['mi', 'mi--h', tk !== undefined ? 'mi--tk' : null, off ? 'off' : null, tile.in_cart > 0 ? 'picked' : null].filter((c) => c !== null).join(' ');
  const tap = () => {
    if (!off) return onTap(tile);
    tk?.onOff(tile.name, tile.availability.state, tile.station_name ?? null);
  };
  return (
    <button type="button" className={classes} aria-label={tile.name} aria-disabled={off} onClick={tap}>
      {tk === undefined && (
        <div className="photo photo--none" aria-hidden="true">
          {monogram(tile.name)}
        </div>
      )}
      <div className="mi__body">
        {tk === undefined ? (
          <span className="mi__name">{tile.name}</span>
        ) : (
          <div className="tk-tile__top">
            <Placeholder tile={tile} />
            <span className="mi__name">{tile.name}</span>
          </div>
        )}
        {tile.sub !== null && <span className="mi__sub">{tile.zone?.zone_name ?? tile.sub}</span>}
        {tile.sub === null && tile.zone?.zone_name != null && <span className="mi__sub">{tile.zone.zone_name}</span>}
        <div className="mi__foot">
          <span className="price" dir={MONEY_DIR}>
            {tile.from && <small>{t('menu.from')} </small>}
            {money(tile.price_minor)}
            {tile.per !== null && <small> {t(tile.per === 'kg' ? 'menu.per.kg' : 'menu.per.l')}</small>}
          </span>
          {tile.zone !== null && (
            <span className="zq">
              <Ico name="pin" />
              {tile.zone.on_hand > 0 ? fill(t('menu.here'), { n: String(tile.zone.on_hand) }) : t('menu.here_kitchen')}
            </span>
          )}
          {chip !== null && (
            <span className={`tag c-${chip.tone}`} title={chip.title}>
              <Ico name={chip.icon} />
              {chip.text}
            </span>
          )}
        </div>
      </div>
      {tile.in_cart > 0 && (
        <span className="qty num" aria-label={fill(t('menu.in_order'), { n: String(tile.in_cart) })}>
          {tile.in_cart}
        </span>
      )}
    </button>
  );
}

// The grid takes pulse-02's default 2 columns (`--icols`); the kiosk's 3 and the phone's 1 need a ui-kit rule
// (no `style` prop, S35 d) — listed in the PR as a layout difference.
// 02b-TK A2 item 3: `tk` = the takeaway tile (frame TileStates); item 4: `rush` = the dense grid, no photos (HomeRush).
export function MenuTiles({ tiles, onTap, tk, rush = false, wait }: { tiles: TileModel[]; onTap(tile: TileModel): void; tk?: TakeawayTileActions | undefined; rush?: boolean; wait?: PhoneWait | undefined }) {
  return (
    <div className={rush ? 'items items--h items--rush' : 'items items--h'}>
      {tiles.map((tile) => (
        <Tile key={`${tile.kind}:${tile.id}`} tile={tile} onTap={onTap} tk={tk} wait={wait} />
      ))}
    </div>
  );
}

/** The sub line of an item tile: "By weight" for an item weighed today (01c V20: the day-frozen unit), else its description. */
export function itemSub(item: ConfigItem, unit: Unit | null): string | null {
  if (item.requires_weighing || (unit ?? item.sale_unit) !== 'piece') return t('menu.by_weight');
  return item.description;
}

/** Variant names in sort order ("Half · Full"). */
export function variantsSub(config: BranchConfig, variant_group_id: string): string {
  return config.items
    .filter((i) => i.variant_group_id === variant_group_id)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((i) => i.variant_name ?? i.name)
    .join(' · ');
}
