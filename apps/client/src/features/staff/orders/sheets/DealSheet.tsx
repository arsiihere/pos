import { checkOptionChoices, isItemOrderable, type IsAvailable } from '@pos/domain';
import type { BranchConfig, ConfigDeal } from '@pos/events';
import { useRef, useState } from 'react';
import { t, type MessageKey } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { CloseX, Dialog, Ico } from '../../../alerts/ui';
import { itemAvailability, type AvailabilityInputs } from '../live/availability';
import { MONEY_DIR, money } from '../money';
import { cartLineMoney, type CartDealChoice, type CartLine, type CartOption, type UnitOf } from '../order-screen/cart';
import { KITCHEN_NOTE_MAX, NoteSheet } from './NoteSheet';
import { defaultOptions, groupsOf } from './preselect';

// 02b-D30 deal sheet (handoff Deal; 02b §8 Ordering screen, 01c §3.4.3–§3.4.4): one card per part ("1× Main",
// "4× Bread"), its choices as chips with the extra price, a choice that cannot be ordered for the part's quantity
// (sold out, off, not now) off with its reason; a rule pill per part; Add says what is missing. A part with one
// orderable choice is chosen already. A choice takes its item's default plain options (child position, V9). The
// price is the deal's orderLineTotalMinor (cart.ts), so extras and part option charges are in it.

export interface DealSheetProps {
  config: BranchConfig;
  inputs: AvailabilityInputs | null;
  /** 01c V20: the day-frozen sale unit (the stock mirror's) */
  unitOf: UnitOf;
  deal_id: string;
  initial: CartLine | null;
  sheet: boolean;
  newKey(): string;
  onAdd(line: CartLine): void;
  onClose(): void;
}

/** Why a part's choice cannot go in this deal at this quantity, or null when the hub would take it. */
export type ChoiceProblem = 'off' | 'not_now' | 'not_counted' | 'sold_out' | 'needs_options';

/**
 * The hub's checks of a deal part (build-submit.ts dealLines): `checkSellable(item, part qty × deal qty, 'child')` —
 * manual Off, hours, `isItemOrderable` in the **child** position (01c V9: a group with no plain options is not offered
 * there) — then `checkOptionChoices(…, choice.options, 'child', …)` on the options the part carries (its item's plain
 * defaults; owner Q-64 is open on letting a part pick them), then the engine's stock (sold_out items).
 */
export function choiceProblem(config: BranchConfig, inputs: AvailabilityInputs | null, unitOf: UnitOf, item_id: string, quantity: number, options: CartOption[]): ChoiceProblem | null {
  const item = config.items.find((i) => i.item_id === item_id);
  if (item === undefined) return 'off';
  const base = (id: string, q: number): ChoiceProblem | null => {
    if (inputs === null) return null;
    const it = config.items.find((i) => i.item_id === id);
    if (it === undefined) return 'off';
    const state = itemAvailability(id, inputs).state.kind;
    // `unavailable` is the line-position group check; the child position is checked below
    if (state === 'off' || state === 'not_now') return state;
    if (it.out_of_stock_behaviour === 'sold_out') {
      const left = inputs.stock.available(id);
      if (inputs.stock.level(id) === 'not_counted') return 'not_counted';
      if (left !== null && left < q) return 'sold_out';
    }
    return null;
  };
  const own = base(item_id, quantity);
  if (own !== null) return own;
  const groupsById = Object.fromEntries(config.modifier_groups.map((g) => [g.modifier_group_id, g]));
  const itemsById = Object.fromEntries(config.items.map((i) => [i.item_id, i]));
  const isAvailable: IsAvailable = (id, q) => base(id, q) === null;
  if (!isItemOrderable(item, groupsById, itemsById, 'child', quantity, isAvailable)) return 'needs_options';
  const groups = groupsOf(config, item);
  const chosen = options.flatMap((o) => {
    const g = groups.find((x) => x.options.some((y) => y.option_id === o.option_id));
    return g === undefined ? [] : [{ modifier_group_id: g.modifier_group_id, option_id: o.option_id, quantity: o.quantity }];
  });
  const unit = unitOf(item_id) ?? item.sale_unit;
  return checkOptionChoices(groups, chosen, 'child', { quantity, sale_unit: unit }, groupsById, itemsById, isAvailable).length === 0 ? null : 'needs_options';
}

const REASON: Record<ChoiceProblem, MessageKey> = {
  off: 'menu.not_available',
  not_now: 'opt.reason.not_now',
  not_counted: 'menu.not_counted',
  sold_out: 'opt.reason.sold_out',
  needs_options: 'deal.needs_options',
};

function sorted(deal: ConfigDeal) {
  return [...deal.parts].sort((a, b) => a.sort_order - b.sort_order);
}

export function DealSheet(p: DealSheetProps) {
  // the screen closes the sheet when a menu change removed the deal (it never renders us without it)
  const deal = p.config.deals.find((d) => d.deal_id === p.deal_id)!;
  const added = useRef(false);
  const defaultsOf = (item_id: string) => {
    const item = p.config.items.find((i) => i.item_id === item_id);
    return item === undefined ? [] : defaultOptions(p.config, item, p.newKey, true);
  };
  const problemOf = (item_id: string, quantity: number, options: CartOption[] = defaultsOf(item_id)) => choiceProblem(p.config, p.inputs, p.unitOf, item_id, quantity, options);
  const choiceFor = (deal_part_id: string, item_id: string): CartDealChoice => {
    const options = defaultsOf(item_id);
    return { deal_part_id, item_id, order_item_id: p.newKey(), ...(options.length === 0 ? {} : { options }) };
  };
  const [qty, setQty] = useState(p.initial?.quantity ?? 1);
  const [note, setNote] = useState<string | undefined>(p.initial?.kitchen_note);
  const [noteOpen, setNoteOpen] = useState(false);
  const [choices, setChoices] = useState<CartDealChoice[]>(() => {
    if (p.initial?.deal_choices !== undefined) return p.initial.deal_choices;
    return sorted(deal).flatMap((part) => {
      const ok = part.choices.filter((c) => problemOf(c.item_id, part.quantity) === null);
      if (ok.length !== 1) return [];
      return [choiceFor(part.deal_part_id, ok[0]!.item_id)];
    });
  });
  const pick = (deal_part_id: string, item_id: string) => setChoices((cur) => [...cur.filter((c) => c.deal_part_id !== deal_part_id), choiceFor(deal_part_id, item_id)]);
  const parts = sorted(deal);
  // a menu change: a choice no longer offered by its part is dropped, so its part asks again
  const live = choices.filter((c) => parts.some((part) => part.deal_part_id === c.deal_part_id && part.choices.some((x) => x.item_id === c.item_id)));
  const partOk = (part: (typeof parts)[number]) => {
    const c = live.find((x) => x.deal_part_id === part.deal_part_id);
    return c !== undefined && problemOf(c.item_id, part.quantity * qty, c.options) === null;
  };
  const missing = parts.findIndex((part) => !partOk(part));
  const line: CartLine = {
    key: p.initial?.key ?? '',
    deal_id: deal.deal_id,
    quantity: qty,
    options: [],
    deal_choices: parts.flatMap((part) => live.filter((c) => c.deal_part_id === part.deal_part_id)),
    ...(note === undefined ? {} : { kitchen_note: note }),
  };
  const m = missing < 0 ? cartLineMoney(p.config, line, p.unitOf) : null;
  const total = m?.kind === 'ok' ? m.minor : null;
  const itemName = (id: string) => p.config.items.find((i) => i.item_id === id)?.name ?? '';

  if (noteOpen)
    return (
      <NoteSheet
        title={fill(t('note.kitchen_title'), { item: deal.name })}
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
  return (
    <Dialog sheet={p.sheet} labelledBy="deal-t" onClose={p.onClose} className="dlg--w">
      <div className="dlg__h">
        <div className="dlg__t">
          <h2 id="deal-t">{deal.name}</h2>
          <div className="ac__who" dir={MONEY_DIR}>
            {money(deal.price_minor)}
          </div>
        </div>
        <CloseX onClose={p.onClose} />
      </div>
      <div className="dlg__b">
        {parts.map((part, n) => {
          const chosen = live.find((c) => c.deal_part_id === part.deal_part_id);
          const done = partOk(part);
          return (
            <div className="dsh" key={part.deal_part_id}>
              <div className="dsh__h">
                <span className="q num">{part.quantity}×</span>
                <b>{fill(t('deal.part_n'), { n: String(n + 1) })}</b>
                <span className={done ? 'rule ok' : 'rule need'}>{done ? t('deal.done') : fill(t('opt.choose'), { n: '1' })}</span>
              </div>
              <div className="chips">
                {[...part.choices]
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((c) => {
                    const problem = problemOf(c.item_id, part.quantity * qty);
                    return problem === null ? (
                      <button key={c.item_id} type="button" className="chip" aria-pressed={chosen?.item_id === c.item_id} onClick={() => pick(part.deal_part_id, c.item_id)}>
                        {itemName(c.item_id)}
                        {c.extra_price_minor > 0 && (
                          <small dir={MONEY_DIR}>
                            {' '}+{money(c.extra_price_minor)}
                          </small>
                        )}
                      </button>
                    ) : (
                      <button key={c.item_id} type="button" className="chip" disabled>
                        <Ico name="x" />
                        {itemName(c.item_id)} · {t(REASON[problem])}
                      </button>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="qline">
        <span className="step" role="group" aria-label={t('cart.quantity')}>
          <button type="button" aria-label={t('cart.less')} disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))}>
            −
          </button>
          <output className="num">{qty}</output>
          <button type="button" aria-label={t('cart.more')} onClick={() => setQty((q) => q + 1)}>
            +
          </button>
        </span>
        <span className="pv">
          <strong className="num" dir={MONEY_DIR}>
            {total === null ? '—' : money(total)}
          </strong>
        </span>
      </div>
      <div className="acts">
        <button type="button" className="btn" onClick={() => setNoteOpen(true)}>
          {t('opt.kitchen_note')}
        </button>
        <button type="button" className="btn btn--primary" disabled={missing >= 0}
          onClick={() => {
            // one tap, one line: a second tap before the sheet closes adds nothing
            if (added.current || missing >= 0) return;
            added.current = true;
            p.onAdd({ ...line, key: p.initial?.key ?? p.newKey() });
          }}
        >
          {missing >= 0 ? fill(t('opt.choose_missing'), { n: '1', group: fill(t('deal.part_n'), { n: String(missing + 1) }) }) : t('opt.add')}
        </button>
      </div>
    </Dialog>
  );
}
