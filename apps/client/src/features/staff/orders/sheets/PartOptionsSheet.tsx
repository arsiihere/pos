import { optionChargeMinor } from '@pos/domain';
import type { BranchConfig, ConfigModifierGroup } from '@pos/events';
import { useRef, useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { CloseX, Dialog } from '../../../alerts/ui';
import { MONEY_DIR, money } from '../money';
import type { CartOption, UnitOf } from '../order-screen/cart';
import { groupsOf, partViolations } from './preselect';

// Owner ruling Q-64 (a), 01c V9 (02b §8 Ordering screen, deal sheet): a deal part offers its item's **plain** options —
// a group without plain options is not offered in a child position, and a linked option never is. Validity is the
// hub's `checkOptionChoices(…, 'child', { quantity: part qty × deal qty, sale_unit })` (build-submit.ts dealLines).
// A chip shows the charge it adds to this deal (§3.4.3 B2: per piece of a piece part, once per deal for a g / ml
// part), from `optionChargeMinor`; the deal sheet's total carries it (cart.ts cartLineMoney).

export interface PartOptionsSheetProps {
  config: BranchConfig;
  unitOf: UnitOf;
  item_id: string;
  /** part quantity × deal quantity */
  quantity: number;
  dealQty: number;
  initial: CartOption[];
  sheet: boolean;
  onDone(options: CartOption[]): void;
  onClose(): void;
}

export function PartOptionsSheet(p: PartOptionsSheetProps) {
  const item = p.config.items.find((i) => i.item_id === p.item_id);
  // V9: only groups with plain options, only their plain options
  const groups: ConfigModifierGroup[] =
    item === undefined
      ? []
      : groupsOf(p.config, item)
          .filter((g) => g.has_plain_options)
          .map((g) => ({ ...g, options: g.options.filter((o) => o.linked_item_id === null) }));
  const offered = new Set(groups.flatMap((g) => g.options.map((o) => o.option_id)));
  // start from what the menu still offers: an option a menu change removed is dropped, and said so
  const [options, setOptions] = useState<CartOption[]>(() => p.initial.filter((o) => o.order_item_id === undefined && offered.has(o.option_id)));
  const [dropped] = useState(() => p.initial.some((o) => !offered.has(o.option_id)));
  const [full, setFull] = useState<string | null>(null);
  const done = useRef(false);
  if (item === undefined) return null;
  const unit = p.unitOf(item.item_id) ?? item.sale_unit;
  const violations = partViolations(p.config, p.unitOf, item.item_id, p.quantity, options);
  const below = violations.find((v) => v.reason === 'below_min');
  const belowGroup = below === undefined ? undefined : groups.find((g) => g.modifier_group_id === below.modifier_group_id);
  const optionParent = unit === 'piece' ? p.quantity : p.dealQty;
  const tap = (g: ConfigModifierGroup, option_id: string) => {
    const option = g.options.find((o) => o.option_id === option_id)!;
    const had = options.find((o) => o.option_id === option_id);
    const rest = options.filter((o) => o.option_id !== option_id);
    const groupTotal = options.filter((o) => g.options.some((x) => x.option_id === o.option_id)).reduce((n, o) => n + o.quantity, 0);
    setFull(null);
    if (g.max_choices === 1 && had === undefined) return setOptions([...rest.filter((o) => !g.options.some((x) => x.option_id === o.option_id)), { option_id, quantity: 1 }]);
    if (had === undefined) {
      // a full multi-choice group takes no more: say which group and its limit
      if (groupTotal >= g.max_choices) return setFull(g.modifier_group_id);
      return setOptions([...rest, { option_id, quantity: 1 }]);
    }
    setOptions(had.quantity < option.max_quantity && groupTotal < g.max_choices ? options.map((o) => (o.option_id === option_id ? { ...o, quantity: o.quantity + 1 } : o)) : rest);
  };
  return (
    <Dialog sheet={p.sheet} labelledBy="part-t" onClose={p.onClose} className="dlg--w">
      <div className="dlg__h">
        <div className="dlg__t">
          <h2 id="part-t">{item.name}</h2>
          <div className="ac__who">{fill(t('deal.part_options_sub'), { n: unit === 'piece' ? String(p.quantity) : `${p.quantity} ${unit}` })}</div>
        </div>
        <CloseX onClose={p.onClose} />
      </div>
      <div className="dlg__b">
        {dropped && (
          <div className="msg c-warn" role="status">
            <span>{t('deal.options_dropped')}</span>
          </div>
        )}
        {full !== null && (
          <div className="msg c-warn" role="alert">
            <span>{fill(t('opt.group_full'), { n: String(groups.find((g) => g.modifier_group_id === full)?.max_choices ?? ''), group: groups.find((g) => g.modifier_group_id === full)?.name ?? '' })}</span>
          </div>
        )}
        {groups.map((g) => {
          const n = options.filter((o) => g.options.some((x) => x.option_id === o.option_id)).reduce((s, o) => s + o.quantity, 0);
          const rule = g.min_choices > 0 ? fill(t('opt.choose'), { n: String(g.min_choices) }) : fill(t('opt.up_to'), { n: String(g.max_choices) });
          return (
            <div className="opt" key={g.modifier_group_id}>
              <div className="opt__h">
                <b>{g.name}</b>
                <span className={g.min_choices === 0 ? 'rule' : n >= g.min_choices ? 'rule ok' : 'rule need'}>{rule}</span>
              </div>
              <div className="chips">
                {g.options.map((o) => {
                  const picked = options.find((x) => x.option_id === o.option_id);
                  const charge = optionChargeMinor(o.price_minor, 1, optionParent, 'piece');
                  return (
                    <button key={o.option_id} type="button" className="chip" aria-pressed={picked !== undefined} onClick={() => tap(g, o.option_id)}>
                      {o.name}
                      {charge > 0 && (
                        <small dir={MONEY_DIR}>
                          {' '}+{money(charge)}
                        </small>
                      )}
                      {picked !== undefined && picked.quantity > 1 && <span className="num"> ×{picked.quantity}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="acts">
        <button type="button" className="btn" onClick={p.onClose}>
          {t('note.cancel')}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={violations.length > 0}
          onClick={() => {
            if (done.current || violations.length > 0) return;
            done.current = true;
            p.onDone(options);
          }}
        >
          {violations.length === 0 ? t('deal.options_done') : belowGroup !== undefined ? fill(t('opt.choose_missing'), { n: String(belowGroup.min_choices), group: belowGroup.name }) : t('opt.fix')}
        </button>
      </div>
    </Dialog>
  );
}
