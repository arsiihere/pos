import { registerBootStep, type BootContext } from '../lib/boot.js';
import type { HubDeps } from '../server.js';
import { printedLinesAcked } from '../ws/print-catch-up.js';
import { createPaperFallback } from './fallback.js';
import { createPrintStatus } from './status.js';
import { createPrintWorker, type PrintWorkerHooks } from './worker.js';

// 03c §3.7 (G-7, phase 0 P0.11; task c16): the print boot step and the worker start / stop. main.ts and lib/boot.ts
// call these and are not edited again.

let registered = false;

/** Called once by main.ts after registerRestaurantBootSteps(): boot step 5 resumes the print queue. */
export function registerPrintBootSteps(): void {
  if (registered) return;
  registered = true;
  registerBootStep('5', (ctx) => {
    resumePrintQueue(ctx);
  });
}

/**
 * §3.7, F §5.8 step 5: a job sent but not acked when the hub stopped may be half on paper → `is_reprint = 1`,
 * `sent_at = NULL`; the worker re-sends it in `created_at` order with the REPRINT header. 1 statement.
 */
export function resumePrintQueue(ctx: Pick<BootContext, 'db'>): number {
  return ctx.db
    .prepare('UPDATE print_jobs SET is_reprint = 1, sent_at = NULL WHERE sent_at IS NOT NULL AND acked_at IS NULL AND cancelled_at IS NULL')
    .run().changes;
}

export interface PrintWorkerLog {
  info?(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

/** Runs each part in turn; a part that throws is logged and never stops the next one or the worker. */
function guarded(log: PrintWorkerLog, hook: string, parts: ReadonlyArray<() => void>): void {
  for (const part of parts) {
    try {
      part();
    } catch (error) {
      try {
        log.error({ hook, err: (error as Error).message }, 'print.hook_failed');
      } catch {
        // a broken logger never stops printing
      }
    }
  }
}

/**
 * §3.7, H-11: started after listen next to the tick loop; the returned stop joins `beat.stop`. The worker's hooks
 * compose the status part (c15: status reads, suspects, printer_problem, skip alerts) with the paper fallback on
 * `pass` (c17, §3.4) and the printed_lines frame on `acked` (c21, §3.8); integrator ruling on #65 / #67.
 */
export function startPrintWorker(deps: HubDeps, log: PrintWorkerLog): () => void {
  const branch_id = deps.config.provisioned?.branch_id;
  if (branch_id === undefined) return () => undefined;
  const status = createPrintStatus({ db: deps.db, writer: deps.writer, clock: deps.clock, branch_id, log });
  const fallback = createPaperFallback({ db: deps.db, state: deps.state, log });
  const printed = printedLinesAcked(deps.db);
  const hooks: PrintWorkerHooks = {
    acked: (job, at) => guarded(log, 'acked', [() => status.hooks.acked(job, at), () => printed(job, at)]),
    failed: (job, result, at) => guarded(log, 'failed', [() => status.hooks.failed(job, result, at)]),
    pass: (now) => guarded(log, 'pass', [() => status.hooks.pass(now), () => fallback.pass(now)]),
  };
  const worker = createPrintWorker({ db: deps.db, state: deps.state, clock: deps.clock, hooks, log });
  worker.start();
  return () => {
    worker.stop();
    status.stop();
  };
}
