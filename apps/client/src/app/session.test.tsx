import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudAdmin } from '../api/cloud-admin';
import { t } from '../i18n';
import { App } from '../features/owner/App';
import { fail, flush, mount, ok, type Mounted } from '../features/owner/test-api';
import { navigate } from './router';

// 01b §8 error mapping at the app level: SERVICE_UNAVAILABLE is the cloud-unreachable state, never the
// sign-in page; JWT_INVALID then REFRESH_TOKEN_INVALID lands on sign-in once (Review Focus 4, client).
let m: Mounted;
const USER = { user_id: 'U1', display_name: 'Arif', tenant_id: 'T1', allowed_branch_ids: ['B1'], must_change_password: false };

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
  sessionStorage.setItem('owner_refresh_token', 'R1');
  sessionStorage.setItem('owner_user', JSON.stringify(USER));
  window.location.hash = '#/roles';
  m = mount();
});

afterEach(() => {
  m.unmount();
  sessionStorage.clear();
});

describe('[01b §8] owner session', () => {
  it('[01b §8] SERVICE_UNAVAILABLE shows the cloud-unreachable state, not sign-in', async () => {
    const onLoggedOut = vi.fn();
    const api = createCloudAdmin({ onLoggedOut, fetch: async () => fail(503, 'SERVICE_UNAVAILABLE') });
    await m.render(<App api={api} />);
    expect(api.cloudDown()).toBe(true);
    expect(m.container.textContent).toContain(t('common.cloud_down'));
    expect(m.container.querySelector('input[type="password"]')).toBeNull();
    expect(onLoggedOut).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('owner_access_token')).toBe('A1');
  });

  it('[01b §8] 401 JWT_INVALID then 401 REFRESH_TOKEN_INVALID lands on sign-in once', async () => {
    const onLoggedOut = vi.fn(() => navigate('/login'));
    const refreshes: string[] = [];
    const api = createCloudAdmin({
      onLoggedOut,
      fetch: async (url) => {
        if (url === '/v1/auth/refresh') {
          refreshes.push(url);
          return fail(401, 'REFRESH_TOKEN_INVALID');
        }
        if (url.startsWith('/v1/admin/roles') || url === '/v1/admin/branches') return fail(401, 'JWT_INVALID');
        return ok({});
      },
    });
    await m.render(<App api={api} />);
    await flush();
    expect(onLoggedOut).toHaveBeenCalledTimes(1);
    expect(refreshes).toHaveLength(1);
    expect(window.location.hash).toBe('#/login');
    expect(m.container.querySelector('input[type="password"]')).not.toBeNull();
  });
});
