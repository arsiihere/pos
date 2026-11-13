import type { LineDetail } from '@pos/domain';
import type { StationPlanBody } from '@pos/events';
import type { ReactNode } from 'react';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import { identifierText } from './Identifier';
import { clockText } from './LineTimer';
import { MarkTag } from './MarkTag';

// 03b §3.3, #70 (K2; frame 03b-S01 Next column): Next = the `station_plan` lines with `frozen: true`, each with
// "in m:ss" to its fire_ms (hub clock); Later: N = the rest, counted. A planned line without details yet is a
// placeholder row in place. The footer (Give me more, K3) stays at the bottom.

export function nextOf(plan: StationPlanBody | null): { next: StationPlanBody['lines']; later: number } {
  const lines = plan?.lines ?? [];
  return { next: lines.filter((l) => l.frozen), later: lines.filter((l) => !l.frozen).length };
}

export function NextColumn({
  plan,
  details,
  nowMs,
  footer,
}: {
  plan: StationPlanBody | null;
  details: ReadonlyMap<string, LineDetail>;
  nowMs: number;
  footer?: ReactNode;
}) {
  const { next, later } = nextOf(plan);
  return (
    <aside className="knx">
      <div className="ksec__h">
        {t('kds.next')}
        <span className="n">{next.length}</span>
      </div>
      <div className="knx__l">
        {next.map((l) => {
          const d = details.get(l.order_item_id);
          const inText = fill(t('kds.in'), { time: clockText(l.fire_ms - nowMs) });
          if (d === undefined) return <div key={l.order_item_id} className="knr s-ph" aria-label={t('kds.loading')} data-id={l.order_item_id} />;
          return (
            <div key={l.order_item_id} className={l.mark === null ? 'knr' : 'knr mk'} data-id={l.order_item_id}>
              {l.mark !== null && <MarkTag mark={l.mark} {...(l.mark === 'moved' ? { extra: inText } : {})} />}
              <span className="knr__n">{identifierText(d.identifier)}</span>
              <span className="knr__it">
                <span className="q">{d.units} x</span>
                {d.item_name}
              </span>
              <span className="knr__in">
                {inText}
                <small>{t('kds.to_fire')}</small>
              </span>
            </div>
          );
        })}
      </div>
      <div className="klater">
        {t('kds.later').split('{n}')[0]}
        <b className="num">{later}</b>
      </div>
      {footer !== undefined && <div className="kmore">{footer}</div>}
    </aside>
  );
}
