import { DEFAULT_CONFIG_PATH } from './config/schema.js';
import { boot } from './lib/boot.js';
import { flushEngineBootLog, registerEngineBootSteps } from './engine-host/boot-steps.js';
import { registerRestaurantBootSteps } from './sync/boot-steps.js';

const monoNow = (): number => Number(process.hrtime.bigint() / 1_000_000n);

registerEngineBootSteps(monoNow);
registerRestaurantBootSteps();

boot({
  configPath: process.env.POS_HUB_CONFIG ?? DEFAULT_CONFIG_PATH,
  wallNow: () => Date.now(),
  monoNow,
  listen: true,
}).catch((error: unknown) => {
  flushEngineBootLog();
  const message = error instanceof Error ? error.message : 'boot failed';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
