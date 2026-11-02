import type { EventDraft, PosEvent, WsReceipt } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { Writer } from '../engine-host/writer.js';
import type { Clock } from '../lib/clock.js';
import type { ReceiptFrom } from '../ws/server.js';

// 01d §3.6 / A11 / §6 batch 3 (device → server): the receipt buffer.
// - `AlertDelivered` (WS `receipt` frames, 01e routes) and `AlertSeen` (MarkAlertsSeen, queued on commit) go
//   into an in-memory buffer, deduped BEFORE buffering by (alert_id, staff_id, device_id, kind, step), step -1
//   for seen, against the "recorded" set (filled at flush and, at boot, from alert_receipts of open alerts)
//   and the buffer itself. Repeats never become events, so no rate limit is kept (v0.3 #12).
// - A flush runs RECEIPT_FLUSH_MS after the first buffered receipt or at RECEIPT_FLUSH_AT, whichever comes
//   first, as ONE writer.run appending all of them. An empty buffer opens no transaction (no idle timer runs).
//   A hub crash may lose the last batch (accepted for these two events only, G1-8c).
// - A `receipt` frame is accepted only for a known alert this device was sent and a step ≤ the alert's current
//   step; "sent" = the device in any step's alert_recipients, or its session staff / bound person in
//   alert_inbox, or the (device, alert) pair given to recordSent (alerts_open / catch-up, tasks 32 / 34).
// - staff_id: the session staff (staff socket) or the device's bound person (alert mode) when that person was
//   sent the alert; '' (null in the payload) for a device-target alert (§6 batch 3, test 30).
// Statements: a receipt frame 1 read (none when malformed: the WS hub never hands it over); recordReceipt 0;
// a flush 1 read (the subjects) plus the writer's append; the boot seed 1. Events are hub-written:
// actor_id null, device_id 'hub' (§4.2 actor rule); the reporting device is in the payload.

export const RECEIPT_FLUSH_MS = 1_000;
export const RECEIPT_FLUSH_AT = 100;

/** The receipt route of a frame that came over a session socket / an alert-mode socket (§3.4.3, §6.10). */
const SCREEN = 'screen';
const ALERT_CONNECTION = 'alert_connection';

/** §4.2 `alerts.recordReceipt` input; `route` (default 'screen') is the 01e route that reports it (AD row). */
export interface ReceiptInput {
  alert_id: string;
  staff_id: string | null;
  device_id: string;
  kind: 'delivered' | 'seen';
  step?: number;
  route?: string;
}

export interface ReceiptLog {
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface ReceiptEnv {
  db: Database.Database;
  writer: Writer;
  clock: Clock;
  log: ReceiptLog;
}

export interface ReceiptBuffer {
  /** §3.6: the recorded set from alert_receipts of open alerts; before the WS server accepts sockets. */
  seed(): void;
  /** §4.2 `alerts.recordReceipt`. Throws for `delivered` without a step. */
  record(r: ReceiptInput): void;
  /** WsHub.onReceipt listener: a schema-valid `receipt` frame from a session or alert-mode socket. */
  fromSocket(from: ReceiptFrom, msg: WsReceipt): void;
  /** §6 batch 3 "sent" through alerts_open / catch-up (tasks 32, 34). */
  recordSent(deviceId: string, alertId: string): void;
  /** One writer.run with every buffered receipt; nothing when the buffer is empty. */
  flush(): void;
  /** Buffered receipts not yet flushed. */
  size(): number;
  /** App close: the timer stops and what is buffered is flushed. */
  stop(): void;
  /** §5.1 / AD-88: retention deleted these alerts' rows; drop their recorded and sentVia keys. */
  forget(alertIds: readonly string[]): void;
  /** Alerts that have recorded or sentVia keys (memory bound, tests). */
  tracked(): number;
}

interface Entry {
  alert_id: string;
  staff_id: string | null;
  device_id: string;
  kind: 'delivered' | 'seen';
  step: number;
  route: string;
  at: number;
}

interface SentRow {
  step: number;
  person: string | null;
  to_device: 0 | 1;
  to_person: 0 | 1;
}

const keyOf = (e: { alert_id: string; staff_id: string | null; device_id: string; kind: string; step: number }): string =>
  JSON.stringify([e.alert_id, e.staff_id ?? '', e.device_id, e.kind, e.step]);

export function createReceiptBuffer(env: ReceiptEnv): ReceiptBuffer {
  const recorded = new Map<string, Set<string>>(); // alert_id → keys (AD-88: dropped per alert by retention)
  const buffer = new Map<string, Entry>();
  const sentVia = new Map<string, Set<string>>(); // alert_id → device ids
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushQueued = false;

  /** Buffers one receipt unless its key is recorded or already buffered; true when it was buffered. */
  function add(e: Entry): boolean {
    const key = keyOf(e);
    if (recorded.get(e.alert_id)?.has(key) === true || buffer.has(key)) return false;
    buffer.set(key, e);
    timer ??= setTimeout(() => {
      timer = null;
      flush();
    }, RECEIPT_FLUSH_MS);
    return true;
  }

  function flush(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (buffer.size === 0) return;
    const batch = [...buffer.entries()];
    buffer.clear();
    try {
      env.writer.run((tx) => {
        const ids = [...new Set(batch.map(([, e]) => e.alert_id))];
        const subjects = new Map(
          (
            tx.db
              .prepare(
                `SELECT alert_id, subject_stream_type, subject_stream_id FROM alerts
                 WHERE alert_id IN (SELECT value FROM json_each(?))`,
              )
              .all(JSON.stringify(ids)) as Array<{ alert_id: string; subject_stream_type: PosEvent['stream_type']; subject_stream_id: string }>
          ).map((r) => [r.alert_id, r]),
        );
        const drafts: EventDraft[] = [];
        const keys: Array<[string, string]> = [];
        for (const [key, e] of batch) {
          const subject = subjects.get(e.alert_id);
          if (subject === undefined) continue; // an unknown alert (recordReceipt): no event
          const payload: Record<string, unknown> = {
            alert_id: e.alert_id,
            subject_stream_type: subject.subject_stream_type,
            subject_stream_id: subject.subject_stream_id,
            staff_id: e.staff_id,
            device_id: e.device_id,
            route: e.route,
          };
          if (e.kind === 'delivered') payload.step = e.step;
          drafts.push({
            stream_type: 'audit',
            stream_id: e.alert_id,
            event_type: e.kind === 'delivered' ? 'AlertDelivered' : 'AlertSeen',
            schema_version: 1,
            payload,
            occurred_at: e.at,
            actor_id: null,
            device_id: 'hub',
          });
          keys.push([e.alert_id, key]);
        }
        if (drafts.length === 0) return;
        tx.append(drafts);
        // recorded only once committed: after a rollback a re-sent receipt can still become its event
        tx.onCommit(() => {
          for (const [alertId, key] of keys) addRecorded(alertId, key);
        });
      });
    } catch (err) {
      // A11: lossy is accepted for these two events (G1-8c); the batch is dropped and logged (ids not logged).
      env.log.error({ err, receipts: batch.length }, 'alert receipt flush failed');
    }
  }

  function addRecorded(alertId: string, key: string): void {
    const keys = recorded.get(alertId) ?? new Set<string>();
    keys.add(key);
    recorded.set(alertId, keys);
  }

  function record(r: ReceiptInput): void {
    const delivered = r.kind === 'delivered';
    if (delivered && (r.step === undefined || !Number.isInteger(r.step) || r.step < 0)) {
      throw new Error('alerts.recordReceipt: a delivered receipt needs a step (integer ≥ 0)');
    }
    const added = add({
      alert_id: r.alert_id,
      staff_id: r.staff_id === '' ? null : r.staff_id,
      device_id: r.device_id,
      kind: r.kind,
      step: delivered ? (r.step as number) : -1,
      route: r.route ?? SCREEN,
      at: env.clock.branchNow(),
    });
    // Called from a command's tx.onCommit (MarkAlertsSeen): flushing here would append and publish before the
    // caller's own transaction has published, so the size flush runs right after the caller returns.
    if (added && buffer.size >= RECEIPT_FLUSH_AT && !flushQueued) {
      flushQueued = true;
      queueMicrotask(() => {
        flushQueued = false;
        if (buffer.size >= RECEIPT_FLUSH_AT) flush();
      });
    }
  }

  function fromSocket(from: ReceiptFrom, msg: WsReceipt): void {
    const alertMode = from.mode === 'alert';
    // §6 batch 3: one read — the alert's current step, whether this device or its person was sent it.
    const row = env.db
      .prepare(
        `WITH p AS (
           SELECT CASE WHEN @alert_mode = 1 THEN (SELECT staff_id FROM device_bindings WHERE device_id = @device_id)
                       ELSE @staff_id END AS person
         )
         SELECT a.step AS step, p.person AS person,
                EXISTS (SELECT 1 FROM alert_recipients r WHERE r.device_id = @device_id AND r.alert_id = a.alert_id) AS to_device,
                EXISTS (SELECT 1 FROM alert_inbox i WHERE i.alert_id = a.alert_id AND i.staff_id = p.person) AS to_person
         FROM alerts a, p WHERE a.alert_id = @alert_id`,
      )
      .get({ alert_mode: alertMode ? 1 : 0, device_id: from.deviceId, staff_id: from.staffId, alert_id: msg.alert_id }) as
      | SentRow
      | undefined;
    if (row === undefined || msg.step > row.step) return; // unknown alert, or a step not yet sent
    const via = sentVia.get(msg.alert_id)?.has(from.deviceId) === true;
    if (row.to_device === 0 && row.to_person === 0 && !via) return; // not sent to this device
    // the person when they were sent it (inbox, or catch-up / alerts_open); '' for a device-target alert
    const staffId = row.to_person === 1 || (row.to_device === 0 && via) ? row.person : null;
    add({
      alert_id: msg.alert_id,
      staff_id: staffId,
      device_id: from.deviceId,
      kind: 'delivered',
      step: msg.step,
      route: alertMode ? ALERT_CONNECTION : SCREEN,
      at: env.clock.branchNow(),
    });
    // not inside any transaction (a socket message), so the size flush runs now
    if (buffer.size >= RECEIPT_FLUSH_AT) flush();
  }

  const receipts: ReceiptBuffer = {
    seed() {
      const rows = env.db
        .prepare(
          `SELECT r.alert_id, r.staff_id, r.device_id, r.kind, r.step FROM alert_receipts r
           JOIN alerts a ON a.alert_id = r.alert_id WHERE a.state = 'open'`,
        )
        .all() as Array<{ alert_id: string; staff_id: string; device_id: string; kind: string; step: number }>;
      for (const r of rows) addRecorded(r.alert_id, keyOf(r));
    },
    record,
    fromSocket,
    recordSent(deviceId, alertId) {
      const devices = sentVia.get(alertId) ?? new Set<string>();
      devices.add(deviceId);
      sentVia.set(alertId, devices);
    },
    flush,
    size: () => buffer.size,
    stop() {
      flush();
    },
    forget(alertIds) {
      for (const alertId of alertIds) {
        recorded.delete(alertId);
        sentVia.delete(alertId);
      }
    },
    tracked: () => new Set([...recorded.keys(), ...sentVia.keys()]).size,
  };
  dbOf.set(receipts, env.db);
  return receipts;
}

// ------------------------------------------------------------------------------------------------ binding

const buffers = new WeakMap<FastifyInstance, ReceiptBuffer>();
const dbOf = new WeakMap<ReceiptBuffer, Database.Database>();
const byDb = new WeakMap<Database.Database, ReceiptBuffer>();
let active: ReceiptBuffer | null = null;

/** Bound once per hub by registerAlerts; the latest bound buffer serves `alerts.recordReceipt`. */
export function bindReceiptBuffer(app: FastifyInstance, buffer: ReceiptBuffer): void {
  buffers.set(app, buffer);
  const db = dbOf.get(buffer);
  if (db !== undefined) byDb.set(db, buffer);
  active = buffer;
}

export function unbindReceiptBuffer(buffer: ReceiptBuffer): void {
  const db = dbOf.get(buffer);
  if (db !== undefined && byDb.get(db) === buffer) byDb.delete(db);
  if (active === buffer) active = null;
}

/** §5.1 / AD-88: retention (on commit of its batch) drops the purged alerts' keys from the hub's buffer. */
export function forgetReceiptAlerts(db: Database.Database, alertIds: readonly string[]): void {
  byDb.get(db)?.forget(alertIds);
}

/** Like wsHubFor: the hub's receipt buffer (recordSent for tasks 32 / 34; flush / size for tests). */
export function receiptBufferFor(app: FastifyInstance): ReceiptBuffer {
  const buffer = buffers.get(app);
  if (buffer === undefined) throw new Error('registerAlerts has not run on this app');
  return buffer;
}

/** §4.2 `alerts.recordReceipt({ alert_id, staff_id, device_id, kind, step })`. */
export function recordReceipt(r: ReceiptInput): void {
  if (active === null) throw new Error('alerts.recordReceipt: no receipt buffer is bound (registerAlerts)');
  active.record(r);
}
