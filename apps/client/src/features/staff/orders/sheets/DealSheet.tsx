import { isItemOrderable, type IsAvailable } from '@pos/domain';
import type { BranchConfig, ConfigDeal } from '@pos/events';
import { useEffect, useRef, useState } from 'react';
import { t, type MessageKey } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { CloseX, Dialog, Ico } from '../../../alerts/ui';
import { itemAvailability, type AvailabilityInputs } from '../live/availability';
import { MONEY_DIR, money } from '../money';
import { cartLineMoney, type CartDealChoice, type CartLine, type CartOption, type UnitOf } from '../order-screen/cart';
import { KITCHEN_NOTE_MAX, NoteSheet } from './NoteSheet';
import { PartOptionsSheet } from './PartOptionsSheet';
import { defaultOptions, offersOptions, partViolations } from './preselect';

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
  /** a toast (the screen's): the open part picker's item left the menu */
  onNotice?(text: string): void;
}

/** Why a part's choice cannot go in this deal at this quantity, or null when the hub would take it. */
export type ChoiceProblem = 'off' | 'not_now' | 'not_counted' | 'sold_out' | 'needs_options';

/**
 * The hub's checks of a deal part's item (build-submit.ts dealLines): `checkSellable(item, part qty × deal qty,
 * 'child')` — manual Off, hours, `isItemOrderable` in the **child** position (01c V9: a group with no plain options is
 * not offered there) — and the engine's stock (sold_out items). The part's own options are `partViolations`.
 */
export function choiceProblem(config: BranchConfig, inputs: AvailabilityInputs | null, item_id: string, quantity: number): ChoiceProblem | null {
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
  return isItemOrderable(item, groupsById, itemsById, 'child', quantity, isAvailable) ? null : 'needs_options';
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
  const problemOf = (item_id: string, quantity: number) => choiceProblem(p.config, p.inputs, item_id, quantity);
  const optionsOk = (c: CartDealChoice, quantity: number) => partViolations(p.config, p.unitOf, c.item_id, quantity, c.options ?? []).length === 0;
  const choiceFor = (deal_part_id: string, item_id: string): CartDealChoice => {
    const options = defaultsOf(item_id);
    return { deal_part_id, item_id, order_item_id: p.newKey(), ...(options.length === 0 ? {} : { options }) };
  };
  const [qty, setQty] = useState(p.initial?.quantity ?? 1);
  const onNotice = useRef(p.onNotice);
  onNotice.current = p.onNotice;
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
  // Q-64: a part whose (auto-picked) choice's defaults leave a required group empty opens its options at once
  const [picking, setPicking] = useState<string | null>(() =>
    p.initial !== null ? null : (sorted(deal).find((part) => choices.some((c) => c.deal_part_id === part.deal_part_id && !optionsOk(c, part.quantity)))?.deal_part_id ?? null),
  );
  const pick = (deal_part_id: string, item_id: string, quantity: number) => {
    const had = choices.find((x) => x.deal_part_id === deal_part_id);
    // the chosen item again: its options (paid ones too) stay; only an unfilled one reopens its options
    if (had !== undefined && had.item_id === item_id) {
      setPicking(optionsOk(had, quantity) ? null : deal_part_id);
      return;
    }
    const c = choiceFor(deal_part_id, item_id);
    setChoices((cur) => [...cur.filter((x) => x.deal_part_id !== deal_part_id), c]);
    setPicking(optionsOk(c, quantity) ? null : deal_part_id);
  };
  const setPartOptions = (deal_part_id: string, options: CartOption[]) =>
    setChoices((cur) => cur.map((c) => (c.deal_part_id !== deal_part_id ? c : { deal_part_id: c.deal_part_id, item_id: c.item_id, order_item_id: c.order_item_id, ...(options.length === 0 ? {} : { options }) })));
  const parts = sorted(deal);
  // a menu change: a choice no longer offered by its part is dropped, so its part asks again
  const live = choices.filter((c) => parts.some((part) => part.deal_part_id === c.deal_part_id && part.choices.some((x) => x.item_id === c.item_id)));
  const partOk = (part: (typeof parts)[number]) => {
    const c = live.find((x) => x.deal_part_id === part.deal_part_id);
    return c !== undefined && problemOf(c.item_id, part.quantity * qty) === null && optionsOk(c, part.quantity * qty);
  };
  const missing = parts.findIndex((part) => !partOk(part));
  function pickingChoiceOf(id: string) {
    return live.find((c) => c.deal_part_id === id);
  }
  const missingOptions = missing >= 0 && (() => {
    const part = parts[missing]!;
    const c = live.find((x) => x.deal_part_id === part.deal_part_id);
    return c !== undefined && problemOf(c.item_id, part.quantity * qty) === null;
  })();
  // the open picker's item left the menu (or its part): back to the deal, which is kept, with a notice
  const stalePicking = picking !== null && !(pickingChoiceOf(picking) !== undefined && p.config.items.some((i) => i.item_id === pickingChoiceOf(picking)!.item_id));
  useEffect(() => {
    if (!stalePicking) return;
    setPicking(null);
    onNotice.current?.(t('sheet.changed'));
  }, [stalePicking]);
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

  const pickingPart = picking === null ? undefined : parts.find((x) => x.deal_part_id === picking);
  const pickingChoice = pickingPart === undefined ? undefined : live.find((c) => c.deal_part_id === pickingPart.deal_part_id);
  const pickingOk = pickingChoice !== undefined && p.config.items.some((i) => i.item_id === pickingChoice.item_id);
  if (pickingPart !== undefined && pickingChoice !== undefined && pickingOk)
    return (
      <PartOptionsSheet
        config={p.config}
        unitOf={p.unitOf}
        item_id={pickingChoice.item_id}
        quantity={pickingPart.quantity * qty}
        dealQty={qty}
        initial={pickingChoice.options ?? []}
        sheet={p.sheet}
        onDone={(options) => {
          setPartOptions(pickingPart.deal_part_id, options);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    );
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
          const needsOptions = chosen !== undefined && problemOf(chosen.item_id, part.quantity * qty) === null && !optionsOk(chosen, part.quantity * qty);
          const optionNames = (chosen?.options ?? []).map((o) => {
            const name = p.config.modifier_groups.flatMap((g) => g.options).find((x) => x.option_id === o.option_id)?.name;
            // an option a menu change removed is not named (the part asks for its options again)
            return name === undefined ? [] : [o.quantity > 1 ? `${name} ×${o.quantity}` : name];
          }).flat();
          return (
            <div className="dsh" key={part.deal_part_id}>
              <div className="dsh__h">
                <span className="q num">{part.quantity}×</span>
                <b>{fill(t('deal.part_n'), { n: String(n + 1) })}</b>
                <span className={done ? 'rule ok' : 'rule need'}>{done ? t('deal.done') : needsOptions ? t('deal.choose_options') : fill(t('opt.choose'), { n: '1' })}</span>
              </div>
              <div className="chips">
                {[...part.choices]
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((c) => {
                    const problem = problemOf(c.item_id, part.quantity * qty);
                    return problem === null ? (
                      <button key={c.item_id} type="button" className="chip" aria-pressed={chosen?.item_id === c.item_id} onClick={() => pick(part.deal_part_id, c.item_id, part.quantity * qty)}>
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
              {chosen !== undefined && offersOptions(p.config, chosen.item_id) && (
                <div className="dsh__opt">
                  {optionNames.length > 0 && <span className="muted">+ {optionNames.join(', ')}</span>}
                  <button type="button" className="btn btn--quiet" onClick={() => setPicking(part.deal_part_id)}>
                    {t('deal.options')}
                  </button>
                </div>
              )}
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
          {missing < 0
            ? t('opt.add')
            : missingOptions
              ? fill(t('deal.options_missing'), { part: fill(t('deal.part_n'), { n: String(missing + 1) }) })
              : fill(t('opt.choose_missing'), { n: '1', group: fill(t('deal.part_n'), { n: String(missing + 1) }) })}
        </button>
      </div>
    </Dialog>
  );
}
