import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import type { TableState } from '@pos/domain';
import { Legend } from './Legend';
import type { NeedsItem, NeedsKind } from './filters';
import { MapIco, type MapIconName } from './Tile';

// 02-S03 Needs you: Bill asked, late, calls, To clean, "Bilal is ordering"; the legend sits under the list (`.needs`).
// Rows open the table sheet. "Bill paid {time}" (05) and "Void waiting" (04) are not shown until those modules.

const TONE: Record<NeedsKind, string> = { bill: 'c-bill', late: 'c-warn', call: 'c-ordered', clean: 'c-clean', ordering: 'c-seated' };
const ICON: Record<NeedsKind, MapIconName> = { bill: 'bill', late: 'clock', call: 'call', clean: 'clean', ordering: 'lock' };

function title(item: NeedsItem): string {
  switch (item.kind) {
    case 'bill':
      return t('tables.ny.bill');
    case 'late':
      return item.minutes === null ? t('tables.flag.late_unknown') : fill(t('tables.flag.late'), { n: String(item.minutes) });
    case 'call':
      return t('tables.ny.call');
    case 'clean':
      return t('tables.ny.clean');
    case 'ordering':
      return fill(t('tables.ny.ordering'), { name: item.who ?? '' });
  }
}

function sub(item: NeedsItem): string | null {
  const n = String(item.minutes ?? 0);
  switch (item.kind) {
    case 'bill':
      if (item.minutes === null) return null;
      return item.mine === true ? fill(t('tables.ny.yours_ago'), { n }) : item.who ? fill(t('tables.ny.by_ago'), { name: item.who, n }) : fill(t('tables.ny.ago'), { n });
    case 'call':
      return item.who ? fill(t('tables.ny.by_ago'), { name: item.who, n }) : fill(t('tables.ny.ago'), { n });
    case 'ordering':
      return t('tables.ny.ordering_sub');
    default:
      return null;
  }
}

export function NeedsYou({ items, counts, onOpen }: { items: readonly NeedsItem[]; counts: Record<TableState, number>; onOpen(item: NeedsItem): void }) {
  return (
    <div className="card needs">
      <div className="needs__h">
        <h2>{t('tables.needs_you')}</h2>
        {items.length > 0 && <span className="cnt num">{items.length}</span>}
      </div>
      {items.map((item) => {
        const line = sub(item);
        return (
          <button key={item.key} type="button" className={`ny ${TONE[item.kind]}`} onClick={() => onOpen(item)}>
            <span className={`ny__c${item.name.includes(' + ') ? ' sm' : ''}`}>{item.name.replace(/ \+ /g, '+')}</span>
            <span>
              <span className="ny__t">
                <MapIco name={ICON[item.kind]} />
                {title(item)}
              </span>
              {line !== null && <span className="ny__s">{line}</span>}
            </span>
            <MapIco name="chev" />
          </button>
        );
      })}
      <Legend counts={counts} />
    </div>
  );
}
