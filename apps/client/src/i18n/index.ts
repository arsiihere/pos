import { en, type MessageKey } from './en';

export type { MessageKey };

export function t(key: MessageKey): string {
  return en[key];
}
