// Audit log map, pure and browser-safe [04 §3.6, §4.2]. The hub's `audit` projection folds it (04 §5); 06's
// cloud audit view uses the same map over synced events (04 §4.3 To 06). Events only: `lookups` holds what the fold
// itself built from earlier events (audit_requests, audit_orders); names are never part of an entry (joined at read).
import type { ANSWER_METHODS } from './alert-constants.js';

/** The fields of a stored event this map reads (structurally a `@pos/events` PosEvent). */
export interface AuditEvent {
  seq: number;
  event_id: string;
  event_type: string;
  stream_type: string;
  stream_id: string;
  recorded_at: number;
  actor_id: string | null;
  device_id: string;
  payload: Record<string, unknown>;
}

/** 04 §3.6 `requestOf`: one `audit_requests` row (from `AlertRaised` with `request ≠ null`, answerer from `RequestAnswered`). */
export interface AuditRequestRef {
  kind: string;
  requester_staff_id: string | null;
  order_id: string | null;
  table_code: string | null;
  answerer_staff_id: string | null;
}

export interface AuditLookups {
  requestOf(alert_id: string): AuditRequestRef | null;
  /** `audit_orders`: the table the order was placed at (`OrderPlaced.table_id`). */
  tableOf(order_id: string): string | null;
}

export type AuditMethod = (typeof ANSWER_METHODS)[number];

/** `detail_json`: the rest of the row; `envelope_actor_id` is always set (04 §3.6). */
export interface AuditDetail {
  envelope_actor_id: string | null;
  [key: string]: unknown;
}

/** One `audit_entries` row (04 §5); `detail` is stored as `detail_json`. */
export interface AuditEntry {
  seq: number;
  event_id: string;
  recorded_at: number;
  action: string;
  actor_staff_id: string | null;
  approver_staff_id: string | null;
  method: AuditMethod | null;
  device_id: string;
  subject_type: string;
  subject_id: string;
  order_id: string | null;
  table_code: string | null;
  table_id: string | null;
  reason: string | null;
  outcome: string | null;
  amount_minor: number | null;
  detail: AuditDetail;
}

/**
 * What one event's map returns. Absent columns take the defaults of 04 §3.6 "every other action": actor = envelope
 * actor, approver / method / reason / outcome / amount null; `order_id` = the stream id on an `order` stream;
 * `table_id` = `tableOf(order_id)`. The envelope columns and `detail.envelope_actor_id` are always the event's.
 */
export interface AuditMapped {
  action: string;
  subject_type: string;
  subject_id: string;
  actor_staff_id?: string | null;
  approver_staff_id?: string | null;
  method?: AuditMethod | null;
  order_id?: string | null;
  table_code?: string | null;
  table_id?: string | null;
  reason?: string | null;
  outcome?: string | null;
  amount_minor?: number | null;
  detail?: Record<string, unknown>;
}

export type AuditMap = (event: AuditEvent, lookups: AuditLookups) => AuditMapped | null;

/** 04 §3.6 action table, exactly. */
export const AUDIT_ACTIONS = [
  'void_requested',
  'void_answered',
  'comp_answered',
  'request_answered',
  'request_withdrawn',
  'request_pin_failed',
  'item_voided',
  'item_moved_to_stock',
  'item_removed',
  'comp_requested',
  'line_comped',
  'item_returned',
  'line_weight_set',
  'order_boosted',
  'order_cancelled',
  'day_opened',
  'day_closed',
  'table_lock_force_released',
  'table_holder_changed',
  'pin_locked_out',
  'device_pin_locked_out',
  'pin_lockout_cleared',
  'device_paired',
  'device_revoked',
  'pairing_token_generated',
  'station_paused',
  'station_capacity_set',
  'item_availability_set',
  'request_closed',
  'stock_set',
  'stock_added',
  'zone_stock_set',
  'zone_stock_added',
  'stock_transferred_out',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// ------------------------------------------------------------------------------------------------ payload reads

function str(p: Record<string, unknown>, key: string): string | null {
  const v = p[key];
  return typeof v === 'string' ? v : null;
}

function num(p: Record<string, unknown>, key: string): number | null {
  const v = p[key];
  return typeof v === 'number' ? v : null;
}

function rec(p: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = p[key];
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const METHODS: readonly string[] = ['session', 'pin', 'in_person'];
function method(p: Record<string, unknown>): AuditMethod | null {
  const m = str(p, 'method');
  return m !== null && METHODS.includes(m) ? (m as AuditMethod) : null;
}

/** `reason_code[: note]`, ≤ 200, as CompLine builds it (04 §5 `reason`). */
function reasonText(p: Record<string, unknown>): string | null {
  const code = str(p, 'reason_code');
  if (code === null) return null;
  const note = str(p, 'note');
  return (note === null ? code : `${code}: ${note}`).slice(0, 200);
}

/** The request row of an event's `alert_id`, with its order / table columns. */
function requestCols(e: AuditEvent, l: AuditLookups): { req: AuditRequestRef | null; cols: Partial<AuditMapped> } {
  const alert_id = str(e.payload, 'alert_id');
  const req = alert_id === null ? null : l.requestOf(alert_id);
  if (req === null) return { req, cols: {} };
  const cols: Partial<AuditMapped> = { table_code: req.table_code };
  if (req.order_id !== null) cols.order_id = req.order_id;
  return { req, cols };
}

/** Request-family subject: the order when the request has one, else the event's own stream. */
function requestSubject(e: AuditEvent, req: AuditRequestRef | null): { subject_type: string; subject_id: string } {
  if (req?.order_id != null) return { subject_type: 'order', subject_id: req.order_id };
  return { subject_type: e.stream_type, subject_id: e.stream_id };
}

const order = (e: AuditEvent): { subject_type: string; subject_id: string } => ({ subject_type: 'order', subject_id: e.stream_id });

const DECISION_OUTCOME: Record<string, string> = { approve: 'approved', reject: 'rejected', accept: 'accepted', decline: 'declined' };

const REQUEST_ACTIONS: Record<string, { requested: AuditAction; answered: AuditAction }> = {
  void_approval: { requested: 'void_requested', answered: 'void_answered' },
  comp: { requested: 'comp_requested', answered: 'comp_answered' },
};

// ------------------------------------------------------------------------------------------------ the map

const BUILT_IN: Record<string, AuditMap> = {
  // void_requested / comp_requested: actor = requester_staff_id (§3.6). Other kinds fold audit_requests only.
  AlertRaised: (e) => {
    const p = e.payload;
    const kind = str(p, 'kind');
    if (p['request'] == null || kind === null) return null;
    const action = REQUEST_ACTIONS[kind]?.requested;
    if (action === undefined) return null;
    const values = rec(p, 'values');
    const details = rec(p, 'details');
    const order_id = str(p, 'subject_stream_type') === 'order' ? str(p, 'subject_stream_id') : null;
    return {
      action,
      subject_type: str(p, 'subject_stream_type') ?? e.stream_type,
      subject_id: str(p, 'subject_stream_id') ?? e.stream_id,
      actor_staff_id: str(p, 'requester_staff_id'),
      order_id,
      table_code: str(rec(p, 'display'), 'table_code'),
      reason: str(details, 'reason'),
      outcome: action === 'void_requested' ? str(values, 'disposition') : null,
      amount_minor: num(details, 'amount'),
      detail: {
        alert_id: str(p, 'alert_id'),
        order_item_id: str(values, 'order_item_id'),
        item: str(details, 'item'),
        units: num(values, 'units') ?? num(details, 'quantity'),
        ...(action === 'void_requested'
          ? { comp_voided_minor: num(values, 'comp_voided_minor'), disposition_label: str(details, 'disposition') }
          : {}),
      },
    };
  },

  // *_answered: actor = requester, approver = answerer, method (§3.6).
  RequestAnswered: (e, l) => {
    const p = e.payload;
    const { req, cols } = requestCols(e, l);
    const decision = str(p, 'decision');
    return {
      ...cols,
      action: (req !== null ? REQUEST_ACTIONS[req.kind]?.answered : undefined) ?? 'request_answered',
      ...requestSubject(e, req),
      actor_staff_id: req?.requester_staff_id ?? null,
      approver_staff_id: str(p, 'answerer_staff_id'),
      method: method(p),
      outcome: decision === null ? null : (DECISION_OUTCOME[decision] ?? decision),
      detail: { alert_id: str(p, 'alert_id'), kind: req?.kind ?? null, on_requester_device: p['on_requester_device'] === true },
    };
  },

  RequestWithdrawn: (e, l) => {
    const { req, cols } = requestCols(e, l);
    return {
      ...cols,
      action: 'request_withdrawn',
      ...requestSubject(e, req),
      actor_staff_id: req?.requester_staff_id ?? str(e.payload, 'by_staff_id'),
      outcome: 'withdrawn',
      detail: { alert_id: str(e.payload, 'alert_id'), kind: req?.kind ?? null },
    };
  },

  // request_pin_failed: actor = the named answerer; the event is on the `audit` stream, its subject in the payload.
  RequestPinFailed: (e, l) => {
    const p = e.payload;
    const { req, cols } = requestCols(e, l);
    const subject_type = str(p, 'subject_stream_type') ?? e.stream_type;
    const subject_id = str(p, 'subject_stream_id') ?? e.stream_id;
    return {
      ...cols,
      action: 'request_pin_failed',
      subject_type,
      subject_id,
      ...(subject_type === 'order' ? { order_id: subject_id } : {}),
      actor_staff_id: str(p, 'answerer_staff_id'),
      method: method(p),
      outcome: str(p, 'outcome'),
      detail: {
        alert_id: str(p, 'alert_id'),
        kind: req?.kind ?? null,
        requester_staff_id: str(p, 'requester_staff_id'),
        error_code: str(p, 'error_code'),
      },
    };
  },

  // request_closed: only alerts that are requests (in audit_requests); actor = requester, approver = closer (H7-3).
  AlertClosed: (e, l) => {
    const p = e.payload;
    const { req, cols } = requestCols(e, l);
    if (req === null) return null;
    return {
      ...cols,
      action: 'request_closed',
      ...requestSubject(e, req),
      actor_staff_id: req.requester_staff_id,
      approver_staff_id: str(p, 'by_staff_id'),
      outcome: str(p, 'reason'),
      detail: { alert_id: str(p, 'alert_id'), kind: req.kind, note: str(p, 'note') },
    };
  },

  // item_voided: actor = payload requester (old events: envelope actor, H4-5), approver = payload approver.
  ItemVoided: (e, l) => {
    const p = e.payload;
    const { cols } = requestCols(e, l);
    return {
      ...cols,
      action: 'item_voided',
      ...order(e),
      actor_staff_id: str(p, 'requester_staff_id') ?? e.actor_id,
      approver_staff_id: str(p, 'approver_staff_id'),
      reason: reasonText(p),
      outcome: str(p, 'disposition'),
      amount_minor: num(p, 'refund_minor'),
      detail: {
        order_item_id: str(p, 'order_item_id'),
        units: num(p, 'units'),
        comp_voided_minor: num(p, 'comp_voided_minor'),
        alert_id: str(p, 'alert_id'),
        disposition_note: str(p, 'disposition_note'),
      },
    };
  },

  // item_moved_to_stock with alert_id: actor = requester, approver = answerer (both from audit_requests, H4-2).
  ItemMovedToStock: (e, l) => {
    const p = e.payload;
    const { req, cols } = requestCols(e, l);
    return {
      ...cols,
      action: 'item_moved_to_stock',
      ...order(e),
      ...(req !== null ? { actor_staff_id: req.requester_staff_id, approver_staff_id: req.answerer_staff_id } : {}),
      detail: { order_item_id: str(p, 'order_item_id'), units: num(p, 'units'), alert_id: str(p, 'alert_id') },
    };
  },

  ItemRemoved: (e) => ({
    action: 'item_removed',
    ...order(e),
    detail: { order_item_id: str(e.payload, 'order_item_id'), units: num(e.payload, 'units') },
  }),

  // line_comped: as item_voided (§3.6).
  LineComped: (e, l) => {
    const p = e.payload;
    const { cols } = requestCols(e, l);
    return {
      ...cols,
      action: 'line_comped',
      ...order(e),
      actor_staff_id: str(p, 'requester_staff_id') ?? e.actor_id,
      approver_staff_id: str(p, 'approver_staff_id'),
      reason: reasonText(p),
      amount_minor: num(p, 'value_minor'),
      detail: { order_item_id: str(p, 'order_item_id'), units: num(p, 'units'), alert_id: str(p, 'alert_id') },
    };
  },

  ItemReturned: (e) => ({
    action: 'item_returned',
    ...order(e),
    outcome: str(e.payload, 'mode'),
    detail: {
      order_item_id: str(e.payload, 'order_item_id'),
      replacement_order_item_id: str(e.payload, 'replacement_order_item_id'),
    },
  }),

  // item_returned for a fix: an OrderLinesAdded whose lines carry return_of.mode = 'fix' (a remake has its ItemReturned).
  OrderLinesAdded: (e) => {
    const lines = Array.isArray(e.payload['lines']) ? (e.payload['lines'] as unknown[]) : [];
    const fixes: Array<{ order_item_id: string | null; return_of: string | null }> = [];
    for (const line of lines) {
      if (typeof line !== 'object' || line === null) continue;
      const l = line as Record<string, unknown>;
      const ret = rec(l, 'return_of');
      if (str(ret, 'mode') === 'fix') fixes.push({ order_item_id: str(l, 'order_item_id'), return_of: str(ret, 'order_item_id') });
    }
    if (fixes.length === 0) return null;
    return { action: 'item_returned', ...order(e), outcome: 'fix', detail: { lines: fixes } };
  },

  LineWeightSet: (e) => ({
    action: 'line_weight_set',
    ...order(e),
    amount_minor: num(e.payload, 'line_total_minor'),
    detail: { order_item_id: str(e.payload, 'order_item_id'), quantity: num(e.payload, 'quantity') },
  }),

  OrderBoosted: (e) => ({ action: 'order_boosted', ...order(e) }),

  OrderCancelled: (e) => {
    const alert_id = str(e.payload, 'alert_id');
    return { action: 'order_cancelled', ...order(e), ...(alert_id !== null ? { detail: { alert_id } } : {}) };
  },

  BusinessDayOpened: (e) => ({
    action: 'day_opened',
    subject_type: 'day',
    subject_id: e.stream_id,
    detail: { business_date: str(e.payload, 'business_date') },
  }),

  BusinessDayClosed: (e) => ({ action: 'day_closed', subject_type: 'day', subject_id: e.stream_id }),

  TableLockReleased: (e) => {
    const p = e.payload;
    if (str(p, 'reason') !== 'force') return null;
    const table_id = str(p, 'table_id') ?? e.stream_id;
    return {
      action: 'table_lock_force_released',
      subject_type: 'table',
      subject_id: table_id,
      table_id,
      detail: { seating_id: str(p, 'seating_id'), holder_staff_id: str(p, 'staff_id'), alert_id: str(p, 'alert_id') },
    };
  },

  TableHolderChanged: (e) => {
    const p = e.payload;
    const table_id = str(p, 'table_id') ?? e.stream_id;
    return {
      action: 'table_holder_changed',
      subject_type: 'table',
      subject_id: table_id,
      table_id,
      reason: str(p, 'reason'),
      detail: {
        seating_id: str(p, 'seating_id'),
        from_staff_id: str(p, 'from_staff_id'),
        to_staff_id: str(p, 'to_staff_id'),
        alert_id: str(p, 'alert_id'),
      },
    };
  },

  StaffPinLockedOut: (e) => ({
    action: 'pin_locked_out',
    subject_type: 'staff',
    subject_id: str(e.payload, 'staff_id') ?? e.stream_id,
    detail: { locked_until: num(e.payload, 'locked_until'), failed_count: num(e.payload, 'failed_count') },
  }),

  DevicePinLockedOut: (e) => ({
    action: 'device_pin_locked_out',
    subject_type: str(e.payload, 'subject_type') ?? 'device',
    subject_id: str(e.payload, 'subject_id') ?? e.stream_id,
    detail: { locked_until: num(e.payload, 'locked_until'), failed_count: num(e.payload, 'failed_count') },
  }),

  PinLockoutCleared: (e) => ({
    action: 'pin_lockout_cleared',
    subject_type: str(e.payload, 'subject_type') ?? 'staff',
    subject_id: str(e.payload, 'subject_id') ?? e.stream_id,
  }),

  DevicePaired: (e) => {
    const p = e.payload;
    return {
      action: 'device_paired',
      subject_type: 'device',
      subject_id: str(p, 'device_id') ?? e.stream_id,
      detail: {
        device_name: str(p, 'device_name'),
        device_type: str(p, 'device_type'),
        station_id: str(p, 'station_id'),
        owner_staff_id: str(p, 'owner_staff_id'),
      },
    };
  },

  DeviceRevoked: (e) => ({
    action: 'device_revoked',
    subject_type: 'device',
    subject_id: str(e.payload, 'device_id') ?? e.stream_id,
    reason: str(e.payload, 'reason'),
    outcome: str(e.payload, 'cause'),
  }),

  DevicePairingTokenGenerated: (e) => {
    const p = e.payload;
    return {
      action: 'pairing_token_generated',
      subject_type: 'device',
      subject_id: str(p, 'pairing_token_id') ?? e.stream_id,
      detail: { device_type: str(p, 'device_type'), owner_staff_id: str(p, 'owner_staff_id'), expires_at: num(p, 'expires_at') },
    };
  },

  StationPauseSet: (e) => ({
    action: 'station_paused',
    subject_type: 'station',
    subject_id: str(e.payload, 'station_id') ?? e.stream_id,
    outcome: e.payload['paused'] === true ? 'paused' : 'resumed',
  }),

  StationCapacitySet: (e) => ({
    action: 'station_capacity_set',
    subject_type: 'station',
    subject_id: str(e.payload, 'station_id') ?? e.stream_id,
    reason: str(e.payload, 'reason'),
    detail: { capacity_override: num(e.payload, 'capacity_override'), previous: num(e.payload, 'previous') },
  }),

  ItemMadeAvailable: (e) => ({
    action: 'item_availability_set',
    subject_type: 'item',
    subject_id: str(e.payload, 'item_id') ?? e.stream_id,
    outcome: 'available',
  }),

  ItemMadeUnavailable: (e) => ({
    action: 'item_availability_set',
    subject_type: 'item',
    subject_id: str(e.payload, 'item_id') ?? e.stream_id,
    outcome: 'unavailable',
  }),

  StockSet: (e) => ({
    action: 'stock_set',
    subject_type: 'stock',
    subject_id: str(e.payload, 'stock_item_id') ?? e.stream_id,
    detail: { on_hand: num(e.payload, 'on_hand'), unit: str(e.payload, 'unit') },
  }),

  // stock_added: a manual add only; `reason: 'moved'` is covered by item_moved_to_stock (§3.6, H6-16).
  StockAdded: (e) => {
    if (e.payload['reason'] !== undefined) return null;
    return {
      action: 'stock_added',
      subject_type: 'stock',
      subject_id: str(e.payload, 'stock_item_id') ?? e.stream_id,
      detail: { quantity: num(e.payload, 'quantity'), unit: str(e.payload, 'unit') },
    };
  },

  ZoneStockSet: (e) => ({
    action: 'zone_stock_set',
    subject_type: 'zone',
    subject_id: str(e.payload, 'zone_id') ?? e.stream_id,
    detail: { item_id: str(e.payload, 'item_id'), on_hand: num(e.payload, 'on_hand'), previous: num(e.payload, 'previous') },
  }),

  ZoneStockAdded: (e) => ({
    action: 'zone_stock_added',
    subject_type: 'zone',
    subject_id: str(e.payload, 'zone_id') ?? e.stream_id,
    detail: { item_id: str(e.payload, 'item_id'), quantity: num(e.payload, 'quantity'), transfers: e.payload['transfers'] ?? [] },
  }),

  StockTransferredOut: (e) => ({
    action: 'stock_transferred_out',
    subject_type: 'stock',
    subject_id: str(e.payload, 'stock_item_id') ?? e.stream_id,
    detail: { quantity: num(e.payload, 'quantity'), zone_id: str(e.payload, 'zone_id') },
  }),
};

// ------------------------------------------------------------------------------------------------ registration

/** Never mapped (owner Q14; 02b O17 privacy), so not registrable either (04 test 56). */
const NEVER_MAPPED: readonly string[] = ['OrderContactSet'];

const registered = new Map<string, AuditMap>();

/**
 * 04 §4.2: a later module adds a mapped action (startup only, before the hub registers its projections). A
 * duplicate event type — registered twice or already mapped by 04 — is a startup error. A new mapping of an event
 * type with history ships with the checkpoint-delete migration (04 §3.6).
 */
export function registerAuditAction(event_type: string, map: AuditMap): void {
  if (NEVER_MAPPED.includes(event_type)) throw new Error(`audit: ${event_type} is never mapped (04 §3.6)`);
  if (event_type in BUILT_IN || registered.has(event_type)) {
    throw new Error(`audit: event type ${event_type} is already mapped`);
  }
  registered.set(event_type, map);
}

/** Tests only: drops every registered action (merge-guard precedent, `resetMergeGuard`). */
export function resetAuditActions(): void {
  registered.clear();
}

/** Every mapped event type (04's and registered ones): the `audit` projection's mapped event types. */
export function auditEventTypes(): string[] {
  return [...Object.keys(BUILT_IN), ...registered.keys()];
}

/** 04 §3.6: one event → its audit row, or null when the event (or this shape of it) is not an audit action. */
export function toAuditEntry(event: AuditEvent, lookups: AuditLookups): AuditEntry | null {
  const map = Object.hasOwn(BUILT_IN, event.event_type) ? BUILT_IN[event.event_type] : registered.get(event.event_type);
  if (map === undefined) return null;
  const m = map(event, lookups);
  if (m === null) return null;
  const order_id = m.order_id !== undefined ? m.order_id : event.stream_type === 'order' ? event.stream_id : null;
  const table_id = m.table_id !== undefined ? m.table_id : order_id === null ? null : lookups.tableOf(order_id);
  return {
    seq: event.seq,
    event_id: event.event_id,
    recorded_at: event.recorded_at,
    action: m.action,
    actor_staff_id: m.actor_staff_id !== undefined ? m.actor_staff_id : event.actor_id,
    approver_staff_id: m.approver_staff_id ?? null,
    method: m.method ?? null,
    device_id: event.device_id,
    subject_type: m.subject_type,
    subject_id: m.subject_id,
    order_id,
    table_code: m.table_code ?? null,
    table_id,
    reason: m.reason ?? null,
    outcome: m.outcome ?? null,
    amount_minor: m.amount_minor ?? null,
    detail: { ...m.detail, envelope_actor_id: event.actor_id },
  };
}
