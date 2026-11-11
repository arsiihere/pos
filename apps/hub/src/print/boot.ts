import { registerBootStep, type BootContext } from '../lib/boot.js';
import type { HubDeps } from '../server.js';

// 03c §3.7 (G-7, phase 0 P0.11): the print boot and worker hooks. No-ops until task c16 fills them (this file is
// c16's); main.ts and lib/boot.ts call them and are not edited again.

let registered = false;

/** Called once by main.ts after registerRestaurantBootSteps(): boot step 5 resumes the print queue. */
export function registerPrintBootSteps(): void {
  if (registered) return;
  registered = true;
  registerBootStep('5', (ctx) => {
    resumePrintQueue(ctx);
  });
}

/** §3.7, F-1 step 5 (c16): sent-not-acked jobs → is_reprint = 1, sent_at = NULL, re-sent in order. */
export function resumePrintQueue(ctx: BootContext): void {
  void ctx;
}

export interface PrintWorkerLog {
  error(obj: Record<string, unknown>, msg?: string): void;
}

/** §3.7, H-11 (c16): started after listen next to the tick loop; the returned stop joins `beat.stop`. */
export function startPrintWorker(deps: HubDeps, log: PrintWorkerLog): () => void {
  void deps;
  void log;
  return () => undefined;
}
