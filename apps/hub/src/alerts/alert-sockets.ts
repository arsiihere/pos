import type { DeviceType } from '@pos/domain';
import {
  AlertLockSchema,
  WsAlertsOpen,
  WsAlertsOpenRow,
  WsBindingRoute,
  type AttemptSentPayload,
  type PosEvent,
} from '@pos/events';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { Clock } from '../lib/clock.js';
import type { WsHub } from '../ws/server.js';
import { kindOf } from './kinds.js';
import { bindingIsRoute } from './routes.js';
import { cachedPrepare } from './statements.js';
import type { BatchReads, SessionRead } from './targets.js';
import { lockView, type LockViewRow } from './ws-frames.js';

// 01d §3.7 "Reconnect" and header, §6 batch 3 `alerts_open`, BF-5 / P-6 (`binding_route_until`, `binding_route`).
// - `alerts_open` (the first frame of an alert-mode socket): open alerts where this device is in any step's
//   recipients, plus those where its bound person is in `alert_inbox` (cumulative, §3.5). The bound person's
//   part only while the binding passes §3.4.3 (b) present and (c) recently active (tablets) and the device is
//   a tablet or phone (v0.5 m7); a kiosk / KDS has no binding row (BF-3). Never an alert hidden from this
//   device (§3.10). Rows are lock-only (ws-frames' one lock-view builder): never `card` or `details`
//   (`details_json` is not even read), checked by a strict schema before it leaves (§7). Every listed alert
//   is "sent" to the device for the receipt check (recordSent, §6 batch 3).
// - `binding_route_until` = the bound person's last session activity + `binding_route_idle_ms` for a tablet
//   whose binding is a route (task 17 carry: `until` alone is not enough), else null.
// - `binding_route { until }`: after commit of a step (raise or tick) that routes to a tablet through its
//   binding (`alert_connection` route with a person), to that device's sockets, only when the value differs
//   from the last one this hub sent it (alerts_open included). The last-sent map lives in this instance (one
//   per hub, from registerAlerts), never module-global, so two hubs in one process never share it.
// Statements: `alerts_open` ≤ 3 (alerts with the device and its binding; presence; activity), 1 for a device
// with no binding; the after-commit check 1 per transaction with such routes, 0 otherwise.
// Determinism: `now` from the hub clock. Logs: device ids and error names only, never frame bodies (§7).

const StrictRow = WsAlertsOpenRow.extend({ lock: AlertLockSchema.strict() }).strict();
const StrictOpen = WsAlertsOpen.extend({ alerts: z.array(StrictRow) }).strict();
const StrictBindingRoute = WsBindingRoute.strict();

const STEP_EVENTS: ReadonlySet<string> = new Set(['AttemptSent', 'EscalationStepped']);
const ALERT_CONNECTION = 'alert_connection';

export interface AlertSocketsLog {
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface AlertSocketsEnv {
  db: Database.Database;
  branchId: string;
  clock: Clock;
  ws(): WsHub;
  /** receipts.ts `recordSent`: this device was given the alert in alerts_open. */
  recordSent(deviceId: string, alertId: string): void;
  log: AlertSocketsLog;
}

export interface AlertSockets {
  /** `ws.setAlertsOpen` builder (H-1): the device's first alert-mode frame. */
  alertsOpen(deviceId: string): WsAlertsOpen;
  /** The writer's after-commit hook: BF-5 `binding_route` frames for the step events of one transaction. */
  afterCommit(appended: PosEvent[]): void;
}

interface OpenRow extends Partial<Omit<LockViewRow, 'alert_id'>> {
  device_type: DeviceType;
  bound_staff_id: string | null;
  bound_session_id: string | null;
  bound_since: number | null;
  alert_id: string | null; // null: the LEFT JOIN row of a device with no open alert
  step: number | null;
  to_device: 0 | 1 | null;
}

/** The facts §3.4.3 (b), (c) need about one bound person (presence, activity, active sessions). */
interface BindingFacts {
  device_id: string;
  device_type: DeviceType;
  staff_id: string;
  session_id: string | null;
  since: number;
  present: number | null;
  last: number | null;
  active_json: string | null;
}

// (1) the device, its binding and its open alerts (device in any step, or the bound person in alert_inbox),
// minus those hidden from this device. LEFT JOIN: the device row comes back even with no alert.
const OPEN_SQL = `
  WITH dev AS (
    SELECT d.device_id, d.device_type, b.staff_id AS bound_staff_id, b.session_id AS bound_session_id, b.since AS bound_since
    FROM devices d LEFT JOIN device_bindings b ON b.device_id = d.device_id
    WHERE d.device_id = @device_id
  )
  SELECT dev.device_type, dev.bound_staff_id, dev.bound_session_id, dev.bound_since,
         a.alert_id, a.kind, a.family, a.step, a.display_json, a.raised_at,
         a.alert_id IN (SELECT r.alert_id FROM alert_recipients r WHERE r.device_id = dev.device_id) AS to_device
  FROM dev LEFT JOIN alerts a
    ON a.state = 'open'
   AND (a.hidden_device_id IS NULL OR a.hidden_device_id <> dev.device_id)
   AND (a.alert_id IN (SELECT r.alert_id FROM alert_recipients r WHERE r.device_id = dev.device_id)
        OR a.alert_id IN (SELECT i.alert_id FROM alert_inbox i WHERE i.staff_id = dev.bound_staff_id))
  ORDER BY a.raised_at, a.alert_id`;

// (2) presence of the bound person (§3.4.1: absent = a row with present = 0, BF-8)
const PRESENCE_SQL = 'SELECT present FROM presence_today WHERE staff_id = ?';

// (3) §3.4.3 (c): the person's last session activity at this branch (active or ended), and the active
// sessions (for the in-memory activity value and the "signed in counts as present" rule)
const ACTIVITY_SQL = `
  SELECT MAX(last_activity_at) AS last,
         json_group_array(json_object('session_id', session_id, 'last_activity_at', last_activity_at))
           FILTER (WHERE ended_at IS NULL) AS active_json
  FROM staff_sessions WHERE branch_id = @branch_id AND kind = 'staff' AND staff_id = @staff_id`;

// After commit: the same facts for the tablets / phones a transaction routed to through their binding.
const BINDINGS_SQL = `
  SELECT b.device_id, d.device_type, b.staff_id, b.session_id, b.since,
         (SELECT p.present FROM presence_today p WHERE p.staff_id = b.staff_id) AS present,
         (SELECT MAX(s.last_activity_at) FROM staff_sessions s
           WHERE s.branch_id = @branch_id AND s.kind = 'staff' AND s.staff_id = b.staff_id) AS last,
         (SELECT json_group_array(json_object('session_id', s.session_id, 'last_activity_at', s.last_activity_at))
            FROM staff_sessions s
           WHERE s.branch_id = @branch_id AND s.kind = 'staff' AND s.staff_id = b.staff_id AND s.ended_at IS NULL) AS active_json
  FROM device_bindings b JOIN devices d ON d.device_id = b.device_id
  WHERE b.device_id IN (SELECT value FROM json_each(@device_ids)) AND d.revoked_at IS NULL`;

export function createAlertSockets(env: AlertSocketsEnv): AlertSockets {
  /** BF-5: the last `binding_route_until` this hub sent each device (alerts_open or binding_route). */
  const lastSent = new Map<string, number | null>();

  /**
   * §3.4.3 through routes.ts' one binding rule, over reads built for this one binding. `connectedNow` counts
   * the device as connected (rule (a)): at alerts_open it is the socket being opened (§3.7 checks only (b), (c)).
   */
  function evaluate(f: BindingFacts, connectedNow: boolean): { route: boolean; until: number | null } {
    const ws = env.ws();
    const active = parseActive(f.active_json);
    const reads: BatchReads = {
      sessions: active.map((s): SessionRead => ({ session_id: s.session_id, staff_id: f.staff_id, device_id: '', last_activity_at: s.last_activity_at })),
      bindings: [{ device_id: f.device_id, staff_id: f.staff_id, session_id: f.session_id, since: f.since }],
      devices: [{ device_id: f.device_id, device_type: f.device_type }],
      presence: f.present === null ? new Map() : new Map([[f.staff_id, f.present === 1]]),
      activity: f.last === null ? new Map() : new Map([[f.staff_id, f.last]]),
      prevRecipients: new Map(),
      resolved: new Map(),
    };
    const view: WsHub = connectedNow
      ? { ...ws, alertSockets: () => [...ws.alertSockets(), { deviceId: f.device_id, deviceType: f.device_type }] }
      : ws;
    const result = bindingIsRoute(reads.bindings[0] as BatchReads['bindings'][number], reads, view, env.clock.branchNow());
    // task 17 carry: `until` is set even when (a) or (b) fails; the header shows it only for a route
    return { route: result.route, until: result.route && f.device_type === 'tablet' ? result.until : null };
  }

  function alertsOpen(deviceId: string): WsAlertsOpen {
    const rows = cachedPrepare(env.db, OPEN_SQL).all({ device_id: deviceId }) as OpenRow[];
    const head = rows[0];
    let personPart = false;
    let until: number | null = null;
    if (head !== undefined && head.bound_staff_id !== null && (head.device_type === 'tablet' || head.device_type === 'phone')) {
      const staffId = head.bound_staff_id;
      const presence = cachedPrepare(env.db, PRESENCE_SQL).get(staffId) as { present: number } | undefined;
      const act = cachedPrepare(env.db, ACTIVITY_SQL).get({ branch_id: env.branchId, staff_id: staffId }) as
        | { last: number | null; active_json: string | null }
        | undefined;
      const result = evaluate(
        {
          device_id: deviceId,
          device_type: head.device_type,
          staff_id: staffId,
          session_id: head.bound_session_id,
          since: head.bound_since ?? 0,
          present: presence?.present ?? null,
          last: act?.last ?? null,
          active_json: act?.active_json ?? null,
        },
        true,
      );
      personPart = result.route;
      until = result.until;
    }
    const alerts: Array<z.infer<typeof StrictRow>> = [];
    for (const row of rows) {
      if (row.alert_id === null || row.step === null || row.step < 0) continue;
      if (row.to_device !== 1 && !personPart) continue; // the bound person's part only while a route (m7)
      const kind = kindOf(row.kind as string);
      if (kind === undefined) continue; // P-8: an unknown kind has no lock label
      alerts.push(lockView(row as LockViewRow, kind, row.step));
    }
    const frame = StrictOpen.parse({ type: 'alerts_open', alerts, binding_route_until: until });
    for (const a of frame.alerts) env.recordSent(deviceId, a.alert_id);
    lastSent.set(deviceId, until);
    return frame;
  }

  function sendBindingRoutes(appended: PosEvent[]): void {
    const routed = new Map<string, Set<string>>(); // device id → the people routed to it through the binding
    for (const event of appended) {
      if (!STEP_EVENTS.has(event.event_type)) continue;
      for (const r of (event.payload as AttemptSentPayload).routes) {
        if (r.route !== ALERT_CONNECTION || r.staff_id === null) continue; // a device target is not a binding
        const people = routed.get(r.ref) ?? new Set<string>();
        people.add(r.staff_id);
        routed.set(r.ref, people);
      }
    }
    if (routed.size === 0) return;
    const facts = cachedPrepare(env.db, BINDINGS_SQL).all({ branch_id: env.branchId, device_ids: JSON.stringify([...routed.keys()]) }) as BindingFacts[];
    const ws = env.ws();
    for (const f of facts) {
      if (routed.get(f.device_id)?.has(f.staff_id) !== true) continue; // rebound in the same transaction
      const { until } = evaluate(f, false);
      if (lastSent.has(f.device_id) && lastSent.get(f.device_id) === until) continue;
      lastSent.set(f.device_id, until);
      ws.sendToDevices([f.device_id], StrictBindingRoute.parse({ type: 'binding_route', until }));
    }
  }

  return {
    alertsOpen,
    afterCommit(appended) {
      try {
        sendBindingRoutes(appended);
      } catch (err) {
        const e = err as { name?: unknown } | null;
        env.log.error({ err: { name: typeof e?.name === 'string' ? e.name : 'unknown' }, frames: 'binding_route' }, 'binding_route frames failed');
      }
    },
  };
}

function parseActive(json: string | null): Array<{ session_id: string; last_activity_at: number }> {
  if (json === null) return [];
  return JSON.parse(json) as Array<{ session_id: string; last_activity_at: number }>;
}
