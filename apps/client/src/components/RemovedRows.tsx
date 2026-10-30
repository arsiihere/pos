import { t } from '../i18n';
import { Icon } from './Icon';

// 01c-B06: rows removed earlier (archived options or parts) listed under the form with Restore; the restored
// row keeps its id and is saved with the form. Nothing shows when there are none.
export interface RemovedRow {
  id: string;
  label: string;
}

export function RemovedRows({
  rows,
  onRestore,
  disabled = false,
}: {
  rows: readonly RemovedRow[];
  onRestore: (id: string) => void;
  disabled?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="pos-removed" role="group" aria-label={t('removed.title')}>
      <div className="pos-removed__head">{t('removed.title')}</div>
      {rows.map((row) => (
        <div key={row.id} className="pos-removed__row" data-removed-id={row.id}>
          <span>{row.label}</span>
          <button type="button" className="pos-btn" disabled={disabled} onClick={() => onRestore(row.id)}>
            <Icon name="reload" />
            {t('removed.restore')}
          </button>
        </div>
      ))}
    </div>
  );
}
