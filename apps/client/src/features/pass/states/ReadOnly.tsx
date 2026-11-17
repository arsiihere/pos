import { t } from '../../../i18n';

// 03b v1.0.8 §3.9 (P5; frame 03b-B14 PassReadOnly): signed in without `run-pass` — one info line; the cards stay, no
// action is drawn (the screen passes `canRun = false` down).

export function ReadOnly() {
  return (
    <div className="ro" role="status">
      <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5" />
        <path d="M12 8v.01" />
      </svg>
      <span>{t('pass.read_only')}</span>
    </div>
  );
}
