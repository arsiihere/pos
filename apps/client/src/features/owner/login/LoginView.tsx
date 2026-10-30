import { useState, type FormEvent } from 'react';
import type { CloudAdmin, CloudError, OwnerUser } from '../../../api/cloud-admin';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { errorKey } from '../../../i18n/en';
import { t } from '../../../i18n';

// §8.1 #/login (01a-S01): email + password → /v1/auth/login; tokens in sessionStorage (cloud-admin).
// An empty field is marked before anything is sent. When the cloud can't be reached the banner says so,
// the values stay and Sign in stays enabled: there is no token to probe with (S53).
function loginError(error: CloudError): { tone: 'danger' | 'warn'; text: string; detail?: string; icon?: 'wifi' } {
  if (error.kind === 'network')
    return { tone: 'warn', icon: 'wifi', text: t('owner.login.cloud_down'), detail: t('owner.login.cloud_down_body') };
  if (error.kind === 'api' && error.code === 'LOGIN_INVALID') {
    return { tone: 'danger', text: t('errors.LOGIN_INVALID'), detail: t('owner.login.invalid_body') };
  }
  return { tone: 'danger', text: t(error.kind === 'api' ? errorKey(error.code) : 'errors.UNKNOWN') };
}

export function LoginView({ api, onLoggedIn }: { api: CloudAdmin; onLoggedIn: (user: OwnerUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<{ email: boolean; password: boolean }>({ email: false, password: false });
  const [error, setError] = useState<ReturnType<typeof loginError> | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const empty = { email: email.trim() === '', password: password === '' };
    setMissing(empty);
    if (empty.email || empty.password) return;
    setBusy(true);
    setError(null);
    const result = await api.login(email.trim(), password);
    setBusy(false);
    if (result.ok) onLoggedIn(result.data);
    else setError(loginError(result.error));
  }

  return (
    <div className="pos-page">
      <div className="pos-login">
        <aside className="pos-login__aside">
          <div className="pos-login__mark">
            <i aria-hidden="true">{[...t('owner.login.brand')][0]}</i>
            <strong>{t('owner.login.brand')}</strong>
          </div>
          <div className="pos-login__lead">
            <Headline text={t('owner.login.headline')} />
            <p>{t('owner.login.line')}</p>
          </div>
          <small>{t('owner.login.caption')}</small>
        </aside>
        <main className="pos-login__main">
          <form className="pos-stack pos-login__form" noValidate onSubmit={(e) => void submit(e)}>
            <div className="pos-section__head">
              <h2>{t('owner.login.title')}</h2>
              <p>{t('owner.login.body')}</p>
            </div>
            <label className={`pos-field${missing.email ? ' pos-field--error' : ''}`}>
              <span className="pos-field__label">{t('owner.login.email')}</span>
              <input
                className="pos-input pos-ltr"
                type="email"
                autoComplete="username"
                value={email}
                aria-invalid={missing.email ? true : undefined}
                onChange={(e) => setEmail(e.target.value)}
              />
              {missing.email && <span className="pos-field__error">{t('owner.login.need_email')}</span>}
            </label>
            <label className={`pos-field${missing.password ? ' pos-field--error' : ''}`}>
              <span className="pos-field__label">{t('owner.login.password')}</span>
              <span className="pos-input-affix">
                <input
                  className="pos-input"
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  aria-invalid={missing.password ? true : undefined}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <span>
                  <button type="button" className="pos-btn" aria-pressed={show} onClick={() => setShow(!show)}>
                    {t(show ? 'owner.login.hide' : 'owner.login.show')}
                  </button>
                </span>
              </span>
              {missing.password && <span className="pos-field__error">{t('owner.login.need_password')}</span>}
            </label>
            <BusyButton busy={busy} primary size="lg block" type="submit">
              {t(busy ? 'owner.login.signing_in' : 'owner.login.submit')}
            </BusyButton>
            {error !== null && <Banner tone={error.tone} icon={error.icon} text={error.text} detail={error.detail} />}
          </form>
        </main>
      </div>
    </div>
  );
}

// The aside headline: its second sentence in the brand primary (01a hand-off CHANGES §2, S01).
function Headline({ text }: { text: string }) {
  const parts = /^(.+?[.۔])\s+(.+)$/u.exec(text);
  if (parts === null) return <h1>{text}</h1>;
  return (
    <h1>
      {parts[1]} <em>{parts[2]}</em>
    </h1>
  );
}
