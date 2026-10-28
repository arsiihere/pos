import { useState } from 'react';
import type { CloudAdmin } from '../../../api/cloud-admin';
import { withSupport } from '../../../app/support';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { fill } from '../../../i18n/en';
import { t, typeClass } from '../../../i18n';
import { useCloudDown } from '../cloud';
import { errorText } from '../form';
import { Page } from '../Shell';

// 01b §8 #/account/password (01b-S09, B05, §6.11): current (or temporary) password, the new one twice.
// Short and different are checked before sending; PASSWORD_INVALID and PASSWORD_UNCHANGED are field
// errors. The passwords leave the form after every request. Forced (after a support reset) it is the only
// view. The caption names the support number only when VITE_SUPPORT_PHONE is set (Q3).
type FieldErrors = { current?: string; next?: string; again?: string };

export function ChangePassword({
  api,
  userName,
  forced,
  onChanged,
}: {
  api: CloudAdmin;
  userName: string;
  forced: boolean;
  onChanged: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<{ tone: 'ok' | 'warn' | 'danger'; text: string; detail?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const down = useCloudDown(api);

  async function submit() {
    const found: FieldErrors = {};
    if (current === '') found.current = t('account.current_required');
    if (next.length < 10) found.next = t('account.too_short');
    if (again !== next) found.again = t('account.mismatch');
    setErrors(found);
    const labels = [found.current && t('account.current'), found.next && t('account.new'), found.again && t('account.again')].filter(
      (x): x is string => typeof x === 'string',
    );
    if (labels.length > 0) {
      setBanner({
        tone: 'danger',
        text: labels.length === 1 ? t('staff.fix_one') : fill(t('staff.fix_count'), { n: String(labels.length) }),
        detail: labels.join(' · '),
      });
      return;
    }
    setBusy(true);
    setBanner(null);
    const result = await api.changePassword({ current_password: current, new_password: next });
    setBusy(false);
    setCurrent('');
    setNext('');
    setAgain('');
    if (result.ok) {
      setBanner({ tone: 'ok', text: t('account.saved'), detail: t('account.saved_body') });
      onChanged();
      return;
    }
    const error = result.error;
    if (error.kind === 'network') {
      setBanner({ tone: 'warn', text: t('common.cloud_down'), detail: t('account.offline_body') });
    } else if (error.kind === 'api' && error.code === 'PASSWORD_INVALID') {
      setErrors({ current: t('account.wrong_current') });
    } else if (error.kind === 'api' && error.code === 'PASSWORD_UNCHANGED') {
      setErrors({ next: t('account.unchanged') });
    } else if (error.kind === 'api' && error.status === 429) {
      setBanner({ tone: 'danger', text: t('account.too_many'), detail: t('account.nothing_changed') });
    } else {
      setBanner({ tone: 'danger', text: errorText(error) ?? '' });
    }
  }

  const field = (
    name: string,
    label: string,
    value: string,
    set: (v: string) => void,
    error: string | undefined,
    autoComplete: string,
    extra?: { help?: string; toggle?: boolean },
  ) => {
    const input = (
      <input
        className="pos-input"
        type={show && extra?.toggle !== undefined ? 'text' : 'password'}
        name={name}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    );
    return (
      <label className={`pos-field${error !== undefined ? ' pos-field--error' : ''}`}>
        <span className="pos-field__label">{label}</span>
        {extra?.toggle === true ? (
          <span className="pos-input-affix">
            {input}
            <span>
              <button className="pos-btn" type="button" onClick={() => setShow(!show)}>
                {show ? t('account.hide') : t('account.show')}
              </button>
            </span>
          </span>
        ) : (
          input
        )}
        {error !== undefined ? (
          <span className="pos-field__error">{error}</span>
        ) : (
          extra?.help !== undefined && <span className="pos-field__help">{extra.help}</span>
        )}
      </label>
    );
  };

  return (
    <Page api={api} title={t('account.title')} narrow>
      {forced && <Banner tone="info" text={t('account.forced')} detail={t('account.forced_body')} />}
      {banner !== null && <Banner tone={banner.tone} text={banner.text} detail={banner.detail} />}
      <section className="pos-card">
        <div className="pos-section__head">
          <h2>{t('account.heading')}</h2>
          <p>{fill(t('account.for'), { name: userName })}</p>
        </div>
        {field('current_password', t(forced ? 'account.temporary' : 'account.current'), current, setCurrent, errors.current, 'current-password')}
        {field('new_password', t('account.new'), next, setNext, errors.next, 'new-password', { help: t('account.new_help'), toggle: true })}
        {field('new_password_again', t('account.again'), again, setAgain, errors.again, 'new-password', { toggle: false })}
        <div className="pos-explain">
          <span>{t('account.explain')}</span>
        </div>
        <BusyButton primary busy={busy} disabled={down} onClick={() => void submit()}>
          {t('account.submit')}
        </BusyButton>
      </section>
      {!forced && <p className={typeClass('caption')}>{withSupport(t('account.forgot'))}</p>}
    </Page>
  );
}
