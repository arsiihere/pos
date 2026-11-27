// A structural "no secret here" check for logs, responses and events (L-CLOSE-2). A raw `not.toContain('1234')` on a
// whole log or JSON body fails by chance when a timestamp, a seq or a ULID happens to hold the digits of a short secret
// (CI failed once on a PIN check). Instead: walk the parsed JSON and report every place the secret really sits:
// - a key that names a PIN (`pin`, `new_pin`, `old_pin`, `pin_plain`), whatever its value;
// - a string value equal to the secret;
// - a free-text field (`msg`, `message`, `reason`, `note`) that contains it.
// Numbers are never matched (a timestamp is not a secret), nor are ids that merely contain the digits.

const PIN_KEYS = new Set(['pin', 'new_pin', 'old_pin', 'pin_plain']);
const TEXT_KEYS = new Set(['msg', 'message', 'reason', 'note']);

/** The JSON lines of a captured pino log (non-JSON lines are ignored). */
export function logLines(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // a partial line: not a record
    }
  }
  return out;
}

/** The paths at which `secret` leaks inside `value` (an empty list = clean). */
export function secretLeaks(value: unknown, secret: string, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => secretLeaks(v, secret, `${path}[${i}]`));
  if (value === null || typeof value !== 'object') return typeof value === 'string' && value === secret ? [path] : [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const p = `${path}.${k}`;
    if (PIN_KEYS.has(k)) out.push(p);
    else if (typeof v === 'string' && TEXT_KEYS.has(k) && v.includes(secret)) out.push(p);
    else out.push(...secretLeaks(v, secret, p));
  }
  return out;
}
