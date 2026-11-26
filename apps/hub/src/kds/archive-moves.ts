// ⚠️ 03b v1.0.16 §3.10 "Pass archive (D7)", §6.22, §11 task 51 (run 3 R3-M-1, R3-M-3); 01a v2.11 §6.9a Archive (R3-B-1);
// 02b-tk run 3 decision D7. On a hub config apply where a Pass point became archived (active in the last applied
// snapshot, archived in the incoming one), every outstanding live engine line at it (unserved: added, cooking or done;
// return lines included; a legacy line with point_id null whose station default is that point too) moves to the point
// routePoint picks among the INCOMING active points by the line's order type (most specific, then the effective
// station default for ties and fallback). All destinations are resolved in memory before any move; with no active
// destination (or no active point at all) the apply is refused with 01a §6.9a's VALIDATION_FAILED and nothing commits.
// One PassPointLinesMoved per affected order, lines in id order; carry for the line's station and each stored
// alternate is read against the destination point (a missing row = 0); the old point's name comes from the previous
// snapshot. 0 statements (engine memory and the two configs).
import { DomainError, routePoint, type PointOrderType, type RoutablePoint } from '@pos/domain';
import type { EngineLine, EngineState } from '@pos/engine';
import type { BranchConfig, EventDraft } from '@pos/events';
import { alerts } from '../alerts/raise.js';
import type { WriterTx } from '../engine-host/writer.js';

const OUTSTANDING: ReadonlySet<EngineLine['stage']> = new Set(['added', 'cooking', 'done']);

export const ARCHIVE_REFUSED = { issues: [{ path: 'archived', message: 'Activate another Pass point first' }] } as const;

export interface PointMove {
  order_item_id: string;
  from_point_id: string;
  from_point_name: string;
  to_point_id: string;
  carry_ms: number;
  alternates: Array<{ station_id: string; carry_ms: number; home: boolean }>;
}

type Station = BranchConfig['stations'][number];

function routable(config: BranchConfig): RoutablePoint[] {
  return config.points.map((p) => ({ point_id: p.point_id, name: p.name, sort_order: p.sort_order, is_archived: p.is_archived, ...(p.order_types === undefined ? {} : { order_types: p.order_types }) }));
}

function carryTo(station: Station | undefined, point_id: string): number {
  return station?.carry_times.find((c) => c.point_id === point_id)?.carry_ms ?? 0;
}

/** The moves per order (orders in id order, lines in id order); empty when no point became archived. Throws the refusal. */
export function archiveMoves(prev: BranchConfig | null, next: BranchConfig, state: EngineState): Map<string, PointMove[]> {
  const out = new Map<string, PointMove[]>();
  if (prev === null) return out;
  const wasActive = new Map(prev.points.filter((p) => !p.is_archived).map((p) => [p.point_id, p.name]));
  const archived = new Set(next.points.filter((p) => p.is_archived && wasActive.has(p.point_id)).map((p) => p.point_id));
  if (archived.size === 0) return out;
  const points = routable(next);
  if (!points.some((p) => !p.is_archived)) throw new DomainError('VALIDATION_FAILED', structuredClone(ARCHIVE_REFUSED) as never);
  const nextStations = new Map(next.stations.map((s) => [s.station_id, s]));
  const prevStations = new Map(prev.stations.map((s) => [s.station_id, s]));
  const moves: Array<PointMove & { order_id: string }> = [];
  for (const line of Object.values(state.lines)) {
    if (!OUTSTANDING.has(line.stage)) continue;
    const order = state.orders[line.order_id];
    if (order === undefined) continue;
    const at = line.point_id ?? prevStations.get(line.station_id)?.point_id ?? null;
    if (at === null || !archived.has(at)) continue;
    const station = nextStations.get(line.station_id) ?? prevStations.get(line.station_id);
    const routed = routePoint(points, { point_id: station?.point_id ?? at }, order.order_type as PointOrderType);
    if (routed === null) throw new DomainError('VALIDATION_FAILED', structuredClone(ARCHIVE_REFUSED) as never);
    moves.push({
      order_id: line.order_id,
      order_item_id: line.order_item_id,
      from_point_id: at,
      from_point_name: wasActive.get(at)!,
      to_point_id: routed.point_id,
      carry_ms: carryTo(nextStations.get(line.station_id), routed.point_id),
      alternates: line.alternates.map((a) => ({ station_id: a.station_id, carry_ms: carryTo(nextStations.get(a.station_id), routed.point_id), home: a.home })),
    });
  }
  moves.sort((a, b) => (a.order_id < b.order_id ? -1 : a.order_id > b.order_id ? 1 : a.order_item_id < b.order_item_id ? -1 : a.order_item_id > b.order_item_id ? 1 : 0));
  for (const { order_id, ...m } of moves) out.set(order_id, [...(out.get(order_id) ?? []), m]);
  return out;
}

/** The PassPointLinesMoved v1 drafts of `moves` (one per order), stamped as the config apply's hub writes. */
export function movedDrafts(moves: ReadonlyMap<string, PointMove[]>, now: number): EventDraft[] {
  return [...moves].map(([order_id, list]) => ({
    stream_type: 'order',
    stream_id: order_id,
    event_type: 'PassPointLinesMoved',
    schema_version: 1,
    payload: { order_id, moves: list },
    occurred_at: now,
    actor_id: null,
    device_id: 'hub',
  }));
}

/**
 * The onBranchConfigApplied body (inside the applying writer.run, before COMMIT). A refusal throws and fails the whole
 * apply (S43; 01a §6.21 reports it). Writes the moves, and closes `obsolete` each Ready alert at a newly archived point
 * whose unsettled lines all moved (03b §3.10 R3-M-1): at most 1 batched read of those memberships plus one closeMany.
 * The pass projection drops the moved lines' old memberships from the same event; D8 rechecks in the before-commit hook.
 */
export function archiveMovesHook(prev: BranchConfig | null, next: BranchConfig, tx: WriterTx): Map<string, PointMove[]> {
  const moves = archiveMoves(prev, next, tx.state as EngineState);
  if (moves.size === 0) return moves;
  const now = tx.clock.branchNow();
  const rows = tx.db
    .prepare(
      `SELECT p.order_id AS order_id, p.point_id AS point_id, p.ready_alert_id AS alert_id, r.order_item_id AS order_item_id
         FROM pass_orders p JOIN pass_ready_lines r ON r.order_id = p.order_id AND r.point_id = p.point_id
        WHERE r.settled_at IS NULL AND p.ready_alert_id IS NOT NULL AND p.order_id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify([...moves.keys()])) as Array<{ order_id: string; point_id: string; alert_id: string; order_item_id: string }>;
  const movedFrom = new Set([...moves.values()].flat().map((m) => `${m.from_point_id}|${m.order_item_id}`));
  const readies = new Map<string, { alert_id: string; all: boolean; any: boolean }>();
  for (const r of rows) {
    const key = `${r.order_id}|${r.point_id}`;
    const entry = readies.get(key) ?? { alert_id: r.alert_id, all: true, any: false };
    const isMoved = movedFrom.has(`${r.point_id}|${r.order_item_id}`);
    entry.all &&= isMoved;
    entry.any ||= isMoved;
    readies.set(key, entry);
  }
  const closes = [...readies.values()].filter((r) => r.any && r.all).map((r) => ({ alert_id: r.alert_id, reason: 'obsolete' as const }));
  tx.append(movedDrafts(moves, now));
  if (closes.length > 0) tx.append(alerts.closeMany(alerts.tickCtx(tx, now), closes));
  return moves;
}
