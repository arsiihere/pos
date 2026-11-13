import { checkOptionChoices, type IsAvailable, type Violation } from '@pos/domain';
import type { BranchConfig, ConfigItem, ConfigModifierGroup } from '@pos/events';
import { useRef, useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { CloseX, Dialog, Ico } from '../../../alerts/ui';
import { itemAvailability, optionAvailability, type AvailabilityInputs, type OptionAvailability } from '../live/availability';
import { MONEY_DIR, money } from '../money';
import { cartLineMoney, type CartLine, type CartOption, type UnitOf } from '../order-screen/cart';
import { KITCHEN_NOTE_MAX, NoteSheet } from './NoteSheet';
import { defaultOptions, groupsOf } from './preselect';
import { WeightChoice, gramsOf, type WeightMode } from './WeightChoice';

// 02-D04 options sheet (handoff Options, OptionsUnmet, OptionsWeight, OptionsWeighLater; 02b §8 Ordering screen, §3.6;
// 01c §3.4.8): variant as a segmented control with prices; groups with a rule pill (green when met, orange when
// missing); option chips with "+Rs 40" and "×2"; a linked option that cannot be ordered now is off with its reason;
// defaults ticked; then quantity (or weight) + live price, Kitchen note · Add to order. Add is off while
// `checkOptionChoices` (@pos/domain, the hub's own check) finds a violation, and says what is missing.

export interface OptionsSheetProps {
  config: BranchConfig;
  inputs: AvailabilityInputs | null;
  /** 01c V20: the day-frozen sale unit (the stock mirror's), as the hub bills and checks the line */
  unitOf: UnitOf;
  /** one item, or the variants of a group (in sort order) */
  item_ids: string[];
  /** Edit: the line as it is; else a new line */
  initial: CartLine | null;
  /** Q-7: a preselection (by name) instead of the defaults */
  preset?: CartOption[] | null;
  from_zone?: boolean;
  /** the stepper's cap for an item (O15), from the screen */
  capOf(item_id: string): number | null;
  sheet: boolean;
  newKey(): string;
  onAdd(line: CartLine): void;
  onClose(): void;
}

const REASON_KEY = { off: 'menu.not_available', unavailable: 'menu.not_available', not_now: 'opt.reason.not_now', not_counted: 'menu.not_counted', sold_out: 'opt.reason.sold_out' } as const;

function ruleText(g: ConfigModifierGroup): string {
  return g.min_choices > 0 ? fill(t('opt.choose'), { n: String(g.min_choices) }) : fill(t('opt.up_to'), { n: String(g.max_choices) });
}

/** The words on a disabled Add: the first group below its minimum, else a generic "not available". */
function missingText(violations: Violation[], groups: ConfigModifierGroup[]): string {
  const below = violations.find((v) => v.reason === 'below_min');
  const g = below === undefined ? undefined : groups.find((x) => x.modifier_group_id === below.modifier_group_id);
  if (g !== undefined) return fill(t('opt.choose_missing'), { n: String(g.min_choices), group: g.name });
  // a ticked linked option the kitchen cannot make for this many (child quantity, 01c §3.4.2)
  const linked = violations.find((v) => v.reason === 'linked_not_orderable');
  const option = linked === undefined ? undefined : groups.flatMap((x) => x.options).find((o) => o.option_id === linked.option_id);
  if (option !== undefined) return `${option.name} · ${t('opt.reason.sold_out')}`;
  return t('opt.fix');
}

export function availableFn(inputs: AvailabilityInputs | null): IsAvailable {
  return (item_id, quantity) => {
    if (inputs === null) return true;
    const a = itemAvailability(item_id, inputs);
    return a.orderable && (a.cap === null || a.cap >= quantity);
  };
}

export function OptionsSheet(p: OptionsSheetProps) {
  // the screen closes the sheet when a menu change removed its item (it never renders us without one)
  const added = useRef(false);
  const items = p.item_ids.flatMap((id) => p.config.items.filter((i) => i.item_id === id));
  const startItem = items.find((i) => i.item_id === p.initial?.item_id) ?? items.find((i) => p.inputs === null || itemAvailability(i.item_id, p.inputs).orderable) ?? items[0]!;
  const [itemId, setItemId] = useState(startItem.item_id);
  const item: ConfigItem = items.find((i) => i.item_id === itemId) ?? startItem;
  const [options, setOptions] = useState<CartOption[]>(() => p.initial?.options ?? p.preset ?? defaultOptions(p.config, startItem, p.newKey));
  // the item is on the menu here, so the mirror always has a unit for it (the config's until seeded)
  const unit = p.unitOf(item.item_id) ?? item.sale_unit;
  const weighed = unit !== 'piece';
  const [units, setUnits] = useState(p.initial !== null && !weighed && p.initial.quantity !== null ? p.initial.quantity : 1);
  const [mode, setMode] = useState<WeightMode>(p.initial !== null && p.initial.quantity === null ? 'later' : 'now');
  const [text, setText] = useState(p.initial !== null && weighed && p.initial.quantity !== null ? String(p.initial.quantity / 1000) : '');
  const [note, setNote] = useState<string | undefined>(p.initial?.kitchen_note);
  const [noteOpen, setNoteOpen] = useState(false);

  const groups = groupsOf(p.config, item);
  const quantity: number | null = weighed ? (mode === 'later' && item.requires_weighing ? null : gramsOf(text)) : units;
  const weightOk = !weighed || (mode === 'later' && item.requires_weighing) || quantity !== null;
  const isAvailable = availableFn(p.inputs);
  const groupsById = Object.fromEntries(p.config.modifier_groups.map((g) => [g.modifier_group_id, g]));
  const itemsById = Object.fromEntries(p.config.items.map((i) => [i.item_id, i]));
  const groupOf = (option_id: string) => groups.find((g) => g.options.some((o) => o.option_id === option_id));
  const chosen = options.flatMap((o) => {
    const g = groupOf(o.option_id);
    return g === undefined ? [] : [{ modifier_group_id: g.modifier_group_id, option_id: o.option_id, quantity: o.quantity }];
  });
  const violations = weighed && quantity === null && !item.requires_weighing ? [] : checkOptionChoices(groups, chosen, 'line', { quantity: weighed ? quantity : units, sale_unit: unit }, groupsById, itemsById, isAvailable);
  const cap = p.capOf(item.item_id);
  const line: CartLine = {
    key: p.initial?.key ?? '',
    item_id: item.item_id,
    quantity,
    options: options.filter((o) => groupOf(o.option_id) !== undefined),
    ...(note === undefined ? {} : { kitchen_note: note }),
    ...(p.from_zone === true || p.initial?.from_zone === true ? { from_zone: true } : {}),
  };
  const m = cartLineMoney(p.config, line, p.unitOf);
  // a pending weight: its linked add-ons are billed now (as the cart line shows), the rest after weighing
  const priceText =
    m.kind === 'ok' ? money(m.minor) : m.kind === 'pending' ? (m.minor > 0 ? fill(t('weight.after_weighing_plus'), { amount: money(m.minor) }) : t('weight.after_weighing')) : '—';
  const canAdd = violations.length === 0 && weightOk && (cap === null || (quantity ?? 0) <= cap);

  const optionState = (option: ConfigModifierGroup['options'][number]): OptionAvailability => (p.inputs === null ? { on: true } : optionAvailability(option, p.inputs));
  const tap = (g: ConfigModifierGroup, option_id: string) => {
    const option = g.options.find((o) => o.option_id === option_id)!;
    setOptions((cur) => {
      const had = cur.find((o) => o.option_id === option_id);
      const rest = cur.filter((o) => o.option_id !== option_id);
      // a single-choice group is a radio: picking one drops the group's other picks
      if (g.max_choices === 1 && had === undefined) {
        const others = new Set(g.options.map((o) => o.option_id));
        return [...rest.filter((o) => !others.has(o.option_id)), { option_id, quantity: 1, ...(option.linked_item_id === null ? {} : { order_item_id: p.newKey() }) }];
      }
      if (had === undefined) return [...rest, { option_id, quantity: 1, ...(option.linked_item_id === null ? {} : { order_item_id: p.newKey() }) }];
      // ×2 … while the option and its group have room; else the tap takes it off (a choose-one group toggles)
      const groupTotal = cur.filter((o) => g.options.some((x) => x.option_id === o.option_id)).reduce((n, o) => n + o.quantity, 0);
      return had.quantity < option.max_quantity && groupTotal < g.max_choices ? cur.map((o) => (o.option_id === option_id ? { ...o, quantity: o.quantity + 1 } : o)) : rest;
    });
  };
  const switchItem = (id: string) => {
    const next = items.find((i) => i.item_id === id)!;
    setItemId(id);
    // options of groups the new variant does not have are dropped; its defaults fill groups left empty
    const keep = options.filter((o) => groupsOf(p.config, next).some((g) => g.options.some((x) => x.option_id === o.option_id)));
    const defaults = defaultOptions(p.config, next, p.newKey).filter((d) => {
      const g = groupsOf(p.config, next).find((x) => x.options.some((o) => o.option_id === d.option_id))!;
      return !keep.some((k) => g.options.some((o) => o.option_id === k.option_id));
    });
    setOptions([...keep, ...defaults]);
  };

  if (noteOpen)
    return (
      <NoteSheet
        title={fill(t('note.kitchen_title'), { item: item.name })}
        max={KITCHEN_NOTE_MAX}
        initial={note}
        sheet={p.sheet}
        onSave={(n) => {
          setNote(n);
          setNoteOpen(false);
        }}
        onClose={() => setNoteOpen(false)}
      />
    );
  const vgName = item.variant_group_id === null ? null : (p.config.variant_groups.find((v) => v.variant_group_id === item.variant_group_id)?.name ?? null);
  return (
    <Dialog sheet={p.sheet} labelledBy="opt-t" onClose={p.onClose} className={groups.length > 0 || items.length > 1 ? 'dlg--w' : undefined}>
      <div className="dlg__h">
        <div className="dlg__t">
          <h2 id="opt-t">{vgName ?? item.name}</h2>
          <div className="ac__who" dir="auto">
            {weighed ? `${money(item.price_minor)} ${t(unit === 'g' ? 'menu.per.kg' : 'menu.per.l')} · ${fill(t('weight.rounds'), { unit: unit === 'ml' ? 'ml' : 'g' })}` : money(item.price_minor)}
          </div>
        </div>
        <CloseX onClose={p.onClose} />
      </div>
      <div className="dlg__b">
        {items.length > 1 && (
          <div className="on-light">
            <div className="seg seg--fill seg--opt" role="radiogroup">
              {items.map((v) => {
                const off = p.inputs !== null && !itemAvailability(v.item_id, p.inputs).orderable;
                return (
                  <button key={v.item_id} type="button" aria-pressed={v.item_id === item.item_id} disabled={off} onClick={() => switchItem(v.item_id)}>
                    {v.variant_name ?? v.name}
                    <small dir={MONEY_DIR}>{money(v.price_minor)}</small>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {weighed && <WeightChoice mode={mode} text={text} unit={unit === 'g' ? 'kg' : 'L'} canLater={item.requires_weighing} onMode={setMode} onText={setText} />}
        {groups.map((g) => {
          const n = options.filter((o) => g.options.some((x) => x.option_id === o.option_id)).reduce((s, o) => s + o.quantity, 0);
          const met = n >= g.min_choices;
          return (
            <div className="opt" key={g.modifier_group_id}>
              <div className="opt__h">
                <b>{g.name}</b>
                <span className={g.min_choices === 0 ? 'rule' : met ? 'rule ok' : 'rule need'}>{ruleText(g)}</span>
              </div>
              <div className="chips">
                {g.options.map((o) => {
                  const picked = options.find((x) => x.option_id === o.option_id);
                  const state = optionState(o);
                  // ticked, but its linked item cannot be made for this many: the chip says why (it stays tappable)
                  const short = picked !== undefined && violations.some((v) => v.reason === 'linked_not_orderable' && v.option_id === o.option_id);
                  if (!state.on && picked === undefined)
                    return (
                      <button key={o.option_id} type="button" className="chip" disabled>
                        <Ico name="x" />
                        {o.name} · {t(REASON_KEY[state.reason])}
                      </button>
                    );
                  return (
                    <button key={o.option_id} type="button" className="chip" aria-pressed={picked !== undefined} onClick={() => tap(g, o.option_id)}>
                      {o.name}
                      {o.price_minor > 0 && (
                        <small dir={MONEY_DIR}>
                          {' '}+{money(o.price_minor)}
                        </small>
                      )}
                      {picked !== undefined && picked.quantity > 1 && <span className="num"> ×{picked.quantity}</span>}
                      {short && <> · {t(state.on ? 'opt.reason.sold_out' : REASON_KEY[state.reason])}</>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="qline">
        {weighed ? (
          <b dir="auto">{quantity === null ? `${item.name} · ${money(item.price_minor)} ${t(unit === 'g' ? 'menu.per.kg' : 'menu.per.l')}` : `${quantity / 1000} ${unit === 'g' ? 'kg' : 'L'} × ${money(item.price_minor)}`}</b>
        ) : (
          <span className="step" role="group" aria-label={t('cart.quantity')}>
            <button type="button" aria-label={t('cart.less')} disabled={units <= 1} onClick={() => setUnits((u) => Math.max(1, u - 1))}>
              −
            </button>
            <output className="num">{units}</output>
            <button type="button" aria-label={t('cart.more')} disabled={cap !== null && units >= cap} onClick={() => setUnits((u) => u + 1)}>
              +
            </button>
          </span>
        )}
        <span className="pv">
          <strong className="num" dir={MONEY_DIR}>
            {priceText}
          </strong>
        </span>
      </div>
      <div className="acts">
        <button type="button" className="btn" onClick={() => setNoteOpen(true)}>
          {t('opt.kitchen_note')}
        </button>
        <button type="button" className="btn btn--primary" disabled={!canAdd}
          onClick={() => {
            // one tap, one line: a second tap before the sheet closes adds nothing
            if (added.current || !canAdd) return;
            added.current = true;
            p.onAdd({ ...line, key: p.initial?.key ?? p.newKey() });
          }}
        >
          {canAdd || violations.length === 0 ? t('opt.add') : missingText(violations, groups)}
        </button>
      </div>
    </Dialog>
  );
}
