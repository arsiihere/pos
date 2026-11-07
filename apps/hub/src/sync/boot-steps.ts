import { registerBootStep } from '../lib/boot.js';
import { loadBranchConfig } from '../projections/branch-config.js';
import { branchConfig, swapBranchConfig } from './branch-config-holder.js';
import { configPoller } from './config-poller.js';

let registered = false;

// S15: called once by main.ts before boot(). ⚠️ 03a A-15: step 3 is 03a's replay (engine-host/boot-steps.ts).
export function registerRestaurantBootSteps(): void {
  if (registered) return;
  registered = true;
  // S15: after step 4's catch-up, so a projection that was behind the log is current first (S5).
  registerBootStep('5', (ctx) => {
    const branchId = ctx.config.provisioned?.branch_id;
    if (branchId === undefined) return;
    const loaded = loadBranchConfig(ctx.db, branchId);
    swapBranchConfig(loaded.state === 'APPLIED' ? loaded.entry : null);
  });
  // §7.2: the 60 s poll timer, stopped when the app closes.
  registerBootStep('6', (ctx) => {
    const app = ctx.app;
    if (app === undefined) return;
    const poller = configPoller(app);
    poller.start();
    // AD-19, S28 b: step 5 left no usable config, so poll once now instead of at the first tick.
    if (branchConfig() === null) void poller.pollOnce();
    app.addHook('onClose', async () => {
      poller.stop();
    });
  });
}
