import { defaultBillingSettings } from '@pos/events';
import { describe, expect, it } from 'vitest';
import { build, documentOf, fieldFor, parsePercentBp, referenceError, toDraft, validationErrors } from './form-state';

const doc = { ...defaultBillingSettings({ currency_code: 'PKR', currency_exponent: 2 }), branch_id: 'B1', version: 'v1' };

describe('[01a v2.7.1 §8.1 A-1 (6)] billing form state', () => {
  it('an untouched draft builds the loaded document exactly (nothing dropped, branch and version left out)', () => {
    const built = build(toDraft(doc), doc);
    expect(built).toEqual({ ok: true, body: documentOf(doc) });
  });

  it('percent parses to basis points with at most 2 decimals; 30 is the top', () => {
    expect(parsePercentBp('5')).toBe(500);
    expect(parsePercentBp('2.5')).toBe(250);
    expect(parsePercentBp('0.05')).toBe(5);
    expect(parsePercentBp('1.234')).toBeNull();
    expect(parsePercentBp('-1')).toBeNull();
    expect(parsePercentBp('')).toBeNull();
    const draft = toDraft(doc);
    draft.service.delivery = '30.01';
    expect(build(draft, doc)).toEqual({ ok: false, errors: { 'service_charge_bp.delivery': 'service_range' } });
    draft.service.delivery = '30';
    expect(build(draft, doc).ok).toBe(true);
  });

  it('[R-36] a cloud field maps onto the input it equals or sits under; others have none', () => {
    expect(fieldFor('fiscal.integration_status')).toBe('fiscal.integration_status');
    expect(fieldFor('receipt.header_lines.2')).toBe('receipt.header_lines');
    expect(fieldFor('payment_modes.0.payment_class')).toBeNull();
    expect(referenceError({ field: 'fiscal.integration_status' })).toEqual({ field: 'fiscal.integration_status', path: 'fiscal.integration_status', key: 'integration_status' });
    expect(referenceError({ field: 'jurisdiction_id', reason: 'profile_missing' }).key).toBe('profile_missing');
    expect(referenceError({ field: 'fiscal.adapter_settings.PRA', reason: 'invalid' }).field).toBeNull();
    expect(validationErrors({ issues: [{ path: 'service_charge_bp.dine_in' }, { path: 'nope' }] })).toEqual({ 'service_charge_bp.dine_in': 'service_range' });
  });
});
