import { verify } from '@node-rs/argon2';
import { DomainError, statusOf } from '@pos/domain';
import type { StaffDirectory } from '../../src/auth/staff-directory';
import { Semaphore } from '../../src/lib/semaphore';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkPin, type RateSubject } from '../../src/auth/pin';
import { aDirectory, PIN } from '../helpers/fixtures';
import { createTestHub, type TestHub } from '../helpers/test-hub';

describe('PIN verification', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    vi.useRealTimers();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #59] parallel wrong PINs cross the threshold while a correct PIN verifies → 429', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const directory = await directoryOf();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verifyPin = async (_hash: string, pin: string): Promise<boolean> => {
      if (pin === PIN.a) {
        await gate;
        return true;
      }
      return false;
    };
    const semaphore = new Semaphore(8);
    const correct = checkPin(pinDeps(hub, directory, semaphore, verifyPin), input('S_OWNER', PIN.a, device('dev-race')), () => {
      throw new Error('matched');
    });
    const wrong = Array.from({ length: 5 }, () =>
      checkPin(pinDeps(hub, directory, semaphore, verifyPin), input('S_OWNER', '0000', device('dev-race')), () => 'no'),
    );
    await Promise.all(wrong.map((attempt) => expect(attempt).rejects.toMatchObject({ code: 'PIN_INVALID' })));
    release();
    await expect(correct).rejects.toMatchObject({ code: 'PIN_LOCKED_OUT' });
    expect(statusOf('PIN_LOCKED_OUT')).toBe(429);
  });

  it('[00 §10 #107] after a lock expires, one wrong PIN → attempts_remaining 4', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const directory = await directoryOf();
    const deps = pinDeps(hub, directory, new Semaphore(2), async () => false);
    for (let i = 0; i < 5; i += 1) {
      await expect(checkPin(deps, input('S_OWNER', '0000', device('dev-expire')), () => 'no')).rejects.toMatchObject({
        code: 'PIN_INVALID',
      });
    }
    hub.clock.advance(900_000);
    await expect(checkPin(deps, input('S_OWNER', '0000', device('dev-expire')), () => 'no')).rejects.toMatchObject({
      code: 'PIN_INVALID',
      details: { attempts_remaining: 4 },
    });
  });

  it('[00 §3.5] 5th failure writes StaffPinLockedOut; success resets only the staff counter', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const directory = await directoryOf();
    const deps = pinDeps(
      hub,
      directory,
      new Semaphore(2),
      async (_hash, pin) => pin === PIN.b,
    );
    for (let i = 0; i < 4; i += 1) {
      await expect(checkPin(deps, input('S_OWNER', '0000', device('dev-lock')), () => 'no')).rejects.toMatchObject({
        code: 'PIN_INVALID',
      });
    }
    expect(lockEvents(hub, 'StaffPinLockedOut')).toHaveLength(0);
    await expect(checkPin(deps, input('S_OWNER', '0000', device('dev-lock')), () => 'no')).rejects.toMatchObject({
      code: 'PIN_INVALID',
      details: { attempts_remaining: 0 },
    });
    const locked = lockEvents(hub, 'StaffPinLockedOut');
    expect(locked).toHaveLength(1);
    expect(locked[0]?.payload).toMatchObject({ staff_id: 'S_OWNER', failed_count: 5 });
    await expect(checkPin(deps, input('S_OWNER', PIN.a, device('dev-lock')), () => 'no')).rejects.toMatchObject({
      code: 'PIN_LOCKED_OUT',
    });

    await expect(checkPin(deps, input('S_MGR', '0000', device('dev-reset')), () => 'no')).rejects.toMatchObject({
      code: 'PIN_INVALID',
    });
    await expect(checkPin(deps, input('S_MGR', '0000', device('dev-reset')), () => 'no')).rejects.toMatchObject({
      code: 'PIN_INVALID',
    });
    await expect(checkPin(deps, input('S_MGR', PIN.b, device('dev-reset')), () => 'ok')).resolves.toBe('ok');
    expect(lockRow(hub, 'staff', 'S_MGR')?.failed_count).toBe(0);
    expect(lockRow(hub, 'device', 'dev-reset')?.failed_count).toBe(2);
  });

  it('[00 §3.5] device window restarts after 300 000 ms', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const directory = await directoryOf();
    hub.deps.config.auth.pin_max_failures = 100;
    const deps = pinDeps(hub, directory, new Semaphore(2), async () => false);
    const subject = device('dev-window');
    for (let i = 0; i < 9; i += 1) {
      await expect(checkPin(deps, input('S_OWNER', '0000', subject), () => 'no')).rejects.toMatchObject({ code: 'PIN_INVALID' });
    }
    hub.clock.advance(300_000);
    await expect(checkPin(deps, input('S_CASH', '0000', subject), () => 'no')).rejects.toMatchObject({ code: 'PIN_INVALID' });
    const row = lockRow(hub, 'device', 'dev-window');
    expect(row?.failed_count).toBe(1);
    expect(row?.locked_until).toBeNull();
    expect(row?.window_started_at).toBe(hub.clock.branchNow());
    expect(lockEvents(hub, 'DevicePinLockedOut')).toHaveLength(0);
  });

  it('[00 §3.5] PIN "0123" verifies against a hash of "0123" and not "123"', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const directory = await directoryOf();
    const deps = pinDeps(hub, directory, new Semaphore(2), (hash, pin) => verify(hash, pin));
    await expect(checkPin(deps, input('S_MGR', '0123', device('dev-pin')), () => 'ok')).resolves.toBe('ok');
    await expect(checkPin(deps, input('S_MGR', '123', device('dev-pin')), () => 'ok')).rejects.toMatchObject({
      code: 'PIN_INVALID',
    });
  });

  it('[00 §7.4] semaphore full for 2 s → 503 retry_after_ms 1000', async () => {
    vi.useFakeTimers();
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const directory = await directoryOf();
    const semaphore = new Semaphore(1);
    const release = await semaphore.acquire(1_000);
    let verified = false;
    const pending = checkPin(
      pinDeps(hub, directory, semaphore, async () => {
        verified = true;
        return true;
      }),
      input('S_OWNER', PIN.a, device('dev-sem')),
      () => 'ok',
    );
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      details: { retry_after_ms: 1000 },
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
    expect(statusOf('SERVICE_UNAVAILABLE')).toBe(503);
    expect(verified).toBe(false);
    release();
  });

  it('[00 §3.5] a DomainError from the match callback keeps the staff counter reset and writes no session', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const directory = await directoryOf();
    const deps = pinDeps(hub, directory, new Semaphore(2), async (_hash, pin) => pin === PIN.a);
    const subject = device('dev-reject');
    await expect(checkPin(deps, input('S_OWNER', '0000', subject), () => 'no')).rejects.toMatchObject({ code: 'PIN_INVALID' });
    await expect(checkPin(deps, input('S_OWNER', '0000', subject), () => 'no')).rejects.toMatchObject({ code: 'PIN_INVALID' });
    expect(lockRow(hub, 'staff', 'S_OWNER')?.failed_count).toBe(2);
    await expect(
      checkPin(deps, input('S_OWNER', PIN.a, subject), () => {
        throw new DomainError('DEVICE_SESSION_ACTIVE', {
          staff_id: 'S_CASH',
          display_name: 'Cashier',
          can_take_over: true,
        });
      }),
    ).rejects.toMatchObject({ code: 'DEVICE_SESSION_ACTIVE' });
    expect(lockRow(hub, 'staff', 'S_OWNER')?.failed_count).toBe(0);
    expect(lockRow(hub, 'device', 'dev-reject')?.failed_count).toBe(2);
    const sessions = hub.deps.db.prepare('SELECT COUNT(*) AS n FROM staff_sessions').get() as { n: number };
    expect(sessions.n).toBe(0);
    const started = hub.deps.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_type = 'SessionStarted'`).get() as {
      n: number;
    };
    expect(started.n).toBe(0);
  });

  it('[00 §3.5] ip subject locks with IP_LOCKED_OUT and DevicePinLockedOut subject_type ip', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const directory = await directoryOf();
    hub.deps.config.auth.pin_max_failures = 100;
    const deps = pinDeps(hub, directory, new Semaphore(2), async () => false);
    const subject: RateSubject = { type: 'ip', id: '203.0.113.8' };
    for (let i = 0; i < 10; i += 1) {
      await expect(checkPin(deps, input('S_OWNER', '0000', subject), () => 'no')).rejects.toMatchObject({
        code: 'PIN_INVALID',
      });
    }
    const locked = lockEvents(hub, 'DevicePinLockedOut');
    expect(locked).toHaveLength(1);
    expect(locked[0]?.payload).toMatchObject({ subject_type: 'ip', subject_id: '203.0.113.8', failed_count: 10 });
    await expect(checkPin(deps, input('S_OWNER', '0000', subject), () => 'no')).rejects.toMatchObject({
      code: 'IP_LOCKED_OUT',
    });
    expect(statusOf('IP_LOCKED_OUT')).toBe(429);
  });
});

function device(id: string): RateSubject {
  return { type: 'device', id };
}

function input(staffId: string, pin: string, subject: RateSubject) {
  return { staffId, pin, subject, eventDeviceId: subject.type === 'device' ? subject.id : 'hub' };
}

function pinDeps(
  hub: TestHub,
  directory: StaffDirectory,
  semaphore: Semaphore,
  verifyPin: (hash: string, pin: string) => Promise<boolean>,
) {
  return {
    db: hub.deps.db,
    writer: hub.deps.writer,
    directory: () => directory,
    clock: hub.clock,
    config: hub.deps.config,
    semaphore,
    verify: verifyPin,
  };
}

async function directoryOf(): Promise<StaffDirectory> {
  const { StaffDirectory } = await import('../../src/auth/staff-directory');
  return StaffDirectory.fromInput(await aDirectory());
}

function lockRow(
  hub: TestHub,
  subjectType: string,
  subjectId: string,
): { failed_count: number; window_started_at: number; locked_until: number | null } | undefined {
  return hub.deps.db
    .prepare(
      `SELECT failed_count, window_started_at, locked_until FROM auth_lockouts
       WHERE subject_type = ? AND subject_id = ?`,
    )
    .get(subjectType, subjectId) as
    | { failed_count: number; window_started_at: number; locked_until: number | null }
    | undefined;
}

function lockEvents(hub: TestHub, eventType: string): Array<{ payload: Record<string, unknown> }> {
  const rows = hub.deps.db.prepare('SELECT payload FROM events WHERE event_type = ? ORDER BY seq').all(eventType) as Array<{
    payload: string;
  }>;
  return rows.map((row) => ({ payload: JSON.parse(row.payload) as Record<string, unknown> }));
}
