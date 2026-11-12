// stub (W0.6); owned by lane Q, task 25b
import type { HubClock } from '../../../../app/hub-clock';
import type { Device, StaffApi } from '../../api';
import type { LiveBus } from '../../shell/live';
import type { Enqueue, EnqueueMeta, EnqueueResult, QueueableCommand } from '../../tables/contracts';

// 02b §3.12, 02a §8 Offline (Q-3): the one queue. Until 25b every queueable command answers `needs_hub` (02a ships
// Ask for bill / Clean as "Needs the hub" offline, like Call waiter) and nothing is ever waiting.
export interface EnqueueDeps {
  api: StaffApi;
  device: Device;
  clock: () => HubClock;
  live: LiveBus;
}

export const createEnqueue: (deps: EnqueueDeps) => Enqueue = () => {
  const send: <R>(type: QueueableCommand, payload: unknown, meta: EnqueueMeta) => Promise<EnqueueResult<R>> = async () => ({ status: 'needs_hub' });
  return Object.assign(send, { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} });
};
