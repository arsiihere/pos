// owned by lane Q, task 25b (was the W0.6 stub)
import type { HubClock } from '../../../../app/hub-clock';
import type { Device, StaffApi } from '../../api';
import type { LiveBus } from '../../shell/live';
import type { Enqueue, EnqueueMeta, EnqueueResult, QueueableCommand } from '../../tables/contracts';
import type { QueueStore } from '../contracts';
import { createIdbQueueStore } from './idb-store';
import { createBroadcastPresence, createCommandQueue, wipePosDeviceKeys, type CommandQueue, type Presence } from './queue';

// 02b v1.0.11 §3.12, §8 Queue; 02a §8 Offline (Q-3): the one queue behind the `Enqueue` interface 02a and 02b send
// queueable commands through (queue.ts has the rules). The shell builds it once (StaffApp); the queue log and the
// sign-in hooks (25c) reach the queue behind it with `queueOf(enqueue)`.
export interface EnqueueDeps {
  api: StaffApi;
  device: Device;
  clock: () => HubClock;
  live: LiveBus;
  /** default: IndexedDB `pos-queue` (Q-1) */
  store?: QueueStore;
  /** branch `queue_auto_send_max_ms` (shell config); default: the 01a default until the shell passes it */
  maxAgeMs?: () => number | null;
  /** default: wipe the pos-device keys (20a's path), keep pos-queue */
  onDeviceRevoked?: () => void;
  /** default: BroadcastChannel `pos-queue` (one tab sends its own entries) */
  presence?: (mine: () => string[]) => Presence;
}

const queues = new WeakMap<Enqueue, CommandQueue>();

/** The queue behind an Enqueue built by createEnqueue (the W0.6-style stub of a test has none). */
export function queueOf(enqueue: Enqueue): CommandQueue | null {
  return queues.get(enqueue) ?? null;
}

export const createEnqueue: (deps: EnqueueDeps) => Enqueue = (deps) => {
  const queue = createCommandQueue({
    api: deps.api,
    device: deps.device,
    clock: deps.clock,
    live: deps.live,
    store: deps.store ?? createIdbQueueStore(),
    ...(deps.maxAgeMs === undefined ? {} : { maxAgeMs: deps.maxAgeMs }),
    onDeviceRevoked: deps.onDeviceRevoked ?? (() => void wipePosDeviceKeys()),
    presence: deps.presence ?? ((mine) => createBroadcastPresence(mine)),
  });
  const send = <R>(type: QueueableCommand, payload: unknown, meta: EnqueueMeta): Promise<EnqueueResult<R>> => queue.enqueue<R>(type, payload, meta);
  const enqueue: Enqueue = Object.assign(send, {
    pendingFor: (table_id: string) => queue.pendingFor(table_id),
    pendingCount: () => queue.pendingCount(),
    subscribe: (listener: () => void) => queue.subscribe(listener),
  });
  queues.set(enqueue, queue);
  return enqueue;
};
