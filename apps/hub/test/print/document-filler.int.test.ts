import type { Doc } from '@pos/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SendResult } from '../../src/print/transport/lan';
import { createPrintWorker, registerDocumentFiller, resetDocumentFillers, type PrinterTransport } from '../../src/print/worker';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { append as kdsAppend, openDay } from '../kds/fixtures';
import { fakeClock, type FakeClock } from './fixtures';

// 03c v1.0.14 §3.6, §3.7 (⚠️ Changed by 05 (row P-5)); 05 v1.0.6 §4.5 P-5, B19: `registerDocumentFiller(block_kind, fn)`.
// A Doc block `{ fill: block_kind, ref, last4 }` is replaced at send by `fn(db, ref)`; the filled text is rendered and
// sent, never written back to `print_jobs.payload` (which keeps the block). Unknown kind / missing row → `last4`;
// a filler error is logged with `job_id` only. The full "ID" below is an obviously fake value, used only inside the
// in-memory test filler.

const FAKE_FULL = 'FAKE-ID-0000-TEST';
const LAST4 = '****TEST';

let hub: TestHub;
let clock: FakeClock;
const stops: Array<() => void> = [];
const logs: Array<{ obj: Record<string, unknown>; msg: string | undefined }> = [];

beforeEach(async () => {
  logs.length = 0;
  hub = await createTestHub({ provisioned: true });
  openDay(hub);
  clock = fakeClock();
  kdsAppend(
    hub,
    [
      {
        stream_type: 'hub',
        stream_id: hub.deps.config.provisioned!.branch_id,
        event_type: 'PrinterSaved',
        payload: { printer_id: 'PR1', name: 'PR1', connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived: false },
      },
    ],
    { actor: null },
  );
});
afterEach(async () => {
  for (const s of stops.splice(0)) s();
  resetDocumentFillers();
  await hub.close();
});

const turns = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function recorder(): PrinterTransport & { sends: string[] } {
  const t = {
    sends: [] as string[],
    send(bytes: Uint8Array): Promise<SendResult> {
      t.sends.push(Buffer.from(bytes).toString('latin1'));
      return Promise.resolve({ ok: true });
    },
    close: () => undefined,
  };
  return t;
}

const RECEIPT: Doc = {
  blocks: [{ text: 'RECEIPT 42' }, { text: 'Buyer ID:' }, { fill: 'buyer_id', ref: 'INV1', last4: LAST4 }, { cut: true }],
};

function queue(doc: Doc = RECEIPT): string {
  const payload = JSON.stringify({ doc, kind_label: 'receipt' });
  hub.deps.db
    .prepare(`INSERT INTO print_jobs (job_id, kind, printer_id, station_id, payload, created_at) VALUES ('DOC', 'document', 'PR1', NULL, ?, 1)`)
    .run(payload);
  return payload;
}

async function send(): Promise<string> {
  const t = recorder();
  const log = {
    info: (obj: Record<string, unknown>, msg?: string) => logs.push({ obj, msg }),
    error: (obj: Record<string, unknown>, msg?: string) => logs.push({ obj, msg }),
  };
  const w = createPrintWorker({ db: hub.deps.db, state: hub.deps.state, clock: hub.clock, timers: clock, transportFor: () => t, log });
  stops.push(() => w.stop());
  w.pass();
  await turns();
  expect(t.sends).toHaveLength(1);
  return t.sends[0]!;
}

const row = () =>
  hub.deps.db.prepare(`SELECT payload, acked_at, cancelled_at, last_error FROM print_jobs WHERE job_id = 'DOC'`).get() as {
    payload: string;
    acked_at: number | null;
    cancelled_at: number | null;
    last_error: string | null;
  };

describe('[05 row P-5] registerDocumentFiller — the fill block at send', () => {
  it('[05 row P-5] the filler fills at send; after send the stored payload still has the block, not the filled text', async () => {
    const asked: string[] = [];
    registerDocumentFiller('buyer_id', (db, ref) => {
      expect(db).toBe(hub.deps.db);
      asked.push(ref);
      return FAKE_FULL;
    });
    const stored = queue();
    const sent = await send();
    expect(asked).toEqual(['INV1']);
    expect(sent).toContain(FAKE_FULL);
    expect(sent).not.toContain(LAST4);
    expect(sent.indexOf('Buyer ID:')).toBeLessThan(sent.indexOf(FAKE_FULL));
    const after = row();
    expect(after.acked_at).not.toBeNull();
    expect(after.payload).toBe(stored);
    expect(after.payload).not.toContain(FAKE_FULL);
    expect(JSON.parse(after.payload).doc.blocks[2]).toEqual({ fill: 'buyer_id', ref: 'INV1', last4: LAST4 });
    expect(JSON.stringify(logs)).not.toContain(FAKE_FULL);
  });

  it('[05 row P-5] an unknown kind (no filler registered) prints last4', async () => {
    queue();
    const sent = await send();
    expect(sent).toContain(LAST4);
    expect(row().acked_at).not.toBeNull();
  });

  it('[05 row P-5] a filler for another kind is not asked; a missing row (filler returns null) prints last4', async () => {
    let other = 0;
    registerDocumentFiller('other_kind', () => {
      other += 1;
      return FAKE_FULL;
    });
    registerDocumentFiller('buyer_id', () => null);
    queue();
    const sent = await send();
    expect(other).toBe(0);
    expect(sent).toContain(LAST4);
    expect(sent).not.toContain(FAKE_FULL);
  });

  it('[05 row P-5] a filler that throws: last4 printed, the job still sent; the error log has job_id only, no text', async () => {
    registerDocumentFiller('buyer_id', () => {
      throw new Error(`lookup failed for ${FAKE_FULL}`);
    });
    queue();
    const sent = await send();
    expect(sent).toContain(LAST4);
    expect(row()).toMatchObject({ cancelled_at: null, last_error: null });
    expect(row().acked_at).not.toBeNull();
    const failed = logs.filter((l) => l.msg === 'print.fill_failed');
    expect(failed).toEqual([{ obj: { job_id: 'DOC' }, msg: 'print.fill_failed' }]);
    expect(JSON.stringify(logs)).not.toContain(FAKE_FULL);
    expect(JSON.stringify(logs)).not.toContain('lookup failed');
  });

  it('[05 row P-5] a re-sent job (REPRINT) fills again at send; the payload is still untouched', async () => {
    registerDocumentFiller('buyer_id', () => FAKE_FULL);
    const stored = queue();
    hub.deps.db.prepare(`UPDATE print_jobs SET is_reprint = 1 WHERE job_id = 'DOC'`).run();
    const sent = await send();
    expect(sent).toContain('REPRINT');
    expect(sent).toContain(FAKE_FULL);
    expect(row().payload).toBe(stored);
  });

  it('[05 row P-5] a filler returning an empty string prints last4, as null does', async () => {
    registerDocumentFiller('buyer_id', () => '');
    queue();
    const sent = await send();
    expect(sent).toContain(LAST4);
  });

  it('[05 row P-5] a send that fails after filling (wrote: true): no print_jobs / printer_runtime column and no log line holds the full ID; the retry fills again', async () => {
    let calls = 0;
    registerDocumentFiller('buyer_id', () => {
      calls += 1;
      return FAKE_FULL;
    });
    const stored = queue();
    const sends: string[] = [];
    const answers: SendResult[] = [{ ok: false, error: 'write_failed', detail: 'EPIPE', wrote: true }, { ok: true }];
    const t: PrinterTransport = {
      send(bytes) {
        sends.push(Buffer.from(bytes).toString('latin1'));
        return Promise.resolve(answers.shift()!);
      },
      close: () => undefined,
    };
    const log = {
      info: (obj: Record<string, unknown>, msg?: string) => logs.push({ obj, msg }),
      error: (obj: Record<string, unknown>, msg?: string) => logs.push({ obj, msg }),
    };
    const w = createPrintWorker({ db: hub.deps.db, state: hub.deps.state, clock: hub.clock, timers: clock, transportFor: () => t, log });
    stops.push(() => w.stop());
    w.pass();
    await turns();
    const stores = (): string =>
      JSON.stringify([
        hub.deps.db.prepare('SELECT * FROM print_jobs').all(),
        hub.deps.db.prepare('SELECT * FROM printer_runtime').all(),
        logs,
      ]);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toContain(FAKE_FULL);
    expect(hub.deps.db.prepare(`SELECT attempts, last_error, is_reprint FROM print_jobs WHERE job_id = 'DOC'`).get()).toEqual({
      attempts: 1,
      last_error: 'write_failed:EPIPE',
      is_reprint: 1,
    });
    expect(stores()).not.toContain(FAKE_FULL);
    clock.advance(2_000); // RETRY_DELAYS_MS[0]
    await turns();
    expect(sends).toHaveLength(2);
    expect(calls).toBe(2);
    expect(sends[1]).toContain('REPRINT');
    expect(sends[1]).toContain(FAKE_FULL);
    expect(row()).toMatchObject({ payload: stored, cancelled_at: null });
    expect(row().acked_at).not.toBeNull();
    expect(stores()).not.toContain(FAKE_FULL);
  });

  it('[05 row P-5] resetDocumentFillers → back to no filler (last4)', async () => {
    registerDocumentFiller('buyer_id', () => FAKE_FULL);
    resetDocumentFillers();
    queue();
    expect(await send()).toContain(LAST4);
  });
});
