import { DomainError, type DeviceType, type Permission } from '@pos/domain';
import type { AlertRaisedPayload, AlertTarget } from '@pos/events';
import type { StaffDirectory } from '../auth/staff-directory.js';
import type { WriterTx } from '../engine-host/writer.js';
import type { WsHub } from '../ws/server.js';
import { kindOf, type RecipientSet, type StepDef } from './kinds.js';
import { cachedPrepare } from './statements.js';

// 01d §3.4: who a step reaches. A target is resolved at each step from the batch reads (§3.5 "Reads per
// tick") and the in-memory directory, never frozen at raise. §3.4.1 presence filter (BF-8), §3.3 rules 5–6
// (answerers, holders_informed, mayAnswer). Routes of a person (§3.4.3) are routes.ts (task 17).
// No role name is read anywhere (R5): only permissions, and roles by id.

/** §3.2 `request`, as stored (`alerts.request_json` = the AlertRaised payload's request part). */
export type AlertRequestPart = NonNullable<AlertRaisedPayload['request']>;

/** The `alerts` row fields that resolution needs, parsed (task 18 reads it; the tick selects it). */
export interface AlertRow {
  alert_id: string;
  kind: string;
  requester_staff_id: string | null;
  target: AlertTarget;
  values: Record<string, unknown>;
  request: AlertRequestPart | null;
  step: number;
  raised_at: number;
}

/** §3.4.2: where a table-team recipient came from, captured before the presence filter. */
export interface TableTeamOrigin {
  table_id: string;
  owner_staff_id: string;
}

/**
 * A resolved recipient before routes (§3.4): a person or a device, with its set. `table_team` marks a
 * table's owner (§3.4.2 fallback, routes.ts). An owner dropped by the presence filter is kept as a marker
 * `{ staff_id: null, device_id: null, table_team }`: not a recipient, only the fallback's origin;
 * `routeRecipients` never writes it as a row.
 */
export interface Recipient {
  staff_id: string | null;
  device_id: string | null;
  set: RecipientSet;
  table_team?: TableTeamOrigin;
}

/** A stored recipient row (AttemptSent / EscalationStepped `recipients[]`, `alert_recipients`). */
export interface RecipientRow {
  staff_id: string | null;
  device_id: string | null;
  for_staff_id: string | null;
  set: RecipientSet;
}

/** §4.2 resolver result per target key. */
export interface ResolvedTarget {
  staff_ids: string[];
  device_ids: string[];
}

export interface SessionRead {
  session_id: string;
  staff_id: string;
  device_id: string;
  last_activity_at: number;
}

export interface BindingRead {
  device_id: string;
  staff_id: string;
  session_id: string | null;
  since: number;
}

export interface DeviceRead {
  device_id: string;
  device_type: DeviceType;
}

/** §3.5 "Reads per tick": the fixed reads (3)–(9), read once per tick / raise. */
export interface BatchReads {
  /** (3) active staff sessions with their device ids */
  sessions: SessionRead[];
  /** (4) device_bindings, whole table */
  bindings: BindingRead[];
  /** (5) devices not revoked */
  devices: DeviceRead[];
  /** (6) presence_today: staff_id → present (absent = a row with present = 0, BF-8) */
  presence: Map<string, boolean>;
  /** (9) last session activity of the bound staff: staff_id → ms */
  activity: Map<string, number>;
  /** (7) the previous step's recipients, by alert_id */
  prevRecipients: Map<string, RecipientRow[]>;
  /** (8) resolver results by targetKey (incl. `zone_order_taker:<table_id>` for §3.4.2 fallbacks) */
  resolved: Map<string, ResolvedTarget>;
  /**
   * (10) registered route results by staff_id (§3.8), from routes.ts `askRoutes(tx, routeAsk(…))` after
   * resolveStep. Optional only so hand-built reads without routes stay valid; `routeRecipients` throws when
   * a route is registered and this is missing.
   */
  routes?: Map<string, Array<{ route: string; ref: string }>>;
}

/** The fixed reads (3), (4), (5), (6), (9), cached per transaction (§3.5 "Several raises"). */
type FixedReads = Pick<BatchReads, 'sessions' | 'bindings' | 'devices' | 'presence' | 'activity'>;

/** Per-transaction state shared by batchReads and raise: the fixed reads and raise's returned dedupe keys. */
export interface AlertTxCache {
  fixed: FixedReads | null;
  /** `kind \0 dedupe_key` → the alert raise returned drafts for in this transaction (§4.2) */
  keys: Map<string, { alert_id: string; requester_staff_id: string | null }>;
}

/**
 * BF-6: an append of one of these drops the cached fixed reads (the projections changed what they read).
 * `DevicePaired` / `BusinessDayClosed` (devices, bindings, presence) are a controller-ruled superset.
 */
const STALE_ON: ReadonlySet<string> = new Set(['SessionStarted', 'SessionEnded', 'DeviceRevoked', 'PresenceSet', 'DevicePaired', 'BusinessDayClosed']);
/** A close of an alert in the transaction frees its key (a later raise with the key is a new alert). */
const CLOSES: ReadonlySet<string> = new Set(['AlertClosed', 'RequestAnswered', 'RequestWithdrawn']);
const txCaches = new WeakMap<WriterTx, AlertTxCache>();

/**
 * The per-transaction map keyed by `tx` (§3.5, §4.2). Created on first use; `tx.append` is wrapped once per
 * transaction so the appended events invalidate it (BF-6).
 */
export function alertTxCache(tx: WriterTx): AlertTxCache {
  let cache = txCaches.get(tx);
  if (cache !== undefined) return cache;
  const created: AlertTxCache = { fixed: null, keys: new Map() };
  const append = tx.append.bind(tx);
  tx.append = (drafts) => {
    const events = append(drafts);
    for (const event of events) {
      if (STALE_ON.has(event.event_type)) created.fixed = null;
      if (CLOSES.has(event.event_type)) {
        const closed = (event.payload as { alert_id?: unknown }).alert_id;
        for (const [key, value] of created.keys) if (value.alert_id === closed) created.keys.delete(key);
      }
    }
    return events;
  };
  txCaches.set(tx, created);
  cache = created;
  return cache;
}

/**
 * §3.4.3 (c): the sessions whose `last_activity_at` counts as a person's last session activity — `kind = 'staff'`
 * sessions at this branch (alias `s`, named parameter `@branch_id`). Shared by read (9) and alert-sockets.ts
 * (alerts_open, binding_route), so routing and the tablet header read the same activity.
 */
export const ACTIVITY_SESSIONS = "s.branch_id = @branch_id AND s.kind = 'staff'";

function readFixed(tx: WriterTx): FixedReads {
  const cache = alertTxCache(tx);
  if (cache.fixed !== null) return cache.fixed;
  // (3) active staff sessions with their device ids
  const sessions = cachedPrepare(
    tx.db,
    `SELECT session_id, staff_id, device_id, last_activity_at FROM staff_sessions
     WHERE branch_id = ? AND ended_at IS NULL AND kind = 'staff' ORDER BY session_id`,
  ).all(tx.branchId) as SessionRead[];
  // (4) device_bindings, whole table
  const bindings = cachedPrepare(tx.db, 'SELECT device_id, staff_id, session_id, since FROM device_bindings ORDER BY device_id').all() as BindingRead[];
  // (5) devices not revoked
  const devices = cachedPrepare(tx.db, 'SELECT device_id, device_type FROM devices WHERE branch_id = ? AND revoked_at IS NULL ORDER BY device_id').all(
    tx.branchId,
  ) as DeviceRead[];
  // (6) presence_today
  const presence = cachedPrepare(tx.db, 'SELECT staff_id, present FROM presence_today').all() as Array<{ staff_id: string; present: number }>;
  // (9) last session activity (active or ended) of every bound staff id: staff sessions of this branch only
  // (§3.4.3 (c); an admin session's activity never keeps a binding a route), index staff_sessions_staff_activity
  const activity = cachedPrepare(
    tx.db,
    `SELECT staff_id, MAX(last_activity_at) AS last FROM staff_sessions s
     WHERE ${ACTIVITY_SESSIONS} AND staff_id IN (SELECT staff_id FROM device_bindings) GROUP BY staff_id`,
  ).all({ branch_id: tx.branchId }) as Array<{ staff_id: string; last: number }>;
  cache.fixed = {
    sessions,
    bindings,
    devices,
    presence: new Map(presence.map((row) => [row.staff_id, row.present === 1])),
    activity: new Map(activity.map((row) => [row.staff_id, row.last])),
  };
  return cache.fixed;
}

/**
 * §3.5 / §4.2: the reads of a tick or raise. (3)–(6), (9) are cached per transaction (BF-6); (7) when
 * `previousStep`; (8) one call per resolver kind over the targets of the steps to resolve (`o.steps`:
 * alert_id → step indexes; default the alert's next step), plus, for `lead_fallback` kinds, the zone order
 * taker of each `table_team` table when that resolver is registered (§3.4.2). Read (10) (`routes`) needs the
 * resolved recipients, so the caller fills it with `askRoutes(tx, routeAsk(…))` (routes.ts).
 */
export function batchReads(
  tx: WriterTx,
  alerts: AlertRow[],
  o: { previousStep: boolean; steps?: ReadonlyMap<string, readonly number[]> },
): BatchReads {
  const fixed = readFixed(tx);
  const prevRecipients = new Map<string, RecipientRow[]>();
  const sent = alerts.filter((a) => a.step >= 0);
  if (o.previousStep && sent.length > 0) {
    // (7) the previous step's recipients of these alerts
    const rows = cachedPrepare(
      tx.db,
      `SELECT r.alert_id, r.staff_id, r.device_id, r.for_staff_id, r.recipient_set AS "set"
       FROM json_each(?) j JOIN alert_recipients r
         ON r.alert_id = json_extract(j.value, '$[0]') AND r.step = json_extract(j.value, '$[1]')
       ORDER BY r.rowid`,
    ).all(JSON.stringify(sent.map((a) => [a.alert_id, a.step]))) as Array<RecipientRow & { alert_id: string }>;
    for (const { alert_id, ...row } of rows) {
      const list = prevRecipients.get(alert_id) ?? [];
      list.push(row);
      prevRecipients.set(alert_id, list);
    }
  }
  const targets: AlertTarget[] = [];
  const zone = resolvers.has('zone_order_taker'); // §3.4.2 zone read only when that resolver is registered
  for (const alert of alerts) {
    const kind = kindOf(alert.kind);
    if (kind === undefined) continue;
    for (const index of o.steps?.get(alert.alert_id) ?? [alert.step + 1]) {
      const step = kind.steps[index];
      if (step === undefined) continue;
      for (const { target } of stepTargets(step, alert)) {
        targets.push(target);
        if (kind.lead_fallback && zone && target.kind === 'table_team') targets.push({ kind: 'zone_order_taker', table_id: target.table_id });
      }
    }
  }
  // (8) one call per resolver kind
  const resolved = resolveTargets(tx, targets);
  return { ...fixed, prevRecipients, resolved };
}

// ------------------------------------------------------------------------------------------- resolvers

export type ResolverKind = 'table_team' | 'point' | 'zone_order_taker';
type ResolverTarget<K extends ResolverKind> = Extract<AlertTarget, { kind: K }>;
export type TargetResolver<K extends ResolverKind = ResolverKind> = (
  tx: WriterTx,
  targets: Array<ResolverTarget<K>>,
) => Map<string, ResolvedTarget>;

const RESOLVER_KINDS: ReadonlySet<string> = new Set<ResolverKind>(['table_team', 'point', 'zone_order_taker']);
const resolvers = new Map<ResolverKind, TargetResolver>();

/** §4.2: batch-shaped, one call per tick (or raise) with every target of its kind, one SQL statement per call. */
export function registerTargetResolver<K extends ResolverKind>(kind: K, fn: TargetResolver<K>): void {
  if (resolvers.has(kind)) throw new Error(`registerTargetResolver('${kind}'): already registered`);
  resolvers.set(kind, fn as unknown as TargetResolver);
}

/** Tests only (fakes' `resetFakes`). Production never unregisters. */
export function unregisterTargetResolver(kind: ResolverKind): void {
  resolvers.delete(kind);
}

/**
 * The key a resolver result is stored under. `table_team` is keyed by table only: the resolver returns the
 * table's owner (`tableOwner`), and 01d adds the direct reports for `depth: 'direct'` (§3.4 table).
 */
export function targetKey(target: ResolverTarget<ResolverKind>): string {
  switch (target.kind) {
    case 'table_team':
      return `table_team:${target.table_id}`;
    case 'zone_order_taker':
      return `zone_order_taker:${target.table_id}`;
    case 'point':
      return `point:${target.point_id}`;
  }
}

function isResolverTarget(target: AlertTarget): target is ResolverTarget<ResolverKind> {
  return RESOLVER_KINDS.has(target.kind);
}

function unavailable(kind: string): DomainError {
  return new DomainError('VALIDATION_FAILED', { issue: 'target_unavailable', target_kind: kind });
}

/**
 * §3.5 read (8): one call per registered resolver kind among `targets`, with every distinct target of that
 * kind (in first-seen order). A resolver kind that is not registered → `VALIDATION_FAILED target_unavailable`.
 */
export function resolveTargets(tx: WriterTx, targets: readonly AlertTarget[]): Map<string, ResolvedTarget> {
  const byKind = new Map<ResolverKind, Map<string, ResolverTarget<ResolverKind>>>();
  for (const target of targets) {
    if (!isResolverTarget(target)) continue;
    if (!resolvers.has(target.kind)) throw unavailable(target.kind);
    let list = byKind.get(target.kind);
    if (list === undefined) {
      list = new Map();
      byKind.set(target.kind, list);
    }
    const key = targetKey(target);
    if (!list.has(key)) list.set(key, target);
  }
  const out = new Map<string, ResolvedTarget>();
  for (const [kind, list] of byKind) {
    const fn = resolvers.get(kind) as TargetResolver;
    for (const [key, value] of fn(tx, [...list.values()])) out.set(key, value);
  }
  return out;
}

// ------------------------------------------------------------------------------------------ step targets

/** §3.4 / §3.5: the concrete targets of a step for an alert (`raised_target`, step kinds, `from_value`). */
export function stepTargets(step: StepDef, alert: Pick<AlertRow, 'target' | 'values'>): Array<{ target: AlertTarget; set: RecipientSet }> {
  return step.to.map(({ target, set }) => {
    if (target === 'raised_target') return { target: alert.target, set };
    if (!('from_value' in target)) return { target, set };
    const value = alert.values[target.from_value];
    if (typeof value !== 'string' || value === '') {
      throw new Error(`step target from_value '${target.from_value}' is not a non-empty string in the alert's values`);
    }
    if (!('depth' in target) && target.kind === 'point') return { target: { kind: 'point', point_id: value }, set };
    if (!('depth' in target) && target.kind === 'zone_order_taker') return { target: { kind: 'zone_order_taker', table_id: value }, set };
    const depth = 'depth' in target ? target.depth : undefined;
    return { target: depth === undefined ? { kind: 'table_team', table_id: value } : { kind: 'table_team', table_id: value, depth }, set };
  });
}

const SET_RANK: Record<RecipientSet, number> = { answerer: 2, informed: 1, recipient: 0 };

/**
 * §3.4: the recipients of one step. A person (or device) reached by two entries is listed once with the
 * stronger set (`answerer` > `informed` > `recipient`, §3.5); the requester is left out of every answerer
 * entry (§3.3 rule 5). Resolver targets read `reads.resolved` (filled by `resolveTargets` in batchReads).
 * `ws` is part of the §4.2 signature; presence uses read (3), not the socket list (§3.5 "signed in anywhere").
 */
export function resolveStep(step: StepDef, alert: AlertRow, reads: BatchReads, directory: StaffDirectory, ws: WsHub): Recipient[] {
  void ws;
  const out: Recipient[] = [];
  const people = new Map<string, Recipient>();
  const devices = new Map<string, Recipient>();
  const add = (index: Map<string, Recipient>, id: string, recipient: Recipient): void => {
    const seen = index.get(id);
    if (seen === undefined) {
      index.set(id, recipient);
      out.push(recipient);
    } else if (SET_RANK[recipient.set] > SET_RANK[seen.set]) seen.set = recipient.set;
  };
  const markers = new Set<string>();
  for (const { target, set } of stepTargets(step, alert)) {
    const found = resolveTarget(target, alert, reads, directory);
    for (const staffId of found.staff_ids) {
      if (set === 'answerer' && staffId === alert.requester_staff_id) continue;
      add(people, staffId, { staff_id: staffId, device_id: null, set });
    }
    for (const deviceId of found.device_ids) add(devices, deviceId, { staff_id: null, device_id: deviceId, set });
    // §3.4.2: keep each table owner's origin, read before the presence filter.
    if (target.kind !== 'table_team') continue;
    for (const owner of resolved(target, reads).staff_ids) {
      const origin: TableTeamOrigin = { table_id: target.table_id, owner_staff_id: owner };
      const recipient = people.get(owner);
      if (recipient !== undefined) recipient.table_team ??= origin;
      else if (!isPresent(reads, owner) && !markers.has(`${origin.table_id}\u0000${owner}`)) {
        markers.add(`${origin.table_id}\u0000${owner}`);
        out.push({ staff_id: null, device_id: null, set, table_team: origin });
      }
    }
  }
  return out;
}

function resolveTarget(target: AlertTarget, alert: AlertRow, reads: BatchReads, directory: StaffDirectory): ResolvedTarget {
  const present = (ids: string[]): string[] => ids.filter((id) => isPresent(reads, id));
  const staff = (staff_ids: string[]): ResolvedTarget => ({ staff_ids, device_ids: [] });
  switch (target.kind) {
    case 'person':
      return staff([target.staff_id]);
    case 'device':
      return { staff_ids: [], device_ids: [target.device_id] };
    case 'permission':
      return staff(present(permissionHolders(directory, target.permission, target.range_of ?? null)));
    case 'team':
      return staff(present(walkTeam(directory, target.lead_staff_id, target.depth, { includeNoPin: true })));
    case 'answerers':
    case 'holders_informed': {
      const request = alert.request;
      if (request === null) return staff([]);
      const wanted = target.kind === 'answerers';
      const ids = directory.list().flatMap(({ staff_id }) => {
        const verdict = mayAnswer(directory, request, alert.requester_staff_id, staff_id);
        return (wanted ? verdict.ok : !verdict.ok && verdict.reason === 'out_of_range') ? [staff_id] : [];
      });
      return staff(present(ids));
    }
    case 'managers':
      return staff(present(managers(directory)));
    case 'requester_lead': {
      const lead = alert.requester_staff_id === null ? null : directory.leadOf(alert.requester_staff_id);
      return staff(lead === null ? [] : [lead]);
    }
    case 'always_on':
      // point-bound tablets join once 01a points land (§3.4, stubbed)
      return {
        staff_ids: [],
        device_ids: reads.devices.filter((d) => d.device_type === 'cashier_kiosk' || d.device_type === 'kds').map((d) => d.device_id),
      };
    case 'table_team': {
      const owners = resolved(target, reads).staff_ids;
      const ids = target.depth === 'owner' ? owners : [...owners, ...owners.flatMap((owner) => directory.teamOf(owner, { includeNoPin: true }))];
      return { staff_ids: present([...new Set(ids)]), device_ids: resolved(target, reads).device_ids };
    }
    case 'point':
    case 'zone_order_taker':
      return resolved(target, reads);
  }
}

function resolved(target: ResolverTarget<ResolverKind>, reads: BatchReads): ResolvedTarget {
  if (!resolvers.has(target.kind)) throw unavailable(target.kind);
  return reads.resolved.get(targetKey(target)) ?? { staff_ids: [], device_ids: [] };
}

/** §3.4 `managers`: branch-scope holders of `force-release-table-lock` (G1-11d, Q1). Not presence-filtered. */
export function managers(directory: StaffDirectory): string[] {
  return directory.list().flatMap(({ staff_id }) => {
    const r = directory.resolve(staff_id, 'force-release-table-lock');
    return r.grant === 'allowed' && r.scope === 'branch' ? [staff_id] : [];
  });
}

/** §3.4 `permission`: every `allowed` holder; with `range_of`, filtered by scope like §3.3 rule 6. */
function permissionHolders(directory: StaffDirectory, permission: Permission, rangeOf: string | null): string[] {
  return directory.list().flatMap(({ staff_id }) => {
    const r = directory.resolve(staff_id, permission);
    if (r.grant !== 'allowed') return [];
    if (rangeOf === null || covers(directory, r.scope, staff_id, rangeOf)) return [staff_id];
    return [];
  });
}

/** §3.3 rule 6 range: `branch` covers all; `my_team` covers anyone below the holder in the team tree. */
function covers(directory: StaffDirectory, scope: string, holderId: string, subjectId: string): boolean {
  if (scope === 'branch') return true;
  if (scope === 'my_team') return walkTeam(directory, holderId, 'all', { includeNoPin: false }).includes(subjectId);
  return false;
}

// ------------------------------------------------------------------------------------------- team walk

/**
 * §3.4 `team` / §3.3 rule 6 `my_team`: the lead's reports, direct or the whole subtree (01b §3.5 leaves the
 * walk to 01d). Breadth-first; a visited set (the lead included) makes it cycle-safe, and the depth is
 * bounded by the active staff count (plus `no_pin_staff` when included).
 */
export function walkTeam(directory: StaffDirectory, leadId: string, depth: 'direct' | 'all', o: { includeNoPin: boolean }): string[] {
  const direct = directory.teamOf(leadId, { includeNoPin: o.includeNoPin }).filter((id) => id !== leadId);
  if (depth === 'direct') return direct;
  const maxDepth = directory.list().length + (o.includeNoPin ? directory.noPinStaff().length : 0);
  const visited = new Set<string>([leadId]);
  const out: string[] = [];
  let level = direct;
  for (let d = 0; d < maxDepth && level.length > 0; d += 1) {
    const next: string[] = [];
    for (const id of level) {
      if (visited.has(id)) continue;
      visited.add(id);
      out.push(id);
      next.push(...directory.teamOf(id, { includeNoPin: o.includeNoPin }));
    }
    level = next;
  }
  return out;
}

// ------------------------------------------------------------------------------------------ answer right

export type MayAnswer = { ok: true } | { ok: false; reason: 'self' | 'not_approver' | 'out_of_range' | 'not_receiver' };

/**
 * §3.3 rules 5–6, read now (A5): not self; in the hub directory with a PIN (`no_pin_staff` never answers);
 * `approval`: holds a role in `resolve(requester, base_permission).approver_role_ids` read now, and, with a
 * `range_permission`, holds it `allowed` with a scope covering the requester; `named`: is the receiver.
 */
export function mayAnswer(directory: StaffDirectory, request: AlertRequestPart, requesterId: string | null, staffId: string): MayAnswer {
  if (requesterId !== null && staffId === requesterId) return { ok: false, reason: 'self' };
  const answerer = directory.get(staffId);
  if (request.right_mode === 'named') {
    return answerer !== undefined && staffId === request.receiver_staff_id ? { ok: true } : { ok: false, reason: 'not_receiver' };
  }
  if (answerer === undefined || request.base_permission === null || requesterId === null) return { ok: false, reason: 'not_approver' };
  const base = directory.resolve(requesterId, request.base_permission);
  const approverRoles = base.grant === 'requires_approval' ? base.approver_role_ids : [];
  if (!answerer.role_ids.some((roleId) => approverRoles.includes(roleId))) return { ok: false, reason: 'not_approver' };
  if (request.range_permission === null) return { ok: true };
  const range = directory.resolve(staffId, request.range_permission);
  if (range.grant !== 'allowed') return { ok: false, reason: 'not_approver' };
  return covers(directory, range.scope, staffId, requesterId) ? { ok: true } : { ok: false, reason: 'out_of_range' };
}

// -------------------------------------------------------------------------------------------- presence

/**
 * §3.4.1 / BF-8: absent = a `presence_today` row with `present = 0`, nothing else; a person not ticked is
 * present (so nobody ticked → everyone present); a person signed in anywhere (read (3)) is present.
 */
export function isPresent(reads: BatchReads, staffId: string): boolean {
  if (reads.presence.get(staffId) !== false) return true;
  return reads.sessions.some((session) => session.staff_id === staffId);
}
