import { describe, expect, it } from 'vitest';
import { REFERENCE_MAX, referenceLength, typedReference } from './reference';

describe('[05 §3.7, QA BUG-27] payment reference field (bill pad and takeaway PayPanel)', () => {
  it('drops leading spaces as typed, counts the trimmed text, limit 60', () => {
    expect(REFERENCE_MAX).toBe(60);
    expect(typedReference('   TX 77 ')).toBe('TX 77 ');
    expect(typedReference(' \t')).toBe('');
    expect(referenceLength('TX 77   ')).toBe(5);
    expect(referenceLength('x'.repeat(60))).toBe(60);
  });
});
