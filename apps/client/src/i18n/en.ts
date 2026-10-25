// §8.3: every string is a key; English only until Urdu is added (00 M82).
export const en = {
  'owner.title': 'Restaurant setup',
  'admin_stock.title': 'Stock',
} as const;

export type MessageKey = keyof typeof en;
