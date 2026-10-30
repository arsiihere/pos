import { fill } from '../i18n/en';
import { t } from '../i18n';
import { Icon } from './Icon';

// 01c-B01: one danger summary banner over the inline field and row errors, never one banner per error.
// Each entry links to its field (`target` is the field's element id); a link moves focus there.
export interface FixEntry {
  target: string;
  label: string;
}

export function ErrorSummary({ entries }: { entries: readonly FixEntry[] }) {
  if (entries.length === 0) return null;
  const text = entries.length === 1 ? t('fix.one') : fill(t('fix.count'), { n: String(entries.length) });
  return (
    <div className="pos-banner pos-banner--danger" role="alert" data-fix-summary="">
      <Icon name="alert" />
      <p>
        {text}
        <small>
          {entries.map((entry, i) => (
            <span key={`${entry.target}-${i}`}>
              {i > 0 && ' · '}
              <a
                href={`#${entry.target}`}
                onClick={(event) => {
                  event.preventDefault();
                  const el = document.getElementById(entry.target);
                  el?.scrollIntoView?.({ block: 'center' });
                  (el?.matches('input, select, textarea, button') ? el : el?.querySelector<HTMLElement>('input, select, textarea, button'))?.focus();
                }}
              >
                {entry.label}
              </a>
            </span>
          ))}
        </small>
      </p>
    </div>
  );
}
