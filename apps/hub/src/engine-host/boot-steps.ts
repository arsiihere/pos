import { getTickIntents, initialEngineState, type Diagnostic, type EngineState } from '@pos/engine';
import { registerTick } from '../alerts/tick.js';
import { registerBootStep, type BootContext } from '../lib/boot.js';
import { setStockVersion } from '../sync/stock-version.js';
import { droppedLineOf, firesAlertsTick } from './fires-alerts-tick.js';
import { configStaleFor, firesTick } from './fires-tick.js';
import { hostFlags, resetHostFlags } from './host-flags.js';
import { logDiagnostics } from './reducer.js';
import { loadEngineBase, readStockVersion, replayEngine, type LoadedBase } from './replay.js';

export { readStockVersion, replayEngine } from './replay.js';

type LogLine = { level: 'info' | 'warn'; obj: Record<string, unknown>; msg: string };

// Steps 2 and 3 run before the server, and its logger, exist (ctx.app is set at step 5). Their lines wait here for step 6;
// a failed boot writes them to stderr from main.ts (flushEngineBootLog), beside its failure line.
interface BootRun {
  base: LoadedBase;
  fromSeq: number;
  lines: LogLine[];
  // AD-8 (task 22a review I1): the replayed invalid_event diagnostics, classified at step 6 against the replayed state.
  invalid: Diagnostic[];
}
const runs = new WeakMap<BootContext, BootRun>();
// The newest boot's unflushed lines, for main.ts's failure path (a step after 3 can fail before step 6 flushes them).
let pending: LogLine[] = [];

// §7.2's `ms`: steps 2 and 3 run before the clock exists (step 3a), so main.ts hands in its monotonic source.
let monoNow: () => number = () => 0;

// main.ts's .catch: the step 2–3 lines a failed boot did not flush (each line at most once).
export function flushEngineBootLog(write: (text: string) => void = (text) => process.stderr.write(text)): void {
  for (const line of pending.splice(0)) write(`${JSON.stringify({ level: line.level, ...line.obj, msg: line.msg })}\n`);
}

// §3.12 step 2: 2 statements. A row this build cannot read is skipped with one log line (Review Focus 5).
export function engineStep2(ctx: BootContext): void {
  const branchId = ctx.config.provisioned?.branch_id;
  if (branchId === undefined) return;
  const start = monoNow();
  resetHostFlags();
  const lines: LogLine[] = [];
  const base = loadEngineBase(ctx.db, branchId, (skipped) => {
    lines.push({ level: 'warn', obj: skipped, msg: 'engine boot: unreadable row skipped' });
  });
  hostFlags.snapshot_loaded = base.snapshot_seq !== null;
  lines.push({ level: 'info', obj: { step: '2', snapshot_seq: base.snapshot_seq, checkpoint_seq: base.checkpoint_seq, events_replayed: 0, ms: monoNow() - start }, msg: 'engine boot' });
  pending = lines;
  runs.set(ctx, { base, fromSeq: base.snapshot_seq ?? base.checkpoint_seq ?? 0, lines, invalid: [] });
}

// §3.12 step 3: 4 + 2 statements. Replaces 01a's fold (A-15). A replayed diagnostic is logged again, replay: true (§7.2).
export function engineStep3(ctx: BootContext): void {
  const branchId = ctx.config.provisioned?.branch_id;
  const run = runs.get(ctx);
  if (branchId === undefined || run === undefined) return;
  const start = monoNow();
  const log = {
    warn(obj: Record<string, unknown>, msg: string) {
      run.lines.push({ level: 'warn', obj, msg });
    },
  };
  const { state, replayed } = replayEngine(ctx.db, branchId, run.fromSeq, run.base.state ?? initialEngineState(), (d) => {
    logDiagnostics([d], log, true);
    if (d.kind === 'invalid_event') run.invalid.push(d);
  });
  ctx.initialState = state;
  setStockVersion(readStockVersion(ctx.db, branchId));
  run.lines.push({ level: 'info', obj: { step: '3', snapshot_seq: run.base.snapshot_seq, checkpoint_seq: run.base.checkpoint_seq, events_replayed: replayed, ms: monoNow() - start }, msg: 'engine boot' });
}

// §3.6.2, §3.12 step 6: 0 statements. The dry count goes to step 8 (H-1); boot writes nothing, and the first tick fires
// these lines as ordinary fires.
export function engineStep6(ctx: BootContext): void {
  const run = runs.get(ctx);
  const app = ctx.app;
  if (run !== undefined && app !== undefined) {
    for (const line of run.lines.splice(0)) app.log[line.level](line.obj, line.msg);
  }
  const state = ctx.initialState as EngineState | undefined;
  const clock = ctx.clock;
  if (state === undefined || clock === undefined) return;
  ctx.missedFires = getTickIntents(state, clock.branchNow()).reduce(
    (count, draft) => (draft.event_type === 'FireDispatched' ? count + draft.payload.order_item_ids.length : count),
    0,
  );
  const closedAt = state.business_day?.closed_at ?? null;
  hostFlags.day_closed = closedAt !== null;
  // proposed (implementer): a closed day with no readable checkpoint counts as "older than the close", so that day still
  // gets one; §3.12 states only the taken_at < closed_at case.
  const taken = run?.base.checkpoint_taken_at ?? null;
  hostFlags.checkpoint_pending = closedAt !== null && (taken === null || taken < closedAt);
  hostFlags.reconcile = true;
  // AD-8 (task 22a review I1): a drop is never silent across a restart. The replayed drops are queued for the reconcile
  // pass (after step 5's bindFiresAlertsTick reset; 0 statements); an alert still open dedupes. proposed (implementer):
  // "the line is gone" is read on the replayed state (the fold's own result is not kept per event).
  if (run !== undefined) {
    for (const d of run.invalid) {
      const fact = droppedLineOf(d, (id) => state.lines[id] !== undefined);
      if (fact !== null) hostFlags.dropped_lines.push(fact);
    }
    run.invalid = [];
  }
  // §3.11 catch-up: the first fires pass appends E(branchConfig()) when it differs from the replayed config (0 statements).
  hostFlags.configStale = configStaleFor(state);
}

let registered = false;

// §6.3: called once by main.ts before boot(), in place of 01a's step 3 (A-15).
export function registerEngineBootSteps(mono?: () => number): void {
  if (mono !== undefined) monoNow = mono;
  if (registered) return;
  registered = true;
  registerBootStep('2', engineStep2);
  registerBootStep('3', engineStep3);
  registerBootStep('6', engineStep6);
  // §6.2, §3.6: the fires tick runs right after 01d's own `alerts` tick (registered at that module's load). Here and
  // not in registerEngineHost: the tick list is process-wide and a name registers once, while every server build calls
  // registerEngineHost (proposed (implementer)).
  registerTick(firesTick);
  // §6.2a: fires_alerts right after fires.
  registerTick(firesAlertsTick);
}
