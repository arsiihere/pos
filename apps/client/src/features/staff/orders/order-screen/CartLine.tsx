import type { BranchConfig } from '@pos/events';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico } from '../../../alerts/ui';
import { timeText } from '../../../alerts/labels';
import { MONEY_DIR, money } from '../money';
import { cartLineMoney, type CartLine as Line, type LineProblem, type UnitOf } from './cart';

// 02-S05 cart line (handoff CartLines.dc.html, Order, OrderProblem, OrderOffline): qty, name, options, kitchen note,
// price, clock time. The open line shows the stepper, Edit and Remove; a line problem marks it (`.prob`) with the
// reason and its fix ("Set to 2" / Remove). The time is "—" with no preview, highlighted when its promise moved.

export interface LineView {
  line: Line;
  eta_ms: number | null;
  moved: boolean;
  /** the zone's name on a counter (from_zone) line */
  zone_name: string | null;
  problem: LineProblem | null;
  open: boolean;
  /** the stepper's cap (O15) */
  cap: number | null;
}

export interface LineActions {
  toggle(key: string): void;
  setUnits(key: string, units: number): void;
  remove(key: string): void;
  edit(key: string): void;
}

function Glyph({ d }: { d: string }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const MINUS = 'M5 12h14';
const PLUS = 'M12 5v14M5 12h14';
const PEN = 'M4 20h4L19 9l-4-4L4 16z';
const NOTE = 'M5 4h14v12l-4 4H5z';

function nameOf(config: BranchConfig, line: Line): string {
  if (line.deal_id !== undefined) return config.deals.find((d) => d.deal_id === line.deal_id)?.name ?? '';
  return config.items.find((i) => i.item_id === line.item_id)?.name ?? '';
}

function optionsText(config: BranchConfig, line: Line): string | null {
  const names: string[] = [];
  const optionName = (id: string) => config.modifier_groups.flatMap((g) => g.options).find((o) => o.option_id === id)?.name ?? '';
  for (const o of line.options) names.push(o.quantity > 1 ? `${optionName(o.option_id)} ×${o.quantity}` : optionName(o.option_id));
  for (const c of line.deal_choices ?? []) names.push(config.items.find((i) => i.item_id === c.item_id)?.name ?? '');
  return names.length === 0 ? null : `+ ${names.join(', ')}`;
}

function qtyText(line: Line, unitOf: UnitOf): string {
  const unit = line.item_id === undefined ? 'piece' : unitOf(line.item_id);
  if (line.deal_id === undefined && unit !== 'piece') return line.quantity === null || unit === null ? '—' : `${line.quantity} ${unit}`;
  return `${line.quantity ?? 1}×`;
}

function whyText(p: LineProblem): string {
  switch (p.kind) {
    case 'only_left':
      return fill(t('cart.prob.only_left'), { n: String(p.n) });
    case 'station_paused':
      return t('cart.prob.station_paused');
    case 'sold_out':
      return t('menu.sold_out');
    case 'not_now':
      return t('cart.prob.not_now');
    case 'off':
      return t('menu.not_available');
  }
}

export function CartLineRow({ view, config, unitOf, utcOffsetMs, actions }: { view: LineView; config: BranchConfig; unitOf: UnitOf; utcOffsetMs: number; actions: LineActions }) {
  const { line } = view;
  const m = cartLineMoney(config, line, unitOf);
  // a pending weight shows what is billed now (its linked children) or "—"; missing menu data shows "—"
  const price = m.kind === 'unknown' || (m.kind === 'pending' && m.minor === 0) ? '—' : money(m.minor);
  const options = optionsText(config, line);
  const piece = line.quantity !== null && (line.deal_id !== undefined || (line.item_id !== undefined && unitOf(line.item_id) === 'piece'));
  const classes = ['ln', view.open ? 'open' : null, view.problem !== null ? 'prob' : null].filter((c) => c !== null).join(' ');
  return (
    <li className={classes} data-key={line.key}>
      <span className="ln__q" dir="ltr">
        {qtyText(line, unitOf)}
      </span>
      <div className="ln__m" role="button" tabIndex={0} onClick={() => actions.toggle(line.key)} onKeyDown={(e) => (e.key === 'Enter' ? actions.toggle(line.key) : undefined)}>
        <b>{nameOf(config, line)}</b>
        {options !== null && <span>{options}</span>}
        {line.kitchen_note !== undefined && (
          <span className="nt" dir="auto">
            <Glyph d={NOTE} />“{line.kitchen_note}”
          </span>
        )}
        {view.zone_name !== null && (
          <span className="bd c-ok">
            <Ico name="pin" />
            {view.zone_name}
          </span>
        )}
        {line.quantity === null && <span>{t('cart.weight_pending')}</span>}
      </div>
      <div className="ln__s">
        <span className="ln__p" dir={MONEY_DIR}>
          {price}
        </span>
        {view.zone_name === null && (
          <span className={view.eta_ms === null ? 'eta none' : view.moved ? 'eta moved' : 'eta'} dir="ltr">
            <Ico name="clock" />
            {view.eta_ms === null ? '—' : <span className="num">{timeText(view.eta_ms, utcOffsetMs)}</span>}
          </span>
        )}
      </div>
      {view.problem !== null && (
        <div className="ln__prob">
          <span className="why">
            <Ico name="warn" />
            {whyText(view.problem)}
          </span>
          {view.problem.kind === 'only_left' && (
            <button type="button" className="btn" onClick={() => actions.setUnits(line.key, (view.problem as { n: number }).n)}>
              {fill(t('cart.prob.set_to'), { n: String(view.problem.n) })}
            </button>
          )}
          <button type="button" className="btn btn--icon" aria-label={t('cart.remove')} onClick={() => actions.remove(line.key)}>
            <Ico name="x" />
          </button>
        </div>
      )}
      {view.open && view.problem === null && (
        <div className="ln__ctrl">
          {piece && (
            <span className="step" role="group" aria-label={t('cart.quantity')}>
              <button type="button" aria-label={t('cart.less')} disabled={(line.quantity ?? 1) <= 1} onClick={() => actions.setUnits(line.key, (line.quantity ?? 1) - 1)}>
                <Glyph d={MINUS} />
              </button>
              <output className="num">{line.quantity}</output>
              <button
                type="button"
                aria-label={t('cart.more')}
                disabled={view.cap !== null && (line.quantity ?? 0) >= view.cap}
                onClick={() => actions.setUnits(line.key, (line.quantity ?? 0) + 1)}
              >
                <Glyph d={PLUS} />
              </button>
            </span>
          )}
          <button type="button" className="btn" onClick={() => actions.edit(line.key)}>
            <Glyph d={PEN} />
            {t('cart.edit')}
          </button>
          <button type="button" className="btn btn--quiet ln__rm" aria-label={t('cart.remove')} onClick={() => actions.remove(line.key)}>
            <Ico name="x" />
          </button>
        </div>
      )}
    </li>
  );
}
