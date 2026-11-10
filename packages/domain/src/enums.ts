export type DeviceType = 'tablet' | 'cashier_kiosk' | 'kds' | 'phone';

export type SessionKind = 'staff' | 'admin' | 'station';

export type SessionEndReason =
  | 'logout'
  | 'replaced'
  | 'taken_over'
  | 'idle_timeout'
  | 'forced'
  | 'device_revoked'
  | 'staff_removed'
  | 'credentials_changed'
  | 'hub_restored';

export type GrantType = 'allowed' | 'requires_approval';

export type Grant = GrantType | 'not_granted' | 'denied';

export type LockoutSubject = 'staff' | 'device' | 'ip';

export const TABLE_STATES = [
  'FREE',
  'SEATED',
  'ORDERED',
  'FOOD_ON_TABLE',
  'BILL_REQUESTED',
  'NEEDS_CLEANING',
] as const;

export type TableState = (typeof TABLE_STATES)[number];
