import { SCREEN_KEYS, screensOffered, type DeviceType, type Permission, type ScreenKey } from '@pos/domain';
import { t } from '../../../i18n';
import type { Permissions } from './permissions';

// 05a §3.6, §8, C-1: the staff shell's tabs come from the device's profile `screens` (list order), filtered by what
// the signed-in person holds after the mask (O-16). Never from `device_type` or the screen width: with no profile
// (a hub that sends none) the offered set of the hardware stands in, once, here.

/** The hash route each screen opens. `parking` is the open-orders list (its New car order); `takeaway` is KioskHome (A-7). */
export const SCREEN_ROUTE: Record<ScreenKey, string> = {
  dine_in: '/tables',
  takeaway: '/takeaway',
  parking: '/orders',
  cashier: '/bills',
  pass: '/pass',
  manager: '/manager',
};

/** §3.6: `manager` needs one of these (after the mask). */
export const MANAGER_PERMISSIONS: readonly Permission[] = ['view-reports', 'close-business-day', 'view-audit-log', 'manage-devices'];

export const isScreenKey = (s: string): s is ScreenKey => (SCREEN_KEYS as readonly string[]).includes(s);

/** No profile on the hub: today's order by hardware (Pass first where the catch-up says there is a point). */
export function fallbackScreens(type: DeviceType, hasPoint: boolean): ScreenKey[] {
  const base = screensOffered(type).filter((k) => k !== 'pass' && k !== 'manager');
  const list: ScreenKey[] = type === 'cashier_kiosk' ? ['takeaway', 'parking', 'dine_in', 'cashier'] : base;
  const out: ScreenKey[] = [...(hasPoint ? (['pass'] as const) : []), ...list.filter((k) => k !== 'pass')];
  if (screensOffered(type).includes('manager')) out.push('manager');
  return out;
}

/** §3.6 O-16: a screen is hidden when the person holds none of its permissions. A downgraded grant is still held. */
export function screenHeld(key: ScreenKey, p: Permissions): boolean {
  switch (key) {
    case 'cashier':
      return p.allowed('take-payment') || p.masked('take-payment') === 'downgraded';
    case 'manager':
      return MANAGER_PERMISSIONS.some((x) => p.allowed(x));
    default:
      return true;
  }
}

/** The profile's screens, in list order, that this person may use. Unknown keys are dropped. */
export function visibleScreens(screens: readonly string[], p: Permissions): ScreenKey[] {
  const seen = new Set<string>();
  const out: ScreenKey[] = [];
  for (const s of screens) {
    if (!isScreenKey(s) || seen.has(s)) continue;
    seen.add(s);
    if (screenHeld(s, p)) out.push(s);
  }
  return out;
}

export interface TabItem {
  key: ScreenKey;
  path: string;
  label: string;
  /** a downgraded grant: shown, with the hint "Confirm on your phone" */
  hint: string | null;
}

export function tabsOf(screens: readonly ScreenKey[], p: Permissions): TabItem[] {
  return screens.map((key) => ({
    key,
    path: SCREEN_ROUTE[key],
    label: t(`alerts.screen.${key}`),
    hint: key === 'cashier' && p.masked('take-payment') === 'downgraded' ? t('answer.confirm_on_phone') : null,
  }));
}

/** C-1: home = the first screen; none left → the inbox. */
export const homeOf = (screens: readonly ScreenKey[]): string => (screens[0] === undefined ? '/inbox' : SCREEN_ROUTE[screens[0]]);

/** The screen a route belongs to, or null (inbox, requests, me, shift, and routes shared by two screens). */
export function screenOfPath(path: string, orderType?: string): ScreenKey | null {
  if (path === '/tables' || path.startsWith('/tables/')) return 'dine_in';
  if (path === '/takeaway') return 'takeaway';
  if (path === '/orders') return 'parking';
  if (path.startsWith('/order/')) return orderType === 'dine_in' ? 'dine_in' : orderType === 'takeaway' ? 'takeaway' : orderType === 'parking' ? 'parking' : null;
  if (path === '/bills' || path === '/bill') return 'cashier';
  if (path === '/pass') return 'pass';
  if (['/manager', '/reports', '/day-close', '/audit', '/test-alert', '/devices'].includes(path) || path.startsWith('/receipts/')) return 'manager';
  return null;
}

const LAST_TAB_KEY = 'pos.staff.last_tab';

/** §3.6 "the device remembers its last tab" (a per-device convenience: browser storage, never required). */
export function rememberTab(deviceId: string, key: ScreenKey): void {
  try {
    window.localStorage.setItem(`${LAST_TAB_KEY}.${deviceId}`, key);
  } catch {
    /* private window: the first screen stays home */
  }
}

export function landingOf(deviceId: string, screens: readonly ScreenKey[]): string {
  try {
    const last = window.localStorage.getItem(`${LAST_TAB_KEY}.${deviceId}`);
    if (last !== null && isScreenKey(last) && screens.includes(last)) return SCREEN_ROUTE[last];
  } catch {
    /* ignore */
  }
  return homeOf(screens);
}
