import { DEFAULT_CONFIG_PATH } from './config/schema.js';
import { boot } from './lib/boot.js';
import { flushEngineBootLog, registerEngineBootSteps } from './engine-host/boot-steps.js';
import { onSigterm } from './engine-host/snapshots.js';
import { registerRestaurantBootSteps } from './sync/boot-steps.js';
import { registerPrintBootSteps } from './print/boot.js';

const monoNow = (): number => Number(process.hrtime.bigint() / 1_000_000n);

registerEngineBootSteps(monoNow);
registerRestaurantBootSteps();
// 03c §3.7 (G-7): boot step 5 resumes the print queue (a no-op until c16).
registerPrintBootSteps();

async function start(): Promise<void> {
  const handle = await boot({
    configPath: process.env.POS_HUB_CONFIG ?? DEFAULT_CONFIG_PATH,
    wallNow: () => Date.now(),
    monoNow,
    listen: true,
  });
  // 03a §3.12, F §5.8: systemd's stop is a SIGTERM; one synchronous snapshot, then the hub stops.
  process.once('SIGTERM', () => {
    void onSigterm(handle);
  });
}

start().catch((error: unknown) => {
  flushEngineBootLog();
  const message = error instanceof Error ? error.message : 'boot failed';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
