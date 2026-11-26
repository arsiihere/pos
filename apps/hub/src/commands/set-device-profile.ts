import { DomainError, SCREEN_KEYS, screensOffered, type DeviceType, type ScreenKey } from '@pos/domain';
import type { DeviceProfileSetPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { endSession, type SessionRow } from '../auth/session-store.js';
import type { HubDeps } from '../server.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import { alertsPartForSession } from '../alerts/catch-up.js';
import { wsHubFor, type AlertModeFrame } from '../ws/server.js';
import { defineCommand, type CommandCtx } from './registry.js';
import { commandRegistry } from './route.js';

// 05a v1.0.2 §6.4 `SetDeviceProfile` (M-6, N-1, N-4, G-e). Unsent fields keep the device's current profile; the
// §6.3 step 3 rules run on the merged profile. Statements: device + profile (+ its open staff / admin sessions) read
// (1), people read (1), the append and its projection writes, then 1 per ended session.
const Payload = z.object({
  device_id: z.string().min(1),
  expected_version: z.number().int().min(0),
  device_name: z.string().min(1).max(40).optional(),
  access: z.enum(['everyone', 'listed']).optional(),
  staff_ids: z.array(z.string().min(1)).max(20).optional(),
  screens: z.array(z.enum(SCREEN_KEYS)).max(6).optional(),
  point_id: z.string().min(1).optional(),
});
type Payload = z.infer<typeof Payload>;

const SESSION_JSON = `json_object('session_id', s.session_id, 'kind', s.kind, 'staff_id', s.staff_id, 'station_id', s.station_id,
  'device_id', s.device_id, 'idle_ttl_ms', s.idle_ttl_ms, 'started_at', s.started_at, 'last_activity_at', s.last_activity_at,
  'ended_at', s.ended_at, 'token_hash', s.token_hash)`;

const DEVICE_SQL = `
  SELECT d.device_name, d.device_type, d.point_id, d.revoked_at, p.access, p.screens, p.profile_version,
         (SELECT json_group_array(${SESSION_JSON}) FROM staff_sessions s
           WHERE s.device_id = d.device_id AND s.ended_at IS NULL AND s.kind IN ('staff', 'admin')) AS sessions
    FROM devices d
    LEFT JOIN device_profiles p ON p.device_id = d.device_id
   WHERE d.device_id = ? AND d.branch_id = ?`;

interface DeviceRow {
  device_name: string;
  device_type: DeviceType;
  point_id: string | null;
  revoked_at: number | null;
  access: 'everyone' | 'listed' | null;
  screens: string | null;
  profile_version: number | null;
  sessions: string;
}

interface Merged {
  device_name: string;
  access: 'everyone' | 'listed';
  staff_ids: string[];
  screens: ScreenKey[];
  point_id: string | null;
}

function invalid(field: string, message: string): DomainError {
  return new DomainError('VALIDATION_FAILED', { field, issues: [{ path: field, message }] });
}

export function registerSetDeviceProfile(app: FastifyInstance, deps: HubDeps): void {
  // Step 6, after the commit: the `deviceProfile` map refresh (server.ts, registered before this hook) has run, so the
  // push reads the new profile; the SessionEnded events of the same commit close their sockets 4401 at publish.
  deps.writer.addAfterCommit((appended) => {
    // sessions this commit ended: their sockets close at publish, so they get no refreshed alert part
    const ended = new Set(appended.filter((e) => e.event_type === 'SessionEnded').map((e) => String(e.payload.session_id)));
    for (const event of appended) {
      if (event.event_type !== 'DeviceProfileSet') continue;
      const p = event.payload as DeviceProfileSetPayload;
      if (p.cause !== 'edited') continue;
      const ws = wsHubFor(app);
      const frame = { type: 'device_profile', screens: p.screens, access: p.access, point_id: p.point_id } as const;
      // ⚠️ 01d v1.3.7 §6 batch 3 (run 3 R3-M-2): a surviving staff session of the device gets its complete `alerts`
      // catch-up part with the push (the same builder and card predicate as a reconnect, against the refreshed map);
      // every other socket of the device gets the plain push, as before.
      const sockets = ws.connectedSessions().filter((s) => s.deviceId === p.device_id);
      const staff = sockets.filter((s) => s.kind === 'staff' && s.staffId !== null && !ended.has(s.sessionId));
      const deviceType = staff.length === 0 ? null : (deps.db.prepare('SELECT device_type FROM devices WHERE device_id = ?').get(p.device_id) as { device_type: DeviceType } | undefined)?.device_type;
      if (staff.length === 0 || deviceType === undefined || deviceType === null) {
        ws.sendToDevices([p.device_id], frame);
        continue;
      }
      for (const s of staff) {
        let alerts: ReturnType<typeof alertsPartForSession>;
        try {
          alerts = alertsPartForSession(app, deps.db, deps.state.get(), { deviceId: p.device_id, deviceType, sessionId: s.sessionId, staffId: s.staffId });
        } catch (err) {
          // after commit: never throw past the hook (publish follows); the builder's error carries name and code only
          app.log.error({ err, device_id: p.device_id }, 'device_profile: alerts refresh failed');
          alerts = undefined;
        }
        ws.sendToSessions([s.sessionId], alerts === undefined ? frame : { ...frame, alerts });
      }
      const others = sockets.filter((s) => !staff.includes(s)).map((s) => s.sessionId);
      if (others.length > 0) ws.sendToSessions(others, frame);
      // the alert-mode socket of the device got the push through sendToDevices before; keep it
      if (ws.alertSockets().some((a) => a.deviceId === p.device_id)) ws.sendToAlertMode([p.device_id], frame as unknown as AlertModeFrame);
    }
  });
  commandRegistry(app).register(
    defineCommand({
      commandType: 'SetDeviceProfile',
      payloadSchema: Payload,
      sessionKind: 'both',
      permission: 'manage-devices',
      handle(ctx, payload) {
        // 1. missing, revoked or kds → 404
        const device = ctx.tx.db.prepare(DEVICE_SQL).get(payload.device_id, ctx.branch.branchId) as DeviceRow | undefined;
        if (device === undefined || device.revoked_at !== null || device.device_type === 'kds') {
          throw new DomainError('DEVICE_NOT_FOUND', { device_id: payload.device_id });
        }
        // 2. optimistic version (a staff device with no profile yet counts as version 0)
        const version = device.profile_version ?? 0;
        if (version !== payload.expected_version) {
          throw new DomainError('CONFIG_STALE', { device_id: payload.device_id, profile_version: version });
        }
        const people = (
          ctx.tx.db.prepare('SELECT staff_id FROM device_people WHERE device_id = ? ORDER BY rowid').all(payload.device_id) as Array<{ staff_id: string }>
        ).map((r) => r.staff_id);
        const before: Merged = {
          device_name: device.device_name,
          access: device.access ?? 'everyone',
          staff_ids: device.access === 'listed' ? people : [],
          screens: device.screens === null ? [] : (JSON.parse(device.screens) as ScreenKey[]),
          point_id: device.point_id,
        };
        // 3. merge (G-e) and validate
        const next = merge(before, payload);
        validate(ctx, device.device_type, next);
        // 4. self-guard (M-6)
        const editor = ctx.actor.staffId;
        if (ctx.actor.deviceId === payload.device_id && editor !== null) {
          const offList = next.access === 'listed' && !next.staff_ids.includes(editor);
          const losesAdmin =
            before.access === 'listed' &&
            next.access === 'everyone' &&
            (ctx.directory.resolve(editor, 'manage-devices').grant === 'allowed' || ctx.directory.resolve(editor, 'access-hub-admin').grant === 'allowed');
          if (offList || losesAdmin) throw new DomainError('DEVICE_ACCESS_SELF', { device_id: payload.device_id });
        }
        // 5. the whole profile, version + 1 (N-4)
        const profile_version = version + 1;
        const event: DeviceProfileSetPayload = {
          device_id: payload.device_id,
          device_name: next.device_name,
          access: next.access,
          staff_ids: next.staff_ids,
          screens: next.screens,
          point_id: next.point_id,
          profile_version,
          cause: 'edited',
          needs_review: false,
        };
        ctx.tx.append([
          {
            stream_type: 'hub',
            stream_id: payload.device_id,
            event_type: 'DeviceProfileSet',
            schema_version: 1,
            payload: event,
            occurred_at: ctx.clock.branchNow(),
            actor_id: editor,
            device_id: ctx.actor.deviceId,
          },
        ]);
        // 6. N-1: staff and admin sessions of anyone no longer allowed; M-6: a switch to everyone ends every admin
        // session bound to the device. Ended in this commit as `'forced'` by the editor (RevokeDevice's pattern).
        const becameEveryone = before.access === 'listed' && next.access === 'everyone';
        const sessions = JSON.parse(device.sessions) as SessionRow[];
        for (const s of sessions) {
          const removed = next.access === 'listed' && (s.staff_id === null || !next.staff_ids.includes(s.staff_id));
          if (removed || (becameEveryone && s.kind === 'admin')) {
            endSession(ctx.tx, s, 'forced', editor, editor, ctx.actor.deviceId);
          }
        }
        return { events: [], result: { device_id: payload.device_id, profile_version } };
      },
    }),
  );
}

/** §6.4 + G-e (a): unsent fields kept; a sent point_id without `pass`, or sent staff_ids with `everyone`, is 400. */
function merge(before: Merged, payload: Payload): Merged {
  const access = payload.access ?? before.access;
  const screens = payload.screens ?? before.screens;
  const hasPass = screens.includes('pass');
  if (payload.point_id !== undefined && !hasPass) throw invalid('point_id', 'a point needs the pass screen');
  if (payload.staff_ids !== undefined && access === 'everyone') throw invalid('staff_ids', 'everyone has no people');
  return {
    device_name: payload.device_name ?? before.device_name,
    access,
    staff_ids: access === 'everyone' ? [] : (payload.staff_ids ?? before.staff_ids),
    screens,
    point_id: hasPass ? (payload.point_id ?? before.point_id) : null,
  };
}

/** §6.3 step 3 on the merged profile. */
function validate(ctx: CommandCtx, deviceType: DeviceType, p: Merged): void {
  if (p.access === 'listed') {
    if (p.staff_ids.length < 1 || p.staff_ids.length > 20 || new Set(p.staff_ids).size !== p.staff_ids.length) {
      throw invalid('staff_ids', 'listed needs 1–20 unique people');
    }
    for (const staff_id of p.staff_ids) {
      if (ctx.directory.get(staff_id) === undefined) throw new DomainError('STAFF_NOT_FOUND', { staff_id });
    }
  }
  const offered = screensOffered(deviceType);
  if (p.screens.length < 1 || p.screens.length > 6 || new Set(p.screens).size !== p.screens.length || p.screens.some((k) => !offered.includes(k))) {
    throw invalid('screens', 'screens must be 1–6 unique screens offered for the hardware');
  }
  if (p.screens.includes('pass') !== (p.point_id !== null)) throw invalid('point_id', 'pass needs a point');
  if (p.point_id !== null) {
    const point_id = p.point_id;
    const active = (branchConfig()?.points ?? []).some((pt) => pt.point_id === point_id && !pt.is_archived);
    if (!active) throw new DomainError('POINT_NOT_FOUND', { point_id });
  }
}
