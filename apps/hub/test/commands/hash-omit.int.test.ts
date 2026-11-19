import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { activity } from '../../src/auth/session-store';
import { createCommandRegistry, defineCommand } from '../../src/commands/registry';
import { payloadHash } from '../../src/lib/hash';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 00 v1.12 §3.7, §4.2, §7.2 (⚠️ Changed by 05 (row H-4)); 05 v1.0.5 §4.5 row H-4, B19, B22; 05-plan §2B.4 P0.4b.
// `TestHashOmit` is the test-only `sessionKind: 'both'` command registered in `route.ts`, with
// `hashOmit: ['buyer.name', 'buyer.tax_id.value', 'note']` (`buyer.tax_id.type` stays in the hash). Its
// `tax_id.value` length check and its object-level `buyer.tax_id` pattern check (as a jurisdiction pattern on
// CloseSplit would be) have careless custom messages that echo the value, and `TestPinChecked`'s `pin` length
// check echoes the PIN: the error mapper is what keeps them out of `VALIDATION_FAILED.issues`.
// The values below are synthetic sentinels (no real buyer data): each one must never reach a hash input,
// `processed_commands`, an event, a response or a log line.
const NAME_A = 'SENTINEL-NAME-A';
const NAME_B = 'SENTINEL-NAME-B';
const VALUE_A = '1111111111111';
const VALUE_B = '2222222222222';
const VALUE_NTN = '3333333';
const BAD_VALUE = 'SENTINEL-BAD-VALUE'; // longer than the value's max(16): an issue at `buyer.tax_id.value`
const BAD_PATTERN = 'SENTINEL-PATN'; // fits max(16), fails the CNIC pattern: an issue at `buyer.tax_id`
const BAD_PIN = 'SENTINEL-PIN-TOO-LONG'; // longer than TestPinChecked's pin max(12)
const NOTE_A = 'SENTINEL-NOTE-A';
const NOTE_B = 'SENTINEL-NOTE-B';
const SENTINELS = [NAME_A, NAME_B, VALUE_A, VALUE_B, VALUE_NTN, BAD_VALUE, BAD_PATTERN, BAD_PIN, NOTE_A, NOTE_B];
const OMIT = ['buyer.name', 'buyer.tax_id.value', 'note'];

type Route = 'device' | 'admin';

describe('hashOmit (00 v1.12 row H-4)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    activity.drain();
    activity.drainDevices();
  });

  for (const route of ['device', 'admin'] as const) {
    it(`[05 row H-4] on ${route === 'device' ? '/commands' : '/admin/commands'}: a retransmit that differs only in an omitted field is the same command`, async () => {
      const hub = await hubWithDirectory();
      const ctx = sessionFor(hub, route);
      const first = await post(hub, ctx, 'omit-1', payloadOf(NAME_A, 'CNIC', VALUE_A, NOTE_A));
      expect(first.statusCode).toBe(200);
      const before = counts(hub);

      const again = await post(hub, ctx, 'omit-1', payloadOf(NAME_B, 'CNIC', VALUE_B, NOTE_B));
      expect(again.statusCode).toBe(200);
      expect(again.headers['idempotent-replay']).toBe('true');
      expect(again.json()).toEqual(first.json());
      expect(counts(hub)).toEqual(before);

      // The kept sibling `buyer.tax_id.type` is still part of the identity: a different command, never a second run.
      const changed = await post(hub, ctx, 'omit-1', payloadOf(NAME_A, 'NTN', VALUE_NTN, NOTE_A));
      expect(changed.statusCode).toBe(400);
      expect(changed.json().error.details.issues).toEqual([{ path: 'command_id', message: 'command_id already used' }]);
      expect(counts(hub)).toEqual(before);

      // The stored hash is over the payload without the omitted fields; nothing omitted is stored.
      const row = hub.deps.db.prepare("SELECT payload_hash, response_json FROM processed_commands WHERE command_id = 'omit-1'").get() as {
        payload_hash: string;
        response_json: string;
      };
      expect(row.payload_hash).toBe(payloadHash({ split_id: 'split-1', buyer: { tax_id: { type: 'CNIC' } } }));
      expect(row.payload_hash).toBe(payloadHash(payloadOf(NAME_A, 'CNIC', VALUE_A, NOTE_A), OMIT));
      expectNoSentinel(hub, [row.response_json, eventsText(hub), first.body, again.body, changed.body]);
    });

    it(`[05 row H-4] on ${route === 'device' ? '/commands' : '/admin/commands'}: issue paths name tax_id.value, never the value`, async () => {
      const hub = await hubWithDirectory();
      const ctx = sessionFor(hub, route);
      const response = await post(hub, ctx, 'omit-bad', payloadOf(NAME_A, 'CNIC', BAD_VALUE, NOTE_A));
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
      const issues = response.json().error.details.issues as Array<Record<string, unknown>>;
      // Zod 4 also runs the object-level pattern refine above it: both issues name a path, and carry only a code.
      expect(issues.map((issue) => issue.path).sort()).toEqual(['buyer.tax_id', 'buyer.tax_id.value']);
      expect(issues.find((issue) => issue.path === 'buyer.tax_id.value')?.message).toBe('too_big');
      for (const issue of issues) {
        expect(['too_big', 'custom']).toContain(issue.message);
        expect(Object.keys(issue).sort()).toEqual(['message', 'path']);
        expect(issue).not.toHaveProperty('input');
        expect(issue).not.toHaveProperty('received');
      }
      expectNoSentinel(hub, [response.body]);
      expect(counts(hub)).toEqual({ events: 0, commands: 0 });
    });

    it(`[05 row H-4] on ${route === 'device' ? '/commands' : '/admin/commands'}: an object-level refine above an omitted path names buyer.tax_id with its code, never the value`, async () => {
      const hub = await hubWithDirectory();
      const ctx = sessionFor(hub, route);
      const response = await post(hub, ctx, 'omit-pattern', payloadOf(NAME_A, 'CNIC', BAD_PATTERN, NOTE_A));
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
      expect(response.json().error.details.issues).toEqual([{ path: 'buyer.tax_id', message: 'custom' }]);
      expectNoSentinel(hub, [response.body, processedText(hub), eventsText(hub)]);
      expect(counts(hub)).toEqual({ events: 0, commands: 0 });
    });

    it(`[05 row H-4] on ${route === 'device' ? '/commands' : '/admin/commands'}: a retry differing only in note that lands between guard and writer replays (in-transaction re-check)`, async () => {
      const hub = await hubWithDirectory();
      const ctx = sessionFor(hub, route);
      let entered = 0;
      let inner: Awaited<ReturnType<typeof post>> | undefined;
      hub.deps.testHooks = {
        async betweenGuardAndWriter() {
          entered += 1;
          // The first request is past its fast-path check (no row yet); its retry commits in the gap.
          if (entered === 1) inner = await post(hub, ctx, 'omit-race', payloadOf(NAME_A, 'CNIC', VALUE_A, NOTE_B));
        },
      };
      const outer = await post(hub, ctx, 'omit-race', payloadOf(NAME_A, 'CNIC', VALUE_A, NOTE_A));
      expect(entered).toBe(2);
      expect(inner?.statusCode).toBe(200);
      expect(inner?.headers['idempotent-replay']).toBeUndefined();
      expect(outer.statusCode).toBe(200);
      expect(outer.headers['idempotent-replay']).toBe('true');
      expect(outer.json()).toEqual(inner?.json());
      expect(counts(hub)).toEqual({ events: 1, commands: 1 });
      expectNoSentinel(hub, [processedText(hub), eventsText(hub), outer.body]);
    });
  }

  it("[05 row H-4] the pinCheck field's VALIDATION_FAILED issue carries its code, never the PIN", async () => {
    const hub = await hubWithDirectory();
    const ctx = sessionFor(hub, 'device');
    const response = await post(hub, ctx, 'pin-bad', { staff_id: 'S_OWNER', pin: BAD_PIN }, 'test-pin-checked', 'TestPinChecked');
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    expect(response.json().error.details.issues).toEqual([{ path: 'pin', message: 'too_big' }]);
    expectNoSentinel(hub, [response.body, processedText(hub), eventsText(hub)]);
  });

  it('[05 row H-4] fail closed: when pinCheck throws on the raw payload, every issue carries only its code', async () => {
    const hub = await hubWithDirectory();
    const ctx = sessionFor(hub, 'device');
    const response = await post(hub, ctx, 'pin-throw', { staff_id: 'S_OWNER', pin: BAD_PIN, throw_pin: true }, 'test-pin-checked', 'TestPinChecked');
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    expect(response.json().error.details.issues).toEqual([{ path: 'pin', message: 'too_big' }]);
    expectNoSentinel(hub, [response.body, processedText(hub), eventsText(hub)]);
  });

  it('[05 row H-4] a non-omitted field keeps its Zod message', async () => {
    const hub = await hubWithDirectory();
    const ctx = sessionFor(hub, 'device');
    const response = await post(hub, ctx, 'omit-type', { ...payloadOf(NAME_A, 'CNIC', VALUE_A, NOTE_A), split_id: 7 });
    expect(response.statusCode).toBe(400);
    const issues = response.json().error.details.issues as Array<{ path: string; message: string }>;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe('split_id');
    expect(issues[0]!.message).toMatch(/expected string/);
  });

  it('[05 row H-4] a captured logger sees no request body on /commands/* or /admin/commands/*', async () => {
    const hub = await hubWithDirectory();
    for (const route of ['device', 'admin'] as const) {
      const ctx = sessionFor(hub, route);
      const id = `log-${route}`;
      expect((await post(hub, ctx, id, payloadOf(NAME_A, 'CNIC', VALUE_A, NOTE_A))).statusCode).toBe(200); // ok
      expect((await post(hub, ctx, id, payloadOf(NAME_B, 'CNIC', VALUE_B, NOTE_B))).statusCode).toBe(200); // replay
      expect((await post(hub, ctx, id, payloadOf(NAME_A, 'NTN', VALUE_NTN, NOTE_A))).statusCode).toBe(400); // conflict
      expect((await post(hub, ctx, `${id}-bad`, payloadOf(NAME_A, 'CNIC', BAD_VALUE, NOTE_A))).statusCode).toBe(400); // invalid
      // an unknown command name on the same route group carries the body too
      expect((await post(hub, ctx, `${id}-404`, payloadOf(NAME_A, 'CNIC', VALUE_A, NOTE_A), 'test-no-such')).statusCode).toBe(404);
    }
    const logs = hub.logs();
    // The logger did run for both route groups (the assertion below is not vacuous) ...
    expect(logs).toContain('/commands/test-hash-omit');
    expect(logs).toContain('/admin/commands/test-hash-omit');
    // ... and no line carries a body, a payload or any value from it.
    for (const sentinel of [...SENTINELS, 'split-1']) expect(logs).not.toContain(sentinel);
    for (const line of logs.split('\n').filter((l) => l.length > 0)) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      expect(JSON.stringify(entry)).not.toMatch(/"(body|payload)"\s*:/);
    }
  });

  it('[05 row H-4] the registry accepts only hashOmit paths that resolve to an object field of payloadSchema', () => {
    const schema = z.object({
      split_id: z.string(),
      buyer: z.object({ name: z.string(), tax_id: z.object({ type: z.string(), value: z.string() }).nullable() }).optional(),
      meta: z.object({ note: z.string() }).default({ note: '' }),
      list: z.array(z.object({ note: z.string() })),
      s: z.string(),
    });
    const register = (path: string) =>
      createCommandRegistry().register(
        defineCommand({
          commandType: 'TestOmitPath',
          payloadSchema: schema,
          sessionKind: 'device',
          permission: 'reprint-ticket',
          hashOmit: [path],
          handle: () => ({ events: [], result: null }),
        }),
      );
    // through optional, nullable and default; a whole object or array field is a field too
    for (const good of ['split_id', 'buyer', 'buyer.name', 'buyer.tax_id', 'buyer.tax_id.value', 'meta.note', 'list']) {
      expect(() => register(good)).not.toThrow();
    }
    // empty segments, typos, array steps, primitive steps, absent fields
    for (const bad of ['', 'buyer.', '.buyer', 'buyer..name', 'buyer.nmae', 'list.0.note', 'list.note', 's.length', 'missing']) {
      expect(() => register(bad)).toThrow(/hashOmit/);
    }
  });

  async function hubWithDirectory(): Promise<TestHub> {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    await seedDirectory(hub);
    return hub;
  }
});

interface RouteCtx {
  route: Route;
  device: { deviceId: string; token: string };
  session: { token: string };
}

function sessionFor(hub: TestHub, route: Route): RouteCtx {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: route === 'device' ? 'staff' : 'admin', staffId: 'S_OWNER', deviceId: device.deviceId });
  return { route, device, session };
}

function payloadOf(name: string, type: string, value: string, note: string): Record<string, unknown> {
  return { split_id: 'split-1', buyer: { name, tax_id: { type, value } }, note };
}

function expectNoSentinel(hub: TestHub, texts: string[]): void {
  for (const text of [...texts, hub.logs()]) {
    for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel);
  }
}

function processedText(hub: TestHub): string {
  return JSON.stringify(hub.deps.db.prepare('SELECT * FROM processed_commands').all());
}

function eventsText(hub: TestHub): string {
  return JSON.stringify(hub.deps.db.prepare('SELECT payload FROM events').pluck().all());
}

function counts(hub: TestHub): { events: number; commands: number } {
  return {
    events: hub.deps.db.prepare("SELECT COUNT(*) FROM events WHERE event_type = 'TestNooped'").pluck().get() as number,
    commands: hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands').pluck().get() as number,
  };
}

function post(
  hub: TestHub,
  ctx: RouteCtx,
  commandId: string,
  payload: Record<string, unknown>,
  name = 'test-hash-omit',
  commandType = 'TestHashOmit',
) {
  return hub.app.inject({
    method: 'POST',
    url: ctx.route === 'device' ? `/commands/${name}` : `/admin/commands/${name}`,
    headers: {
      authorization: `Bearer ${ctx.device.token}`,
      ...(ctx.route === 'device' ? { 'x-session-token': ctx.session.token } : { 'x-admin-session': ctx.session.token }),
    },
    payload: {
      command_id: commandId,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: commandType,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: 'S_OWNER',
      device_id: ctx.device.deviceId,
    },
  });
}
