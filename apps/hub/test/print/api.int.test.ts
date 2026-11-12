import type { Doc } from '@pos/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { printDocument, renderText } from '../../src/print/contracts';
import { createPrintWorker, type PrinterTransport } from '../../src/print/worker';
import type { SendResult } from '../../src/print/transport/lan';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { append as kdsAppend, openDay } from '../kds/fixtures';
import { fakeClock } from './fixtures';

// 03c §3.9, §4.2 (task c18): printDocument for 05 — a `document` job in the caller's transaction, 2 statements;
// unknown / archived printer → 404 PRINTER_NOT_FOUND. Called through the contract export (providePrint, lane C4).

let hub: TestHub;
beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  openDay(hub);
});
afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

const branch = (): string => hub.deps.config.provisioned!.branch_id;
function printer(printer_id: string, archived = false): void {
  kdsAppend(
    hub,
    [{ stream_type: 'hub', stream_id: branch(), event_type: 'PrinterSaved', payload: { printer_id, name: printer_id, connection: 'lan', address: '192.168.1.60:9100', paper_width_mm: 80, archived } }],
    { actor: null },
  );
}
const DOC: Doc = { blocks: [{ text: 'BILL  T4', bold: true, align: 'center' }, { rule: true }, { text: 'Total 1,250' }, { cut: true }, { drawer: true }] };
const rows = () =>
  hub.deps.db.prepare('SELECT job_id, kind, printer_id, station_id, ticket_id, order_id, payload, created_at FROM print_jobs').all() as Array<Record<string, unknown>>;

describe('[03c §3.9] printDocument (c18)', () => {
  it('[03c #53] a document job in the caller\'s transaction: 2 statements; committed with it', () => {
    printer('PR1');
    const counter = statementCounter(hub.deps.db);
    const { result } = hub.deps.writer.run((tx) => {
      counter.reset();
      const r = printDocument(tx, 'PR1', DOC, { kind_label: 'Bill' });
      expect(counter.count).toBe(2);
      return r;
    });
    expect(rows()).toEqual([
      {
        job_id: result.job_id,
        kind: 'document',
        printer_id: 'PR1',
        station_id: null,
        ticket_id: null,
        order_id: null,
        payload: JSON.stringify({ doc: DOC, kind_label: 'Bill' }),
        created_at: hub.clock.branchNow(),
      },
    ]);
  });

  it('[03c #53] rolled back with the caller\'s transaction: no job', () => {
    printer('PR1');
    expect(() =>
      hub.deps.writer.run((tx) => {
        printDocument(tx, 'PR1', DOC);
        throw new Error('bill close failed');
      }),
    ).toThrow('bill close failed');
    expect(rows()).toEqual([]);
  });

  it('[03c §3.9, §9] unknown or archived printer → 404 PRINTER_NOT_FOUND { printer_id }; nothing queued', () => {
    printer('PR1', true);
    for (const id of ['PR1', 'NOPE']) {
      expect(() => hub.deps.writer.run((tx) => printDocument(tx, id, DOC))).toThrow(expect.objectContaining({ code: 'PRINTER_NOT_FOUND', details: { printer_id: id } }));
    }
    expect(rows()).toEqual([]);
  });

  it('[03c §3.9] the worker prints the document on its printer; drawer kick = { drawer: true }; preview = renderText', async () => {
    printer('PR1');
    const { result } = hub.deps.writer.run((tx) => printDocument(tx, 'PR1', DOC));
    const sends: Buffer[] = [];
    const t: PrinterTransport = {
      send: (bytes) => {
        sends.push(Buffer.from(bytes));
        return Promise.resolve<SendResult>({ ok: true });
      },
      close: () => undefined,
    };
    const w = createPrintWorker({ db: hub.deps.db, state: hub.deps.state, clock: hub.clock, timers: fakeClock(), transportFor: () => t });
    w.pass();
    await new Promise((resolve) => setImmediate(resolve));
    w.stop();
    expect(sends).toHaveLength(1);
    expect(sends[0]!.toString('latin1')).toContain('Total 1,250');
    expect(sends[0]!.includes(Buffer.from([0x1b, 0x70, 0x00]))).toBe(true); // ESC p 0: drawer kick
    expect(hub.deps.db.prepare('SELECT acked_at FROM print_jobs WHERE job_id = ?').pluck().get(result.job_id)).not.toBeNull();
    expect(renderText(DOC, 48)).toContain('Total 1,250');
  });
});
