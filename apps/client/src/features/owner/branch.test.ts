import { afterEach, describe, expect, it } from 'vitest';
import { storeBranch, storedBranch } from './branch';

// 01a v2.12 QS-2 (owner 2026-11-28 QA-R2): the owner app remembers the chosen branch per browser, not per tab.

describe('[01a v2.12 QS-2] the remembered branch', () => {
  afterEach(() => {
    localStorage.removeItem('owner_branch_id');
    sessionStorage.clear();
  });
  it('a new tab (empty sessionStorage) opens on the branch chosen before, while still allowed', () => {
    storeBranch('B2');
    sessionStorage.clear();
    expect(storedBranch(['B1', 'B2'])).toBe('B2');
    expect(storedBranch(['B1', 'B3'])).toBeNull();
    expect(localStorage.getItem('owner_branch_id')).toBe('B2');
  });
});
