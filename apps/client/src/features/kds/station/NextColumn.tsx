import type { LineDetail } from '@pos/domain';
import type { StationPlanBody } from '@pos/events';
import type { ReactNode } from 'react';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import { identifierText } from './Identifier';
import { clockText } from './LineTimer';
import { MarkTag } from './MarkTag';
import { groupNext, priorityText } from './parts';

// 03b §3.3, #70 (K2; frame 03b-S01 Next column): Next = the `station_plan` lines with `frozen: true`, each with
// "in m:ss" to its fire_ms (hub clock); Later: N = the rest, counted. A planned line without details yet is a
// placeholder row in place. The footer (Give me more, K3) stays at the bottom. 03b v1.0.11 §3.3 (STAB-5): planned parts
// of one `part_of` with the same fire_ms and mark are one row with the units summed (`groupNext`).

export function nextOf(plan: StationPlanBody | null): { next: StationPlanBody['lines']; later: number } {
  const lines = plan?.lines ?? [];
  return { next: lines.filter((l) => l.frozen), later: lines.filter((l) => !l.frozen).length };
}

export function NextColumn({
  plan,
  details,
  nowMs,
  footer,
  rounds,
  flagged,
}: {
  plan: StationPlanBody | null;
  details: ReadonlyMap<string, LineDetail>;
  nowMs: number;
  footer?: ReactNode;
  /** ⚠️ 03b v1.0.13 §3.3 (STAB-6): the station-wide round tag of each load (parts.ts roundsOf) */
  rounds?: ReadonlyMap<string, string>;
  /** ⚠️ 03b v1.0.14 §3.3 (m-6): planned lines a LinePrioritized frame named since the last plan */
  flagged?: ReadonlySet<string>;
}) {
  const { next: lines, later } = nextOf(plan);
  const next = groupNext(lines, details, flagged);
  return (
    <aside className="knx">
      <div className="ksec__h">
        {t('kds.next')}
        <span className="n">{next.length}</span>
      </div>
      <div className="knx__l">
        {next.map(({ line: l, detail: d, priority }) => {
          const inText = fill(t('kds.in'), { time: clockText(l.fire_ms - nowMs) });
          if (d === undefined) return <div key={l.order_item_id} className="knr s-ph" aria-label={t('kds.loading')} data-id={l.order_item_id} />;
          return (
            <div key={l.order_item_id} className={l.mark === null ? 'knr' : 'knr mk'} data-id={l.order_item_id}>
              {l.mark !== null && <MarkTag mark={l.mark} {...(l.mark === 'moved' ? { extra: inText } : {})} />}
              {priority !== null && <span className="kmk c-warn kmk--prio">{priorityText(priority)}</span>}
              <span className="knr__n">{identifierText(d.identifier)}</span>
              <span className="knr__it">
                <span className="q">{d.units} x</span>
                {d.item_name}
              </span>
              {l.load_id != null && rounds?.get(l.load_id) !== undefined && (
                <span className="kround" data-round>
                  {rounds.get(l.load_id)}
                </span>
              )}
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
