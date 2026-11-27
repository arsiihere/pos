import { t } from '../../../i18n';
import { Ring } from '../../alerts/ui';

// ⚠️ 02b-TK L-CLIENT-2 item 1 (03b v1.0.16 §3.10 "Pass archive (D7)", §6.16 (run 3 R3-M-1); D7): the hub's
// `point_view_refresh { view: null }` — a Pass archive retired this tablet's point. One full-screen state in place of
// the cards: no cards, no station strip, no actions (nothing on the removed point can be sent). The next catch-up
// (the tablet set to another point) brings the Pass back. Drawn with the PassEmpty panel classes (IR-18).

export function PointRetired() {
  return (
    <main className="pass">
      <div className="empty empty--pass" role="alert" data-retired="">
        <Ring size={96} pct={null} tone="danger">
          <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3l9.5 17h-19z" />
            <path d="M12 10v4.5" />
            <path d="M12 17.5v.01" />
          </svg>
        </Ring>
        <b>{t('pass.point_retired')}</b>
      </div>
    </main>
  );
}
