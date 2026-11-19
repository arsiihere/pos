import { AUDIT_ACTIONS } from '@pos/domain';
import { describe, expect, it } from 'vitest';
import { AuditLogQuery } from '../../src/audit/queries.js';

// 05 P0.15 (G-19): the audit query validates `action` against AUDIT_ACTIONS, so 05's actions are accepted.
const base = { from: '1000', to: '2000' };

describe('[05 P0.15 G-19] GET /queries/audit-log action filter', () => {
  it('accepts every 05 action, alone and in a list', () => {
    for (const a of ['bill_opened', 'discount_answered', 'money_request_raised', 'shift_variance_signed_off', 'z_report_issued']) {
      expect(AuditLogQuery.safeParse({ ...base, action: a }).success, a).toBe(true);
    }
    expect(AuditLogQuery.safeParse({ ...base, action: 'bill_opened,item_voided,shift_closed' }).success).toBe(true);
    expect(AuditLogQuery.safeParse({ ...base, action: AUDIT_ACTIONS.join(',') }).success).toBe(true);
  });

  it('still refuses an unknown or a removed action', () => {
    expect(AuditLogQuery.safeParse({ ...base, action: 'class_shares_declared' }).success).toBe(false);
    expect(AuditLogQuery.safeParse({ ...base, action: 'bill_opened,bill_opened' }).success).toBe(false);
  });
});
