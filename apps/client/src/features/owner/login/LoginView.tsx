import { useState, type FormEvent } from 'react';
import type { CloudAdmin, CloudError, OwnerUser } from '../../../api/cloud-admin';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { errorKey } from '../../../i18n/en';
import { t } from '../../../i18n';

// §8.1 #/login: email + password → /v1/auth/login; tokens in sessionStorage (cloud-admin).
function loginErrorText(error: CloudError): string {
  if (error.kind === 'api') return t(errorKey(error.code));
  return t(error.kind === 'network' ? 'errors.network' : 'errors.UNKNOWN');
}

export function LoginView({ api, onLoggedIn }: { api: CloudAdmin; onLoggedIn: (user: OwnerUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await api.login(email.trim(), password);
    setBusy(false);
    if (result.ok) onLoggedIn(result.data);
    else setError(loginErrorText(result.error));
  }

  return (
    <form className="pos-stack" noValidate onSubmit={(e) => void submit(e)}>
      <h1 className="title">{t('owner.login.title')}</h1>
      <label className="pos-field">
        <span className="pos-field__label">{t('owner.login.email')}</span>
        <input
          className="pos-input"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="pos-field">
        <span className="pos-field__label">{t('owner.login.password')}</span>
        <input
          className="pos-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error !== null && <Banner tone="danger" text={error} />}
      <BusyButton busy={busy} primary type="submit">
        {t('owner.login.submit')}
      </BusyButton>
    </form>
  );
}
