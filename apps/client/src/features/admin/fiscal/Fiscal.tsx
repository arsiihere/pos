import { useEffect, useState, type FormEvent } from 'react';
import { usePhone } from '../../../app/phone';
import { newUlid } from '../../../app/ulid';
import { AppBar } from '../../../components/AppBar';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import { shortDate } from '../../owner/staff/people';
import type { HubError } from '../kitchen-screens/api';
import { AdminSignIn, errorText } from '../kitchen-screens/KitchenScreens';
import type { FiscalApi, FiscalCredential } from './api';

// 05 row H-2 (00 v1.12 §8.2; D-3 / PL-12: the existing admin page pattern, no 05 design hand-off), §6.28a, §6.28b
// (R-63), B22: the hub admin "Fiscal" page at /admin/fiscal/. One row per (pos_id, credential name) from the
// fiscal-credentials read, "Set on <date>" / "Not set", and a write-only field that sends SetFiscalToken. The field is
// never pre-filled; its value is dropped from state the moment Save is pressed (before the answer), so the token stays
// in no input, state, storage or retry key after submit. Each Save is a new command_id: the hub omits the token from
// payload_hash (row H-4), so reusing an id with a new token would replay the earlier answer and drop the new token.
export function FiscalApp({ api }: { api: FiscalApi }) {
  const [signedIn, setSignedIn] = useState(() => api.hasSession());
  if (!signedIn) {
    return <AdminSignIn api={api} title={t('fiscal.title')} chip="fiscal.sign_in" noAdmins="fiscal.no_admins" onLoggedIn={() => setSignedIn(true)} />;
  }
  return <Fiscal api={api} />;
}

const keyOf = (c: { pos_id: string; name: string }) => `${c.pos_id}:${c.name}`;

function Fiscal({ api }: { api: FiscalApi }) {
  const phone = usePhone();
  const [list, setList] = useState<FiscalCredential[] | null>(null);
  const [loadError, setLoadError] = useState<HubError | null>(null);

  useEffect(() => {
    let live = true;
    // Q-54: read once on open; a Save updates its row from the command result
    void api.credentials().then((answer) => {
      if (!live) return;
      if (answer.ok) setList(answer.data.credentials);
      else setLoadError(answer.error);
    });
    return () => {
      live = false;
    };
  }, [api]);

  const onSet = (pos_id: string, name: string, set_at: number) =>
    setList((current) => (current === null ? current : current.map((c) => (c.pos_id === pos_id && c.name === name ? { ...c, set_at } : c))));

  return (
    <div className="pos-page pos-page--fit">
      <AppBar title={t('fiscal.title')} phone={phone} />
      <main className="pos-content pos-admin__content">
        <section className="ad-stack">
          <div className="ad-sec__h">
            <div>
              <h2>{t('fiscal.credentials_title')}</h2>
              <p>{t('fiscal.credentials_help')}</p>
            </div>
          </div>
          {loadError !== null && (
            <p className="pos-field__error" role="alert">
              {t('fiscal.load_failed')} {errorText(loadError)}
            </p>
          )}
          {list !== null && list.length === 0 && <p>{t('fiscal.none')}</p>}
          {list !== null && list.length > 0 && (
            <div className="pos-list pos-list--out">
              <div className="pos-list__head">
                <span>{t('fiscal.col.pos')}</span>
                <span>{t('fiscal.col.credential')}</span>
              </div>
              {list.map((c) => (
                <CredentialRow key={keyOf(c)} credential={c} api={api} onSet={onSet} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function CredentialRow({
  credential,
  api,
  onSet,
}: {
  credential: FiscalCredential;
  api: FiscalApi;
  onSet: (pos_id: string, name: string, set_at: number) => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { pos_id, name, label, set_at } = credential;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (value === '' || busy) return;
    const token = value;
    setValue(''); // B22: the token leaves page state before the request goes out
    setProblem(null);
    setSaved(false);
    setBusy(true);
    const answer = await api.setToken({ pos_id, name, token }, newUlid());
    setBusy(false);
    if (answer.ok) {
      onSet(pos_id, name, answer.data.set_at);
      setSaved(true);
    } else {
      setProblem(errorText(answer.error));
    }
  };

  return (
    <form className="pos-list__row" data-credential={keyOf(credential)} onSubmit={(e) => void submit(e)}>
      <span className="pos-list__name">
        <strong>{fill(t('fiscal.pos_label'), { label, pos_id })}</strong>
        <span>{set_at === null ? t('fiscal.not_set') : fill(t('fiscal.set_on'), { date: shortDate(set_at) })}</span>
      </span>
      <label className="pos-field">
        <span className="pos-field__label">{name}</span>
        <input
          className="pos-input"
          type="password"
          autoComplete="off"
          aria-label={fill(t('fiscal.new_value'), { name })}
          maxLength={512}
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
        />
        {problem !== null && (
          <span className="pos-field__error" role="alert">
            {problem}
          </span>
        )}
        {saved && problem === null && <span>{t('fiscal.saved')}</span>}
      </label>
      <button type="submit" className="pos-btn" disabled={busy || value === ''}>
        {t('fiscal.save')}
      </button>
    </form>
  );
}
