import { ALERT_CONSTANTS } from '@pos/domain';
import type { AlertView } from '@pos/events';
import { activity } from '../auth/session-store.js';
import type { StaffDirectory } from '../auth/staff-directory.js';
import type { WriterTx } from '../engine-host/writer.js';
import type { WsHub } from '../ws/server.js';
import type { AlertKind } from './kinds.js';
import { isPresent, managers, targetKey, type BatchReads, type BindingRead, type Recipient, type RecipientRow } from './targets.js';

// 01d §3.4.3 routes of a person (screen, alert connection (a)(b)(c), registered routes), the no-route rule
// with its "for" rows (lead_fallback kinds only), the §3.4.2 table-team fallback, and §3.8 registerRoute.
// Pure over the batch reads and the in-memory socket lists: no statement here except `askRoutes`, which is
// the §3.5 read (10) (one `routesFor` call per registered route per tick or raise).

// ------------------------------------------------------------------------------------- registered routes

/** §3.8, exactly. `send` runs after commit (ws-frames, task 20); it must not throw. */
export interface RouteDef {
  route: string;
  format: 'text' | 'short_code';
  ack: boolean;
  receipts: ReadonlyArray<'delivered' | 'seen'>;
  routesFor(tx: WriterTx, staffIds: string[]): Map<string, Array<{ route_ref: string }>>;
  send(alert: AlertView, step: number, route_ref: string): void;
}

/** An `AttemptSent` / `EscalationStepped` `routes[]` entry (§4.2). */
export interface RouteRow {
  staff_id: string | null;
  route: string;
  ref: string;
}

/** A registered route hit for one person (BatchReads.routes value). */
export type RegisteredHit = { route: string; ref: string };

const BUILT_IN_ROUTES: ReadonlySet<string> = new Set(['screen', 'alert_connection']);
const routes = new Map<string, RouteDef>();

/** §3.8: registered at startup by the owning module (01e's pager). Duplicate or built-in name → Error. */
export function registerRoute(def: RouteDef): void {
  if (def.route === '' || BUILT_IN_ROUTES.has(def.route)) throw new Error(`registerRoute('${def.route}'): reserved route name`);
  if (routes.has(def.route)) throw new Error(`registerRoute('${def.route}'): already registered`);
  routes.set(def.route, def);
}

/** Tests only (fakes' `resetFakes`). Production never unregisters. */
export function unregisterRoute(route: string): void {
  routes.delete(route);
}

/** Every registered route, in registration order (ws-frames' after-commit `send`, task 20). */
export function registeredRoutes(): RouteDef[] {
  return [...routes.values()];
}

/**
 * §3.5 read (10) / §3.8: one `routesFor` call per registered route with every asked person (one statement
 * per call is the route's contract, test 35). No person → no call. Result: staff_id → hits, route order.
 */
export function askRoutes(tx: WriterTx, staffIds: readonly string[]): Map<string, RegisteredHit[]> {
  const out = new Map<string, RegisteredHit[]>();
  const ids = [...new Set(staffIds)];
  if (ids.length === 0) return out;
  const asked = new Set(ids);
  for (const def of routes.values()) {
    for (const [staffId, refs] of def.routesFor(tx, ids)) {
      if (!asked.has(staffId) || refs.length === 0) continue;
      const hits = out.get(staffId) ?? [];
      for (const { route_ref } of refs) hits.push({ route: def.route, ref: route_ref });
      out.set(staffId, hits);
    }
  }
  return out;
}

/**
 * The people `askRoutes` must ask for one tick (or raise): every person recipient of every step, then,
 * for `lead_fallback` kinds, every person a fallback could reach (§3.4.3 leads, §3.4.2 zone order takers
 * from `reads.resolved`, present managers), so a fallback's "has a route" test sees registered routes too.
 * In memory; first-seen order.
 */
export function routeAsk(steps: ReadonlyArray<{ recipients: readonly Recipient[]; kind: AlertKind }>, reads: BatchReads, directory: StaffDirectory): string[] {
  const out = new Set<string>();
  for (const { recipients } of steps) for (const r of recipients) if (r.staff_id !== null) out.add(r.staff_id);
  const candidates = new Set<string>();
  let anyFallback = false;
  for (const { recipients, kind } of steps) {
    if (!kind.lead_fallback) continue;
    anyFallback = true;
    for (const r of recipients) {
      const subject = r.staff_id ?? r.table_team?.owner_staff_id ?? null;
      if (subject === null) continue;
      const lead = leadOf(directory, subject);
      if (lead !== null) candidates.add(lead);
      if (r.table_team !== undefined) for (const id of zoneOrderTakers(reads, r.table_team.table_id)) candidates.add(id);
    }
  }
  if (anyFallback) for (const id of presentManagers(reads, directory)) candidates.add(id);
  for (const id of candidates) out.add(id);
  return [...out];
}

// ------------------------------------------------------------------------------------------ binding rule

/**
 * §3.4.3 alert connection, §3.7: a binding is a route only while (a) its device is connected now (an
 * alert-mode socket or a session socket of that device), (b) the person is not absent (§3.4.1 safety rule),
 * and, for a tablet, (c) the person's last session activity is within `binding_route_idle_ms` of `now`.
 * Only tablets and phones route (a kiosk or KDS row never does, BF-3); a device not in read (5) never does.
 * `until` (BF-5 `binding_route_until`) = last activity + idle for a tablet with known activity, else null.
 */
export function bindingIsRoute(binding: BindingRead, reads: BatchReads, ws: WsHub, now: number): { route: boolean; until: number | null } {
  const device = reads.devices.find((d) => d.device_id === binding.device_id);
  if (device === undefined || (device.device_type !== 'tablet' && device.device_type !== 'phone')) return { route: false, until: null };
  const connected =
    ws.alertSockets().some((s) => s.deviceId === binding.device_id) || ws.connectedSessions().some((s) => s.deviceId === binding.device_id);
  const present = isPresent(reads, binding.staff_id);
  if (device.device_type === 'phone') return { route: connected && present, until: null };
  const last = lastActivity(reads, binding.staff_id);
  if (last === null) return { route: false, until: null };
  const until = last + ALERT_CONSTANTS.binding_route_idle_ms;
  return { route: connected && present && now <= until, until };
}

/**
 * §3.4.3 (c): the greatest of read (9) (staff_sessions `last_activity_at`, active or ended) and, for each
 * active session of the person (read 3), its row value and the in-memory activity value when newer.
 */
function lastActivity(reads: BatchReads, staffId: string): number | null {
  let last = reads.activity.get(staffId) ?? null;
  for (const session of reads.sessions) {
    if (session.staff_id !== staffId) continue;
    const value = Math.max(session.last_activity_at, activity.get(session.session_id) ?? 0);
    if (last === null || value > last) last = value;
  }
  return last;
}

// ------------------------------------------------------------------------------------------- routes

/** §3.4.3 routes of one person: screen sockets, binding routes, registered routes (deduped). */
function personRoutes(staffId: string, reads: BatchReads, ws: WsHub, now: number): RouteRow[] {
  const out: RouteRow[] = [];
  const seen = new Set<string>();
  const push = (route: string, ref: string): void => {
    const key = `${route}\u0000${ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ staff_id: staffId, route, ref });
  };
  for (const s of ws.connectedSessions()) if (s.kind === 'staff' && s.staffId === staffId) push('screen', s.deviceId);
  for (const b of reads.bindings) if (b.staff_id === staffId && bindingIsRoute(b, reads, ws, now).route) push('alert_connection', b.device_id);
  for (const hit of reads.routes?.get(staffId) ?? []) push(hit.route, hit.ref);
  return out;
}

/** A device recipient's routes: its session sockets (staff or station) and its alert-mode socket. */
function deviceRoutes(deviceId: string, ws: WsHub): RouteRow[] {
  const out: RouteRow[] = [];
  if (ws.connectedSessions().some((s) => s.deviceId === deviceId)) out.push({ staff_id: null, route: 'screen', ref: deviceId });
  if (ws.alertSockets().some((s) => s.deviceId === deviceId)) out.push({ staff_id: null, route: 'alert_connection', ref: deviceId });
  return out;
}

/**
 * §3.4.3 for one step of one alert: every recipient row (a person with no route included, v0.5 N5, unless a
 * "for" row on a lead stands in for them), the
 * routes of each, and, for a `lead_fallback` kind, the "for" rows of the people with no route:
 * lead → (a table owner not signed in anywhere, §3.4.2) the zone's order taker → present managers. At each
 * level only people with a route are used; a level that would reach the person themself or anyone already
 * in this step stops the chain (no loop, no second copy). Owner markers (absent owners, targets.ts) are
 * never rows. `no_route` lists the person recipients with no route (the G1-9d shortcut, receipt view).
 */
export function routeRecipients(
  recipients: readonly Recipient[],
  kind: AlertKind,
  reads: BatchReads,
  directory: StaffDirectory,
  ws: WsHub,
  now: number,
): { recipients: RecipientRow[]; routes: RouteRow[]; no_route: string[] } {
  if (routes.size > 0 && reads.routes === undefined) {
    throw new Error('routeRecipients: reads.routes is missing while a route is registered (askRoutes before routing)');
  }
  const rows: RecipientRow[] = [];
  const routeRows: RouteRow[] = [];
  const routeSeen = new Set<string>();
  const addRoutes = (list: RouteRow[]): void => {
    for (const r of list) {
      const key = `${r.staff_id ?? ''}\u0000${r.route}\u0000${r.ref}`;
      if (routeSeen.has(key)) continue;
      routeSeen.add(key);
      routeRows.push(r);
    }
  };
  const routeCache = new Map<string, RouteRow[]>();
  const routesOf = (staffId: string): RouteRow[] => {
    let list = routeCache.get(staffId);
    if (list === undefined) {
      list = personRoutes(staffId, reads, ws, now);
      routeCache.set(staffId, list);
    }
    return list;
  };

  const inStep = new Set<string>();
  for (const r of recipients) if (r.staff_id !== null) inStep.add(r.staff_id);

  const noRoute: Recipient[] = [];
  for (const r of recipients) {
    if (r.staff_id !== null) {
      rows.push({ staff_id: r.staff_id, device_id: null, for_staff_id: null, set: r.set });
      const own = routesOf(r.staff_id);
      addRoutes(own);
      if (own.length === 0) noRoute.push(r);
    } else if (r.device_id !== null) {
      rows.push({ staff_id: null, device_id: r.device_id, for_staff_id: null, set: r.set });
      addRoutes(deviceRoutes(r.device_id, ws));
    } else if (r.table_team !== undefined && !inStep.has(r.table_team.owner_staff_id)) {
      noRoute.push(r); // an absent owner: §3.4.2 fallback only
    }
  }

  // §3.4.3 "For" rows (G2 #18): the recipient row is the lead; the person it is for has no row (so no
  // alert_inbox row) for this step until a later step reaches them directly. Only when no fallback reached
  // anyone is the person written with no route (v0.5 N5).
  const coveredFor = new Set<string>();
  if (kind.lead_fallback) {
    const forSeen = new Set<string>();
    for (const r of noRoute) {
      const subject = r.staff_id ?? (r.table_team as NonNullable<Recipient['table_team']>).owner_staff_id;
      for (const leadId of fallbackFor(subject, r, reads, directory, inStep, routesOf)) {
        const key = `${leadId}\u0000${subject}`;
        if (forSeen.has(key)) continue;
        forSeen.add(key);
        rows.push({ staff_id: leadId, device_id: null, for_staff_id: subject, set: r.set });
        addRoutes(routesOf(leadId));
        coveredFor.add(subject);
      }
    }
  }
  const recipientRows = coveredFor.size === 0 ? rows : rows.filter((row) => row.for_staff_id !== null || row.staff_id === null || !coveredFor.has(row.staff_id));

  const no_route = [...new Set(noRoute.flatMap((r) => (r.staff_id === null ? [] : [r.staff_id])))];
  return { recipients: recipientRows, routes: routeRows, no_route };
}

/** The people who take a "for" row for `subject`, or none (§3.4.3 chain, §3.4.2 table-team level). */
function fallbackFor(
  subject: string,
  recipient: Recipient,
  reads: BatchReads,
  directory: StaffDirectory,
  inStep: ReadonlySet<string>,
  routesOf: (staffId: string) => RouteRow[],
): string[] {
  const lead = leadOf(directory, subject);
  const levels: string[][] = [lead === null ? [] : [lead]];
  const signedInAnywhere = reads.sessions.some((s) => s.staff_id === subject);
  if (recipient.table_team !== undefined && !signedInAnywhere) levels.push(zoneOrderTakers(reads, recipient.table_team.table_id));
  levels.push(presentManagers(reads, directory));
  for (const level of levels) {
    if (level.some((id) => id === subject || inStep.has(id))) return [];
    const reachable = level.filter((id) => routesOf(id).length > 0);
    if (reachable.length > 0) return reachable;
  }
  return [];
}

/** 01b §3.5 lead of a person, or of a `no_pin_staff` person (team targets include them, G1-17). */
function leadOf(directory: StaffDirectory, staffId: string): string | null {
  if (directory.get(staffId) !== undefined) return directory.leadOf(staffId);
  return directory.noPinStaff().find((p) => p.staff_id === staffId)?.lead_staff_id ?? null;
}

/** §3.4.2: the zone's order taker(s) for a table, from read (8) when task 18 resolved it; else none. */
function zoneOrderTakers(reads: BatchReads, tableId: string): string[] {
  return reads.resolved.get(targetKey({ kind: 'zone_order_taker', table_id: tableId }))?.staff_ids ?? [];
}

/** §3.4 `managers` with the §3.4.1 presence filter, as a target would resolve them. */
function presentManagers(reads: BatchReads, directory: StaffDirectory): string[] {
  return managers(directory).filter((id) => isPresent(reads, id));
}
