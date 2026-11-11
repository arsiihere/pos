import { registerBootStep, type BootContext } from '../lib/boot.js';
import type { HubDeps } from '../server.js';
import { createPrintStatus } from './status.js';
import { createPrintWorker } from './worker.js';

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

/**
 * §3.7, H-11: started after listen next to the tick loop; the returned stop joins `beat.stop`. The status part (c15)
 * plugs into the worker's hooks: status reads, suspects, printer_problem, skip alerts.
 */
export function startPrintWorker(deps: HubDeps, log: PrintWorkerLog): () => void {
  const branch_id = deps.config.provisioned?.branch_id;
  if (branch_id === undefined) return () => undefined;
  const status = createPrintStatus({ db: deps.db, writer: deps.writer, clock: deps.clock, branch_id, log });
  const worker = createPrintWorker({ db: deps.db, state: deps.state, clock: deps.clock, hooks: status.hooks, log });
  worker.start();
  return () => {
    worker.stop();
    status.stop();
  };
}
