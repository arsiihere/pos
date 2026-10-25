// §8.1: times are typed in minutes and stored as _ms; the cloud checks the ranges (§3.3).
const MINUTE_MS = 60_000;
const MINUTES_RE = /^[0-9]+(\.[0-9]{1,2})?$/;

export function parseMinutes(text: string): number | null {
  const trimmed = text.trim();
  return MINUTES_RE.test(trimmed) ? Math.round(Number(trimmed) * MINUTE_MS) : null;
}

export function formatMinutes(ms: number): string {
  return String(Math.round((ms / MINUTE_MS) * 100) / 100);
}
