// §8.3: every string is a key; English only until Urdu is added (00 M82).
export const en = {
  'owner.title': 'Restaurant setup',
  'admin_stock.title': 'Stock',
  'common.slow': 'Still working. This can take a few seconds.',
  'pin.label': 'PIN',
  'pin.delete': 'Delete',
  'pin.submit': 'Enter',
  'quantity.pieces': 'pieces',
  'quantity.kg': 'kg',
  'quantity.l': 'L',
  'quantity.invalid': 'Check the number: whole pieces, or kg and L with up to 3 decimals.',
  'owner.login.title': 'Sign in',
  'owner.login.email': 'Email',
  'owner.login.password': 'Password',
  'owner.login.submit': 'Sign in',
  'owner.branches.title': 'Choose a branch',
  'owner.nav.floors': 'Floors and tables',
  'owner.common.show_archived': 'Show archived',
  'owner.common.archive': 'Archive',
  'owner.common.restore': 'Restore',
  'owner.common.sort_order': 'Sort number',
  'owner.floors.title': 'Floors and tables',
  'owner.floors.floor_name': 'Floor name',
  'owner.floors.table_name': 'Table name',
  'owner.floors.new_floor': 'New floor name',
  'owner.floors.add_floor': 'Add floor',
  'owner.floors.new_table': 'New table name',
  'owner.floors.seats': 'seats',
  'owner.floors.add_table': 'Add table',
  'errors.CONFIG_NAME_TAKEN': 'That name is already used. Choose another name.',
  'errors.CONFIG_IN_USE': 'Still in use. Archive or move what uses it first.',
  'errors.CONFIG_REFERENCE_INVALID': 'Something it points to is archived or missing. Choose another one.',
  'errors.PERMISSION_DENIED': 'Only an owner of every branch can change this.',
  'errors.LOGIN_INVALID': 'Email or password is wrong. Check them and try again.',
  'errors.LOGIN_LOCKED_OUT': 'Too many tries. Wait a few minutes, then try again.',
  'errors.IP_LOCKED_OUT': 'Too many tries. Wait a few minutes, then try again.',
  'errors.IDEMPOTENCY_KEY_MISMATCH': 'This form was already saved with other values. The list is reloaded; check it before adding again.',
  'errors.VALIDATION_FAILED': 'Check the fields and try again.',
  'errors.network': 'The cloud cannot be reached. Check the internet connection; what you typed is kept.',
  'errors.UNKNOWN': 'Something went wrong. Try again.',
} as const;

export type MessageKey = keyof typeof en;

// §8.1: an API error code shows its errors.<CODE> text, or the generic one when the catalogue has none.
export function errorKey(code: string): MessageKey {
  const key = `errors.${code}`;
  return key in en ? (key as MessageKey) : 'errors.UNKNOWN';
}
