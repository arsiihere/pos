import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate';
import { fixedClock, T } from '../../src/lib/clock';
import { freshDb } from '../helpers/db';

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

describe('event store schema', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[00 §10 #62] events UPDATE and DELETE raise', async () => {
    const fx = await open();
    fx.db
      .prepare(
        `INSERT INTO events (
          event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
          schema_version, payload, occurred_at, recorded_at, device_id, seq
        ) VALUES (?, ?, ?, 'hub', ?, 'HubProvisioned', 1, '{}', ?, ?, 'device-1', 1)`,
      )
      .run('e1', 'tenant-1', 'branch-1', 'branch-1', T, T);
    expect(() => fx.db.prepare("UPDATE events SET payload = ? WHERE event_id = 'e1'").run('{"x":1}')).toThrow(
      /events are immutable/,
    );
    expect(() => fx.db.prepare("DELETE FROM events WHERE event_id = 'e1'").run()).toThrow(/events are immutable/);
    expect(fx.db.prepare('SELECT payload FROM events WHERE event_id = ?').pluck().get('e1')).toBe('{}');
  });

  it('[00 §5.1] processed_commands requires device_id, command_type, payload_hash', async () => {
    const fx = await open();
    expect(() =>
      insertCommand(fx.db, {
        command_id: 'c1',
        branch_id: 'branch-1',
        command_type: 'SubmitOrder',
        payload_hash: 'aa',
        response_json: '{}',
        recorded_at: T,
      }),
    ).toThrow(/device_id/);
    expect(() =>
      insertCommand(fx.db, {
        command_id: 'c2',
        branch_id: 'branch-1',
        device_id: 'device-1',
        payload_hash: 'aa',
        response_json: '{}',
        recorded_at: T,
      }),
    ).toThrow(/command_type/);
    expect(() =>
      insertCommand(fx.db, {
        command_id: 'c3',
        branch_id: 'branch-1',
        device_id: 'device-1',
        command_type: 'SubmitOrder',
        response_json: '{}',
        recorded_at: T,
      }),
    ).toThrow(/payload_hash/);
    insertCommand(fx.db, {
      command_id: 'c4',
      branch_id: 'branch-1',
      device_id: 'device-1',
      session_id: null,
      command_type: 'SubmitOrder',
      payload_hash: 'aa',
      response_json: '{}',
      recorded_at: T,
    });
    expect(
      fx.db.prepare('SELECT device_id, command_type, payload_hash, session_id FROM processed_commands WHERE command_id = ?').get('c4'),
    ).toEqual({
      device_id: 'device-1',
      command_type: 'SubmitOrder',
      payload_hash: 'aa',
      session_id: null,
    });
  });

  it('[F §4.1] (branch_id, seq) is unique', async () => {
    const fx = await open();
    const insert = fx.db.prepare(
      `INSERT INTO events (
        event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
        schema_version, payload, occurred_at, recorded_at, device_id, seq
      ) VALUES (?, ?, ?, 'hub', ?, 'HubProvisioned', 1, '{}', ?, ?, 'device-1', ?)`,
    );
    insert.run('e1', 'tenant-1', 'branch-1', 'branch-1', T, T, 1);
    expect(() => insert.run('e2', 'tenant-1', 'branch-1', 'branch-1', T, T, 1)).toThrow(/UNIQUE/);
    insert.run('e3', 'tenant-1', 'branch-2', 'branch-2', T, T, 1);
    expect(fx.db.prepare('SELECT COUNT(*) FROM events').pluck().get()).toBe(2);
  });

  async function open() {
    const fx = freshDb();
    cleanups.push(fx.cleanup);
    await runMigrations(fx.db, { dir: migrations, clock: fixedClock(T) });
    return fx;
  }
});

function insertCommand(
  db: ReturnType<typeof freshDb>['db'],
  row: Record<string, string | number | null>,
): void {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO processed_commands (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(
    ...cols.map((col) => row[col]),
  );
}
