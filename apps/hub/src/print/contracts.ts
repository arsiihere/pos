import type { Doc } from '@pos/domain';
import type { WriterTx } from '../engine-host/writer.js';

// 03c §4.2 (phase 0 P0.11): the exports 05 codes against. Each throws "not built" until its task provides it with
// providePrint() from the lane's register file (print/lanes/<L>.ts). The boot, worker and retention hooks live in
// print/boot.ts and print/retention.ts and are no-ops until c16 / c22.

export interface PrintContracts {
  /** §3.9 (c18): a `document` job in the caller's transaction; 2 statements; unknown / archived → 404 PRINTER_NOT_FOUND. */
  printDocument(tx: WriterTx, printer_id: string, doc: Doc, meta?: { kind_label: string }): { job_id: string };
  /** §3.6 (c10): the text preview of a Doc; 0 statements. */
  renderText(doc: Doc, width_cols: 32 | 48): string;
}

const TASK: Record<keyof PrintContracts, string> = { printDocument: 'c18', renderText: 'c10' };

let built: Partial<PrintContracts> = {};

export function providePrint(part: Partial<PrintContracts>): void {
  built = { ...built, ...part };
}

function impl<K extends keyof PrintContracts>(name: K): PrintContracts[K] {
  const fn = built[name];
  if (fn === undefined) throw new Error(`03c ${name}: not built (task ${TASK[name]})`);
  return fn;
}

export function printDocument(tx: WriterTx, printer_id: string, doc: Doc, meta?: { kind_label: string }): { job_id: string } {
  return impl('printDocument')(tx, printer_id, doc, meta);
}

export function renderText(doc: Doc, width_cols: 32 | 48): string {
  return impl('renderText')(doc, width_cols);
}
