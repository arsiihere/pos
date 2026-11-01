import { DomainError, type DeviceType, type Permission } from '@pos/domain';
import type { AlertRaisedPayload, AlertTarget } from '@pos/events';
import type { StaffDirectory } from '../auth/staff-directory.js';
import type { WriterTx } from '../engine-host/writer.js';
import type { WsHub } from '../ws/server.js';
import type { RecipientSet, StepDef } from './kinds.js';

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

/**
 * §3.5 / §4.2: the fixed reads of a tick or raise, cached per transaction (BF-6). Signature only in task 16;
 * the body is task 18.
 */
export function batchReads(tx: WriterTx, alerts: AlertRow[], o: { previousStep: boolean }): BatchReads {
  void tx;
  void alerts;
  void o;
  throw new Error('batchReads: not built yet (01d plan task 18)');
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
