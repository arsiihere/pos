import { describe, expect, it } from 'vitest';
import { primaryStep } from './model';
import { preview } from './test-fakes';

// 04 §8 / §3.2 rule 6 (c): "Comp waiting" holds the button on the approval path only.
describe('04 §8 primaryStep', () => {
  const choice = { reason: 'quality' as const, note: '', disposition: 'wastage' as const, dispositionNote: '' };
  it('[04 §3.2 rule 6] comp_pending holds the approval path; a direct void with comp_pending still ends as Void', () => {
    expect(primaryStep({ online: true, preview: preview('K1', { comp_pending: { alert_id: 'C' } }), choice })).toBe('comp_waiting');
    expect(primaryStep({ online: true, preview: preview('K1', { needs_approval: false, comp_pending: { alert_id: 'C' } }), choice })).toBe('void');
  });
  it('[04 §8] offline, a pending void or no preview: blocked', () => {
    expect(primaryStep({ online: false, preview: preview('K1'), choice })).toBe('blocked');
    expect(primaryStep({ online: true, preview: preview('K1', { pending: { alert_id: 'A' } }), choice })).toBe('blocked');
    expect(primaryStep({ online: true, preview: null, choice })).toBe('blocked');
  });
});
