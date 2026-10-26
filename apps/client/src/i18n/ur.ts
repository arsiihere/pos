import type { MessageKey } from './en';

// S49: Urdu texts, same keys as en.ts; a missing key falls back to English
// (docs/design/handoff/01a/urdu-todo.md). Source: frames OwnerMenuUrdu and StockUrdu.
export const ur: Partial<Record<MessageKey, string>> = {
  'owner.title': 'ریسٹورنٹ سیٹ اپ',
  'owner.nav.menu': 'مینیو',
  'owner.nav.floors': 'فلور اور میزیں',
  // "X میں سے Y" reads "Y of X".
  'menu.branches_of': '{m} میں سے {n} برانچ',
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
  'admin_stock.title': 'اسٹاک',
  'admin_stock.filter.to_count': 'گننا باقی',
  'admin_stock.badge.low': 'کم',
  'admin_stock.filter.all': 'سب',
  'quantity.kg': 'کلو',
  'quantity.pieces': 'عدد',
  'admin_stock.add': 'شامل کریں',
  'admin_stock.badge.not_counted': 'آج نہیں گنا',
  'admin_stock.counted_n': '{m} میں سے {n}',
  'admin_stock.save': 'گنتیاں محفوظ کریں',
};
