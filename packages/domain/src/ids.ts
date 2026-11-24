export const ULID_RE: RegExp = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export type Ulid = string;

/** Minimum lead time for a scheduled takeaway pickup (02b §3.2 step 2b). */
export const PICKUP_MIN_LEAD_MS = 600_000;
