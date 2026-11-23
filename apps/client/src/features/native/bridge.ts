// 05b §4.2: the typed page side of the tablet app's `PosNative` plugin (apps/tablet, PosNativePlugin.kt). Read from
// `window.Capacitor?.Plugins?.PosNative`; no Capacitor import in apps/client. Every call is feature-checked and
// never throws into the UI: a missing method, a rejection (`NOT_ALLOWED_HERE`, §3.6) or a throw answers null.

/** 05b M-14: the lowest plugin API this page needs. */
export const MIN_NATIVE_API = 1;

export type AlertSocketState = 'up' | 'connecting' | 'down';

/** §4.2 event `state`. */
export interface NativeState {
  paired: boolean;
  alert_socket: AlertSocketState;
  binding_route_until: number | null;
  update_ready: boolean;
  needs_context?: boolean;
}

export interface NativeInfo {
  native_api: number;
  version_code: number;
  version_name: string;
  device_owner: boolean;
}

/** §3.5: `reason` = the hub error code native found, `UNREACHABLE`, `NO_NATIVE_TOKEN` or `no_answer`. */
export interface ConfirmRevoked {
  revoked: boolean;
  reason?: string | null;
}

export interface NativeChannel {
  exists: boolean;
  importance: number | null;
  sound: string | null;
}

/** M-18: `health()` (MainHealth.merge); `:alerts` fields are null when the service did not answer. */
export interface NativeHealth {
  service_connected: boolean;
  alert_socket: AlertSocketState | null;
  last_frame_age_ms: number | null;
  wake_lock: boolean | null;
  store_readable: boolean | null;
  replaced_by_other?: boolean | null;
  device_owner: boolean;
  lock_task_state: 'none' | 'locked' | 'pinned';
  post_notifications: boolean;
  channels?: Record<string, NativeChannel>;
  fsi_allowed: boolean;
  battery_exempt: boolean;
  exact_alarms: boolean;
  can_install: boolean;
  native_api: number;
  version_name: string;
  paired?: boolean | null;
}

export type SettingKey = 'notifications' | 'battery' | 'fsi' | 'install' | 'app';
export type UpdateState = 'none' | 'downloading' | 'ready' | 'installing';

/** The raw plugin as Capacitor exposes it (every method returns a promise). */
interface RawPlugin {
  [method: string]: unknown;
}

/** The page's safe view of `PosNative`. */
export interface NativeBridge {
  info(): Promise<NativeInfo | null>;
  confirmRevoked(): Promise<ConfirmRevoked | null>;
  setSession(s: { signed_in: boolean; staff_id?: string }): Promise<void>;
  setDeviceContext(c: { always_on: boolean; language: string; lock_task: boolean }): Promise<void>;
  reportShown(r: { alert_id: string; step: number }): Promise<void>;
  health(): Promise<NativeHealth | null>;
  openSetting(o: { which: SettingKey }): Promise<void>;
  setWakeLock(o: { on: boolean }): Promise<void>;
  checkForUpdate(): Promise<{ state: UpdateState } | null>;
  /** `addListener('state')`; returns the remove function (a no-op when the plugin has no listener API). */
  onState(listener: (s: NativeState) => void): () => void;
}

interface CapacitorWindow {
  Capacitor?: { Plugins?: { PosNative?: unknown } };
}

/** Calls `plugin[method](arg)`; any failure → null. */
async function call<T>(plugin: RawPlugin, method: string, arg?: unknown): Promise<T | null> {
  const fn = plugin[method];
  if (typeof fn !== 'function') return null;
  try {
    const out: unknown = await (arg === undefined ? fn.call(plugin) : fn.call(plugin, arg));
    return (out ?? null) as T | null;
  } catch {
    return null;
  }
}

/** Wraps a raw plugin object. */
export function wrapNative(plugin: RawPlugin): NativeBridge {
  const fire = async (method: string, arg: unknown): Promise<void> => {
    await call(plugin, method, arg);
  };
  return {
    info: () => call<NativeInfo>(plugin, 'info'),
    confirmRevoked: () => call<ConfirmRevoked>(plugin, 'confirmRevoked'),
    setSession: (s) => fire('setSession', s),
    setDeviceContext: (c) => fire('setDeviceContext', c),
    reportShown: (r) => fire('reportShown', r),
    health: () => call<NativeHealth>(plugin, 'health'),
    openSetting: (o) => fire('openSetting', o),
    setWakeLock: (o) => fire('setWakeLock', o),
    checkForUpdate: () => call<{ state: UpdateState }>(plugin, 'checkForUpdate'),
    onState(listener) {
      const add = plugin['addListener'];
      if (typeof add !== 'function') return () => {};
      let removed = false;
      let handle: { remove?: () => unknown } | null = null;
      const safe = (s: unknown) => {
        if (removed || s === null || typeof s !== 'object') return;
        try {
          listener(s as NativeState);
        } catch {
          // a listener error never reaches native
        }
      };
      try {
        const out: unknown = add.call(plugin, 'state', safe);
        const take = (h: unknown) => {
          handle = (h ?? null) as { remove?: () => unknown } | null;
          if (removed) void Promise.resolve(handle?.remove?.()).catch(() => {});
        };
        if (out !== null && typeof out === 'object' && typeof (out as Promise<unknown>).then === 'function') (out as Promise<unknown>).then(take, () => {});
        else take(out);
      } catch {
        return () => {};
      }
      return () => {
        removed = true;
        try {
          void Promise.resolve(handle?.remove?.()).catch(() => {});
        } catch {
          // ignore
        }
      };
    },
  };
}

/** The page's bridge, or null outside the tablet app (browsers, kiosks, phones, KDS: today's behaviour). */
export function nativeBridge(win: unknown = typeof window === 'undefined' ? undefined : window): NativeBridge | null {
  try {
    const plugin = (win as CapacitorWindow | undefined)?.Capacitor?.Plugins?.PosNative;
    if (plugin === null || typeof plugin !== 'object') return null;
    return wrapNative(plugin as RawPlugin);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------- pure decisions

/** M-13: what a staff-build comparison asks for. */
export type StaffBuildAction = 'none' | 'reload' | 'banner';

/**
 * 05b M-13 (O-17, test 2): tablets only (`native`); a missing or empty build on either side → nothing; differ +
 * signed out → reload; differ + signed in → the banner (the page reloads at sign-out).
 */
export function staffBuildAction(o: { native: boolean; pageBuild: string | null | undefined; hubBuild: string | null | undefined; signedIn: boolean }): StaffBuildAction {
  if (!o.native) return 'none';
  if (typeof o.pageBuild !== 'string' || o.pageBuild === '' || typeof o.hubBuild !== 'string' || o.hubBuild === '') return 'none';
  if (o.pageBuild === o.hubBuild) return 'none';
  return o.signedIn ? 'banner' : 'reload';
}

/** 05b M-14 (test 3): true when the app's plugin is older than this page needs ("Update the app"). */
export function needsAppUpdate(info: Pick<NativeInfo, 'native_api'> | null, min: number = MIN_NATIVE_API): boolean {
  if (info === null || typeof info.native_api !== 'number' || !Number.isFinite(info.native_api)) return false;
  return info.native_api < min;
}

/** The `/staff/` page meta `pos-staff-build` (H-1), or null when the hub does not serve it. */
export function readStaffBuild(doc: Document = document): string | null {
  const v = doc.querySelector<HTMLMetaElement>('meta[name="pos-staff-build"]')?.content ?? null;
  return v === null || v === '' ? null : v;
}

/** §3.5 / 00 §8.4: the notice key for a `confirmRevoked` answer that kept the keys; null = the hub answered (nothing to show). */
export type RevokeNoticeKey = 'native.notice.staff_wifi' | 'native.notice.hub_address' | 'native.notice.unreachable';
export function revokeNotice(reason: string | null | undefined): RevokeNoticeKey | null {
  if (reason === 'GUEST_NETWORK_FORBIDDEN') return 'native.notice.staff_wifi';
  if (reason === 'HOST_NOT_ALLOWED') return 'native.notice.hub_address';
  if (reason === 'UNREACHABLE' || reason === 'no_answer' || reason === undefined || reason === null) return 'native.notice.unreachable';
  return null;
}

/** M-21: `setDeviceContext` from the 05a device block (`always_on` = a point is set, `lock_task` = audience `everyone`). */
export function deviceContextOf(device: { access: 'everyone' | 'listed'; point_id: string | null }, language: string): { always_on: boolean; language: string; lock_task: boolean } {
  return { always_on: device.point_id !== null && device.point_id !== undefined, language, lock_task: device.access === 'everyone' };
}
