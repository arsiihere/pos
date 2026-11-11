// Pilot values for 01d alerts and requests [01d A14, §3.2, §3.3, §3.5].

export const ALERT_CONSTANTS = Object.freeze({
  approval_repeat_ms: 45_000,
  approval_branch_ms: 120_000,
  binding_route_idle_ms: 7_200_000,
  needs_pin: Object.freeze({ money: 'always', accept: 'never' } as const),
  // ⚠️ Changed by 03c v1.0.1 D-3 (01d v1.2.2): a printer problem older than this raises printer_problem (03c §3.7).
  printer_alert_ms: 30_000,
} as const);

export const ALERT_FAMILIES = ['urgent', 'action', 'info'] as const;
export type AlertFamily = (typeof ALERT_FAMILIES)[number];

export const ALERT_CLOSE_REASONS = [
  'answered',
  'withdrawn',
  'done',
  'obsolete',
  'overridden',
  'undone',
  'expired',
] as const;

export const OWNER_CLOSE_REASONS = ['done', 'obsolete', 'overridden', 'undone'] as const;

export const REQUEST_DECISIONS = ['approve', 'reject', 'accept', 'decline'] as const;

export const ANSWER_METHODS = ['session', 'pin', 'in_person'] as const;

export const RECIPIENT_SETS = ['answerer', 'informed', 'recipient'] as const;
