import { t } from '../../../i18n';
import { Ico, Ring } from '../../alerts/ui';

// 02a §8 Login (frame 02a-S00 PairAgain, handoff CHANGES §3 "Sign-in"): the hub no longer knows this screen (401
// DEVICE_TOKEN_INVALID / 403 DEVICE_REVOKED from staff-roster, WS close 4403) or the page was never paired. The
// caller has already wiped token / device_id / device_type (hub-admin wipeDeviceKeys); the queue and the drafts are
// not touched ("Unsent orders stay on this screen"). The button goes to the 00 pair page, which after approve sends
// a non-KDS device back to /staff/ (00 v1.9.1 §8.2).

const PAIR_PATH = '/pair';

export function PairAgain({
  go = (path: string) => window.location.assign(path),
  wipe = 'done',
}: {
  go?: (path: string) => void;
  /** the pairing keys are being deleted ('pending'), gone ('done'), or could not be deleted ('failed'): the button waits for 'done' */
  wipe?: 'pending' | 'done' | 'failed';
}) {
  return (
    <main className="body">
      <section className="card empty" aria-labelledby="pair-again-title">
        <Ring size={96} pct={100} tone="warn">
          <Ico name="tablet" className="ico--36" />
        </Ring>
        <b id="pair-again-title">{t('pair.again')}</b>
        <p className="muted">{t('pair.again_sub')}</p>
        {wipe === 'failed' && (
          <p className="msg c-danger" role="alert">
            <Ico name="warn" />
            {t('pair.wipe_failed')}
          </p>
        )}
        <button type="button" className="btn btn--primary btn--lg" disabled={wipe !== 'done'} onClick={() => go(PAIR_PATH)}>
          <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="4" width="6" height="6" rx="1" />
            <rect x="14" y="4" width="6" height="6" rx="1" />
            <rect x="4" y="14" width="6" height="6" rx="1" />
            <path d="M14 14h2v2h-2z" />
            <path d="M18 18h2v2h-2z" />
            <path d="M14 18h2" />
            <path d="M18 14h2" />
          </svg>
          {t('pair.show_code')}
        </button>
      </section>
    </main>
  );
}
