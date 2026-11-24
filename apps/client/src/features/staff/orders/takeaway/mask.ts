// 02b-TK (ruling R3; frames TokenReady, TokenPartial, HeldDrawer): a customer's name and phone on a shared screen.
// The token view's Phone fact is always masked ("0300 ••• 4567"; the full number only through Call → order-contact,
// for view-customer-contact holders, logged by the hub). Held drafts shared on a device show the name and phone
// masked to anyone without view-customer-contact ("U•••", "••• 4567"). Pure; nothing is logged.

const digits = (s: string) => s.replace(/\D/g, '');

/** "0300 ••• 4567" — the first 4 and the last 4 digits; a short number shows its last 4 only. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (phone === null || phone === undefined) return null;
  const d = digits(phone);
  if (d === '') return null;
  if (d.length < 9) return `••• ${d.slice(-4)}`;
  return `${d.slice(0, 4)} ••• ${d.slice(-4)}`;
}

/** R3: "••• 4567" (the last 4 digits stay: they are what the queue search takes). */
export function hidePhone(phone: string | null | undefined): string | null {
  if (phone === null || phone === undefined) return null;
  const d = digits(phone);
  return d === '' ? null : `••• ${d.slice(-4)}`;
}

/** R3: "U•••" — the first letter only. */
export function hideName(name: string | null | undefined): string | null {
  const n = (name ?? '').trim();
  return n === '' ? null : `${[...n][0]!}•••`;
}
