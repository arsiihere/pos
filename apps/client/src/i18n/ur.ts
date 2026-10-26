import type { MessageKey } from './en';

// S49: Urdu texts, same keys as en.ts; a missing key falls back to English
// (docs/design/handoff/01a/urdu-todo.md). Source: frames OwnerMenuUrdu and StockUrdu.
export const ur: Partial<Record<MessageKey, string>> = {
  'owner.title': 'ریسٹورنٹ سیٹ اپ',
  'owner.nav.menu': 'مینیو',
  'owner.nav.floors': 'فلور اور میزیں',
  'menu.branches_of': '{n} میں سے {m} برانچ',
  'owner.nav.stations': 'کچن اسٹیشن',
  'owner.sign_out': 'سائن آؤٹ',
  'owner.menu.title': 'مینیو',
  'menu.shared_chip': 'سب برانچوں کا ایک',
  'owner.menu.new_item': 'نیا آئٹم',
  'owner.menu.items': 'آئٹم',
  'owner.menu.categories': 'کیٹیگری',
  'menu.tax_rates': 'ٹیکس',
  'menu.col_item': 'آئٹم',
  'owner.item.category': 'کیٹیگری',
  'menu.col_price': 'قیمت',
  'menu.col_notes': 'کہاں بکتا ہے',
  'owner.common.edit': 'ترمیم',
  'menu.per.piece': '/ عدد',
  'menu.per.kg': '/ کلو',
};
