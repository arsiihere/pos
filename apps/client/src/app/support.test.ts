import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n';
import { ownAdminText } from '../features/owner/form';
import { supportPhone, supportText } from './support';

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
    expect(supportText('branches.behind_body')).toBe(
      'The hub checks in but hasn’t taken the latest changes. Call support on 0300 1234567 if this stays.',
    );
    expect(supportText('errors.network')).not.toContain('0300');
  });

  it('[01b §8, Q3] Urdu support texts get the number in Urdu word order; none when unset', () => {
    setLanguage('ur');
    try {
      vi.stubEnv('VITE_SUPPORT_PHONE', '');
      expect(supportText('branches.behind_body')).toBe('ہب چیک کرتا ہے مگر تازہ تبدیلیاں نہیں لے رہا۔ اگر ایسا رہے تو سپورٹ کو فون کریں۔');
      vi.stubEnv('VITE_SUPPORT_PHONE', '0300 1234567');
      expect(supportText('account.forgot')).toBe('پاس ورڈ بھول گئے؟ سپورٹ کو 0300 1234567 پر فون کریں۔');
      expect(supportText('branches.behind_body')).toBe(
        'ہب چیک کرتا ہے مگر تازہ تبدیلیاں نہیں لے رہا۔ اگر ایسا رہے تو سپورٹ کو 0300 1234567 پر فون کریں۔',
      );
      // An error text with no Urdu yet falls back to English and still gets the number.
      expect(ownAdminText({})).toBe("You can't remove your own admin access. Call support on 0300 1234567.");
    } finally {
      setLanguage('en');
    }
  });
});
