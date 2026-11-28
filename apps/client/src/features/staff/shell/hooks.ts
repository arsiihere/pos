import { createContext, useContext } from 'react';
import type { HubClock } from '../../../app/hub-clock';
import type { Device, PageMeta, StaffApi } from '../api';
import type { OrdersApi } from '../orders/contracts';
import type { Enqueue, LocalFlags, TablesApi } from '../tables/contracts';
import type { ShellConfig } from './config';
import type { ContextSlotStore } from './context-slot';
import type { RushSlotStore } from './rush-slot';
import type { BarSlotStore } from './bar-slot';
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
  /** the one queue interface (25b) */
  enqueue: Enqueue;
  localFlags: LocalFlags;
  /** the hub clock (S47); never Date.now() for business time */
  clock: HubClock;
  me: ShellPerson | null;
  /** the socket is up */
  online: boolean;
  phone: boolean;
  portrait: boolean;
  /** 02b §8 Device idle lock (IR-9, task 28 wiring): the login reply's `idle_ttl_ms`; null / absent = not known */
  idleTtlMs?: number | null;
  /** sign the page out locally (no hub call; the idle lock's Sign in, task 28 wiring); absent outside StaffApp */
  signOut?: () => void;
  /**
   * 01d v1.3.3 §3.13.2 rule 6 "Close returns": a route sheet (TableSheet, OrderView) is closed by the person. A sheet a
   * deep link opened returns to where the tap started (returnTarget); any other closes to `fallback`, today's target.
   * Absent outside StaffApp: the sheet navigates to `fallback` itself.
   */
  closeRouteSheet?: (fallback: string) => void;
  /** 02b-TK TK-SH01: the top bar's context slot the screen on the route fills (and clears); absent outside StaffApp */
  contextSlot?: ContextSlotStore;
  /** 02b-TK A2 item 4: the takeaway screen's rush state for the Live / Rush pill; absent outside StaffApp */
  rush?: RushSlotStore;
  /** ⚠️ 03b v1.0.17 §8: a row of the screen's own controls in the top bar (the Pass's type tabs); absent outside StaffApp */
  bar?: BarSlotStore;
  /**
   * BUG-5 (02b v1.0.30 §8): read the live state again — the socket reopens in its mode and the hub sends a fresh
   * catch-up (a session the hub ended closes 4401: "You were signed out"). Absent outside StaffApp.
   */
  resync?: () => void;
}

/**
 * 02b §8 Queue (25c): the sign-in screen asks the queue to drain first and shows its line ("2 orders waiting to
 * send"). orders/queue/shell-hooks.ts drains the queue and the idle lock's pending logout.
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
