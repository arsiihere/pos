import type { ReactNode } from 'react';
import type { ConfigModifierGroup } from '@pos/events';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import type { CartOption } from '../order-screen/cart';

// 02b-TK C1-4 (frames ItemSheet, DealSheet; 01c §4.4; 02b §3.2; audit #22): an add-on that can be taken more than once
// (option `max_quantity` > 1 in a group of `max_choices` > 1) gets a − n + stepper ("karahi + 4 naan"). The option's
// quantity counts toward the group's `max_choices` (packages/domain/src/menu-lines.ts:233), so + stops at the option's
// max or when the group is full. A choose-one group and a once-only option keep their chip.

type Option = ConfigModifierGroup['options'][number];

/** The stepper is for options taken more than once in a group that allows more than one. */
export function stepsOption(g: ConfigModifierGroup, o: Option): boolean {
  return g.max_choices > 1 && o.max_quantity > 1;
}

/** The group's picks after one step of `option` (+1 / −1); 0 takes it off. `extra` = what a new pick carries (a linked option's id). */
export function stepOption(cur: CartOption[], g: ConfigModifierGroup, option: Option, delta: 1 | -1, extra: () => Partial<CartOption> = () => ({})): CartOption[] {
  const had = cur.find((o) => o.option_id === option.option_id);
  const groupTotal = cur.filter((o) => g.options.some((x) => x.option_id === o.option_id)).reduce((n, o) => n + o.quantity, 0);
  if (delta > 0) {
    if (groupTotal >= g.max_choices || (had?.quantity ?? 0) >= option.max_quantity) return cur;
    return had === undefined ? [...cur, { option_id: option.option_id, quantity: 1, ...extra() }] : cur.map((o) => (o.option_id === option.option_id ? { ...o, quantity: o.quantity + 1 } : o));
  }
  if (had === undefined) return cur;
  return had.quantity <= 1 ? cur.filter((o) => o.option_id !== option.option_id) : cur.map((o) => (o.option_id === option.option_id ? { ...o, quantity: o.quantity - 1 } : o));
}

export function OptionStepper(p: { group: ConfigModifierGroup; option: Option; options: CartOption[]; label: ReactNode; onStep(delta: 1 | -1): void }) {
  const q = p.options.find((o) => o.option_id === p.option.option_id)?.quantity ?? 0;
  const groupTotal = p.options.filter((o) => p.group.options.some((x) => x.option_id === o.option_id)).reduce((n, o) => n + o.quantity, 0);
  const more = q < p.option.max_quantity && groupTotal < p.group.max_choices;
  return (
    <div className="qline" role="group" aria-label={p.option.name}>
      <span>{p.label}</span>
      <span className="step">
        <button type="button" aria-label={fill(t('opt.less'), { option: p.option.name })} disabled={q === 0} onClick={() => p.onStep(-1)}>
          −
        </button>
        <output className="num">{q}</output>
        <button type="button" aria-label={fill(t('opt.more'), { option: p.option.name })} disabled={!more} onClick={() => p.onStep(1)}>
          +
        </button>
      </span>
    </div>
  );
}
