// 02b-TK L-CLIENT-2 item 4 (02b v1.0.25 §3.7a When / Ask, §6.16 `bill` + `unpaid_handover_approved`, §8 OR-7 "Unpaid
// hand-over"; D2, D3; 03b v1.0.16 §3.4 Handed to customer): the ONE candidate check of every hand-over place — the
// counter's ready tile and queue row, the token drawer, the parking / per-line Mark served sheet and the Pass card.
// Pure. A Due order (bill `due`, due_minor > 0) without an effective approval may not give its LAST live line; a
// partial serve that leaves a live line in it is allowed. An approval covers one named order up to the amount
// approved (D2): a sibling order needs its own, and a due above that amount needs a new one. Unknown billing blocks.

export interface BillRow {
  order_type?: string;
  /** §6.16: takeaway / parking `{ state, due_minor }`, dine-in null; absent on a hub before 02b B2-1 */
  bill?: { state: 'due' | 'paid'; due_minor: number } | null;
  /** §6.16 (R3-M-8): absent on a hub that does not send it yet */
  unpaid_handover_approved?: boolean;
}

/** One successful `open-orders` read: hub-clock ms when it was issued, and its rows by order id. */
export interface BillRead {
  at: number;
  rows: ReadonlyMap<string, BillRow>;
}

export type Gate = { kind: 'free' } | { kind: 'unknown' } | { kind: 'due'; due_minor: number; approved: boolean };

export interface GateOptions {
  /** the row is absent and that means paid (a billed parking order leaves open-orders; read issued after placement) */
  absentFree?: boolean;
  /** D2: the amount a manager approved for this order (UnpaidHandoverApproved / RequestUnpaidHandover `approved`) */
  approvedDue?: number | undefined;
}

/** One order's hand-over gate from its open-orders row. */
export function gateOf(row: BillRow | undefined, o: GateOptions = {}): Gate {
  if (row === undefined) return o.absentFree === true ? { kind: 'free' } : { kind: 'unknown' };
  if (row.bill === undefined) return { kind: 'unknown' };
  if (row.bill === null || row.bill.state === 'paid' || row.bill.due_minor <= 0) return { kind: 'free' };
  return dueGate(row.bill.due_minor, row.unpaid_handover_approved, o.approvedDue);
}

/** A Due gate: the hub's flag when it sends one, else this page's knowledge of the approved amount (D2). */
export function dueGate(due_minor: number, flag: boolean | undefined, approvedDue: number | undefined): Gate {
  if (due_minor <= 0) return { kind: 'free' };
  const approved = flag ?? (approvedDue !== undefined && due_minor <= approvedDue);
  return { kind: 'due', due_minor, approved };
}

export interface CandidateOrder {
  order_id: string;
  /** every live unserved line id of the order, as this place serves them */
  live_ids: readonly string[];
  gate: Gate;
}

export type HandoverCheck = { ok: true } | { ok: false; reason: 'unknown' } | { ok: false; reason: 'due'; order_id: string; due_minor: number };

/**
 * §3.7a / §8: may these line ids be handed over now? `orders` oldest first; `reserved` = ids already waiting in an
 * Undo window or the queue (a second tap cannot take the last line). Blocked → the newest Due, unapproved order the
 * send would empty is named (the one to Ask a manager about).
 */
export function checkHandover(orders: readonly CandidateOrder[], ids: readonly string[], reserved: ReadonlySet<string> = new Set()): HandoverCheck {
  const picked = new Set(ids);
  let blocked: HandoverCheck | null = null;
  for (const o of orders) {
    if (!o.live_ids.some((id) => picked.has(id))) continue;
    if (o.gate.kind === 'unknown') return { ok: false, reason: 'unknown' };
    if (o.gate.kind !== 'due' || o.gate.approved) continue;
    if (o.live_ids.every((id) => picked.has(id) || reserved.has(id))) blocked = { ok: false, reason: 'due', order_id: o.order_id, due_minor: o.gate.due_minor };
  }
  return blocked ?? { ok: true };
}

/**
 * BUG-9 (owner ruling 2026-11-28, approval ruling A; §3.7a Ask, D2): EVERY Due, unapproved order the send would empty,
 * oldest first, each with its own due — one "Ask a manager" per order (a request names one order and its due). Empty
 * when nothing is blocked by a due (or billing is unknown: `checkHandover` says so).
 */
export function blockedOrders(orders: readonly CandidateOrder[], ids: readonly string[], reserved: ReadonlySet<string> = new Set()): Array<{ order_id: string; due_minor: number }> {
  const picked = new Set(ids);
  const out: Array<{ order_id: string; due_minor: number }> = [];
  for (const o of orders) {
    if (!o.live_ids.some((id) => picked.has(id)) || o.gate.kind !== 'due' || o.gate.approved) continue;
    if (o.live_ids.every((id) => picked.has(id) || reserved.has(id))) out.push({ order_id: o.order_id, due_minor: o.gate.due_minor });
  }
  return out;
}

/** The ids a list of (grouped) lines names: a grouped row names all its parts (as servedPayload). */
export function lineIds(lines: ReadonlyArray<{ order_item_id: string; part_ids?: string[] }>): string[] {
  return lines.flatMap((l) => l.part_ids ?? [l.order_item_id]);
}

/** The candidate orders of a token / order: its live lines per order (oldest order first) and each order's gate. */
export function candidatesOf(order_ids: readonly string[], live: ReadonlyArray<{ order_id: string; order_item_id: string; part_ids?: string[] }>, gate: (order_id: string) => Gate): CandidateOrder[] {
  return order_ids.map((order_id) => ({ order_id, live_ids: lineIds(live.filter((l) => l.order_id === order_id)), gate: gate(order_id) }));
}

/** Each order's gate from its row, with this page's approvals (unpaid/requests.ts approvedDue). */
export function gatesOf(rows: ReadonlyArray<{ order_id: string } & BillRow>, approvedDue: (order_id: string) => number | undefined): Array<{ order_id: string; gate: Gate }> {
  return rows.map((r) => ({ order_id: r.order_id, gate: gateOf(r, { approvedDue: approvedDue(r.order_id) }) }));
}

/** The ready tile's one tap: every order of the token, every live line (the same rule). */
export function checkWholeToken(orders: ReadonlyArray<{ order_id: string; gate: Gate }>): HandoverCheck {
  return checkHandover(
    orders.map((o) => ({ order_id: o.order_id, live_ids: [o.order_id], gate: o.gate })),
    orders.map((o) => o.order_id),
  );
}

/** The `open-orders` answer's billing facts; null when it is not an open-orders body. */
export function parseBillRows(data: unknown, at: number): BillRead | null {
  const orders = (data as { orders?: unknown } | null)?.orders;
  if (!Array.isArray(orders)) return null;
  const rows = new Map<string, BillRow>();
  for (const o of orders as Array<Record<string, unknown>>) {
    if (typeof o['order_id'] !== 'string') continue;
    const b = o['bill'] as { state?: unknown; due_minor?: unknown } | null | undefined;
    const state: 'due' | 'paid' | null = b?.state === 'due' ? 'due' : b?.state === 'paid' ? 'paid' : null;
    const bill = b === null ? null : state !== null && typeof b?.due_minor === 'number' ? { state, due_minor: b.due_minor } : undefined;
    const flag = o['unpaid_handover_approved'];
    rows.set(o['order_id'], {
      order_type: typeof o['order_type'] === 'string' ? o['order_type'] : '',
      ...(bill === undefined ? {} : { bill }),
      ...(typeof flag === 'boolean' ? { unpaid_handover_approved: flag } : {}),
    });
  }
  return { at, rows };
}
