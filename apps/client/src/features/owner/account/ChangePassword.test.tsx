import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage, t } from '../../../i18n';
import { App } from '../App';
import { button, click, fail, fakeApi, mount, ok, setValue, type Call, type Mounted } from '../test-api';
import { ChangePassword } from './ChangePassword';

let m: Mounted;

const USER = { user_id: 'U1', display_name: 'Arif', tenant_id: 'T1', allowed_branch_ids: ['B1'], must_change_password: false };

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
  sessionStorage.setItem('owner_refresh_token', 'R1');
  sessionStorage.setItem('owner_user', JSON.stringify(USER));
  window.location.hash = '';
  m = mount();
});

afterEach(() => {
  m.unmount();
  sessionStorage.clear();
  vi.unstubAllEnvs();
});

const TOKENS = { access_token: 'A2', access_expires_at: 1, refresh_token: 'R2', refresh_expires_at: 2 };

function caption(): string {
  return m.container.querySelector('p.caption, p.ur-body')?.textContent ?? '';
}

async function renderForm(handler: (call: Call) => Response = () => ok(TOKENS)) {
  const { api, calls } = fakeApi(handler);
  await m.render(<ChangePassword api={api} userName="Arif" forced={false} onChanged={() => {}} />);
  return calls;
}

function fillForm(current: string, next: string, again = next) {
  setValue(m.container.querySelector<HTMLInputElement>('input[name="current_password"]'), current);
  setValue(m.container.querySelector<HTMLInputElement>('input[name="new_password"]'), next);
  setValue(m.container.querySelector<HTMLInputElement>('input[name="new_password_again"]'), again);
}

describe('[01b §8] change password', () => {
  it('[01b §8, Q3] caption "Forgot your password? Call support." with no number when VITE_SUPPORT_PHONE is unset; "… Call support on {phone}." when set', async () => {
    vi.stubEnv('VITE_SUPPORT_PHONE', '');
    await renderForm();
    expect(caption()).toBe('Forgot your password? Call support.');
    m.unmount();

    vi.stubEnv('VITE_SUPPORT_PHONE', '0300 1234567');
    m = mount();
    await renderForm();
    expect(caption()).toBe('Forgot your password? Call support on 0300 1234567.');
  });

  it('[01b §8, Q3] the Urdu caption gets the number too, and none when unset', async () => {
    setLanguage('ur');
    try {
      vi.stubEnv('VITE_SUPPORT_PHONE', '');
      await renderForm();
      expect(caption()).toBe('پاس ورڈ بھول گئے؟ سپورٹ کو فون کریں۔');
      m.unmount();

      vi.stubEnv('VITE_SUPPORT_PHONE', '0300 1234567');
      m = mount();
      await renderForm();
      expect(caption()).toBe('پاس ورڈ بھول گئے؟ سپورٹ کو 0300 1234567 پر فون کریں۔');
    } finally {
      setLanguage('en');
    }
  });

  it('[01b §8] every view redirects to #/account/password while must_change_password', async () => {
    sessionStorage.setItem('owner_user', JSON.stringify({ ...USER, must_change_password: true }));
    const { api } = fakeApi((call) => {
      if (call.url === '/v1/admin/branches') return fail(403, 'PASSWORD_CHANGE_REQUIRED');
      return fail(403, 'PASSWORD_CHANGE_REQUIRED');
    });
    await m.render(<App api={api} />);
    for (const path of ['/', '/menu', '/floors', '/stations', '/staff', '/staff/S1', '/roles', '/teams', '/stock-counting', '/branches', '/branches/B1/settings']) {
      window.location.hash = path;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await click(document.body);
      expect(window.location.hash, path).toBe('#/account/password');
      expect(m.container.textContent).toContain(t('account.forced'));
      // B05: no side nav while forced.
      expect(m.container.querySelector('.pos-sidenav')).toBeNull();
    }
  });

  it('[01b §8] PASSWORD_INVALID and PASSWORD_UNCHANGED are field errors; short and different are checked first', async () => {
    let answer = fail(401, 'PASSWORD_INVALID');
    const calls = await renderForm(() => answer);
    fillForm('old-password', 'short', 'shorter');
    await click(button(m.container, t('account.submit')));
    expect(m.container.textContent).toContain(t('account.too_short'));
    expect(m.container.textContent).toContain(t('account.mismatch'));
    expect(calls).toEqual([]);

    fillForm('old-password', 'a long new password');
    await click(button(m.container, t('account.submit')));
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: '/v1/auth/change-password',
      body: { current_password: 'old-password', new_password: 'a long new password' },
    });
    expect(m.container.textContent).toContain(t('account.wrong_current'));

    answer = fail(422, 'PASSWORD_UNCHANGED');
    fillForm('old-password', 'a long new password');
    await click(button(m.container, t('account.submit')));
    expect(m.container.textContent).toContain(t('account.unchanged'));

    answer = ok(TOKENS);
    fillForm('old-password', 'a long new password');
    await click(button(m.container, t('account.submit')));
    expect(m.container.textContent).toContain(t('account.saved'));
    // The passwords leave the form after the request.
    expect([...m.container.querySelectorAll<HTMLInputElement>('input')].map((i) => i.value)).toEqual(['', '', '']);
  });
});
