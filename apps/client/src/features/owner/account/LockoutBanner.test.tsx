import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { t } from '../../../i18n';
import { button, click, fakeApi, mount, ok, type Mounted } from '../test-api';
import { LockoutBanner } from './LockoutBanner';

let m: Mounted;

beforeEach(() => {
  sessionStorage.clear();
  m = mount();
});

afterEach(() => {
  m.unmount();
  sessionStorage.clear();
});

const USER = { user_id: 'U1', display_name: 'Arif', tenant_id: 'T1', allowed_branch_ids: ['B1'], must_change_password: false };

function login(notice: unknown) {
  return ok({ access_token: 'A1', access_expires_at: 1, refresh_token: 'R1', refresh_expires_at: 2, user: USER, lockout_notice: notice });
}

describe('[01b §8] lockout banner', () => {
  it('[01b §8] lockout banner shows {n} = failed_count', async () => {
    const { api } = fakeApi(() => login({ locked_at: Date.UTC(2026, 9, 27, 17, 42), failed_count: 10 }));
    await api.login('arif@example.pk', 'password-1');
    await m.render(<LockoutBanner api={api} />);
    expect(m.container.textContent).toContain('with a wrong password 10 times on');
    expect(m.container.textContent).toContain(t('account.lock_notice_body'));

    // Shown once: Got it clears it for the rest of the session.
    await click(button(m.container, t('account.lock_got_it')));
    expect(m.container.textContent).toBe('');
    m.unmount();
    m = mount();
    await m.render(<LockoutBanner api={api} />);
    expect(m.container.textContent).toBe('');
  });

  it('[01b §8] no notice, no banner', async () => {
    const { api } = fakeApi(() => login(null));
    await api.login('arif@example.pk', 'password-1');
    await m.render(<LockoutBanner api={api} />);
    expect(m.container.textContent).toBe('');
  });

  it('[hand-off 01b-B01] danger banner; Change password leads to #/account/password; both actions secondary', async () => {
    const { api } = fakeApi(() => login({ locked_at: Date.UTC(2026, 9, 27, 17, 42), failed_count: 10 }));
    await api.login('arif@example.pk', 'password-1');
    await m.render(<LockoutBanner api={api} />);
    expect(m.container.querySelector('.pos-banner--danger[role="alert"]')).not.toBeNull();
    const link = m.container.querySelector<HTMLAnchorElement>('.pos-banner__action a')!;
    expect(link.textContent).toBe(t('owner.nav.change_password'));
    expect(link.getAttribute('href')).toBe('#/account/password');
    expect(m.container.querySelector('.pos-btn--primary')).toBeNull();
  });
});
