/// <reference types="node" />
import type { DeviceType } from '@pos/domain';
import type Database from 'better-sqlite3';

export interface SocketCtx {
  deviceId: string;
  deviceType: DeviceType;
  sessionId: string;
  kind: 'staff' | 'station';
  staffId: string | null;
  stationId: string | null;
  asOfSeq: number;
}

export interface CatchUpPart {
  part: string;
  appliesTo(socket: SocketCtx): boolean;
  build(db: Database.Database, state: unknown): unknown;
}

const parts: CatchUpPart[] = [];

export function registerCatchUp(part: CatchUpPart): void {
  parts.push(part);
}

export function buildCatchUpState(
  db: Database.Database,
  state: unknown,
  socket: SocketCtx,
  branchId: string,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { hub: hubPart(db, branchId) };
  for (const part of parts) {
    if (part.appliesTo(socket)) merged[part.part] = part.build(db, state);
  }
  return merged;
}

function hubPart(
  db: Database.Database,
  branchId: string,
): { clock_alarm: { wall_ms: number; last_recorded_at: number } | null; branch_name: string } {
  const row = db
    .prepare(
      `SELECT payload FROM events WHERE branch_id = ? AND event_type = 'ClockAlarm' ORDER BY seq DESC LIMIT 1`,
    )
    .get(branchId) as { payload: string } | undefined;
  if (row === undefined) return { clock_alarm: null, branch_name: '' };
  const payload = JSON.parse(row.payload) as { wall_ms: number; last_recorded_at: number };
  return {
    clock_alarm: { wall_ms: payload.wall_ms, last_recorded_at: payload.last_recorded_at },
    branch_name: '',
  };
}
