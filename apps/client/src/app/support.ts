/// <reference types="vite/client" />
import { language } from '../i18n';
import { en, fill, type MessageKey } from '../i18n/en';
import { ur } from '../i18n/ur';

// 01b §8, owner answer Q3: the optional build value VITE_SUPPORT_PHONE. Unset or empty → every support text
// ends with "Call support." and shows no number; set → the number is added, in every language.
export function supportPhone(): string | null {
  const value = (import.meta.env['VITE_SUPPORT_PHONE'] as string | undefined)?.trim() ?? '';
  return value === '' ? null : value;
}

// The text for `key` with its `{support}` place filled: empty when no number is set, else `support.on`
// in the text's own language ("Call support on 0300 1234567." / "سپورٹ کو 0300 1234567 پر فون کریں۔").
// An Urdu view whose key has no Urdu yet shows the English text with the English fragment.
export function supportText(key: MessageKey): string {
  const urdu = language() === 'ur' ? ur[key] : undefined;
  const phone = supportPhone();
  const on = phone === null ? '' : fill(urdu === undefined ? en['support.on'] : (ur['support.on'] ?? en['support.on']), { phone });
  return fill(urdu ?? en[key], { support: on });
}
