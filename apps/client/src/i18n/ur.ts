import type { MessageKey } from './en';

// S49: Urdu texts, same keys as en.ts; a missing key falls back to English
// (docs/design/handoff/01a/urdu-todo.md). Source: frames OwnerMenuUrdu and StockUrdu.
export const ur: Partial<Record<MessageKey, string>> = {
  'owner.title': 'ریسٹورنٹ سیٹ اپ',
  'owner.nav.menu': 'مینیو',
  'owner.nav.floors': 'فلور اور میزیں',
  'menu.branches_of': '{n} میں سے {m} برانچ',
};
