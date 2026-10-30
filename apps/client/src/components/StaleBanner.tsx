import { t } from '../i18n';
import { Icon } from './Icon';

// 01c-B03 "Changed elsewhere" (01c §8 "Versions"; Q8): a 409 CONFIG_STALE keeps the draft editable and
// copyable until Reload; nothing is retried. On a form Reload is the layer's one primary (the page Save is
// disabled while it shows); inside an "At each branch" row (`row`) it is row-styled and only that row reloads.
export function StaleBanner({ onReload, row = false }: { onReload: () => void; row?: boolean }) {
  return (
    <div className="pos-banner pos-banner--warn" role="status" data-stale="">
      <Icon name="reload" />
      <p>
        {t('stale.title')}
        <small>{t('stale.body')}</small>
      </p>
      <div className="pos-banner__action pos-row">
        <button type="button" className={`pos-btn ${row ? 'pos-btn--row' : 'pos-btn--primary'}`} onClick={onReload}>
          <Icon name="reload" />
          {t('stale.reload')}
        </button>
      </div>
    </div>
  );
}
