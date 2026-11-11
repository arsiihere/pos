import type { Doc, DocBlock, Identifier, LineDetail } from '@pos/domain';
import { stationPlan, type EngineState } from '@pos/engine';
import type Database from 'better-sqlite3';
import { buildLineDetails } from '../../kds/contracts.js';
import { tableLabel } from '../../kds/details.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { mapText } from '../escpos.js';

// 03c §3.3 (ticket layout), §3.5 (slips, REPRINT), §3.6 (render at send), task c10. Builders for the worker (c14):
// each renders one job at send from the hub tables and the engine and returns its Doc, or null when it is empty
// (kitchen / first / cancel with nothing left, a stale slip or COMING UP: the worker cancels it, not sent).
// Statements: a ticket job = 1 read (ticket + ticket_lines + order_lines + orders, + the station's toggles) +
// 03b buildLineDetails (2); COMING UP = buildLineDetails (2) over stationPlan. Content from 03b's details; an order
// no longer in the engine falls back to order_lines and config names. No prices, no COMP, no zone-served lines.

export interface RenderCtx {
  db: Database.Database;
  state: EngineState;
  now: number;
  /** hubTime(clock).utc_offset_ms: the 12-hour times are branch-local. */
  utc_offset_ms: number;
  width_cols: 32 | 48;
}

/** The job fields a render needs (the worker maps `print_jobs` + its payload to this). */
export type RenderJob =
  | { kind: 'kitchen'; ticket_id: string; is_reprint: boolean }
  | { kind: 'reprint'; ticket_id: string; is_reprint: boolean }
  /**
   * §3.3 payload `{ ticket_id, order_item_id, units: p.units ?? null }` (null = whole line) + the row's job_id /
   * created_at (to find the earlier cancel jobs of the line).
   */
  | { kind: 'cancel'; job_id: string; created_at: number; ticket_id: string; order_item_id: string; units: number | null; is_reprint: boolean }
  | { kind: 'first'; ticket_id: string; order_item_ids: string[]; reason: 'boost' | 'expedite'; is_reprint: boolean }
  | { kind: 'coming_up'; station_id: string; created_at: number; is_reprint: boolean };

/** §3.5: a COMING UP older than this at send is stale. */
export const COMING_UP_STALE_MS = 600_000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 03b §3.1 identifier text: "T4 + T5", "#12", "#12 10 Nov", "PARKING LEB 1234 SEDAN". */
export function identifierText(id: Identifier): string {
  if (id.kind === 'table') return id.label;
  if (id.kind === 'token') {
    if (id.date === null) return `#${id.token}`;
    const [, m, d] = id.date.split('-');
    return `#${id.token} ${Number(d)} ${MONTHS[Number(m) - 1] ?? m}`;
  }
  return `PARKING ${id.car_number} ${id.car_type.toUpperCase()}`;
}

/** 12-hour branch-local time, "1:22 PM". */
export function clock12(at: number, utc_offset_ms: number): string {
  const d = new Date(at + utc_offset_ms);
  const h = d.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const ORDER_TYPE: Record<LineDetail['order_type'], string> = { dine_in: 'DINE-IN', takeaway: 'TAKEAWAY', parking: 'PARKING' };

// ---- the ticket read (1 statement) --------------------------------------------------------------------------------

interface Row {
  ticket_id: string;
  station_id: string;
  order_id: string;
  fired_at: number;
  show_taker: number | null;
  show_order_id: number | null;
  order_item_id: string;
  done_at: number | null;
  line_kind: 'item' | 'option_child' | 'deal' | 'deal_part';
  name: string;
  units: number;
  live_units: number;
  kitchen_note: string | null;
  parent_kind: Row['line_kind'] | null;
  parent_name: string | null;
  options: string; // JSON [{ name, live }] of the live option children with no ticket line of their own
  order_type: LineDetail['order_type'];
  business_date: string;
  token: number | null;
  car_number: string | null;
  car_type: 'sedan' | 'mini' | 'large' | null;
  order_note: string | null;
  placed_by_name: string | null;
  primary_table_id: string | null;
  tables: string; // JSON table ids of the open seating, join order
  r_order_item_id: string | null;
  r_name: string | null;
  r_order_type: LineDetail['order_type'] | null;
  r_business_date: string | null;
  r_token: number | null;
  r_car_number: string | null;
  r_car_type: 'sedan' | 'mini' | 'large' | null;
  r_primary_table_id: string | null;
  r_tables: string;
  earlier_cancelled: number; // Σ units of the cancel jobs of this line before the one rendered (0 for other kinds)
}

interface OrderPart {
  order_type: LineDetail['order_type'];
  business_date: string;
  token: number | null;
  car_number: string | null;
  car_type: 'sedan' | 'mini' | 'large' | null;
  primary_table_id: string | null;
  tables: string;
}

const TICKET_SQL = `
SELECT t.ticket_id, t.station_id, t.order_id, t.fired_at, so.show_taker, so.show_order_id,
       tl.order_item_id, tl.done_at,
       l.line_kind, l.name, l.units, l.units - l.removed_units - l.voided_units AS live_units, l.kitchen_note,
       p.line_kind AS parent_kind, p.name AS parent_name,
       (SELECT json_group_array(json_object('name', c.name, 'live', c.live))
          FROM (SELECT c0.name, c0.units - c0.removed_units - c0.voided_units AS live FROM order_lines c0
                 WHERE c0.order_id = l.order_id AND c0.parent_order_item_id = l.order_item_id
                   AND c0.line_kind = 'option_child' AND c0.is_food = 0 AND c0.served_from_zone_id IS NULL
                   AND c0.units - c0.removed_units - c0.voided_units > 0
                   AND NOT EXISTS (SELECT 1 FROM ticket_lines x WHERE x.order_item_id = c0.order_item_id)
                 ORDER BY c0.added_at, c0.rowid) c) AS options,
       o.order_type, o.business_date, o.token, o.car_number, o.car_type, o.order_note,
       s.display_name AS placed_by_name, se.primary_table_id,
       (SELECT json_group_array(st.table_id)
          FROM (SELECT st0.table_id FROM seating_tables st0 WHERE st0.seating_id = se.seating_id
                 ORDER BY st0.joined_at, st0.table_id) st) AS tables,
       r.order_item_id AS r_order_item_id, r.name AS r_name,
       ro.order_type AS r_order_type, ro.business_date AS r_business_date, ro.token AS r_token,
       ro.car_number AS r_car_number, ro.car_type AS r_car_type, rse.primary_table_id AS r_primary_table_id,
       (SELECT json_group_array(st.table_id)
          FROM (SELECT st0.table_id FROM seating_tables st0 WHERE st0.seating_id = rse.seating_id
                 ORDER BY st0.joined_at, st0.table_id) st) AS r_tables,
       (SELECT COALESCE(SUM(json_extract(j.payload, '$.units')), 0) FROM print_jobs j
         WHERE j.ticket_id = t.ticket_id AND j.kind = 'cancel' AND j.is_reprint = 0  -- a re-sent slip is not a new cancel
           AND json_extract(j.payload, '$.order_item_id') = tl.order_item_id
           AND (j.created_at < @before_at OR (j.created_at = @before_at AND j.job_id < @before_id))) AS earlier_cancelled
  FROM tickets t
  JOIN ticket_lines tl ON tl.ticket_id = t.ticket_id
  JOIN order_lines l ON l.order_item_id = tl.order_item_id
  JOIN orders o ON o.order_id = t.order_id
  LEFT JOIN station_outputs so ON so.station_id = t.station_id
  LEFT JOIN staff s ON s.staff_id = o.placed_by
  LEFT JOIN order_lines p ON p.order_item_id = l.parent_order_item_id
  LEFT JOIN seating_orders sto ON sto.order_id = o.order_id
  LEFT JOIN seatings se ON se.seating_id = sto.seating_id
  LEFT JOIN order_lines r ON r.order_item_id = l.return_of
  LEFT JOIN orders ro ON ro.order_id = r.order_id
  LEFT JOIN seating_orders rsto ON rsto.order_id = ro.order_id
  LEFT JOIN seatings rse ON rse.seating_id = rsto.seating_id
 WHERE t.ticket_id = @ticket_id
 ORDER BY l.added_at, l.rowid`;

interface TicketLine {
  order_item_id: string;
  done: boolean;
  live_units: number;
  units: number;
  earlier_cancelled: number;
  text: string; // "3 x Naan - for Chicken Karahi", "1 x Chicken Karahi (Karahi combo)"
  name: string;
  options: string[];
  kitchen_note: string | null;
  return_of: { mode: 'fix' | 'remake' | null; item_name: string; identifier: Identifier } | null; // mode null: engine gone
  first: boolean; // engine mark boost / expedite
}

interface Ticket {
  station_id: string;
  fired_at: number;
  order_id: string;
  identifier: Identifier;
  order_type: LineDetail['order_type'];
  placed_by_name: string | null;
  show_taker: boolean;
  show_order_id: boolean;
  order_note: string | null;
  lines: TicketLine[];
}

function lineText(units: number, name: string, for_parent: string | null, deal_name: string | null): string {
  return `${units} x ${name}${for_parent === null ? '' : ` - for ${for_parent}`}${deal_name === null ? '' : ` (${deal_name})`}`;
}

/** From stored data: the open seating's tables (primary first, then join order), else the primary table alone. */
function fallbackIdentifier(r: OrderPart, state: EngineState): Identifier {
  if (r.order_type === 'dine_in') {
    const names = new Map((branchConfig()?.floors ?? []).flatMap((f) => f.tables.map((t) => [t.table_id, t.name] as const)));
    const joined = (JSON.parse(r.tables) as string[]).filter((t) => t !== r.primary_table_id);
    const ids = r.primary_table_id === null ? joined : [r.primary_table_id, ...joined];
    return { kind: 'table', label: ids.map((t) => tableLabel(names.get(t) ?? t)).join(' + ') };
  }
  if (r.order_type === 'takeaway') {
    const today = state.business_day?.business_date ?? null;
    return { kind: 'token', token: r.token ?? 0, date: r.business_date === today ? null : r.business_date };
  }
  return { kind: 'parking', car_number: r.car_number ?? '', car_type: r.car_type ?? 'sedan' };
}

function fallbackReturn(r: Row, state: EngineState): Ticket['lines'][number]['return_of'] {
  if (r.r_order_item_id === null || r.r_order_type === null) return null;
  const identifier = fallbackIdentifier(
    {
      order_type: r.r_order_type,
      business_date: r.r_business_date ?? '',
      token: r.r_token,
      car_number: r.r_car_number,
      car_type: r.r_car_type,
      primary_table_id: r.r_primary_table_id,
      tables: r.r_tables,
    },
    state,
  );
  return { mode: null, item_name: r.r_name ?? '', identifier };
}

/** §3.6: 3 statements. null = no such ticket (or none of its lines left in order_lines). */
function readTicket(db: Database.Database, state: EngineState, ticket_id: string, before: { at: number; id: string } = { at: -1, id: '' }): Ticket | null {
  const rows = db.prepare(TICKET_SQL).all({ ticket_id, before_at: before.at, before_id: before.id }) as Row[];
  const first = rows[0];
  if (first === undefined) return null;
  const details = buildLineDetails(db, state, rows.map((r) => r.order_item_id));
  const any = rows.map((r) => details.get(r.order_item_id)).find((d) => d !== undefined);
  return {
    station_id: first.station_id,
    fired_at: first.fired_at,
    order_id: first.order_id,
    identifier: any?.identifier ?? fallbackIdentifier(first, state),
    order_type: first.order_type,
    placed_by_name: first.placed_by_name,
    show_taker: first.show_taker !== 0,
    show_order_id: first.show_order_id !== 0,
    order_note: first.order_note,
    lines: rows.map((r): TicketLine => {
      const d = details.get(r.order_item_id);
      const mark = state.lines[r.order_item_id]?.mark ?? null;
      const for_parent = d !== undefined ? d.for_parent : r.line_kind === 'option_child' ? r.parent_name : null;
      const deal_name = d !== undefined ? d.deal_name : r.line_kind === 'deal_part' && r.parent_kind === 'deal' ? r.parent_name : null;
      const name = d?.item_name ?? r.name;
      return {
        order_item_id: r.order_item_id,
        done: r.done_at !== null,
        live_units: r.live_units,
        units: r.units,
        earlier_cancelled: r.earlier_cancelled,
        text: lineText(r.live_units, name, for_parent, deal_name),
        name,
        // Options always from this read (live, station-less, not zone-served, no own ticket line), with their units
        // ("+ 2 x Raita"): LineDetail.options are names only and also list zone-served children. Plain options: B3-2.
        options: (JSON.parse(r.options) as Array<{ name: string; live: number }>).map((c) => (c.live > 1 ? `${c.live} x ${c.name}` : c.name)),
        kitchen_note: d !== undefined ? d.kitchen_note : r.kitchen_note,
        return_of: d !== undefined ? d.return_of : fallbackReturn(r, state),
        first: mark === 'boost' || mark === 'expedite',
      };
    }),
  };
}

// ---- layout ---------------------------------------------------------------------------------------------------------

const stationName = (station_id: string): string => branchConfig()?.stations.find((s) => s.station_id === station_id)?.name ?? station_id;

/** "TANDOOR                 1:22 PM" on one line when both fit, else two lines (the time right-aligned). */
function spread(left: string, right: string, cols: number, bold: boolean): DocBlock[] {
  const l = mapText(left);
  if (l.length + 1 + right.length <= cols) return [{ text: l + ' '.repeat(cols - l.length - right.length) + right, bold }];
  return [{ text: l, bold }, { text: right, bold, align: 'right' }];
}

const reprintHeader = (is_reprint: boolean): DocBlock[] => (is_reprint ? [{ text: '** REPRINT **', bold: true, align: 'center' }] : []);

function ticketDoc(t: Ticket, lines: TicketLine[], ctx: RenderCtx, is_reprint: boolean): Doc {
  const cols = ctx.width_cols;
  const ident = identifierText(t.identifier);
  const meta = [ORDER_TYPE[t.order_type]];
  if (t.show_taker && t.placed_by_name !== null) meta.push(t.placed_by_name);
  if (t.show_order_id) meta.push(`#${t.order_id.slice(-6)}`);
  const blocks: DocBlock[] = [
    ...reprintHeader(is_reprint),
    ...spread(stationName(t.station_id).toUpperCase(), clock12(t.fired_at, ctx.utc_offset_ms), cols, true),
    { text: '='.repeat(cols) },
    { text: ident, size: 2, bold: true, align: 'center' },
    { text: meta.join('  ') },
  ];
  for (const l of lines) {
    if (l.return_of !== null) {
      const was = `${identifierText(l.return_of.identifier)} ${l.return_of.item_name}`;
      const mode = l.return_of.mode === null ? '' : ` - ${l.return_of.mode.toUpperCase()}`;
      blocks.push({ text: `** RETURN${mode} - was ${was} **`, bold: true });
    }
  }
  if (lines.some((l) => l.first)) blocks.push({ text: `** FIRST - ${ident} is eating **`, bold: true });
  blocks.push({ rule: true });
  for (const l of lines) {
    blocks.push({ text: l.text, bold: true });
    for (const o of l.options) blocks.push({ text: `    + ${o}` });
    if (l.kitchen_note !== null && l.kitchen_note !== '') blocks.push({ text: `    NOTE: ${l.kitchen_note}` });
  }
  if (t.order_note !== null && t.order_note !== '') blocks.push({ rule: true }, { text: `ORDER NOTE: ${t.order_note}` });
  blocks.push({ cut: true });
  return { width_cols: cols, blocks };
}

function slipDoc(t: Ticket, texts: string[], ctx: RenderCtx, is_reprint: boolean): Doc {
  return {
    width_cols: ctx.width_cols,
    blocks: [
      ...reprintHeader(is_reprint),
      ...spread(stationName(t.station_id).toUpperCase(), clock12(ctx.now, ctx.utc_offset_ms), ctx.width_cols, false),
      ...texts.map((text): DocBlock => ({ text, bold: true })),
      { cut: true },
    ],
  };
}

function comingUpDoc(ctx: RenderCtx, station_id: string, is_reprint: boolean): Doc {
  const plan = stationPlan(ctx.state, station_id, ctx.now).lines;
  const details = buildLineDetails(ctx.db, ctx.state, plan.map((l) => l.order_item_id));
  const blocks: DocBlock[] = [
    ...reprintHeader(is_reprint),
    { text: 'COMING UP', size: 2, bold: true, align: 'center' },
    ...spread(stationName(station_id).toUpperCase(), clock12(ctx.now, ctx.utc_offset_ms), ctx.width_cols, false),
    { text: '='.repeat(ctx.width_cols) },
  ];
  let n = 0;
  for (const p of plan) {
    const d = details.get(p.order_item_id);
    if (d === undefined || d.units <= 0) continue;
    n += 1;
    const what = lineText(d.units, d.item_name, d.for_parent, d.deal_name);
    blocks.push({ text: `${clock12(p.fire_ms, ctx.utc_offset_ms)}  ${identifierText(d.identifier)}  ${what}` });
  }
  if (n === 0) blocks.push({ text: 'Nothing coming up' });
  blocks.push({ cut: true });
  return { width_cols: ctx.width_cols, blocks };
}

/**
 * §3.6 render at send. kitchen → the not-done live lines; reprint → every live line; cancel / first → their slip
 * (null when the line is done / served / gone); coming_up → stationPlan (null when older than 10 min).
 */
export function renderJob(ctx: RenderCtx, job: RenderJob): Doc | null {
  if (job.kind === 'coming_up') {
    if (ctx.now - job.created_at > COMING_UP_STALE_MS) return null;
    return comingUpDoc(ctx, job.station_id, job.is_reprint);
  }
  const t = readTicket(ctx.db, ctx.state, job.ticket_id, job.kind === 'cancel' ? { at: job.created_at, id: job.job_id } : undefined);
  if (t === null) return null;
  const ident = identifierText(t.identifier);
  if (job.kind === 'kitchen' || job.kind === 'reprint') {
    const every = job.kind === 'reprint';
    const lines = t.lines.filter((l) => l.live_units > 0 && (every || !l.done));
    return lines.length === 0 ? null : ticketDoc(t, lines, ctx, every || job.is_reprint);
  }
  if (job.kind === 'cancel') {
    const l = t.lines.find((x) => x.order_item_id === job.order_item_id);
    if (l === undefined || l.done) return null;
    // §3.5: a partial slip names its units, the units left are read at send (D2); a whole-line slip (units null)
    // names the units still to cancel = ordered units − the units of the line's earlier cancel jobs (02b M-5).
    const text =
      job.units === null
        ? `CANCELLED  ${ident}  ${Math.max(0, l.units - l.earlier_cancelled)} x ${l.name}`
        : `CANCELLED  ${ident}  - ${job.units} x ${l.name}  ${l.live_units} left`;
    return slipDoc(t, [text], ctx, job.is_reprint);
  }
  const ids = new Set(job.order_item_ids);
  const lines = t.lines.filter((l) => ids.has(l.order_item_id) && !l.done && l.live_units > 0);
  if (lines.length === 0) return null;
  return slipDoc(t, lines.map((l) => `FIRST  ${ident}  ${l.live_units} x ${l.name} (${job.reason})`), ctx, job.is_reprint);
}
