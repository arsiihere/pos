// 02b v1.0.20 §3.2 step 4a (STAB-5; proposal docs/plans/stab-b2-unit-split-proposal.md): a cart line with
// line_kind 'item', quantity n > 1, the day sale unit 'piece', not requires_weighing, not from_zone, whose routed
// station is a slot station, becomes n lines of quantity 1, so 03a places each unit in the next free unit of the
// station (03a AD-4 holds a multi-unit line until all its units are free together, and later lines push it back).
// Part 1 keeps the cart's order_item_id, part k is `<id>-p<k>`; a linked option's child likewise. Every part carries
// part_of = part 1's id (a child: part 1's child id). Pure: runs before buildSubmit in SubmitOrder and eta-preview.
// An unknown item is left as it is (buildSubmit refuses it).
// ⚠️ 02b v1.0.23 §3.2 step 4a (STAB-6; 03a v1.2.10 BQ-6, To 02 #12): a piece line routed to a **batch** station is split
// per unit too, so the tandoor fills a round's free spots first and the rest goes into the next round (was: slot only).
import type { BranchConfig } from '@pos/events';
import { zoneOf } from './build-submit.js';
import type { BuildSubmitCtx, SubmitInput } from './contracts.js';

type Line = SubmitInput['lines'][number];

export const partId = (order_item_id: string, k: number): string => (k === 1 ? order_item_id : `${order_item_id}-p${k}`);

export function expandParts(config: BranchConfig, input: SubmitInput, ctx: Pick<BuildSubmitCtx, 'draws' | 'primary_table_id'>): SubmitInput {
  const zone = zoneOf(config, input, ctx.primary_table_id);
  const stationType = new Map(config.stations.map((s) => [s.station_id, s.station_type]));
  // a piece item (not weighed) whose routed station is one of `types`
  const routedTo = (item_id: string, types: ReadonlySet<string>): boolean => {
    const item = config.items.find((i) => i.item_id === item_id);
    if (item === undefined || item.requires_weighing || ctx.draws(item.item_id).sale_unit !== 'piece') return false;
    // §3.10 / O4: the zone route of the primary table's zone (dine-in), else the branch route — as buildSubmit routes
    const station_id = zone?.routes.find((r) => r.item_id === item.item_id)?.station_id ?? item.station_id;
    const type = stationType.get(station_id);
    return type !== undefined && types.has(type);
  };
  const SLOT: ReadonlySet<string> = new Set(['slot']);
  const SLOT_OR_BATCH: ReadonlySet<string> = new Set(['slot', 'batch']);
  const splits = (line: Line): number => {
    const n = line.quantity ?? 1;
    if (n <= 1 || line.from_zone === true) return 1;
    // ⚠️ 02b v1.0.22 (phase 5): a deal is split per deal unit when a chosen part cooks on a slot station
    if (line.deal_id !== undefined) return (line.deal_choices ?? []).some((c) => routedTo(c.item_id, SLOT)) ? n : 1;
    if (line.item_id === undefined) return 1;
    return routedTo(line.item_id, SLOT_OR_BATCH) ? n : 1;
  };
  const optionParts = (options: Line['options'], k: number): Line['options'] =>
    options?.map((o) => (o.order_item_id === undefined ? o : { ...o, order_item_id: partId(o.order_item_id, k), part_of: o.order_item_id }));
  const lines = input.lines.flatMap((line): Line[] => {
    const n = splits(line);
    if (n === 1) return [line];
    return Array.from({ length: n }, (_, i) => ({
      ...line,
      order_item_id: partId(line.order_item_id, i + 1),
      quantity: 1,
      part_of: line.order_item_id,
      ...(line.options === undefined ? {} : { options: optionParts(line.options, i + 1) }),
      ...(line.deal_choices === undefined
        ? {}
        : {
            deal_choices: line.deal_choices.map((c) => ({
              ...c,
              order_item_id: partId(c.order_item_id, i + 1),
              part_of: c.order_item_id,
              ...(c.options === undefined ? {} : { options: optionParts(c.options, i + 1) }),
            })),
          }),
    }));
  });
  return { ...input, lines };
}
