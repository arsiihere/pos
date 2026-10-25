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
  'errors.LOGIN_INVALID': 'Email or password is wrong. Check them and try again.',
  'errors.LOGIN_LOCKED_OUT': 'Too many tries. Wait a few minutes, then try again.',
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
