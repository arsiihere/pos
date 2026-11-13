import { describe, expect, it } from 'vitest';
import type { SeatingLine } from '../contracts';
import { atStageOne, isReady, isServed, lineBadges, lineStage, optionsText, readyCount, servable, stageText } from './stage';

// 02b v1.0.11 §8 Table view (frame Stages, Q4): every line stage is an icon + a word + a colour.

const OFFSET = 5 * 3_600_000; // the hub's zone (PKT)
const AT_828_PM = Date.UTC(2026, 10, 13, 15, 28); // 8:28 PM in the hub's zone

function sline(over: Partial<SeatingLine> = {}): SeatingLine {
  return {
    order_item_id: 'L1',
    order_id: 'O1',
    parent_order_item_id: null,
    line_kind: 'item',
    item_id: 'I1',
    deal_id: null,
    name: 'Seekh Kebab',
    sale_unit: 'piece',
    quantity: 4,
    units: 4,
    live_units: 4,
    comped_units: 0,
    removed_units: 0,
    voided_units: 0,
    returned_units: 0,
    refundable_minor: 140_000,
    comp_minor: 0,
    comp_voided_minor: 0,
    removed_minor: 0,
    refund_minor: 0,
    line_total_minor: 140_000,
    billed_minor: 140_000,
    return_of: null,
    served_from_zone_id: null,
    zone_served: false,
    added_at: AT_828_PM - 20 * 60_000,
    served_at: null,
    served_source: null,
    is_food: true,
    kitchen_note: null,
    stage: 'added',
    fired: false,
    ...over,
  };
}

const word = (line: SeatingLine) => {
  const s = lineStage(line);
  return s === null ? null : { text: stageText(s, OFFSET), tone: s.tone, icon: s.icon };
};

describe('[02b §8 Table view] line stages', () => {
  it('[02b §8 Table view] stages in words, icon + word (Stages)', () => {
    expect(word(sline({ stage: 'added', fired: false }))).toEqual({ text: 'Later', tone: 'mute', icon: 'clock' });
    expect(word(sline({ stage: 'added', fired: true }))).toEqual({ text: 'Sent to kitchen', tone: 'info', icon: 'send' });
    expect(word(sline({ stage: 'cooking', fired: true }))).toEqual({ text: 'Cooking', tone: 'warn', icon: 'pulse' });
    expect(word(sline({ stage: 'done', fired: true }))).toEqual({ text: 'Ready', tone: 'ok', icon: 'checkc' });
    expect(word(sline({ stage: 'served', fired: true, served_at: AT_828_PM }))).toEqual({ text: 'Served · 8:28 PM', tone: 'mute', icon: 'check' });
    expect(word(sline({ stage: 'returned', fired: true, served_at: AT_828_PM, returned_units: 4 }))).toEqual({ text: 'Sent back', tone: 'danger', icon: 'undo' });
    // served more than 30 min ago: the order left the engine (E-7)
    expect(word(sline({ stage: 'out_of_engine', served_at: AT_828_PM }))).toEqual({ text: 'Served · closed', tone: 'mute', icon: 'lock' });
    // an abandoned order's unserved line (O16): still servable
    expect(word(sline({ stage: 'out_of_engine', served_at: null }))).toEqual({ text: 'Not tracked', tone: 'mute', icon: 'info' });
    expect(word(sline({ stage: null, zone_served: true, served_at: AT_828_PM, served_source: 'zone' }))).toEqual({
      text: 'From the counter · Served',
      tone: 'ok',
      icon: 'tray',
    });
    // no station: never in the engine
    expect(word(sline({ stage: null }))).toEqual({ text: 'No kitchen — serve when ready', tone: 'mute', icon: 'info' });
    expect(word(sline({ quantity: null, sale_unit: 'g', units: 1, live_units: 1, line_total_minor: null, billed_minor: 0, refundable_minor: 0 }))).toEqual({
      text: 'Weight pending',
      tone: 'warn',
      icon: 'warn',
    });
    // a deal header's stage lives in its parts; a no-station option child follows its parent; a removed line has its badge
    expect(word(sline({ line_kind: 'deal', stage: null }))).toBeNull();
    expect(word(sline({ line_kind: 'option_child', parent_order_item_id: 'L0', stage: null }))).toBeNull();
    expect(word(sline({ live_units: 0, removed_units: 4, stage: 'removed' }))).toBeNull();

    expect(lineBadges(sline({ comped_units: 1 }))).toEqual([{ text: 'Comped ×1', tone: 'brand', icon: 'checkc' }]);
    expect(lineBadges(sline({ live_units: 0, removed_units: 4 }))).toEqual([{ text: 'Removed', tone: 'mute', icon: 'x' }]);
    expect(lineBadges(sline({ return_of: 'L0' }))).toEqual([{ text: 'Replacement', tone: 'info', icon: 'repeat' }]);
  });

  it('[02b §3.5, §3.7] servable, ready and stage-1 lines', () => {
    expect(servable(sline({ stage: 'added', fired: false }))).toBe(false);
    expect(servable(sline({ stage: 'added', fired: true }))).toBe(true);
    expect(servable(sline({ stage: 'done', fired: true }))).toBe(true);
    expect(servable(sline({ stage: 'served', fired: true, served_at: AT_828_PM }))).toBe(false);
    expect(servable(sline({ stage: 'out_of_engine' }))).toBe(true);
    expect(servable(sline({ stage: null }))).toBe(true);
    expect(servable(sline({ line_kind: 'deal', stage: null }))).toBe(false);
    expect(servable(sline({ live_units: 0, removed_units: 4, stage: 'removed', fired: true }))).toBe(false);
    expect(isReady(sline({ stage: 'done' }))).toBe(true);
    expect(isServed(sline({ served_at: AT_828_PM }))).toBe(true);

    const deal = sline({ order_item_id: 'D', line_kind: 'deal', stage: null });
    const part = (stage: SeatingLine['stage']) => sline({ order_item_id: `P-${String(stage)}`, line_kind: 'deal_part', parent_order_item_id: 'D', stage });
    expect(atStageOne(sline({ stage: 'added', fired: true }), [])).toBe(true);
    expect(atStageOne(sline({ stage: 'cooking' }), [])).toBe(false);
    expect(atStageOne(deal, [deal, part('added'), part('added')])).toBe(true);
    expect(atStageOne(deal, [deal, part('added'), part('cooking')])).toBe(false);

    // ready n / m (02b §6.16 AD-39 R3): deal headers left out, a line is ready when served or done
    expect(readyCount([deal, part('done'), part('added'), sline({ order_item_id: 'X', served_at: AT_828_PM, stage: 'served' })])).toEqual({ n: 2, m: 3 });
  });

  it('[02b §3.5] Remove follows the hub rule: an unserved no-station line and a deal with a no-station part are stage 1', () => {
    // a drink with no station: never in the engine (stage null)
    expect(atStageOne(sline({ stage: null, served_at: null }), [])).toBe(true);
    expect(atStageOne(sline({ stage: null, served_at: AT_828_PM }), [])).toBe(false);
    // an order out of the engine (abandoned / exited) → out_of_engine
    expect(atStageOne(sline({ stage: 'out_of_engine' }), [])).toBe(false);
    const deal = sline({ order_item_id: 'D', line_kind: 'deal', stage: null });
    const drink = sline({ order_item_id: 'P1', line_kind: 'deal_part', parent_order_item_id: 'D', stage: null });
    const handi = sline({ order_item_id: 'P2', line_kind: 'deal_part', parent_order_item_id: 'D', stage: 'added' });
    expect(atStageOne(deal, [deal, drink, handi])).toBe(true);
    expect(atStageOne(deal, [deal, { ...drink, served_at: AT_828_PM }, handi])).toBe(false);
    // an item whose option child (own station) is cooking: the cascade would be refused
    const karahi = sline({ order_item_id: 'K', stage: 'added' });
    const extra = sline({ order_item_id: 'X', line_kind: 'option_child', parent_order_item_id: 'K', stage: 'cooking' });
    expect(atStageOne(karahi, [karahi, extra])).toBe(false);
  });

  it('[02b §6.15] optionsText joins the plain options, ×n above 1', () => {
    expect(optionsText(sline({ options: [{ name: 'No onion', quantity: 1 }, { name: 'Less spicy', quantity: 1 }] }))).toBe('+ No onion · Less spicy');
    expect(optionsText(sline({ options: [{ name: 'Extra raita', quantity: 2 }] }))).toBe('+ Extra raita ×2');
    expect(optionsText(sline({ options: [] }))).toBeNull();
    expect(optionsText(sline())).toBeNull();
  });
});
