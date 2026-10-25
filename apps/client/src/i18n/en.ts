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
} as const;

export type MessageKey = keyof typeof en;
