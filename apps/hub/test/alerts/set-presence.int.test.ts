import type { DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { aBusinessDayClosed, aBusinessDayOpened } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activity } from '../../src/auth/session-store';
import type { CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 01d task 37: `SetPresence` (§6.6, §3.11). A manager (`manage-staff`, the normal permission check) ticks who
// is present today; `present: false` marks the listed people absent (BF-8: absent = a presence_today row with
// present = 0). Validation: a business day open (else 409 BUSINESS_DAY_NOT_OPEN), every id in `staff` or
// `no_pin_staff` (else 404 STAFF_NOT_FOUND { staff_ids }). 1 statement (the open day's id). End to end: the
// next raise's team resolution skips a person ticked absent who is not signed in (§3.4.1).

const OWNER = 'S_OWNER'; // a lead: S_WAIT and the no-PIN N_HELPER report to the owner
const MGR = 'S_MGR'; // R_MGR holds manage-staff
const CASH = 'S_CASH'; // R_CASH: no manage-staff
const WAIT = 'S_WAIT';
const HELPER = 'N_HELPER'; // a no-PIN person (01b B-1)
const TENANT = 'tenant-a';
const BRANCH = 'branch-1';

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory({ directory_version: 1 });
  return {
    ...base,
    staff: base.staff.map((s) => (s.staff_id === WAIT ? { ...s, lead_staff_id: OWNER } : s)),
    no_pin_staff: [{ staff_id: HELPER, display_name: 'Helper', lead_staff_id: OWNER }],
  };
}

interface Seat {
  staffId: string;
  deviceId: string;
  deviceToken: string;
  sessionToken: string;
}

function seat(hub: TestHub, staffId: string): Seat {
  const device = pairDevice(hub, { type: 'tablet', name: `Tablet of ${staffId}` });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, deviceToken: device.token, sessionToken: session.token };
}

let commandNo = 0;
const nextId = (): string => `auto-${(commandNo += 1)}`;

function post(hub: TestHub, s: Seat, path: string, commandType: string, payload: unknown, commandId: string = nextId()) {
  return hub.app.inject({
    method: 'POST',
    url: `/commands/${path}`,
    headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
    payload: {
      command_id: commandId,
      tenant_id: TENANT,
      branch_id: BRANCH,
      command_type: commandType,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: s.staffId,
      device_id: s.deviceId,
    },
  });
}

const setPresence = (hub: TestHub, s: Seat, staff_ids: string[], present: boolean, commandId?: string) =>
  post(hub, s, 'set-presence', 'SetPresence', { staff_ids, present }, commandId);

function append(hub: TestHub, events: PosEvent[]): void {
  hub.deps.writer.run((tx) => {
    tx.append(
      events.map(
        (e): EventDraft => ({
          stream_type: e.stream_type,
          stream_id: BRANCH,
          event_type: e.event_type,
          schema_version: e.schema_version,
          payload: e.payload,
          occurred_at: hub.clock.branchNow(),
          actor_id: e.actor_id,
          device_id: e.device_id,
        }),
      ),
    );
  });
}

function eventsOf(hub: TestHub, type: string): Array<Record<string, unknown>> {
  const rows = hub.deps.db.prepare('SELECT * FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<Record<string, unknown>>;
  return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload as string) }));
}

const dayId = (hub: TestHub): string => eventsOf(hub, 'BusinessDayOpened').at(-1)?.event_id as string;

function presence(hub: TestHub): Array<Record<string, unknown>> {
  return hub.deps.db.prepare('SELECT staff_id, present, set_by FROM presence_today ORDER BY staff_id').all() as Array<Record<string, unknown>>;
}

/** The staff ids of the team test alert's step 0 (own rows only, not "for" rows). */
async function teamRecipients(hub: TestHub, s: Seat): Promise<string[]> {
  const res = await post(hub, s, 'send-test-alert', 'SendTestAlert', { target: { kind: 'team', lead_staff_id: OWNER } });
  expect(res.statusCode).toBe(200);
  const alertId = (res.json() as { data: { result: { alert_id: string } } }).data.result.alert_id;
  return hub.deps.db
    .prepare('SELECT DISTINCT staff_id FROM alert_recipients WHERE alert_id = ? AND step = 0 AND staff_id IS NOT NULL ORDER BY staff_id')
    .pluck()
    .all(alertId) as string[];
}

/** Counts the statements of each `handle` call of SetPresence (§6.6 Queries). */
function countHandle(hub: TestHub): { handle: number[]; restore(): void } {
  const def = commandRegistry(hub.app).byPath('set-presence') as CommandDef;
  const counter = statementCounter(hub.deps.db);
  const original = def.handle;
  const out: number[] = [];
  def.handle = (ctx, payload, cmd) => {
    counter.reset();
    try {
      return original.call(def, ctx, payload, cmd);
    } finally {
      out.push(counter.count);
    }
  };
  return {
    handle: out,
    restore() {
      def.handle = original;
    },
  };
}

describe('01d SetPresence (task 37)', () => {
  let hub: TestHub;

  beforeEach(async () => {
    hub = await createTestHub();
    await seedDirectory(hub, await directory());
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run(); // the §3.9 flag pass is not under test here
  });

  afterEach(async () => {
    activity.drain();
    activity.drainDevices();
    await hub.close();
  });

  it('[01d #45] sets and clears presence for PIN and no-PIN people: 200 { business_day_id, staff_ids, present }, PresenceSet on staff / branch_id, 1 statement', async () => {
    const mgr = seat(hub, MGR);
    append(hub, [aBusinessDayOpened()]);
    const day = dayId(hub);
    const counted = countHandle(hub);

    const absent = await setPresence(hub, mgr, [WAIT, HELPER], false, 'auto-absent');
    expect(absent.statusCode).toBe(200);
    expect((absent.json() as { data: { result: unknown } }).data.result).toEqual({ business_day_id: day, staff_ids: [WAIT, HELPER], present: false });
    expect(presence(hub)).toEqual([
      { staff_id: HELPER, present: 0, set_by: MGR },
      { staff_id: WAIT, present: 0, set_by: MGR },
    ]);
    const [event] = eventsOf(hub, 'PresenceSet');
    expect(event).toMatchObject({
      stream_type: 'staff',
      stream_id: BRANCH,
      schema_version: 1,
      actor_id: MGR,
      device_id: mgr.deviceId,
      payload: { business_day_id: day, staff_ids: [WAIT, HELPER], present: false, set_by: MGR },
    });

    // clear: present again (an upsert; setting the same value again is harmless)
    const back = await setPresence(hub, mgr, [HELPER], true);
    expect(back.statusCode).toBe(200);
    expect((back.json() as { data: { result: unknown } }).data.result).toEqual({ business_day_id: day, staff_ids: [HELPER], present: true });
    expect((await setPresence(hub, mgr, [HELPER], true)).statusCode).toBe(200);
    expect(presence(hub)).toEqual([
      { staff_id: HELPER, present: 1, set_by: MGR },
      { staff_id: WAIT, present: 0, set_by: MGR },
    ]);
    expect(counted.handle).toEqual([1, 1, 1]);
    counted.restore();

    // idempotency (00 M19): the same command_id replays, no second event
    const replay = await setPresence(hub, mgr, [WAIT, HELPER], false, 'auto-absent');
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(eventsOf(hub, 'PresenceSet')).toHaveLength(3);
  });

  it('[01d #45] business day not open (never opened, or closed) → 409 BUSINESS_DAY_NOT_OPEN, no event', async () => {
    const mgr = seat(hub, MGR);
    const never = await setPresence(hub, mgr, [WAIT], false);
    expect(never.statusCode).toBe(409);
    expect(never.json().error.code).toBe('BUSINESS_DAY_NOT_OPEN');

    append(hub, [aBusinessDayOpened(), aBusinessDayClosed()]);
    const closed = await setPresence(hub, mgr, [WAIT], false);
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error.code).toBe('BUSINESS_DAY_NOT_OPEN');
    expect(eventsOf(hub, 'PresenceSet')).toEqual([]);
  });

  it('[01d #45] an id in neither staff nor no_pin_staff → 404 STAFF_NOT_FOUND { staff_ids } listing every unknown id, no event', async () => {
    const mgr = seat(hub, MGR);
    append(hub, [aBusinessDayOpened()]);
    const res = await setPresence(hub, mgr, [WAIT, 'S_NOBODY', HELPER, 'N_NOBODY'], false);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: 'STAFF_NOT_FOUND', details: { staff_ids: ['S_NOBODY', 'N_NOBODY'] } });
    expect(eventsOf(hub, 'PresenceSet')).toEqual([]);
    expect(presence(hub)).toEqual([]);
  });

  it('[01d #45] without manage-staff → 403 PERMISSION_DENIED', async () => {
    const cash = seat(hub, CASH);
    append(hub, [aBusinessDayOpened()]);
    const res = await setPresence(hub, cash, [WAIT], false);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'manage-staff' } });
    expect(eventsOf(hub, 'PresenceSet')).toEqual([]);
  });

  it('[01d #45] the projection is cleared on BusinessDayClosed', async () => {
    const mgr = seat(hub, MGR);
    append(hub, [aBusinessDayOpened()]);
    expect((await setPresence(hub, mgr, [WAIT, HELPER], false)).statusCode).toBe(200);
    expect(presence(hub)).toHaveLength(2);
    append(hub, [aBusinessDayClosed()]);
    expect(presence(hub)).toEqual([]);
  });

  it('[01d §6.6] payload: 1..100 ids and a boolean present → else 400 VALIDATION_FAILED', async () => {
    const mgr = seat(hub, MGR);
    append(hub, [aBusinessDayOpened()]);
    const ids = Array.from({ length: 101 }, (_, i) => `S_${i}`);
    for (const payload of [{ staff_ids: [], present: false }, { staff_ids: ids, present: false }, { staff_ids: [WAIT] }]) {
      const res = await post(hub, mgr, 'set-presence', 'SetPresence', payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('[01d §6.6] end to end (§3.4.1, BF-8): PresenceSet makes the next raise skip a person ticked absent who is not signed in; un-ticked or signed-in people stay present', async () => {
    const mgr = seat(hub, MGR);
    append(hub, [aBusinessDayOpened()]);
    // nobody ticked → everyone present
    expect(await teamRecipients(hub, mgr)).toEqual([HELPER, WAIT]);

    // S_WAIT (not signed in) ticked absent → the next raise's team resolution skips them; N_HELPER, not ticked,
    // stays present
    expect((await setPresence(hub, mgr, [WAIT], false)).statusCode).toBe(200);
    expect(await teamRecipients(hub, mgr)).toEqual([HELPER]);

    // the no-PIN person ticked absent too → skipped
    expect((await setPresence(hub, mgr, [HELPER], false)).statusCode).toBe(200);
    expect(await teamRecipients(hub, mgr)).toEqual([]);

    // cleared → present again
    expect((await setPresence(hub, mgr, [WAIT], true)).statusCode).toBe(200);
    expect(await teamRecipients(hub, mgr)).toEqual([WAIT]);

    // a person signed in counts as present even when ticked absent
    expect((await setPresence(hub, mgr, [WAIT], false)).statusCode).toBe(200);
    seat(hub, WAIT);
    expect(await teamRecipients(hub, mgr)).toEqual([WAIT]);
  });
});
