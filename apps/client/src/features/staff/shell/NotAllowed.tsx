import { t } from '../../../i18n';
import { Ico } from '../../alerts/ui';

// BUG-18 (05a §3.6 O-16: a screen is hidden when the person holds none of its permissions; no read-only screens): a
// route the signed-in person may not use on this device (typed, a bookmark, a link left from someone else) says so,
// with the way to the person's own first screen — never an empty screen, a skeleton or the inbox in its place.
export function NotAllowed({ onHome }: { onHome: () => void }) {
  return (
    <main className="body" data-not-allowed="">
      <div className="card col" role="alert">
        <b>
          <Ico name="lock" /> {t('shell.not_allowed.title')}
        </b>
        <p className="muted">{t('shell.not_allowed.body')}</p>
        <button type="button" className="btn btn--lg" onClick={onHome}>
          <Ico name="back" />
          {t('shell.not_allowed.home')}
        </button>
      </div>
    </main>
  );
}
