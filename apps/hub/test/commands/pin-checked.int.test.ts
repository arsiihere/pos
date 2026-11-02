import { verify } from '@node-rs/argon2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activity, endSession, findSessionByToken } from '../../src/auth/session-store';
import { payloadHash } from '../../src/lib/hash';
import { PIN } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// The argon2 verify the pipeline calls, counted (the real verify still runs).
vi.mock('@node-rs/argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@node-rs/argon2')>();
  return { ...actual, verify: vi.fn((hash: string, pin: string) => actual.verify(hash, pin)) };
});

const verifySpy = vi.mocked(verify);
const hubs: TestHub[] = [];
const RIGHT = PIN.b; // S_MGR
const WRONG = '5555';

describe('TestPinChecked: a command with pinCheck through checkPin', () => {
  afterEach(async () => {
    for (const hub of hubs.splice(0)) await hub.close();
    activity.drain();
    activity.drainDevices();
    verifySpy.mockClear();
  });

  it('[00 H-3] a replay of a stored command_id returns the stored 200 without argon2 (01d §3.3 rule 4 (a))', async () => {
    const { hub, bound } = await setup();
    const first = await post(hub, bound, { commandId: 'cmd-a', payload: { staff_id: 'S_MGR', pin: RIGHT } });
    expect(first.statusCode).toBe(200);
    verifySpy.mockClear();
    const runs = spyRuns(hub);
    const again = await post(hub, bound, { commandId: 'cmd-a', payload: { staff_id: 'S_MGR', pin: RIGHT } });
    expect(again.statusCode).toBe(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.json()).toEqual(first.json());
    expect(verifySpy).not.toHaveBeenCalled();
    expect(runs()).toBe(0);
  });

  it('[00 H-9] a replay that differs only in the PIN returns the stored 200 without argon2', async () => {
    const { hub, bound } = await setup();
    const first = await post(hub, bound, { commandId: 'cmd-h9', payload: { staff_id: 'S_MGR', pin: RIGHT } });
    expect(first.statusCode).toBe(200);
    verifySpy.mockClear();
    const again = await post(hub, bound, { commandId: 'cmd-h9', payload: { staff_id: 'S_MGR', pin: WRONG } });
    expect(again.statusCode).toBe(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.json()).toEqual(first.json());
    expect(verifySpy).not.toHaveBeenCalled();
    expect(counters(hub, bound)).toEqual({ staff: 0, device: 0 });
  });

  it('[00 H-9] the same command_id with another non-PIN field is 400 command_id already used', async () => {
    const { hub, bound } = await setup();
    expect((await post(hub, bound, { commandId: 'cmd-h9b', payload: { staff_id: 'S_MGR', pin: RIGHT } })).statusCode).toBe(200);
    verifySpy.mockClear();
    const other = await post(hub, bound, { commandId: 'cmd-h9b', payload: { staff_id: 'S_OWNER', pin: PIN.a } });
    expect(other.statusCode).toBe(400);
    expect(other.json().error.details.issues).toEqual([{ path: 'command_id', message: 'command_id already used' }]);
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('[00 H-3] a payload that fails Zod is 400 with no PIN verified', async () => {
    const { hub, bound } = await setup();
    const response = await post(hub, bound, { commandId: 'cmd-zod', payload: { staff_id: 'S_MGR' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    expect(verifySpy).not.toHaveBeenCalled();
    expect(counters(hub, bound)).toEqual({ staff: 0, device: 0 });
  });

  it('[01d §3.3 rule 4] a preRead refusal is 404 for the right and the wrong PIN, no PIN verified, nothing counted ((b))', async () => {
    const { hub, bound } = await setup();
    const before = counts(hub);
    for (const pin of [RIGHT, WRONG]) {
      const response = await post(hub, bound, { commandId: `cmd-pre-${pin}`, payload: { staff_id: 'S_MGR', pin, refuse: 'pre' } });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('STAFF_NOT_FOUND');
      expect(JSON.stringify(response.json())).not.toContain(pin);
    }
    expect(verifySpy).not.toHaveBeenCalled();
    expect(counters(hub, bound)).toEqual({ staff: 0, device: 0 });
    expect(counts(hub)).toEqual(before);
  });

  it('[00 H-3] success is one writer.run; payload_hash leaves the PIN out and processed_commands holds no PIN', async () => {
    const { hub, bound } = await setup();
    const payload = { staff_id: 'S_MGR', pin: RIGHT };
    const runs = spyRuns(hub);
    const response = await post(hub, bound, { commandId: 'cmd-ok', payload });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.result).toEqual({ ok: true, staff_id: 'S_MGR' });
    expect(response.json().data.event_ids).toHaveLength(1);
    expect(runs()).toBe(1);
    expect(verifySpy).toHaveBeenCalledTimes(1);
    const row = hub.deps.db
      .prepare("SELECT payload_hash, response_json FROM processed_commands WHERE command_id = 'cmd-ok'")
      .get() as { payload_hash: string; response_json: string };
    expect(row.payload_hash).toBe(payloadHash(payload, 'pin'));
    expect(row.payload_hash).not.toBe(payloadHash(payload));
    expect(row.response_json).not.toContain(RIGHT);
    expect(JSON.stringify(eventPayloads(hub))).not.toContain(RIGHT);
    expect(activity.get(bound.session.sessionId)).toBe(hub.clock.branchNow());
  });

  it('[01d §3.3 rule 4] a failed prepare is 409 for both PINs, one writer.run each, one failure counted each ((d))', async () => {
    const { hub, bound } = await setup();
    let expected = 0;
    for (const pin of [RIGHT, WRONG]) {
      const runs = spyRuns(hub);
      const response = await post(hub, bound, { commandId: `cmd-prep-${pin}`, payload: { staff_id: 'S_MGR', pin, refuse: 'prepare' } });
      expected += 1;
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('REQUEST_NOT_PENDING');
      expect(runs()).toBe(1);
      expect(counters(hub, bound)).toEqual({ staff: expected, device: expected });
    }
    expect(verifySpy).toHaveBeenCalledTimes(2);
    expect(hookEvents(hub)).toEqual(['prepare_failed:matched', 'prepare_failed:mismatched']);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands').pluck().get()).toBe(0);
  });

  it('[00 H-3] a wrong PIN is 401 PIN_INVALID, counted, with the onMismatch drafts', async () => {
    const { hub, bound } = await setup();
    const runs = spyRuns(hub);
    const response = await post(hub, bound, { commandId: 'cmd-wrong', payload: { staff_id: 'S_MGR', pin: WRONG } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('PIN_INVALID');
    expect(runs()).toBe(1);
    expect(counters(hub, bound)).toEqual({ staff: 1, device: 1 });
    expect(hookEvents(hub)).toEqual(['mismatch']);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands').pluck().get()).toBe(0);
  });

  it('[00 H-3] M39: the session ended between verify and the writer is 401 SESSION_EXPIRED for both PINs, counted', async () => {
    for (const pin of [RIGHT, WRONG]) {
      const { hub, bound } = await setup();
      hub.deps.testHooks = {
        async betweenVerifyAndWriter() {
          const row = findSessionByToken(hub.deps.db, bound.session.token);
          if (row === undefined) throw new Error('session missing');
          hub.deps.writer.run((tx) => {
            endSession(tx, row, 'forced', null, null, bound.device.deviceId);
          });
        },
      };
      const response = await post(hub, bound, { commandId: `cmd-m39-${pin}`, payload: { staff_id: 'S_MGR', pin } });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('SESSION_EXPIRED');
      expect(counters(hub, bound)).toEqual({ staff: 1, device: 1 });
      expect(hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands').pluck().get()).toBe(0);
    }
  });

  it('[00 H-3] a replay committed between verify and the writer returns the stored 200, nothing counted', async () => {
    const { hub, bound } = await setup();
    let parallel: Awaited<ReturnType<typeof post>> | undefined;
    let entered = 0;
    hub.deps.testHooks = {
      async betweenVerifyAndWriter() {
        entered += 1;
        if (entered === 1) {
          parallel = await post(hub, bound, { commandId: 'cmd-race', payload: { staff_id: 'S_MGR', pin: RIGHT } });
        }
      },
    };
    const response = await post(hub, bound, { commandId: 'cmd-race', payload: { staff_id: 'S_MGR', pin: WRONG } });
    expect(parallel?.statusCode).toBe(200);
    expect(response.statusCode).toBe(200);
    expect(response.headers['idempotent-replay']).toBe('true');
    expect(response.json()).toEqual(parallel?.json());
    expect(counters(hub, bound)).toEqual({ staff: 0, device: 0 });
    expect(hookEvents(hub)).toEqual([]);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands').pluck().get()).toBe(1);
  });
});

type Bound = { device: { deviceId: string; token: string }; session: { sessionId: string; token: string } };

async function setup(): Promise<{ hub: TestHub; bound: Bound }> {
  const hub = await createTestHub();
  hubs.push(hub);
  await seedDirectory(hub);
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: device.deviceId });
  return { hub, bound: { device, session } };
}


function spyRuns(hub: TestHub): () => number {
  const spy = vi.spyOn(hub.deps.writer, 'run');
  return () => {
    const n = spy.mock.calls.length;
    spy.mockRestore();
    return n;
  };
}

function counters(hub: TestHub, bound: Bound): { staff: number; device: number } {
  const read = (type: string, id: string): number =>
    (hub.deps.db
      .prepare('SELECT failed_count FROM auth_lockouts WHERE subject_type = ? AND subject_id = ?')
      .pluck()
      .get(type, id) as number | undefined) ?? 0;
  return { staff: read('staff', 'S_MGR'), device: read('device', bound.device.deviceId) };
}

function counts(hub: TestHub): { events: number; commands: number } {
  return {
    events: hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number,
    commands: hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands').pluck().get() as number,
  };
}

function eventPayloads(hub: TestHub): unknown[] {
  return (hub.deps.db.prepare('SELECT payload FROM events').pluck().all() as string[]).map((p) => JSON.parse(p));
}

function hookEvents(hub: TestHub): string[] {
  return (
    hub.deps.db
      .prepare("SELECT payload FROM events WHERE event_type = 'TestNooped' ORDER BY seq")
      .pluck()
      .all() as string[]
  )
    .map((p) => (JSON.parse(p) as { command_id: string }).command_id)
    .filter((id) => !id.startsWith('cmd-'));
}

function post(
  hub: TestHub,
  bound: Bound,
  o: { commandId: string; payload: Record<string, unknown> },
) {
  return hub.app.inject({
    method: 'POST',
    url: '/commands/test-pin-checked',
    headers: {
      authorization: `Bearer ${bound.device.token}`,
      'x-session-token': bound.session.token,
    },
    payload: {
      command_id: o.commandId,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'TestPinChecked',
      payload: o.payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: 'S_CASH',
      device_id: bound.device.deviceId,
    },
  });
}
