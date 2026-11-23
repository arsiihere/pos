// 02b §3.1, §6.1 (hub submit-order.ts `Phone`): a phone is `/^\+?[\d\s-]+$/` with 10–13 digits once spaces, dashes and
// a leading + are dropped; the hub stores the digits. 02b-TK C1-2 (R1): name and phone stay optional; the cart keeps
// what was typed (the draft brings it back as typed), and Send carries the hub's form of it.

/** 02b §8 Types: phone 10–13 digits after normalising (hub submit-order.ts :28-33). */
export const PHONE_RE = /^\d{10,13}$/;
export const NAME_MAX = 40;

/** "+92 300-1234567" → "923001234567"; "" → null; anything the hub would refuse → the text without spaces and dashes (fails PHONE_RE). */
export function phoneDigits(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return trimmed.replace(/^\+/, '').replace(/[\s-]/g, '');
}

/** A typed phone the hub would refuse (an empty field is fine: the phone is optional). */
export function phoneBad(text: string | undefined): boolean {
  const d = text === undefined ? null : phoneDigits(text);
  return d !== null && !PHONE_RE.test(d);
}

/** The takeaway part Send carries: the name trimmed, the phone as digits; nothing typed → undefined. */
export function takeawayContact(c: { customer_name?: string; phone?: string } | undefined): { customer_name?: string; phone?: string } | undefined {
  if (c === undefined) return undefined;
  const name = c.customer_name?.trim() ?? '';
  const digits = c.phone === undefined ? null : phoneDigits(c.phone);
  const phone = digits !== null && PHONE_RE.test(digits) ? digits : null;
  if (name === '' && phone === null) return undefined;
  return { ...(name === '' ? {} : { customer_name: name }), ...(phone === null ? {} : { phone }) };
}
