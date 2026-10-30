import { useId, useRef } from 'react';
import { fill } from '../i18n/en';
import { t } from '../i18n';
import { useModalFocus } from './Dialog';
import { Icon, type IconName } from './Icon';

// 01c-D04 "In use" (409 CONFIG_IN_USE): "{name} can't be archived yet", one line saying what to do, then
// each user (used_by.ids named from the lists already loaded) with Open; Close is the one primary. Ids the
// page could not name show as "and N more"; with no body the generic text shows.
export interface InUseRow {
  name: string;
  href?: string;
}

export function InUseDialog({
  name,
  body,
  rows,
  unnamed = 0,
  icon = 'list',
  onClose,
  onOpen,
}: {
  name: string;
  body?: string;
  rows: readonly InUseRow[];
  unnamed?: number;
  icon?: IconName;
  onClose: () => void;
  // Called before an Open link navigates (e.g. to close the dialog first).
  onOpen?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onKeyDown = useModalFocus(box, onClose);
  return (
    <div className="pos-scrim">
      <div
        ref={box}
        className="pos-dialog pos-dialog--form"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-in-use=""
      >
        <h2 className="pos-dialog__title" id={titleId}>
          {fill(t('in_use.title'), { name })}
        </h2>
        <p className="pos-dialog__body">{body ?? t('errors.CONFIG_IN_USE')}</p>
        {rows.map((row, i) => (
          <div key={`${row.name}-${i}`} className="pos-removed__row pos-inuse__row">
            <span>
              <Icon name={icon} /> {row.name}
            </span>
            {row.href !== undefined && (
              <a className="pos-btn" href={row.href} onClick={onOpen}>
                {t('in_use.open')}
              </a>
            )}
          </div>
        ))}
        {unnamed > 0 && <p className="pos-note">{fill(t('archive.and_more'), { n: String(unnamed) })}</p>}
        <div className="pos-dialog__footer">
          <button type="button" className="pos-btn pos-btn--primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
