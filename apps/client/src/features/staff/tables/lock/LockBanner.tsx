import { useState } from 'react';
import { t, type MessageKey } from '../../../../i18n';
import { en, fill } from '../../../../i18n/en';
import { Ring } from '../../../alerts/ui';
import type { LockBannerProps, LockBannerState } from '../contracts';

// 02a §8 Banners (handoff 02a-B10): the warn banner at the top end of the order screen, sticky, one tinted
// Keep as draft; the draft is never dropped. The force-move notice to the new holder is an info banner with OK
// (dismissed here). Q-18: a reason is `<token>` or `<token>: <note>`; a known token is shown localised, other text raw.

export function reasonText(reason: string): string {
  const cut = reason.indexOf(':');
  const token = (cut < 0 ? reason : reason.slice(0, cut)).trim();
  const key = `tables.reason.${token}`;
  if (!(key in en)) return reason;
  const label = t(key as MessageKey);
  const note = cut < 0 ? '' : reason.slice(cut + 1).trim();
  return note === '' ? label : `${label}: ${note}`;
}

function texts(state: LockBannerState): { title: string; det: string } {
  switch (state.kind) {
    case 'released_by': {
      const title = state.by_name === null ? fill(t('lock.released'), { table: state.table }) : fill(t('lock.released_by'), { table: state.table, name: state.by_name });
      const kept = t('lock.kept');
      return { title, det: state.reason === null || state.reason === '' ? kept : `“${reasonText(state.reason)}” · ${kept}` };
    }
    case 'released_ttl':
      return { title: fill(t('lock.released_ttl'), { table: state.table, n: String(state.minutes) }), det: t('lock.kept_ttl') };
    case 'other_device':
      return { title: t('lock.other_device'), det: t('lock.kept_other_device') };
    case 'holder_changed': {
      const name = state.holder_name ?? t('lock.someone');
      return { title: fill(t('lock.holder_changed'), { name }), det: state.can_send ? fill(t('lock.holder_changed_can_send'), { name }) : t('lock.kept_hold') };
    }
    case 'force_moved_to_me':
      return { title: fill(t('forcemove.notice_receiver'), { table: state.table }), det: '' };
  }
}

export const LockBanner = ({ state, onKeepDraft }: LockBannerProps) => {
  // a new state (another object) shows again
  const [dismissed, setDismissed] = useState<LockBannerState | null>(null);
  if (state === null || dismissed === state) return null;
  const { title, det } = texts(state);
  const info = state.kind === 'force_moved_to_me';
  const tone = info ? 'info' : 'warn';
  return (
    <div className="abns">
      <div className={`abn c-${tone}${info ? ' abn--info' : ''}`} role="alert">
        <Ring size={56} pct={null} tone={tone} />
        <div className="ac__body">
          <div className="ac__title">
            {state.table !== '' && (
              <span className="tcode tcode--sm" dir="ltr">
                {state.table}
              </span>
            )}
            <b>{title}</b>
          </div>
          {det !== '' && <div className="ac__det">{det}</div>}
        </div>
        {info ? (
          <button type="button" className="btn btn--tone c-info" onClick={() => setDismissed(state)}>
            {t('lock.ok')}
          </button>
        ) : (
          <button type="button" className="btn btn--tone c-warn" onClick={onKeepDraft}>
            {t('lock.keep_draft')}
          </button>
        )}
      </div>
    </div>
  );
};
