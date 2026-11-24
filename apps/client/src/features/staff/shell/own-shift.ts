import type { HubResult } from '../../../api/hub-admin';

// 02b-TK A2 item 1 (frames ShellAnatomy "No shift open — cash can’t be taken", PersonMenu "My shift · Opened 7:02 AM ·
// float Rs 5,000"; MAPPING TK-SH01, TK-SH02): the signed-in person's own shift from 05 v1.0.34 §6.16
// `GET /queries/shift` (no shift_id: the caller's open shift; none → 404 SHIFT_NOT_FOUND). The shell reads it for a
// manage-own-shift holder and again on a shift event, a reconnect and a route change.

export type OwnShift = { kind: 'unknown' } | { kind: 'none' } | { kind: 'open'; opened_at: number; float_minor: number };

/** 404 SHIFT_NOT_FOUND (or a closed shift) → none; an open one → its opening; anything else → unknown (no banner). */
export async function readOwnShift(query: () => Promise<HubResult<unknown>>): Promise<OwnShift> {
  const r = await query();
  if (!r.ok) return r.error.kind === 'api' && r.error.status === 404 && r.error.code === 'SHIFT_NOT_FOUND' ? { kind: 'none' } : { kind: 'unknown' };
  const v = r.data as { state?: unknown; opened_at?: unknown; float_minor?: unknown } | null;
  if (v?.state === 'open' && typeof v.opened_at === 'number' && typeof v.float_minor === 'number') return { kind: 'open', opened_at: v.opened_at, float_minor: v.float_minor };
  return v?.state === 'closed' ? { kind: 'none' } : { kind: 'unknown' };
}

const SHIFT_EVENTS = new Set(['ShiftOpened', 'ShiftClosed', 'ShiftCounted', 'ShiftCountSkipped']);

/** A frame of this type may have opened or closed a shift: read again. */
export function shiftEvent(event_type: string): boolean {
  return SHIFT_EVENTS.has(event_type);
}
