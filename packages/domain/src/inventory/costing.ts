// 08 v1.1 Part B §3.1 B3–B11, §4.2: the cost engine and usage explosion. Pure, BigInt fractions inside, rounded once
// at the edge (roundMinor, half away from zero). **Never throws** (B9, B11): a cycle, a nesting deeper than 3, an
// unknown version, a unit or basis mismatch, a malformed element — each makes that line / part unknown and the
// result `partial`. Browser-safe: no node:* import, no zod (AD-12: the lenient element checks are hand-written
// here and mirrored by `InventoryElementsLenient` in @pos/events).
import { childQuantity } from '../menu-lines.js';
import type { Unit } from '../units.js';
import type { Fraction } from './conversions.js';
import { effectiveMenuPrice, pricePerStockUnit, type PriceRow } from './prices.js';

export type { Fraction } from './conversions.js';

// ------------------------------------------------------------------------------------------------ fractions
// Signed fractions (num any sign, den > 0). 08a's reduceFraction refuses a negative num, and removal lines are
// negative (B4, B7), so the engine keeps its own sign-aware helpers (AD-5).

const ZERO: Fraction = Object.freeze({ num: 0n, den: 1n });

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a);
  let y = abs(b);
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function norm(num: bigint, den: bigint): Fraction {
  if (num === 0n) return ZERO;
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

function add(a: Fraction, b: Fraction): Fraction {
  return norm(a.num * b.den + b.num * a.den, a.den * b.den);
}

function mul(a: Fraction, b: Fraction): Fraction {
  return norm(a.num * b.num, a.den * b.den);
}

function frac(num: bigint, den = 1n): Fraction {
  return norm(num, den);
}

function min(a: Fraction, b: Fraction): Fraction {
  return a.num * b.den <= b.num * a.den ? a : b;
}

function isNegative(a: Fraction): boolean {
  return a.num < 0n;
}

function neg(a: Fraction): Fraction {
  return { num: -a.num, den: a.den };
}

// B9: rounded to minor units once, at the edge, half away from zero (+0.5 → 1, −0.5 → −1).
// A malformed fraction (den ≤ 0; never produced by the engine) rounds to 0 rather than throwing.
export function roundMinor(value: Fraction): bigint {
  try {
    if (value.den <= 0n) return 0n;
    const n = abs(value.num);
    const r = (2n * n + value.den) / (2n * value.den);
    return value.num < 0n ? -r : r;
  } catch {
    return 0n;
  }
}

// ------------------------------------------------------------------------------------------------ inputs

export interface CostItem {
  stock_item_id: string;
  kind: string; // 'prepared' | 'ingredient' | 'packet'; any other string = unknown (t-5)
  name: string;
  code: string | null;
  stock_unit: string; // 'piece' | 'g' | 'ml'; any other string = unknown
  cost_category: string;
  is_a_item: boolean;
}

export interface CostUnit {
  stock_item_id: string;
  unit_name: string;
  factor: Fraction;
}

export interface CostPrice extends PriceRow {
  stock_item_id: string;
}

export interface CostLine {
  stock_item_id: string;
  stock_qty: Fraction; // frozen, in `stock_unit`; negative only on an option's removal line (B4)
  stock_unit: string;
  qty_basis: string; // 'AP' | 'EP'
}

export interface CostVersion {
  recipe_version_id: string;
  status: string; // 'published' | 'superseded' (the cloud context: published only)
  owner_type: string;
  owner_id: string;
  basis: string;
  base_qty: bigint | null;
  measure_unit: string | null;
  recipe_archived: boolean;
  batch_yield_qty: bigint | null;
  batch_stock_unit: string | null;
  misc_allowance_bp: number;
  published_at: number;
  lines: CostLine[];
  lines_dropped: number; // malformed line elements (t-5): the version is then partial, never silently cheaper
}

export interface CostInputs {
  items: Map<string, CostItem>;
  units: Map<string, CostUnit[]>;
  prices: Map<string, CostPrice[]>;
  yields: Map<string, number>; // active yield_bp per ingredient
  versions: Map<string, CostVersion>;
  publishedByOwner: Map<string, string>; // 'menu_item:<id>' | 'modifier_option:<id>' | 'stock_item:<id>' → version id
  dropped: number;
}

// §4.2 n-7: the five cost-context row sets of §6 as the cloud repository returns them, mapped to the snapshot key's
// element shapes (BIGINT money / quantities as strings; created_at, valid_until_at, published_at, base_qty as
// numbers; versions with `status: 'published'` and their lines). `source: 'cloud'` tells them from a snapshot key:
// cloud price rows are time-filtered for `now` already (selectPriceCandidates), so their created_at is kept (no
// rank, t-1); a version without `recipe_archived` reads as not archived (the cost context is non-archived only).
export interface CloudCostRows {
  source: 'cloud';
  items: unknown[];
  units: unknown[];
  prices: unknown[];
  yields: unknown[];
  recipes: unknown[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const INT_RE = /^-?[0-9]+$/;
const POS_RE = /^[0-9]+$/;
function big(v: unknown, signed = false): bigint | null {
  if (!isStr(v) || !(signed ? INT_RE : POS_RE).test(v)) return null;
  return BigInt(v);
}

function parseItem(e: unknown): CostItem | null {
  if (!isObj(e)) return null;
  const { stock_item_id, kind, name, code, stock_unit, cost_category, is_a_item } = e;
  if (!isStr(stock_item_id) || !isStr(kind) || !isStr(name) || !isStrOrNull(code) || !isStr(stock_unit) || !isStr(cost_category)) return null;
  if (typeof is_a_item !== 'boolean') return null;
  return { stock_item_id, kind, name, code, stock_unit, cost_category, is_a_item };
}

function parseUnit(e: unknown): CostUnit | null {
  if (!isObj(e) || !isStr(e.stock_item_id) || !isStr(e.unit_name)) return null;
  const num = big(e.factor_num);
  const den = big(e.factor_den);
  if (num === null || den === null || num <= 0n || den <= 0n) return null;
  return { stock_item_id: e.stock_item_id, unit_name: e.unit_name, factor: frac(num, den) };
}

function parsePrice(e: unknown): CostPrice | null {
  if (!isObj(e)) return null;
  const { price_id, stock_item_id, branch_id, kind, unit_name, stock_unit, created_at, valid_until_at } = e;
  if (!isStr(price_id) || !isStr(stock_item_id) || !isStrOrNull(branch_id) || !isStr(kind) || !isStr(unit_name) || !isStr(stock_unit)) return null;
  if (!isInt(created_at) || !(valid_until_at === null || isInt(valid_until_at))) return null;
  const price_minor = big(e.price_minor);
  const stock_qty_num = big(e.stock_qty_num);
  const stock_qty_den = big(e.stock_qty_den);
  if (price_minor === null || stock_qty_num === null || stock_qty_den === null || stock_qty_num <= 0n || stock_qty_den <= 0n) return null;
  return {
    price_id,
    stock_item_id,
    branch_id,
    kind: kind as PriceRow['kind'], // kind does not rank (08a I7); kept as sent
    unit_name,
    stock_unit: stock_unit as Unit, // a unit no item has never matches an item's stock_unit
    price_minor,
    stock_qty_num,
    stock_qty_den,
    created_at,
    valid_until_at,
  };
}

function parseLine(e: unknown): CostLine | null {
  if (!isObj(e) || !isStr(e.stock_item_id) || !isStr(e.stock_unit) || !isStr(e.qty_basis)) return null;
  const num = big(e.stock_qty_num, true);
  const den = big(e.stock_qty_den);
  if (num === null || den === null || num === 0n || den <= 0n) return null;
  return { stock_item_id: e.stock_item_id, stock_qty: frac(num, den), stock_unit: e.stock_unit, qty_basis: e.qty_basis };
}

function parseVersion(e: unknown, counter: { dropped: number }): CostVersion | null {
  if (!isObj(e)) return null;
  const { recipe_version_id, status, owner_type, owner_id, basis, base_qty, measure_unit, batch_stock_unit, misc_allowance_bp, published_at, lines } = e;
  if (!isStr(recipe_version_id) || !isStr(status) || !isStr(owner_type) || !isStr(owner_id) || !isStr(basis)) return null;
  if (!(base_qty === null || isInt(base_qty)) || !isStrOrNull(measure_unit) || !isStrOrNull(batch_stock_unit)) return null;
  if (!isInt(misc_allowance_bp) || misc_allowance_bp < 0 || misc_allowance_bp > 5_000 || !isInt(published_at) || !Array.isArray(lines)) return null;
  const archived = e.recipe_archived === undefined ? false : e.recipe_archived; // the cloud context carries no flag (non-archived only)
  if (typeof archived !== 'boolean') return null;
  let batch_yield_qty: bigint | null = null;
  if (e.batch_yield_qty !== null && e.batch_yield_qty !== undefined) {
    batch_yield_qty = big(e.batch_yield_qty);
    if (batch_yield_qty === null || batch_yield_qty <= 0n) return null;
  }
  const parsed: CostLine[] = [];
  let linesDropped = 0;
  for (const l of lines) {
    const line = parseLine(l);
    if (line === null) linesDropped += 1;
    else parsed.push(line);
  }
  counter.dropped += linesDropped;
  return {
    recipe_version_id,
    status,
    owner_type,
    owner_id,
    basis,
    base_qty: base_qty === null ? null : BigInt(base_qty),
    measure_unit,
    recipe_archived: archived,
    batch_yield_qty,
    batch_stock_unit,
    misc_allowance_bp,
    published_at,
    lines: parsed,
    lines_dropped: linesDropped,
  };
}

function emptyInputs(): CostInputs {
  return { items: new Map(), units: new Map(), prices: new Map(), yields: new Map(), versions: new Map(), publishedByOwner: new Map(), dropped: 0 };
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

// B15 (c), §4.2, t-1, t-5, t-7: element by element; a failing element is dropped and counted; unknown fields are
// ignored; each snapshot price row's created_at becomes its rank within its item (created_at, then price_id: 08a
// I7's order), so every row is in effect on any hub clock; archived recipes' versions are kept by id but are not
// in publishedByOwner. Anything that is not an object with the five arrays → no items (inventory not configured).
export function buildCostInputs(source: unknown): CostInputs {
  const out = emptyInputs();
  try {
    if (!isObj(source)) return out;
    const fromCloud = source.source === 'cloud';
    const list = (k: string): unknown[] => (Array.isArray(source[k]) ? (source[k] as unknown[]) : []);
    const counter = { dropped: 0 };
    for (const e of list('items')) {
      const item = parseItem(e);
      if (item === null) counter.dropped += 1;
      else out.items.set(item.stock_item_id, item);
    }
    for (const e of list('units')) {
      const unit = parseUnit(e);
      if (unit === null) counter.dropped += 1;
      else pushTo(out.units, unit.stock_item_id, unit);
    }
    for (const e of list('prices')) {
      const price = parsePrice(e);
      if (price === null) counter.dropped += 1;
      else pushTo(out.prices, price.stock_item_id, price);
    }
    if (!fromCloud) {
      for (const rows of out.prices.values()) {
        const ranked = [...rows].sort((a, b) => a.created_at - b.created_at || (a.price_id < b.price_id ? -1 : a.price_id > b.price_id ? 1 : 0));
        ranked.forEach((row, rank) => {
          row.created_at = rank;
        });
      }
    }
    for (const e of list('yields')) {
      if (!isObj(e) || !isStr(e.stock_item_id) || !isInt(e.yield_bp) || e.yield_bp < 1 || e.yield_bp > 50_000) counter.dropped += 1;
      else out.yields.set(e.stock_item_id, e.yield_bp);
    }
    for (const e of list('recipes')) {
      const version = parseVersion(e, counter);
      if (version === null) {
        counter.dropped += 1;
        continue;
      }
      // a repeated version id: the later element wins everywhere (no stale publishedByOwner entry)
      const previous = out.versions.get(version.recipe_version_id);
      if (previous !== undefined) {
        const k = `${previous.owner_type}:${previous.owner_id}`;
        if (out.publishedByOwner.get(k) === previous.recipe_version_id) out.publishedByOwner.delete(k);
      }
      out.versions.set(version.recipe_version_id, version);
      if (version.status === 'published' && !version.recipe_archived) {
        // one published version per owner (DB); should a key carry two, the latest published_at (then id) wins
        const k = `${version.owner_type}:${version.owner_id}`;
        const other = out.versions.get(out.publishedByOwner.get(k) ?? '');
        if (other === undefined || other.published_at < version.published_at || (other.published_at === version.published_at && other.recipe_version_id < version.recipe_version_id)) {
          out.publishedByOwner.set(k, version.recipe_version_id);
        }
      }
    }
    out.dropped = counter.dropped;
    return out;
  } catch {
    return emptyInputs(); // unreachable by construction; the engine never throws
  }
}

// ------------------------------------------------------------------------------------------------ costing

const MAX_DEPTH = 3; // B6: a chain of prepared recipes longer than 3 levels is too deep

type Status = 'costed' | 'partial';

interface Acc {
  value: Fraction;
  partial: boolean;
  knownLines: number;
  unknown: Set<string>;
}

interface Ctx {
  inputs: CostInputs;
  branchId: string | null;
  nowMs: number;
}

const ownerKey = (type: string, id: string) => `${type}:${id}`;

// B9 (a)–(c) on one item, with the chain of prepared items already being costed (cycle / depth guard).
// Returns null for unknown (never 0), `partial` when the batch recipe it comes from is partial.
function unitCost(ctx: Ctx, stockItemId: string, level: number, stack: readonly string[]): { value: Fraction; source: 'menu' | 'recipe'; partial: boolean } | null {
  const item = ctx.inputs.items.get(stockItemId);
  if (item === undefined) return null; // n-11: archived since, or dropped
  if (item.kind !== 'prepared' && item.kind !== 'ingredient' && item.kind !== 'packet') return null; // t-5: unknown kind
  if (item.kind === 'prepared') {
    const vid = ctx.inputs.publishedByOwner.get(ownerKey('stock_item', stockItemId));
    if (vid !== undefined) {
      if (stack.includes(stockItemId) || level > MAX_DEPTH) return null; // cycle / too deep: unknown, never a throw
      const version = ctx.inputs.versions.get(vid);
      if (version === undefined) return null;
      if (version.basis !== 'per_batch' || version.batch_yield_qty === null || version.batch_stock_unit !== item.stock_unit) return null; // N-1 backstop
      const acc = costLines(ctx, version, level, [...stack, stockItemId]);
      if (acc.knownLines === 0) return null;
      return { value: mul(acc.value, frac(1n, version.batch_yield_qty)), source: 'recipe', partial: acc.partial };
    }
  }
  const row = effectiveMenuPrice(ctx.inputs.prices.get(stockItemId) ?? [], ctx.branchId, ctx.nowMs, item.stock_unit as Unit);
  if (row === null) return null;
  return { value: pricePerStockUnit(row), source: 'menu', partial: false };
}

// AP stock quantity of a line (after yield), or null when unknown (EP ingredient with no yield, D9; bad basis).
function apQty(ctx: Ctx, line: CostLine, item: CostItem): Fraction | null {
  if (line.qty_basis === 'AP') return line.stock_qty;
  if (line.qty_basis !== 'EP') return null;
  if (item.kind !== 'ingredient') return line.stock_qty; // EP on packet / prepared: no division (test 2)
  const bp = ctx.inputs.yields.get(item.stock_item_id);
  if (bp === undefined) return null;
  return mul(line.stock_qty, frac(10_000n, BigInt(bp)));
}

function lineItem(ctx: Ctx, line: CostLine): CostItem | null {
  const item = ctx.inputs.items.get(line.stock_item_id);
  if (item === undefined || item.stock_unit !== line.stock_unit) return null; // N-1: frozen unit ≠ current → unknown
  return item;
}

// Σ known line costs of a version (no misc), lines at prepared-nesting `level` + 1. Negative lines are left to the
// option path (B7), which caps them against the parent; here (a recipe costed on its own) they are taken as written.
function costLines(ctx: Ctx, version: CostVersion, level: number, stack: readonly string[]): Acc {
  const acc: Acc = { value: ZERO, partial: version.lines_dropped > 0, knownLines: 0, unknown: new Set() };
  for (const line of version.lines) addLineCost(ctx, acc, line, line.stock_qty, level, stack);
  return acc;
}

// one line (or a capped removal quantity of it, AP-converted by the caller when `qtyOverride` is given)
function addLineCost(ctx: Ctx, acc: Acc, line: CostLine, qty: Fraction, level: number, stack: readonly string[], asAp = false): void {
  const item = lineItem(ctx, line);
  const q = item === null ? null : asAp ? qty : apQty(ctx, { ...line, stock_qty: qty }, item);
  const cost = item === null || q === null ? null : unitCost(ctx, item.stock_item_id, level + 1, stack);
  if (cost === null || q === null) {
    acc.partial = true;
    acc.unknown.add(line.stock_item_id);
    return;
  }
  acc.value = add(acc.value, mul(q, cost.value));
  acc.knownLines += 1;
  if (cost.partial) {
    acc.partial = true; // M-11: a line through a partial sub-recipe is partial
    acc.unknown.add(line.stock_item_id);
  }
}

function misc(version: CostVersion): Fraction {
  return frac(BigInt(10_000 + version.misc_allowance_bp), 10_000n);
}

const KNOWN_BASES = new Set(['per_unit', 'per_measure', 'per_batch']);

function topLevel(version: CostVersion): { level: number; stack: string[] } {
  return version.owner_type === 'stock_item' ? { level: 1, stack: [version.owner_id] } : { level: 0, stack: [] };
}

// §4.2 recipeCost: one version's cost (per base: per unit / per base_qty / per batch), misc at the top only (B5).
// `known` (AD-13) = at least one line known, or an empty recipe (an empty option costs 0, costed).
export function recipeCost(
  inputs: CostInputs,
  recipeVersionId: string,
  branchId: string | null,
  nowMs: number,
  opts: { top: boolean },
): { value: Fraction; status: Status; unknown: string[]; known: boolean } {
  try {
    const version = inputs.versions.get(recipeVersionId);
    if (version === undefined || !KNOWN_BASES.has(version.basis)) return { value: ZERO, status: 'partial', unknown: [], known: false };
    const ctx: Ctx = { inputs, branchId, nowMs };
    const { level, stack } = topLevel(version);
    const acc = costLines(ctx, version, level, stack);
    if (version.basis === 'per_batch') {
      const owner = inputs.items.get(version.owner_id);
      if (owner === undefined || version.batch_stock_unit !== owner.stock_unit || version.batch_yield_qty === null) acc.partial = true; // N-1
    }
    const value = opts.top ? mul(acc.value, misc(version)) : acc.value;
    const known = version.lines.length === 0 && version.lines_dropped === 0 ? true : acc.knownLines > 0;
    return { value, status: acc.partial ? 'partial' : 'costed', unknown: [...acc.unknown].sort(), known };
  } catch {
    return { value: ZERO, status: 'partial', unknown: [], known: false };
  }
}

// §4.2 stockItemUnitCost: B9 (a)–(c). For an ingredient or packet it is exactly 08a
// pricePerStockUnit(effectiveMenuPrice(…)) on the same inputs. null = unknown, never 0; a prepared item whose batch
// recipe is partial → null too (AD-14: the contract has no partial flag).
export function stockItemUnitCost(
  inputs: CostInputs,
  stockItemId: string,
  branchId: string | null,
  nowMs: number,
): { per_stock_unit: Fraction; source: 'menu' | 'recipe' } | null {
  try {
    const cost = unitCost({ inputs, branchId, nowMs }, stockItemId, 1, []);
    if (cost === null || cost.partial) return null;
    return { per_stock_unit: cost.value, source: cost.source };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------ sale lines

export type SaleUnit = 'piece' | 'g' | 'ml';

export interface SaleLineShape {
  kind: 'item';
  item_id: string;
  quantity: bigint; // in the line's sale unit; a deal part's = part qty × deal qty (N-5)
  sale_unit: SaleUnit;
  deal_qty?: bigint; // t-3: on a deal-part line, the deal's quantity (the plain-option multiplier on a g / ml part)
  options: { option_id: string; quantity: bigint }[];
}

export interface RecipeVersionIds {
  item: string | null;
  options: { option_id: string; recipe_version_id: string | null }[];
}

export type SaleLineUsage = SaleLineShape & { recipe_version_ids: RecipeVersionIds };

export type PlateStatus = 'costed' | 'partial' | 'no_recipe';

// T-2 / f-2 backstop: the version fits the line's sale unit (per_unit ↔ piece, per_measure ↔ its measure_unit).
function fitsSaleUnit(version: CostVersion, saleUnit: string): boolean {
  if (version.owner_type !== 'menu_item') return false;
  if (saleUnit === 'piece') return version.basis === 'per_unit';
  if (saleUnit === 'g' || saleUnit === 'ml') return version.basis === 'per_measure' && version.measure_unit === saleUnit && version.base_qty !== null && version.base_qty > 0n;
  return false;
}

// the item recipe's factor for the line: × quantity (per_unit), × q / base_qty (per_measure)
function itemFactor(version: CostVersion, quantity: bigint): Fraction {
  return version.basis === 'per_measure' && version.base_qty !== null ? frac(quantity, version.base_qty) : frac(quantity);
}

// B10 / t-3: the plain option's quantity per sale line (01c §3.4.2 childQuantity; numbers at the boundary, n-7).
// null when childQuantity refuses its inputs (never thrown out of the engine).
function optionMultiplier(line: SaleLineShape, optionQty: bigint): bigint | null {
  try {
    const dealPart = line.deal_qty !== undefined && line.sale_unit !== 'piece';
    const parentQty = dealPart ? line.deal_qty! : line.quantity;
    const parentUnit: Unit = dealPart ? 'piece' : line.sale_unit;
    return BigInt(childQuantity(Number(optionQty), Number(parentQty), parentUnit));
  } catch {
    return null;
  }
}

// B7: a parent's own direct AP stock quantity of a stock item, per parent unit × the line's factor (after yield).
function parentDirectAp(ctx: Ctx, parent: CostVersion | null, stockItemId: string, factor: Fraction): Fraction {
  if (parent === null) return ZERO;
  let total = ZERO;
  for (const line of parent.lines) {
    if (line.stock_item_id !== stockItemId || isNegative(line.stock_qty)) continue;
    const item = lineItem(ctx, line);
    const q = item === null ? null : apQty(ctx, line, item);
    if (q !== null) total = add(total, q);
  }
  return mul(total, factor);
}

// the AP quantity an option line takes away (≤ 0), capped by B7, for `mult` option units on this sale line. The cap
// is per stock item for the whole sale line (`remaining`, shared by every option on it): two removals of one item
// together never take away more than the parent's own direct quantity, so usage never goes below 0.
type Remaining = Map<string, Fraction>;
function cappedRemoval(ctx: Ctx, line: CostLine, mult: bigint, parent: CostVersion | null, factor: Fraction, remaining: Remaining): Fraction | null {
  const item = lineItem(ctx, line);
  if (item === null) return null;
  const ap = apQty(ctx, line, item); // negative
  if (ap === null) return null;
  const wanted = mul(neg(ap), frac(mult)); // > 0
  const cap = remaining.get(line.stock_item_id) ?? parentDirectAp(ctx, parent, line.stock_item_id, factor);
  const taken = min(wanted, cap);
  remaining.set(line.stock_item_id, add(cap, neg(taken)));
  return neg(taken);
}

interface PartResult {
  value: Fraction;
  status: PlateStatus;
  known: boolean;
}

// §4.2 / B10 plateCost: the whole item sale line. `nowMs` is a real clock (ms): snapshot price rows carry their
// per-item rank as created_at (t-1), so every rank is below any real time. (item recipe × quantity, + each plain option's recipe).
export function plateCost(
  inputs: CostInputs,
  line: SaleLineShape,
  branchId: string | null,
  nowMs: number,
): PartResult & { recipe_version_ids: RecipeVersionIds } {
  let ids: RecipeVersionIds = { item: null, options: [] };
  try {
    const options = line.options.map((o) => ({ option_id: o.option_id, recipe_version_id: inputs.publishedByOwner.get(ownerKey('modifier_option', o.option_id)) ?? null }));
    ids = { item: inputs.publishedByOwner.get(ownerKey('menu_item', line.item_id)) ?? null, options };
    if (ids.item === null) return { value: ZERO, status: 'no_recipe', known: false, recipe_version_ids: ids };
    const ctx: Ctx = { inputs, branchId, nowMs };
    const version = inputs.versions.get(ids.item);
    if (version === undefined || !fitsSaleUnit(version, line.sale_unit)) return { value: ZERO, status: 'partial', known: false, recipe_version_ids: ids };
    const factor = itemFactor(version, line.quantity);
    const item = recipeCost(inputs, version.recipe_version_id, branchId, nowMs, { top: true });
    let value = mul(item.value, factor);
    let partial = item.status === 'partial';
    let known = item.known; // t-6: at least one line known, on the item or an option
    const remaining: Remaining = new Map();
    for (const [i, o] of line.options.entries()) {
      const vid = options[i]!.recipe_version_id;
      if (vid === null) {
        partial = true; // a plain option without a recipe adds 0 (08-g0 §3.11)
        continue;
      }
      const opt = optionCost(ctx, line, o.quantity, vid, version, factor, remaining);
      if (opt === null) {
        partial = true;
        continue;
      }
      value = add(value, opt.value);
      if (opt.partial) partial = true;
      if (opt.known) known = true;
    }
    return { value, status: partial ? 'partial' : 'costed', known, recipe_version_ids: ids };
  } catch {
    return { value: ZERO, status: 'partial', known: false, recipe_version_ids: ids };
  }
}

// one plain option's cost on a sale line: Σ positive lines × multiplier + Σ capped removals, × misc (top, B5)
function optionCost(
  ctx: Ctx,
  line: SaleLineShape,
  optionQty: bigint,
  vid: string,
  parent: CostVersion,
  factor: Fraction,
  remaining: Remaining,
): { value: Fraction; partial: boolean; known: boolean } | null {
  const version = ctx.inputs.versions.get(vid);
  if (version === undefined || version.owner_type !== 'modifier_option' || version.basis !== 'per_unit') return null;
  const mult = optionMultiplier(line, optionQty);
  if (mult === null) return null;
  const acc: Acc = { value: ZERO, partial: version.lines_dropped > 0, knownLines: 0, unknown: new Set() };
  for (const l of version.lines) {
    if (!isNegative(l.stock_qty)) {
      addLineCost(ctx, acc, l, mul(l.stock_qty, frac(mult)), 0, []);
      continue;
    }
    const removed = cappedRemoval(ctx, l, mult, parent, factor, remaining);
    if (removed === null) {
      acc.partial = true;
      continue;
    }
    if (removed.num === 0n) {
      acc.knownLines += 1;
      continue;
    }
    addLineCost(ctx, acc, l, removed, 0, [], true);
  }
  const known = version.lines.length === 0 && version.lines_dropped === 0 ? true : acc.knownLines > 0;
  return { value: mul(acc.value, misc(version)), partial: acc.partial, known };
}

// §4.2 / B10 deal rule (N-5): value = Σ parts; no_recipe only when every part is; else partial if any part is not
// costed; known = any part known (t-6).
export function dealCost(parts: readonly PartResult[]): PartResult {
  try {
    return dealSum(parts);
  } catch {
    return { value: ZERO, status: 'partial', known: false }; // a malformed part (never engine-produced)
  }
}

function dealSum(parts: readonly PartResult[]): PartResult {
  let value = ZERO;
  let allNoRecipe = true; // no parts at all → no_recipe (nothing to cost)
  let anyNotCosted = false;
  let known = false;
  for (const p of parts) {
    value = add(value, p.value);
    if (p.status !== 'no_recipe') allNoRecipe = false;
    if (p.status !== 'costed') anyNotCosted = true;
    if (p.known) known = true;
  }
  return { value, status: allNoRecipe ? 'no_recipe' : anyNotCosted ? 'partial' : 'costed', known };
}

// ------------------------------------------------------------------------------------------------ explosion

interface Usage {
  usage: Map<string, Fraction>;
  partial: boolean;
}

function bump(u: Usage, id: string, qty: Fraction): void {
  const cur = u.usage.get(id);
  u.usage.set(id, cur === undefined ? qty : add(cur, qty));
}

// AP quantity `qty` of an item in its stock unit: ingredient / packet → usage as purchased; prepared → through its
// current published batch recipe (n-2), raw = qty × line ÷ batch_yield_qty, always (no stopAt); depth ≤ 3.
function explodeAp(ctx: Ctx, u: Usage, stockItemId: string, qty: Fraction, level: number, stack: readonly string[]): void {
  const item = ctx.inputs.items.get(stockItemId);
  if (item === undefined || (item.kind !== 'prepared' && item.kind !== 'ingredient' && item.kind !== 'packet')) {
    u.partial = true;
    return;
  }
  if (item.kind !== 'prepared') {
    bump(u, stockItemId, qty);
    return;
  }
  if (stack.includes(stockItemId) || level > MAX_DEPTH) {
    u.partial = true; // cycle / depth > 3: that branch dropped
    return;
  }
  const vid = ctx.inputs.publishedByOwner.get(ownerKey('stock_item', stockItemId));
  const version = vid === undefined ? undefined : ctx.inputs.versions.get(vid);
  if (version === undefined || version.basis !== 'per_batch' || version.batch_yield_qty === null || version.batch_stock_unit !== item.stock_unit) {
    u.partial = true; // no published recipe (N-6), or the frozen batch unit no longer fits (N-1)
    return;
  }
  if (version.lines_dropped > 0) u.partial = true;
  const per = mul(qty, frac(1n, version.batch_yield_qty));
  for (const line of version.lines) explodeLine(ctx, u, line, per, level, [...stack, stockItemId]);
}

// one recipe line × `factor` parent units; misc never applied (B5)
function explodeLine(ctx: Ctx, u: Usage, line: CostLine, factor: Fraction, level: number, stack: readonly string[]): void {
  const item = lineItem(ctx, line);
  const ap = item === null ? null : apQty(ctx, line, item);
  if (item === null || ap === null) {
    u.partial = true; // unknown yield → that item left out
    return;
  }
  explodeAp(ctx, u, item.stock_item_id, mul(ap, factor), level + 1, stack);
}

function explodeVersion(ctx: Ctx, u: Usage, version: CostVersion, factor: Fraction): void {
  if (version.lines_dropped > 0) u.partial = true;
  const { level, stack } = topLevel(version);
  for (const line of version.lines) explodeLine(ctx, u, line, factor, level, stack);
}

function settle(u: Usage): { usage: Map<string, Fraction>; status: Status } {
  for (const [id, q] of u.usage) if (q.num === 0n) u.usage.delete(id);
  return { usage: u.usage, status: u.partial ? 'partial' : 'costed' };
}

// §4.2 / B11 explodeUsage: a sale line with the recipe version ids recorded for it (item and each option).
export function explodeUsage(inputs: CostInputs, line: SaleLineUsage): { usage: Map<string, Fraction>; status: Status } {
  const u: Usage = { usage: new Map(), partial: false };
  try {
    const ctx: Ctx = { inputs, branchId: null, nowMs: 0 };
    const vid = line.recipe_version_ids.item;
    const version = vid === null ? undefined : inputs.versions.get(vid);
    let parent: CostVersion | null = null;
    let factor = frac(line.quantity);
    if (version === undefined || !fitsSaleUnit(version, line.sale_unit)) {
      u.partial = true; // no recipe, a version past the 3 kept (OQ-5), or a basis that does not fit (f-2): nothing from it
    } else {
      parent = version;
      factor = itemFactor(version, line.quantity);
      explodeVersion(ctx, u, version, factor);
    }
    const remaining: Remaining = new Map();
    for (const o of line.options) {
      const rec = line.recipe_version_ids.options.find((x) => x.option_id === o.option_id);
      const ov = rec === undefined || rec.recipe_version_id === null ? undefined : inputs.versions.get(rec.recipe_version_id);
      if (ov === undefined || ov.owner_type !== 'modifier_option' || ov.basis !== 'per_unit') {
        u.partial = true;
        continue;
      }
      const mult = optionMultiplier(line, o.quantity);
      if (mult === null) {
        u.partial = true;
        continue;
      }
      if (ov.lines_dropped > 0) u.partial = true;
      for (const l of ov.lines) {
        if (!isNegative(l.stock_qty)) {
          explodeLine(ctx, u, l, frac(mult), 0, []);
          continue;
        }
        const removed = cappedRemoval(ctx, l, mult, parent, factor, remaining);
        if (removed === null) {
          u.partial = true;
          continue;
        }
        if (removed.num !== 0n) explodeAp(ctx, u, l.stock_item_id, removed, 1, []);
      }
    }
    return settle(u);
  } catch {
    return { usage: new Map(), status: 'partial' };
  }
}

// §4.2 explodeStockItem (owner contract): `qty` of a prepared item in its own stock unit (pieces, plates as piece)
// through its published per_batch recipe, recursing through prepared sub-items, depth ≤ 3; a prepared item with no
// published recipe → empty usage, partial. Never throws.
export function explodeStockItem(
  inputs: CostInputs,
  preparedStockItemId: string,
  qty: bigint,
): { usage: Map<string, { num: bigint; den: bigint }>; status: Status } {
  try {
    const item = inputs.items.get(preparedStockItemId);
    if (item === undefined || item.kind !== 'prepared') return { usage: new Map(), status: 'partial' };
    const u: Usage = { usage: new Map(), partial: false };
    explodeAp({ inputs, branchId: null, nowMs: 0 }, u, preparedStockItemId, frac(qty), 1, []);
    return settle(u);
  } catch {
    return { usage: new Map(), status: 'partial' };
  }
}

