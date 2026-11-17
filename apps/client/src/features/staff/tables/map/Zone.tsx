import type { ReactNode } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { initial } from '../../../alerts/ui';
import type { MapPerson } from '../contracts';
import type { Section } from './filters';

// 02-S03 zone: heading "Cabins · S Sara's zone · 5 tables" (Q-25: an assignee only when every tile has the same one)
// over its tiles. No zone and Archived tables carry client labels (§6.17).

export function Zone({ section, assignee, staffId, children }: { section: Section; assignee: MapPerson | null; staffId: string | null; children: ReactNode }) {
  const title = section.kind === 'archived' ? t('tables.archived_group') : section.kind === 'none' ? t('zones.none') : (section.name ?? '');
  const mine = assignee !== null && assignee.staff_id === staffId;
  return (
    <section className="zone" aria-label={title}>
      <div className="zone__h">
        {title}
        {assignee !== null && (
          <span className={`zw${mine ? ' zw--me' : ''}`}>
            <span className="av">{initial(assignee.name ?? '?')}</span>
            {mine ? t('tables.zone.mine') : fill(t('tables.zone.other'), { name: assignee.name ?? '' })}
          </span>
        )}
        <span className="end num">{section.kind === 'archived' ? section.tiles.length : fill(t('tables.zone.count'), { n: String(section.tiles.length) })}</span>
      </div>
      <div className="tiles" dir="ltr">
        {children}
      </div>
    </section>
  );
}
