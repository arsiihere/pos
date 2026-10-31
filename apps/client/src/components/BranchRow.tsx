import { useId, useState, type ReactNode } from 'react';
import { fill } from '../i18n/en';
import { t } from '../i18n';
import { Banner } from './Banner';
import { Icon } from './Icon';
import { StaleBanner } from './StaleBanner';

// 01c "At each branch" row (Q15; kit .pos-brow): collapsed to the branch name and its state chips; the toggle
// shows the controls. The row's own Save (.pos-btn--row, never a second filled primary) shows only while the
// row has unsaved changes, and saves only this row with its own version. A stale answer (01c-B03) or an error
// shows inside this row only, and keeps the row open.
export function BranchRow({
  name,
  chips,
  dirty,
  busy = false,
  disabled = false,
  stale = false,
  error,
  defaultOpen = false,
  onSave,
  onReload,
  children,
}: {
  name: string;
  chips: ReactNode;
  dirty: boolean;
  busy?: boolean;
  // e.g. while the cloud is down; the Save stays visible but cannot be pressed.
  disabled?: boolean;
  stale?: boolean;
  error?: string;
  defaultOpen?: boolean;
  onSave: () => void;
  onReload: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const shown = open || stale || error !== undefined;
  return (
    <div className={`pos-brow${dirty ? ' is-dirty' : ''}`} data-branch-row={name}>
      <div className="pos-brow__head">
        <div className="pos-brow__name">
          <strong>{name}</strong>
          <div className="pos-chips">{chips}</div>
        </div>
        {dirty && !stale && (
          <button
            type="button"
            className={`pos-btn pos-btn--row${busy ? ' is-busy' : ''}`}
            aria-label={fill(t('brow.save_for'), { branch: name })}
            aria-busy={busy ? true : undefined}
            disabled={busy || disabled}
            onClick={onSave}
          >
            {t('brow.save')}
          </button>
        )}
        <button
          type="button"
          className="pos-brow__toggle"
          aria-expanded={shown}
          aria-controls={shown ? bodyId : undefined}
          aria-label={name}
          onClick={() => setOpen(!shown)}
        >
          <Icon name="chevron" />
        </button>
      </div>
      {shown && (
        <div className="pos-brow__body" id={bodyId}>
          {stale && <StaleBanner row onReload={onReload} />}
          {error !== undefined && <Banner tone="danger" text={error} />}
          {children}
        </div>
      )}
    </div>
  );
}
