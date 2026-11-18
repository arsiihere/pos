import type { AlertLinkTarget } from '@pos/events';
import { t } from '../../i18n';
import { fill } from '../../i18n/en';
import { matchStaffRoute } from '../staff/shell/routes';

// 01d v1.3 §3.13.5 (m12), test 95: on a Pass tablet on #/pass, an `order` target whose Pass card is on the screen is
// open by definition: the tap glows that card in place, with no navigation, no order-view read and no sheet (its
// escalation row is lock-only). Integrator ruling (a), cp7: the tap asks this first.

const cssId = (s: string) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

/** The rendered, shown Pass card of an `order` target while the route is #/pass; null in every other case. */
export function passPlace(target: AlertLinkTarget, root: ParentNode = document): HTMLElement | null {
  if (target.type !== 'order') return null;
  if (matchStaffRoute(window.location.hash.replace(/^#/, ''), 'tablet').name !== 'pass') return null;
  const card = root.querySelector<HTMLElement>(`article.pc[data-order="${cssId(target.order_id)}"]`);
  if (card === null || card.closest('[hidden]') !== null) return null;
  for (let el: Element | null = card; el !== null; el = el.parentElement) if (getComputedStyle(el).display === 'none') return null;
  return card;
}

/** §3.13.6 n4: "Opened Pass card <name>", the one label of both paths (the tap in place, and #/pass?focus=). The name
 *  is the card's identifier as the screen shows it; before the card renders, `fallback` (the Pass store's identifier),
 *  else the order id: never an empty name. */
export function passOpenedText(order_id: string, fallback = '', root: ParentNode = document): string {
  const shown = root.querySelector(`article.pc[data-order="${cssId(order_id)}"] .pc__n`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const name = shown !== '' ? shown : fallback.trim() !== '' ? fallback.trim() : order_id;
  return fill(t('alerts.opened.pass'), { name });
}
