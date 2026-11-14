import { t } from '../../../i18n';

// 03b v1.0.8 §8 (P5; frame 03b-B12 PassOffline): the socket is down — the warn bar above the Pass; the cards stay and
// every button is off (the screen passes `up = false` down); the socket reconnects by itself and its catch-up refreshes.

export function Offline() {
  return (
    <div className="warnbar" role="status">
      {t('pass.offline')}
      <small>{t('pass.offline_sub')}</small>
    </div>
  );
}

/** PassLoading (03b-S02): before the first catch-up, three skeleton cards (IR-18 classes). */
export function Loading() {
  return (
    <main className="pass">
      <div className="pscroll">
        <div className="pcards">
          {[0, 1, 2].map((i) => (
            <article key={i} className="pc pc--sk" aria-hidden="true">
              <span className="sk sk--pid" />
              <span className="sk sk--pl1" />
              <span className="sk sk--pl2" />
              <span className="sk sk--pbtn" />
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
