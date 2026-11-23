import type { DeviceType } from './enums.js';

// 05a §3.6: the staff-shell screens a device profile may carry.
export const SCREEN_KEYS = ['dine_in', 'takeaway', 'parking', 'cashier', 'pass', 'manager'] as const;
export type ScreenKey = (typeof SCREEN_KEYS)[number];

// 05a §3.3a: why a permission is masked on an `everyone` device.
export type Masked = 'listed_only' | 'downgraded';

// 05a §3.6: `cashier` only on cashier_kiosk and tablet; `kds` has no screens.
export function screensOffered(t: DeviceType): readonly ScreenKey[] {
  if (t === 'kds') return [];
  if (t === 'cashier_kiosk' || t === 'tablet') return SCREEN_KEYS;
  return SCREEN_KEYS.filter((k) => k !== 'cashier');
}
