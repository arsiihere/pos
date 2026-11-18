// 01d v1.3 §3.13.5 (devices table, m7), 02a v1.1.7 §8 (L-4a), G-4: the element a `table` deep link glows.
// - Tablet, landscape: the map tile `[data-table]`, kept in view beside the side panel; if the tile is still covered by
//   the panel, or is in the archived group, the sheet header `[data-seating]` instead.
// - Tablet portrait and phone: the sheet header (the bottom sheet covers the map).
// The tap's arrival helper asks this for every `table` place (deeplink-tap.ts findPlace, integrator ruling (a), cp5):
// null = not rendered yet (it keeps waiting). The device is StaffApp's own layout query (shell/layout.ts).

import { bottomSheetLayout } from '../../shell/layout';

const cssId = (s: string) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

/** The tile and the panel overlap with a positive area (the panel draws over the map). */
function covered(tile: Element, panel: Element): boolean {
  const a = tile.getBoundingClientRect();
  const b = panel.getBoundingClientRect();
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0;
}

export function tablePlace(table_id: string, seating_id: string | null, root: ParentNode = document): HTMLElement | null {
  const header = seating_id === null ? null : root.querySelector<HTMLElement>(`[data-seating="${cssId(seating_id)}"]`);
  const tile = root.querySelector<HTMLElement>(`[data-table="${cssId(table_id)}"]`);
  if (bottomSheetLayout()) return header;
  // landscape: the tile, once the map shows it (TableMap switches to the tile's floor on the same render as the
  // route): judged on the floor shown now, never on the old one. While the map is still loading → keep waiting; a
  // loaded map that does not draw the tile (the "Mine" filter hides it) → the header at once.
  if (tile === null) {
    const map = root.querySelector('main.map');
    return map !== null && map.getAttribute('aria-busy') !== 'true' ? header : null;
  }
  if (tile.classList.contains('arch')) return header;
  // "kept in view beside the side panel": bring it into view first, then judge whether the panel still covers it
  // (if it does, the spec's header fallback)
  tile.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
  // the side panel: the table sheet's dialog (scrim--side) when it is open
  const panel = header?.closest('.tv') ?? root.querySelector('.scrim--side .tv');
  if (panel !== null && panel !== undefined && covered(tile, panel)) return header;
  return tile;
}
