import { DomainError } from '@pos/domain';
import { AlertReceiptsResponse } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { StaffDirectory } from '../../auth/staff-directory.js';
import { defineQuery, queryRegistry, type QueryCtx } from '../../queries/registry.js';
import { safeBuild } from '../ws-frames.js';

// 01d §6.10 `GET /queries/alert-receipts?alert_id=` (AD-13 shape; `for_staff_name` and `no_route` on recipients
// are additive, task 36). For `test_alert` and support.
// - Who: a staff session whose person holds `manage-devices` (403 PERMISSION_DENIED, checked before any
//   statement); unknown alert → 404 ALERT_NOT_FOUND.
// - Steps: every step that has a step event or recipient rows, ascending. Recipients from `alert_recipients`
//   (kept per step, v0.4 M2): a person with no route is a row too (v0.5 N5), a lead's "for" row carries
//   `for_staff_id` and the person it is for has no row of their own (§3.4.3, AD-106). Routes from the
//   `AttemptSent` / `EscalationStepped` events of the alert's subject stream with seq ≥ `raised_seq`, filtered
//   to this alert_id (v0.5 m12). `no_route`: a person row with no route of that person in the step's routes
//   ("Owner: no route"), a device row with no device route (`staff_id` null, ref = the device).
// - Receipts from `alert_receipts`: delivered (per step) / seen, each naming the device (joined) and the person
//   (`staff_id` '' → null: a device-target alert or a signed-out kiosk). For an alert-mode receipt that person
//   is the device's bound person ("delivered to device Tablet 3, bound to Ali (not signed in)", route
//   `alert_connection`) vs. "delivered to Ali on Tablet 3" (route `screen`). `alert_receipts` has no route
//   column (§5.1), so the route is read from the receipt's own AlertDelivered / AlertSeen event on the alert's
//   `audit` stream inside the same statement (proposed AD row).
// - Lock-safe only: no display, details or card (§3.12, §7).
// Statements: 4 ((1) the alert row, (2) recipients joined with device names, (3) step events from raised_seq,
// (4) receipts joined with device names and their route), 1 for an unknown alert, prepared per call (AD-125:
// the statement cache is for the tick, projections and raise only), on the read-only connection (ctx.db).
// Names from the directory in memory (staff with a PIN, else the no-PIN cache). countsAsActivity false.

const Query = z.object({ alert_id: z.string().min(1) });

const ALERT_SQL = `SELECT alert_id, kind, subject_stream_type, subject_stream_id, raised_seq FROM alerts WHERE alert_id = ?`;

const RECIPIENTS_SQL = `
  SELECT r.step, r.staff_id, r.device_id, r.for_staff_id, r.recipient_set, d.device_name
  FROM alert_recipients r LEFT JOIN devices d ON d.device_id = r.device_id
  WHERE r.alert_id = ?
  ORDER BY r.step, r.rowid`;

const STEPS_SQL = `
  SELECT payload FROM events
  WHERE stream_type = ? AND stream_id = ? AND seq >= ?
    AND event_type IN ('AttemptSent', 'EscalationStepped')
    AND json_extract(payload, '$.alert_id') = ?
  ORDER BY seq`;

const RECEIPTS_SQL = `
  SELECT r.kind, r.step, r.staff_id, r.device_id, r.at, d.device_name,
         (SELECT json_extract(e.payload, '$.route') FROM events e
           WHERE e.stream_type = 'audit' AND e.stream_id = r.alert_id
             AND e.event_type = (CASE r.kind WHEN 'delivered' THEN 'AlertDelivered' ELSE 'AlertSeen' END)
             AND json_extract(e.payload, '$.device_id') = r.device_id
             AND COALESCE(json_extract(e.payload, '$.staff_id'), '') = r.staff_id
             AND (r.kind = 'seen' OR json_extract(e.payload, '$.step') = r.step)
           ORDER BY e.seq LIMIT 1) AS route
  FROM alert_receipts r LEFT JOIN devices d ON d.device_id = r.device_id
  WHERE r.alert_id = ?
  ORDER BY r.at, r.kind, r.step, r.device_id, r.staff_id`;

interface AlertRow {
  alert_id: string;
  kind: string;
  subject_stream_type: string;
  subject_stream_id: string;
  raised_seq: number;
}

interface RecipientDbRow {
  step: number;
  staff_id: string | null;
  device_id: string | null;
  for_staff_id: string | null;
  recipient_set: 'answerer' | 'informed' | 'recipient';
  device_name: string | null;
}

interface StepPayload {
  step: number;
  routes: Array<{ staff_id: string | null; route: string; ref: string }>;
}

interface ReceiptDbRow {
  kind: 'delivered' | 'seen';
  step: number;
  staff_id: string;
  device_id: string;
  at: number;
  device_name: string | null;
  route: string | null;
}

type Response = z.infer<typeof AlertReceiptsResponse>;
type StepView = Response['data']['steps'][number];

function requireManageDevices(ctx: QueryCtx): void {
  const staffId = ctx.session?.staff_id ?? null;
  const grant = staffId === null ? 'not_granted' : ctx.directory.resolve(staffId, 'manage-devices').grant;
  if (grant !== 'allowed') throw new DomainError('PERMISSION_DENIED', { permission: 'manage-devices', grant });
}

function buildReceipts(ctx: QueryCtx, alertId: string): Response {
  requireManageDevices(ctx);
  const alert = ctx.db.prepare(ALERT_SQL).get(alertId) as AlertRow | undefined;
  if (alert === undefined) throw new DomainError('ALERT_NOT_FOUND', { alert_id: alertId });
  const recipients = ctx.db.prepare(RECIPIENTS_SQL).all(alertId) as RecipientDbRow[];
  const stepEvents = (
    ctx.db.prepare(STEPS_SQL).all(alert.subject_stream_type, alert.subject_stream_id, alert.raised_seq, alertId) as Array<{ payload: string }>
  ).map((r) => JSON.parse(r.payload) as StepPayload);
  const receipts = ctx.db.prepare(RECEIPTS_SQL).all(alertId) as ReceiptDbRow[];

  const directory = ctx.directory;
  let noPin: Map<string, string> | undefined;
  const nameOf = (staffId: string | null): string | null => {
    if (staffId === null) return null;
    const known = directory.get(staffId)?.display_name;
    if (known !== undefined) return known;
    noPin ??= noPinNames(directory);
    return noPin.get(staffId) ?? null;
  };

  const steps = new Map<number, StepView>();
  const stepOf = (n: number): StepView => {
    let s = steps.get(n);
    if (s === undefined) {
      s = { step: n, recipients: [], routes: [] };
      steps.set(n, s);
    }
    return s;
  };
  for (const e of stepEvents) stepOf(e.step).routes.push(...e.routes.map((r) => ({ staff_id: r.staff_id, route: r.route, ref: r.ref })));
  for (const r of recipients) {
    const s = stepOf(r.step);
    const routed =
      r.staff_id !== null
        ? s.routes.some((x) => x.staff_id === r.staff_id)
        : s.routes.some((x) => x.staff_id === null && x.ref === r.device_id);
    s.recipients.push({
      staff_id: r.staff_id,
      staff_name: nameOf(r.staff_id),
      device_id: r.device_id,
      device_name: r.device_id === null ? null : r.device_name,
      for_staff_id: r.for_staff_id,
      for_staff_name: nameOf(r.for_staff_id),
      set: r.recipient_set,
      no_route: !routed,
    });
  }

  return AlertReceiptsResponse.parse({
    data: {
      alert_id: alert.alert_id,
      kind: alert.kind,
      steps: [...steps.values()].sort((a, b) => a.step - b.step),
      receipts: receipts.map((r) => {
        const staffId = r.staff_id === '' ? null : r.staff_id;
        return {
          kind: r.kind,
          step: r.kind === 'seen' ? null : r.step,
          staff_id: staffId,
          staff_name: nameOf(staffId),
          device_id: r.device_id,
          device_name: r.device_name,
          // every alert_receipts row is projected from its event (§5.2), so the route is always found; a seen
          // comes from a signed-in session (MarkAlertsSeen)
          route: r.route ?? 'screen',
          at: r.at,
        };
      }),
    },
  });
}

function noPinNames(directory: StaffDirectory): Map<string, string> {
  return new Map(directory.noPinStaff().map((s) => [s.staff_id, s.display_name]));
}

export function registerAlertReceipts(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'alert-receipts',
      sessionKind: 'device',
      session: 'required',
      countsAsActivity: false,
      querySchema: Query,
      handle: (ctx, q) => safeBuild('alert-receipts', () => buildReceipts(ctx, q.alert_id)),
    }),
  );
}
