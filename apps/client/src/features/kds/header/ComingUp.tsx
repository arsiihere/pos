import { t } from '../../../i18n';
import type { KdsView } from '../store';

// 03b v1.0.8 §3.3, #73 (K4; frame 03b-C06): the coming-up strip — live units by item name over Now (not done) and
// Next (the frozen plan lines with details), largest first, at most 6; computed on the screen.

export const COMING_UP_MAX = 6;

export function comingUp(view: KdsView): Array<{ name: string; units: number }> {
  const sum = new Map<string, number>();
  const add = (name: string, units: number) => sum.set(name, (sum.get(name) ?? 0) + units);
  for (const r of view.rows) if (r.detail !== null && r.stage !== 'done') add(r.detail.item_name, r.detail.units);
  for (const l of view.plan?.lines ?? []) {
    const d = view.details.get(l.order_item_id);
    if (l.frozen && d !== undefined) add(d.item_name, d.units);
  }
  // largest first; equal counts keep the order they first appeared in (Now, then Next)
  return [...sum.entries()]
    .map(([name, units], i) => ({ name, units, i }))
    .sort((a, b) => b.units - a.units || a.i - b.i)
    .slice(0, COMING_UP_MAX)
    .map(({ name, units }) => ({ name, units }));
}

export function ComingUp({ view }: { view: KdsView }) {
  const chips = comingUp(view);
  if (chips.length === 0) return null;
  return (
    <div className="kcu">
      <span className="kcu__l">{t('kds.coming_up')}</span>
      {chips.map((c) => (
        <span key={c.name} className="kcu__c">
          <b>{c.units}</b>
          {c.name}
        </span>
      ))}
    </div>
  );
}
