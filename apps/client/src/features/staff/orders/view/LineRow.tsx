import type { KeyboardEvent, ReactNode } from 'react';
import { t } from '../../../../i18n';
import { Ico } from '../../../alerts/ui';
import type { LineView, SeatingLine } from '../contracts';
import { MONEY_DIR, money } from '../money';
import { isServed, isWeightPending, lineBadges, lineStage, optionsText, stageText } from './stage';

// 02b v1.0.11 §8 Table view (frames TableView, OrderView, Stages): one order line `.ol` — units, name, the plain
// options line (Q-7), the kitchen note in quotes, the stage pill, badges, the billed amount. A selected line opens its
// actions under it (`children` → `.ol__ctrl`). `served` mode is the order-view fallback before H3 (Q-8): no stages,
// only a Served / Not served badge from the catch-up lines.

export interface LineRowProps {
  line: SeatingLine | LineView;
  mode: 'stages' | 'served';
  utcOffsetMs: number;
  selected?: boolean;
  onSelect?: (order_item_id: string) => void;
  /** the selected line's actions */
  children?: ReactNode;
}

const hasStage = (line: SeatingLine | LineView): line is SeatingLine => 'stage' in line;

/** "1.25 kg" for 1250 g; "0.5 L" for 500 ml. */
export function weightText(quantity: number, unit: 'g' | 'ml'): string {
  const whole = quantity / 1000;
  return `${whole.toLocaleString('en-US', { maximumFractionDigits: 3 })} ${unit === 'g' ? t('quantity.kg') : t('line.unit_l')}`;
}

export function LineRow({ line, mode, utcOffsetMs, selected = false, onSelect, children }: LineRowProps) {
  const child = line.line_kind === 'option_child' || line.line_kind === 'deal_part';
  const struck = line.live_units === 0;
  const units = struck ? line.units : line.live_units;
  const weighed = line.sale_unit !== 'piece';
  const stage = mode === 'stages' && hasStage(line) ? lineStage(line) : null;
  const options = optionsText(line);
  const subs: string[] = [];
  if (options !== null) subs.push(options);
  if (line.kitchen_note !== null && line.kitchen_note !== '') subs.push(`“${line.kitchen_note}”`);
  if (weighed && line.quantity !== null) subs.push(weightText(line.quantity, line.sale_unit as 'g' | 'ml'));
  const badges = lineBadges(line);
  // a deal part's money lives in its deal line (§3.4): no amount on the part
  const price = line.line_kind === 'deal_part' ? '' : isWeightPending(line) ? '—' : money(line.billed_minor);
  const select = () => onSelect?.(line.order_item_id);
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select();
    }
  };
  const cls = ['ol', child ? 'child' : null, struck ? 'struck' : null, selected ? 'sel' : null].filter((c) => c !== null).join(' ');
  return (
    <div
      className={cls}
      data-line={line.order_item_id}
      {...(onSelect === undefined ? {} : { tabIndex: 0, 'aria-expanded': selected, onClick: select, onKeyDown: onKey })}
    >
      <span className="ol__q num">{units}×</span>
      <span className="ol__n">
        <b>{child && line.line_kind === 'option_child' ? `+ ${line.name}` : line.name}</b>
        {subs.map((s, i) => (
          <span key={i} dir="auto">
            {s}
          </span>
        ))}
        {mode === 'served' && line.line_kind !== 'deal_part' && (
          <span className={`bdg ${isServed(line) ? 'c-ok' : 'c-mute'}`}>
            <Ico name={isServed(line) ? 'check' : 'clock'} />
            {isServed(line) ? t('orders.served') : t('orders.not_served')}
          </span>
        )}
        {badges.map((b) => (
          <span key={b.text} className={`bdg c-${b.tone}`}>
            <Ico name={b.icon} />
            {b.text}
          </span>
        ))}
      </span>
      <span className="ol__e">
        {stage !== null && (
          <span className={`stg c-${stage.tone}`}>
            <Ico name={stage.icon} />
            {stageText(stage, utcOffsetMs)}
          </span>
        )}
        <span className="ol__p" dir={MONEY_DIR}>
          {price}
        </span>
      </span>
      {selected && children !== undefined && (
        <div className="ol__ctrl" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  );
}
