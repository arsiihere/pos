import type { AvailabilityWindow } from '@pos/domain';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { opensText } from './MenuTiles';

// 02-S05 category rail (200 px, kiosk wider by the kit) and 02-S10's phone pills. A category outside its windows is
// greyed "Not now · 7 AM" and stays tappable (its tiles say why). Urdu: the rail sits on the right by logical CSS.

export interface RailCategory {
  category_id: string;
  name: string;
  items: number;
  deals: number;
  /** the windows that keep it out now, or null */
  closed: AvailabilityWindow[] | null;
}

function countText(c: RailCategory): string {
  if (c.items === 0 && c.deals > 0) return fill(t('menu.deals_n'), { n: String(c.deals) });
  return fill(t('menu.items_n'), { n: String(c.items + c.deals) });
}

export function MenuRail({ categories, current, onPick }: { categories: RailCategory[]; current: string | null; onPick(id: string): void }) {
  return (
    <nav className="cats" aria-label={t('menu.sections')}>
      {categories.map((c) => (
        <button
          key={c.category_id}
          type="button"
          className={c.closed === null ? 'cat' : 'cat off'}
          aria-current={c.category_id === current ? 'true' : undefined}
          onClick={() => onPick(c.category_id)}
        >
          <div className="cat__ph" aria-hidden="true" />
          <span className="cat__t">
            <b>{c.name}</b>
            <small>{c.closed === null ? countText(c) : fill(t('menu.not_now'), { window: opensText(c.closed) })}</small>
          </span>
        </button>
      ))}
    </nav>
  );
}

export function MenuPills({ categories, current, onPick }: { categories: RailCategory[]; current: string | null; onPick(id: string): void }) {
  return (
    <nav className="pills pills--sm" aria-label={t('menu.sections')}>
      {categories.map((c) => (
        <button key={c.category_id} type="button" className="pill" aria-current={c.category_id === current ? 'true' : undefined} onClick={() => onPick(c.category_id)}>
          {c.name}
        </button>
      ))}
    </nav>
  );
}
