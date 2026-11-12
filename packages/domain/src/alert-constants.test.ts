import { describe, expect, it } from 'vitest';
import {
  ALERT_CLOSE_REASONS,
  ALERT_CONSTANTS,
  ALERT_FAMILIES,
  ANSWER_METHODS,
  OWNER_CLOSE_REASONS,
  RECIPIENT_SETS,
  REQUEST_DECISIONS,
} from './alert-constants';
import * as domain from './index';

describe('alert constants', () => {
  it('[01d A14] ALERT_CONSTANTS holds the pilot values exactly', () => {
    expect(ALERT_CONSTANTS).toStrictEqual({
      approval_repeat_ms: 45_000,
      approval_branch_ms: 120_000,
      binding_route_idle_ms: 7_200_000,
      needs_pin: { money: 'always', accept: 'never' },
      printer_alert_ms: 30_000,
    });
  });

  it('[01d A14] ALERT_CONSTANTS is deeply frozen', () => {
    expect(Object.isFrozen(ALERT_CONSTANTS)).toBe(true);
    expect(Object.isFrozen(ALERT_CONSTANTS.needs_pin)).toBe(true);
  });

  it('[01d §3.2] families and close reasons', () => {
    expect(ALERT_FAMILIES).toStrictEqual(['urgent', 'action', 'info']);
    expect(ALERT_CLOSE_REASONS).toStrictEqual([
      'answered',
      'withdrawn',
      'done',
      'obsolete',
      'overridden',
      'undone',
      'expired',
    ]);
    expect(OWNER_CLOSE_REASONS).toStrictEqual(['done', 'obsolete', 'overridden', 'undone']);
    for (const r of OWNER_CLOSE_REASONS) expect(ALERT_CLOSE_REASONS).toContain(r);
  });

  it('[01d §3.3] request decisions, answer methods and recipient sets', () => {
    expect(REQUEST_DECISIONS).toStrictEqual(['approve', 'reject', 'accept', 'decline']);
    expect(ANSWER_METHODS).toStrictEqual(['session', 'pin', 'in_person']);
    expect(RECIPIENT_SETS).toStrictEqual(['answerer', 'informed', 'recipient']);
  });

  it('[01d §4.2] exported from @pos/domain', () => {
    expect(domain.ALERT_CONSTANTS).toBe(ALERT_CONSTANTS);
    expect(domain.ALERT_FAMILIES).toBe(ALERT_FAMILIES);
    expect(domain.ALERT_CLOSE_REASONS).toBe(ALERT_CLOSE_REASONS);
    expect(domain.OWNER_CLOSE_REASONS).toBe(OWNER_CLOSE_REASONS);
    expect(domain.REQUEST_DECISIONS).toBe(REQUEST_DECISIONS);
    expect(domain.ANSWER_METHODS).toBe(ANSWER_METHODS);
    expect(domain.RECIPIENT_SETS).toBe(RECIPIENT_SETS);
  });
});
