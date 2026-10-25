import { DEFAULT_CONFIG_PATH } from './config/schema.js';
import { boot } from './lib/boot.js';
import { registerRestaurantBootSteps } from './sync/boot-steps.js';

registerRestaurantBootSteps();

boot({
  configPath: process.env.POS_HUB_CONFIG ?? DEFAULT_CONFIG_PATH,
  wallNow: () => Date.now(),
  monoNow: () => Number(process.hrtime.bigint() / 1_000_000n),
  listen: true,
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'boot failed';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
