// Lane T1, task t1 — 04 §10 test 46 (K-6 raised bar; H1-5, H2-9, H3-12): 500 seeded random sequences of comp / remove /
// void / weight (and kitchen stage moves) over random items, option children and deals, through the hub's REAL
// commands (CompLine, RemoveItems, VoidItems direct, SetLineWeight; the Manager holds every grant `allowed`). After
// every step the `orders` projection is read and checked against the §10 invariants and against an INDEPENDENT
// unit-by-unit model kept here: each unit of each line is a slot holding its share, in one of the states live /
// comped / removed / voided / comp_voided. The model never calls 02b's ledger (planVoid, lineShares, cascadeUnits…);
// it restates the rules from 01c §3.4.8 and 02b §3.4 in its own terms:
//   - shares: floor(refundable / units) per unit, the remainder on the last slot;
//   - the k-th unit to leave billing (comp, or an uncomped remove / void) takes the next free slot;
//   - remove / void take uncomped live units first, then comped ones, the largest share first (the remainder);
//     a voided comped unit's share is comp_voided (never a refund, O21), a removed one's is removed;
//   - cascades: per parent unit `child units / parent units` child units, capped at the child's live units (live −
//     comped for a comp); the parent's last (uncomped, for a comp) live unit takes every child unit left;
//   - billed: item / option child = Σ live-slot shares; deal part = 0; deal = line total − Σ its parts' shares out.
// Deterministic: a fixed seed (mulberry32), no Math.random, no timing asserts. A refused command must append nothing.
import { lineTotalMinor } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import type { BranchConfig } from '@pos/events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LineView } from '../../src/orders/contracts';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import type { TestHub } from '../helpers/test-hub';
import { appendOrder, FX, signIn, STAFF, toStage, type FixtureLine, type Reply, type Who } from './fixtures';
import { compLine, linesOf, moneyMenu, MX, removeItems, setWeight, startMoney, voidItems } from './money.fixtures';

const SEED = 0x04_46_2026;
const SEQUENCES = 500;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// ------------------------------------------------------------------------------------------- the independent model

type SlotState = 'live' | 'comped' | 'removed' | 'voided' | 'comp_voided';
interface Slot {
  share: number;
  state: SlotState;
}
interface ModelLine {
  id: string;
  kind: LineView['line_kind'];
  parent: string | null;
  units: number;
  /** deal: the line total (its own slots hold 0) */
  line_total: number;
  slots: Slot[];
  /** index of the next slot to leave billing */
  next: number;
  /** a weighed g item whose weight is pending, then weighed */
  weighed: { price: number } | null;
}

/** 01c §3.4.8 shares: floor per unit, the remainder on the last. */
function shares(total: number, units: number): number[] {
  const q = Math.floor(total / units);
  return Array.from({ length: units }, (_, i) => (i === units - 1 ? total - q * (units - 1) : q));
}

/** A line as the model starts it: from the fixture and moneyMenu()'s prices, never from the projection. */
interface StartLine {
  id: string;
  kind: LineView['line_kind'];
  parent: string | null;
  units: number;
  /** item: price × quantity; option child: option price × child units; deal part: its share of the deal total; deal 0 */
  refundable: number;
  /** deal: deal price × quantity */
  line_total: number;
  weighed: { price: number } | null;
}

/**
 * 01c §3.4.2–§3.4.4 restated: units (item quantity, option qty × parent quantity, deal quantity, part quantity × deal
 * quantity; a weighed g item 1 unit with 0 until weighed) and refundable amounts from the menu's prices. A deal's
 * total is split over its parts pro rata by weight (reference item price × part quantity × deal quantity), floor
 * for every part but the last, the last the remainder (01c V11 c). All generator lines are piece lines.
 */
function startLines(fixture: readonly FixtureLine[], menu: BranchConfig): StartLine[] {
  const item = (id: string | undefined) => menu.items.find((i) => i.item_id === id)!;
  const out: StartLine[] = [];
  for (const f of fixture) {
    const parent = f.parent_order_item_id === undefined ? null : out.find((o) => o.id === f.parent_order_item_id)!;
    const base = { id: f.order_item_id, parent: parent?.id ?? null, line_total: 0, weighed: null };
    if (f.option_id !== undefined) {
      const option = menu.modifier_groups.flatMap((g) => g.options).find((o) => o.option_id === f.option_id)!;
      const units = (f.quantity ?? 1) * parent!.units;
      out.push({ ...base, kind: 'option_child', units, refundable: option.price_minor * units });
    } else if (f.deal_part_id !== undefined) {
      const deal = menu.deals.find((d) => d.deal_id === f.deal_id)!;
      const weights = deal.parts.map((p) => item(p.choices[0]!.item_id).price_minor * p.quantity * parent!.units);
      const sum = weights.reduce((a, w) => a + w, 0);
      const floors = weights.map((w) => Math.floor((parent!.line_total * w) / sum));
      const k = deal.parts.findIndex((p) => p.deal_part_id === f.deal_part_id);
      const share = k === deal.parts.length - 1 ? parent!.line_total - floors.slice(0, -1).reduce((a, x) => a + x, 0) : floors[k]!;
      out.push({ ...base, kind: 'deal_part', units: deal.parts[k]!.quantity * parent!.units, refundable: share });
    } else if (f.deal_id !== undefined) {
      const deal = menu.deals.find((d) => d.deal_id === f.deal_id)!;
      const units = f.quantity ?? 1;
      out.push({ ...base, kind: 'deal', units, refundable: 0, line_total: deal.price_minor * units });
    } else {
      const it = item(f.item_id);
      if (it.requires_weighing) out.push({ ...base, kind: 'item', units: 1, refundable: 0, weighed: { price: it.price_minor } });
      else out.push({ ...base, kind: 'item', units: f.quantity ?? 1, refundable: it.price_minor * (f.quantity ?? 1) });
    }
  }
  return out;
}

class Model {
  lines = new Map<string, ModelLine>();

  add(l: StartLine): void {
    this.lines.set(l.id, {
      id: l.id,
      kind: l.kind,
      parent: l.parent,
      units: l.units,
      line_total: l.kind === 'deal' ? l.line_total : 0,
      slots: shares(l.kind === 'deal' ? 0 : l.refundable, l.units).map((share) => ({ share, state: 'live' as const })),
      next: 0,
      weighed: l.weighed,
    });
  }

  private count(l: ModelLine, s: SlotState): number {
    return l.slots.filter((x) => x.state === s).length;
  }
  live(id: string): number {
    const l = this.lines.get(id)!;
    return l.units - this.count(l, 'removed') - this.count(l, 'voided') - this.count(l, 'comp_voided');
  }
  comped(id: string): number {
    return this.count(this.lines.get(id)!, 'comped');
  }
  counts(id: string): { comped_units: number; removed_units: number; voided_units: number } {
    const l = this.lines.get(id)!;
    return { comped_units: this.count(l, 'comped'), removed_units: this.count(l, 'removed'), voided_units: this.count(l, 'voided') + this.count(l, 'comp_voided') };
  }
  private children(id: string): ModelLine[] {
    const p = this.lines.get(id)!;
    const kind = p.kind === 'deal' ? 'deal_part' : p.kind === 'item' ? 'option_child' : null;
    return kind === null ? [] : [...this.lines.values()].filter((c) => c.parent === id && c.kind === kind);
  }

  /** The cascade: [line, units] for the parent and each child, 0-unit children dropped. */
  private cascade(id: string, n: number, comp: boolean): Array<[ModelLine, number]> {
    const p = this.lines.get(id)!;
    const left = comp ? this.live(id) - this.comped(id) : this.live(id);
    if (n < 1 || n > left) throw new Error(`model: ${n} units of ${id}, ${left} left`);
    const out: Array<[ModelLine, number]> = [[p, n]];
    for (const c of this.children(id)) {
      const cap = comp ? this.live(c.id) - this.comped(c.id) : this.live(c.id);
      const u = n === left ? cap : Math.min((c.units / p.units) * n, cap);
      if (u > 0) out.push([c, u]);
    }
    return out;
  }

  private takeFresh(l: ModelLine, n: number, to: SlotState): void {
    for (let i = 0; i < n; i++) {
      const s = l.slots[l.next];
      if (s === undefined || s.state !== 'live') throw new Error(`model: no free slot on ${l.id}`);
      s.state = to;
      l.next += 1;
    }
  }

  comp(id: string, n: number): void {
    for (const [l, u] of this.cascade(id, n, true)) this.takeFresh(l, u, 'comped');
  }

  /** remove / void: uncomped live units first (fresh slots), then comped ones, the largest share first. */
  private out(id: string, n: number, fresh: SlotState, fromComp: SlotState): void {
    for (const [l, u] of this.cascade(id, n, false)) {
      const uncomped = Math.min(u, this.live(l.id) - this.comped(l.id));
      this.takeFresh(l, uncomped, fresh);
      for (let i = uncomped; i < u; i++) {
        const comped = l.slots.filter((s) => s.state === 'comped').sort((a, b) => b.share - a.share)[0];
        if (comped === undefined) throw new Error(`model: no comped unit left on ${l.id}`);
        comped.state = fromComp;
      }
    }
  }
  remove(id: string, n: number): void {
    this.out(id, n, 'removed', 'removed');
  }
  void(id: string, n: number): void {
    this.out(id, n, 'voided', 'comp_voided');
  }

  /** A weight on an untouched weighed line sets its one slot (lineTotalMinor of @pos/domain, the pricing rule). */
  weigh(id: string, grams: number): void {
    const l = this.lines.get(id)!;
    if (l.weighed === null || l.next !== 0 || l.slots.some((s) => s.state !== 'live')) throw new Error(`model: weight on ${id}`);
    l.slots[0]!.share = lineTotalMinor(l.weighed.price, grams, 'g');
  }

  billed(id: string): number {
    const l = this.lines.get(id)!;
    if (l.kind === 'deal_part') return 0;
    if (l.kind === 'deal') return l.line_total - this.children(id).reduce((a, c) => a + c.slots.filter((s) => s.state !== 'live').reduce((b, s) => b + s.share, 0), 0);
    return l.slots.filter((s) => s.state === 'live').reduce((a, s) => a + s.share, 0);
  }
  total(): number {
    return [...this.lines.keys()].reduce((a, id) => a + this.billed(id), 0);
  }
}

// ------------------------------------------------------------------------------------------- the generator

let hub: TestHub;
let mgr: Who;
const menu = moneyMenu();

beforeAll(async () => {
  hub = await startMoney();
  mgr = signIn(hub, STAFF.manager);
});

afterAll(async () => {
  swapBranchConfig(null);
  await hub?.close();
});

const eventCount = () => hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number;

function orderLinesFor(rnd: () => number, p: string): FixtureLine[] {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const out: FixtureLine[] = [];
  const n = int(1, 3);
  for (let i = 0; i < n; i++) {
    const id = `${p}L${i}`;
    switch (pick(['karahi', 'naan', 'family', 'odd', 'fish', 'combo'] as const)) {
      case 'karahi':
        out.push({ order_item_id: id, item_id: FX.piece, quantity: int(1, 3) });
        if (rnd() < 0.6) out.push({ order_item_id: `${id}r`, option_id: FX.option, parent_order_item_id: id, quantity: int(1, 2) });
        break;
      case 'naan':
        out.push({ order_item_id: id, item_id: FX.naan, quantity: int(1, 4) });
        break;
      case 'family':
      case 'odd':
      case 'combo': {
        const which = pick([
          { deal_id: MX.family, parts: MX.familyParts, items: [FX.naan, FX.naan] },
          { deal_id: MX.odd, parts: MX.oddParts, items: [FX.naan, FX.naan] },
          { deal_id: FX.deal, parts: FX.dealParts, items: [FX.piece, FX.naan] },
        ]);
        out.push({ order_item_id: id, deal_id: which.deal_id, quantity: int(1, 2) });
        which.parts.forEach((part, k) => out.push({ order_item_id: `${id}p${k}`, deal_id: which.deal_id, deal_part_id: part, item_id: which.items[k], parent_order_item_id: id }));
        break;
      }
      case 'fish':
        out.push({ order_item_id: id, item_id: FX.gram });
        break;
    }
  }
  return out;
}

const STAGES = ['added', 'cooking', 'done', 'served'] as const;

/**
 * Money out of billing per line, from the view's own fields and never from 02b's ledger: an item / option child's
 * `refundable − billed`; a deal part's (and a deal's) raw comp + comp_voided + removed + refund columns.
 */
const outOf = (l: LineView): number =>
  l.line_kind === 'item' || l.line_kind === 'option_child' ? l.refundable_minor - l.billed_minor : l.comp_minor + l.comp_voided_minor + l.removed_minor + l.refund_minor;

describe('[04 #46] property: 500 random comp / remove / void / weight sequences, after every step', () => {
  it(`[04 #46] seed ${SEED}: per line moneyOut ≤ refundable, billed ≥ 0, deal-billed rule, billed rises only on LineWeightSet, moneyOut never decreases; Σ billed per order = the unit-by-unit model`, async () => {
    const rnd = mulberry32(SEED);
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const done = { comp: 0, remove: 0, void: 0, weight: 0, refused: 0, cascades: 0, compVoided: 0 };

    for (let seq = 0; seq < SEQUENCES; seq++) {
      const p = `P${seq}_`;
      const fixture = orderLinesFor(rnd, p);
      const order_id = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: fixture }).order_id;
      const model = new Model();
      for (const l of startLines(fixture, menu)) model.add(l);
      // the menu-derived start equals what the projection folded from the real ItemAdded rows (units, refundable, deal total)
      for (const [lid, l] of linesOf(hub, order_id)) {
        const m = model.lines.get(lid)!;
        expect({ units: m.units, refundable: m.kind === 'deal' ? 0 : m.slots.reduce((a, x) => a + x.share, 0), total: m.line_total }, `seq ${seq} start ${lid}`).toEqual({
          units: l.units,
          refundable: l.refundable_minor,
          total: l.line_kind === 'deal' ? l.line_total_minor : 0,
        });
      }
      const engine = () => hub.deps.state.get() as EngineState;
      const engineIds = [...model.lines.keys()].filter((id) => engine().lines[id] !== undefined);
      // a random start stage per engine line (stage-1 lines are removable, the others voidable)
      for (const id of engineIds) {
        const s = pick(STAGES);
        if (s !== 'added') toStage(hub, order_id, [id], s);
      }

      let before = linesOf(hub, order_id);
      const steps = int(3, 6);
      for (let step = 0; step < steps; step++) {
        const where = `seed ${SEED} seq ${seq} step ${step}`;
        const ids = [...model.lines.keys()];
        const id = pick(ids);
        const op = pick(['comp', 'remove', 'void', 'void', 'weight', 'stage'] as const);
        const live = model.live(id);
        const n = Math.max(1, int(1, Math.max(1, live)));
        let r: Reply | null = null;
        const events = eventCount();
        if (op === 'stage') {
          const ln = engine().lines[id];
          const at = ln === undefined ? -1 : STAGES.indexOf(ln.stage as (typeof STAGES)[number]);
          if (at >= 0 && at < 3) toStage(hub, order_id, [id], STAGES[at + 1] as Exclude<(typeof STAGES)[number], 'added'>);
        } else if (op === 'weight') {
          const fish = ids.find((x) => model.lines.get(x)!.weighed !== null);
          if (fish === undefined) continue;
          const grams = 50 * int(1, 40);
          r = await setWeight(hub, mgr, fish, grams);
          if (r.status === 200) {
            model.weigh(fish, grams);
            done.weight += 1;
          }
        } else if (op === 'comp') {
          r = await compLine(hub, mgr, id, Math.max(1, int(1, Math.max(1, live - model.comped(id)))));
          if (r.status === 200) {
            model.comp(id, r.events.find((e) => e.event_type === 'LineComped' && e.payload.order_item_id === id)!.payload.units as number);
            done.comp += 1;
          }
        } else if (op === 'remove') {
          r = await removeItems(hub, mgr, order_id, [{ order_item_id: id, units: n }]);
          if (r.status === 200) {
            model.remove(id, n);
            done.remove += 1;
          }
        } else {
          const disposition = pick(['wastage', 'wastage', 'staff_meal', 'other', 'moved'] as const);
          r = await voidItems(hub, mgr, order_id, [{ order_item_id: id, units: n, disposition }]);
          if (r.status === 200) {
            model.void(id, n);
            done.void += 1;
            const voided = r.events.filter((e) => e.event_type === 'ItemVoided');
            if (voided.length > 1) done.cascades += 1;
            if (voided.some((e) => (e.payload.comp_voided_minor as number) > 0)) done.compVoided += 1;
          }
        }
        if (r !== null && r.status !== 200) {
          // a refusal is a 4xx business answer and writes nothing
          expect([400, 409], `${where} ${op} ${id}: ${JSON.stringify(r.error)}`).toContain(r.status);
          expect(eventCount(), where).toBe(events);
          done.refused += 1;
        }

        // ---- after every step: the projection against the invariants and the model
        const after = linesOf(hub, order_id);
        let sum = 0;
        for (const [lid, l] of after) {
          const at = `${where} ${op} ${id} → line ${lid}`;
          const prev = before.get(lid)!;
          expect(outOf(l), at).toBeLessThanOrEqual(l.refundable_minor);
          if (l.line_kind === 'item' || l.line_kind === 'option_child') expect(l.comp_minor + l.comp_voided_minor + l.removed_minor + l.refund_minor, `${at}: raw columns`).toBe(outOf(l));
          expect(l.billed_minor, at).toBeGreaterThanOrEqual(0);
          if (l.line_kind === 'deal_part') expect(l.billed_minor, at).toBe(0);
          if (l.line_kind === 'deal') {
            const parts = [...after.values()].filter((x) => x.parent_order_item_id === lid && x.line_kind === 'deal_part');
            expect(l.billed_minor, at).toBe((l.line_total_minor ?? 0) - parts.reduce((a, x) => a + outOf(x), 0));
          }
          if (!(op === 'weight' && r?.status === 200)) expect(l.billed_minor, `${at}: billed rose`).toBeLessThanOrEqual(prev.billed_minor);
          expect(outOf(l), `${at}: moneyOut fell`).toBeGreaterThanOrEqual(outOf(prev));
          expect({ ...model.counts(lid), billed: model.billed(lid) }, `${at}: model`).toEqual({ comped_units: l.comped_units, removed_units: l.removed_units, voided_units: l.voided_units, billed: l.billed_minor });
          sum += l.billed_minor;
        }
        expect(sum, `${where}: Σ billed`).toBe(model.total());
        before = after;
      }
    }
    // the generator really exercised every action, cascades and comped voids (not a vacuous pass)
    expect(done.void).toBeGreaterThan(300);
    expect(done.comp).toBeGreaterThan(100);
    expect(done.remove).toBeGreaterThan(50);
    expect(done.weight).toBeGreaterThan(20);
    expect(done.cascades).toBeGreaterThan(50);
    expect(done.compVoided).toBeGreaterThan(20);
    expect(done.refused).toBeGreaterThan(0);
  }, 600_000);
});
