import type { AvailabilityWindow } from '@pos/domain';
import type { BranchConfig, ConfigItem } from '@pos/events';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico, type IconName, type Tone } from '../../../alerts/ui';
import type { ItemAvailability, TileState } from '../live/availability';
import { MONEY_DIR, money } from '../money';

// 02b-C01 / 02-B06 tile (handoff MenuTiles.dc.html, CHANGES §3 02b-C01): photo or monogram, name, sub, price, one
// chip, the in-cart count. Off tiles are greyed with the price struck. A zone item shows its count ("6 here", or
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

export function chipOf(state: TileState): { tone: Tone; icon: IconName; text: string } | null {
  switch (state.kind) {
    case 'ok':
      return null;
    case 'off':
    case 'unavailable':
      return { tone: 'mute', icon: 'x', text: t('menu.not_available') };
    case 'not_now':
      return { tone: 'mute', icon: 'clock', text: fill(t('menu.not_now'), { window: windowsText(state.windows) }) };
    case 'not_counted':
      return { tone: 'mute', icon: 'info', text: t('menu.not_counted') };
    case 'sold_out':
      return { tone: 'danger', icon: 'x', text: t('menu.sold_out') };
    case 'left':
      return { tone: 'warn', icon: 'warn', text: fill(t('menu.left'), { n: String(state.n) }) };
    case 'slow':
      return { tone: 'warn', icon: 'clock', text: fill(t('menu.slow'), { n: String(state.minutes) }) };
  }
}

function monogram(name: string): string {
  const words = name.split(/\s+/).filter((w) => w.length > 0);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function Tile({ tile, onTap }: { tile: TileModel; onTap(tile: TileModel): void }) {
  const chip = tile.zone === null ? chipOf(tile.availability.state) : null;
  const off = !tile.availability.orderable;
  const classes = ['mi', 'mi--h', off ? 'off' : null, tile.in_cart > 0 ? 'picked' : null].filter((c) => c !== null).join(' ');
  return (
    <button type="button" className={classes} aria-label={tile.name} aria-disabled={off} onClick={() => (off ? undefined : onTap(tile))}>
      <div className="photo photo--none" aria-hidden="true">
        {monogram(tile.name)}
      </div>
      <div className="mi__body">
        <span className="mi__name">{tile.name}</span>
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
            <span className={`tag c-${chip.tone}`}>
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
export function MenuTiles({ tiles, onTap }: { tiles: TileModel[]; onTap(tile: TileModel): void }) {
  return (
    <div className="items items--h">
      {tiles.map((tile) => (
        <Tile key={`${tile.kind}:${tile.id}`} tile={tile} onTap={onTap} />
      ))}
    </div>
  );
}

/** The sub line of an item tile: "By weight" for a weighed item, else its description. */
export function itemSub(item: ConfigItem): string | null {
  if (item.requires_weighing || item.sale_unit !== 'piece') return t('menu.by_weight');
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
