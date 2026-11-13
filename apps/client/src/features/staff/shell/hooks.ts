import { createContext, useContext } from 'react';
import type { HubClock } from '../../../app/hub-clock';
import type { Device, PageMeta, StaffApi } from '../api';
import type { OrdersApi } from '../orders/contracts';
import type { Enqueue, LocalFlags, TablesApi } from '../tables/contracts';
import type { ShellConfig } from './config';
import type { LiveBus } from './live';
import type { Permissions } from './permissions';
import type { ToastBus } from './toast';

// 02a §8, 02b §8 (W0.6, Q-3): what the staff shell hands every 02 screen. A lane reads it with `useShell()` and
// never builds its own api, socket, clock or queue.

export interface ShellPerson {
  staff_id: string;
  name: string;
}

export interface Shell {
  device: Device;
  meta: PageMeta;
  api: StaffApi;
  tables: TablesApi;
  orders: OrdersApi;
  live: LiveBus;
  config: ShellConfig;
  /** the signed-in person's effective permissions (full Resolution, §3.15) */
  permissions: Permissions;
  toasts: ToastBus;
  /** the one queue interface (stub answers needs_hub until 25b) */
  enqueue: Enqueue;
  localFlags: LocalFlags;
  /** the hub clock (S47); never Date.now() for business time */
  clock: HubClock;
  me: ShellPerson | null;
  /** the socket is up */
  online: boolean;
  phone: boolean;
  portrait: boolean;
}

/**
 * 02b §8 Queue (25c): the sign-in screen asks the queue to drain first and shows its line ("2 orders waiting to
 * send"). The stub (orders/queue/shell-hooks.ts) waits for nothing and shows nothing.
 */
export interface ShellHooks {
  /** awaited before POST /auth/pin */
  beforeSignIn(): Promise<void>;
  /** the sign-in screen's queue line, or null */
  queueLine(): string | null;
  subscribe(listener: () => void): () => void;
}

export const ShellContext = createContext<Shell | null>(null);

export function useShell(): Shell {
  const shell = useContext(ShellContext);
  if (shell === null) throw new Error('useShell outside the staff shell');
  return shell;
}
