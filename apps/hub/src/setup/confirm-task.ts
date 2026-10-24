/// <reference types="node" />
import type { HubConfig } from '../config/schema.js';
import { writeHubConfigAtomic } from '../config/write.js';
import { HUB_VERSION } from '../lib/health.js';
import type { Clock } from '../lib/clock.js';
import type { CloudClient } from './cloud-client.js';

const RETRY_MS = 60_000;

export function startConfirmTask(o: {
  cloud: CloudClient;
  config: HubConfig;
  configPath: string;
  clock: Clock;
  log: { error: (obj: unknown, msg?: string) => void };
}): () => void {
  const key = o.config.provisioned?.branch_api_key;
  if (key === undefined || key.length === 0) return () => undefined;
  const apiKey: string = key;
  let stopped = false;
  let inFlight = false;
  const timer = setInterval(() => {
    void attempt();
  }, RETRY_MS);
  if (typeof timer.unref === 'function') timer.unref();

  async function attempt(): Promise<void> {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await o.cloud.confirmHub(apiKey, { hub_version: HUB_VERSION });
      if (stopped) return;
      const provisioned = o.config.provisioned;
      if (provisioned === undefined) return;
      const confirmedAt = o.clock.branchNow();
      const next: HubConfig = {
        ...o.config,
        provisioned: { ...provisioned, confirmed_at: confirmedAt },
      };
      writeHubConfigAtomic(o.configPath, next);
      o.config.provisioned = next.provisioned;
      stopped = true;
      clearInterval(timer);
    } catch (error) {
      o.log.error({ err: error }, 'hub confirm failed');
    } finally {
      inFlight = false;
    }
  }

  void attempt();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
