import { useSyncExternalStore } from 'react';
import type { CloudAdmin } from '../../../api/cloud-admin';
import { Icon } from '../../../components/Icon';
import { fill } from '../../../i18n/en';
import { language, t } from '../../../i18n';

// 01b §8 B01, §3.7: after a lock, the next sign-in (or rotating refresh) brings `lockout_notice` once; it
// shows on whatever page is open until "Got it". `{n}` is `failed_count` (design Q14).
// Pulse (hand-off 01b-B01): a danger banner with a lock icon; Change password (→ 01b-S09) and Got it are
// both secondary.
export function LockoutBanner({ api }: { api: CloudAdmin }) {
  const raw = useSyncExternalStore(api.onLockoutNotice, () => JSON.stringify(api.lockoutNotice()));
  const notice = JSON.parse(raw) as ReturnType<CloudAdmin['lockoutNotice']>;
  if (notice === null) return null;
  const locale = language() === 'ur' ? 'ur-PK' : 'en-GB';
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(notice.locked_at);
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(notice.locked_at);
  return (
    <div className="pos-banner pos-banner--danger" role="alert">
      <Icon name="lock" />
      <p>
        {fill(t('account.lock_notice'), { n: String(notice.failed_count), date, time })}
        <small>{t('account.lock_notice_body')}</small>
      </p>
      <div className="pos-banner__action pos-row">
        <a className="pos-btn" href="#/account/password">
          <Icon name="key" />
          {t('owner.nav.change_password')}
        </a>
        <button type="button" className="pos-btn" onClick={() => api.dismissLockoutNotice()}>
          {t('account.lock_got_it')}
        </button>
      </div>
    </div>
  );
}
