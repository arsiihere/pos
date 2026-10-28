/// <reference types="vite/client" />
// 01b §8, owner answer Q3: the optional build value VITE_SUPPORT_PHONE. Unset or empty → every support text
// ends with "Call support." and shows no number; set → " on {phone}" follows "Call support".
export function supportPhone(): string | null {
  const value = (import.meta.env['VITE_SUPPORT_PHONE'] as string | undefined)?.trim() ?? '';
  return value === '' ? null : value;
}

// "… Call support." → "… Call support on 0300 1234567."; also "Call support to link it." and
// "Call support if this stays.". Texts without the phrase are returned as they are.
export function withSupport(text: string): string {
  const phone = supportPhone();
  return phone === null ? text : text.replace(/Call support(?=\.| to | if )/g, `Call support on ${phone}`);
}
