// 02b v1.0.25 §3.1 Phone key (R1, owner 2026-11-24; run 1 m-2): the one canonical key of a stored phone, for matching
// (customer-orders, §6.18b). Pure; module-internal (computed by the orders fold of OrderContactSet, §5) and never sent:
// no query body, frame or catch-up carries `phone_key`. A change here is a migration with an `orders` checkpoint delete.

/** §3.1 rules 1–4, 3a, 3b over the digits of `phone`. */
export function phoneKey(phone: string): string {
  const d = phone.replace(/\D/g, ''); // rule 1 (the stored phone is already digits only)
  if (d.length === 11 && d.startsWith('0')) return `92${d.slice(1)}`; // rule 2: 0 + 10
  if (d.length === 12 && d.startsWith('92')) return d; // rule 3: 92 + 10
  if (d.length === 13 && d.startsWith('920')) return `92${d.slice(3)}`; // rule 3a: +92 0300 …
  if (d.length === 10 && d.startsWith('3')) return `92${d}`; // rule 3b: a mobile typed without its 0
  return d; // rule 4
}
