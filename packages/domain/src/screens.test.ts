import { describe, expect, it } from 'vitest';
import { LISTED_ONLY_PERMISSIONS, MONEY_PERMISSIONS, isPermission } from './permissions';
import { SCREEN_KEYS, screensOffered } from './screens';

describe('device screens and permission lists', () => {
  it('[05a §3.3] LISTED_ONLY_PERMISSIONS is exact', () => {
    expect([...LISTED_ONLY_PERMISSIONS]).toEqual([
      'access-hub-admin',
      'manage-devices',
      'manage-staff',
      'manage-roles',
      'manage-fiscal-settings',
      'approve-void',
      'view-audit-log',
    ]);
  });

  it('[05a §3.3] MONEY_PERMISSIONS is exact', () => {
    expect([...MONEY_PERMISSIONS]).toEqual(['void-item', 'apply-discount', 'apply-comp', 'apply-refund', 'reopen-bill']);
  });

  it('[05a §3.3] both lists hold known permissions and are disjoint', () => {
    for (const p of [...LISTED_ONLY_PERMISSIONS, ...MONEY_PERMISSIONS]) expect(isPermission(p), p).toBe(true);
    expect(LISTED_ONLY_PERMISSIONS.filter((p) => (MONEY_PERMISSIONS as readonly string[]).includes(p))).toEqual([]);
  });

  it('[05a §3.6] SCREEN_KEYS are the six keys in order', () => {
    expect([...SCREEN_KEYS]).toEqual(['dine_in', 'takeaway', 'parking', 'cashier', 'pass', 'manager']);
  });

  it('[05a §3.6] cashier is offered on cashier_kiosk and tablet only', () => {
    expect(screensOffered('cashier_kiosk')).toContain('cashier');
    expect(screensOffered('tablet')).toContain('cashier');
    expect(screensOffered('phone')).not.toContain('cashier');
  });

  it('[05a §3.6] kds has no screens; others offer the rest', () => {
    expect(screensOffered('kds')).toEqual([]);
    expect(screensOffered('phone')).toEqual(['dine_in', 'takeaway', 'parking', 'pass', 'manager']);
    expect(screensOffered('tablet')).toEqual([...SCREEN_KEYS]);
  });
});
