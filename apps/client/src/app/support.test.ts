import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { ownAdminText } from '../features/owner/form';
import { supportPhone, withSupport } from './support';

afterEach(() => vi.unstubAllEnvs());

describe('[01b §8, Q3] support number', () => {
  it('[01b §8, Q3] unset or empty adds no number; set appends " on {phone}" after "Call support"', () => {
    vi.stubEnv('VITE_SUPPORT_PHONE', '  ');
    expect(supportPhone()).toBeNull();
    expect(ownAdminText({})).toBe("You can't remove your own admin access. Call support.");

    vi.stubEnv('VITE_SUPPORT_PHONE', '0300 1234567');
    expect(supportPhone()).toBe('0300 1234567');
    expect(ownAdminText({})).toBe("You can't remove your own admin access. Call support on 0300 1234567.");
    expect(ownAdminText({ reason: 'owner_not_linked' })).toBe(
      "Your owner login isn't linked to your staff profile yet, so admin access can't be removed. Call support on 0300 1234567 to link it.",
    );
    expect(withSupport(t('branches.behind_body'))).toBe(
      'The hub checks in but hasn’t taken the latest changes. Call support on 0300 1234567 if this stays.',
    );
    expect(withSupport('No support here.')).toBe('No support here.');
  });
});
