import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { DialogFrame } from './TableBusy';

// 02a §3.7, §6.6 (02a-D22 TakeOver): the assignee takes the table from its holder. The sheet sends
// `TakeOverTable` (it does not lock) and then `OpenTable`; the old holder's unsent order stays on his screen.

export interface TakeOverProps {
  code: string;
  /** the current holder */
  name: string;
  busy: boolean;
  onClose(): void;
  onConfirm(): void;
}

export function TakeOver({ code, name, busy, onClose, onConfirm }: TakeOverProps) {
  return (
    <DialogFrame code={code} title={fill(t('takeover.title'), { table: code, name })} onClose={onClose}>
      <p className="dlg__line">{fill(t('takeover.line'), { name })}</p>
      <div className="acts">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={onConfirm}>
          {t('takeover.go')}
        </button>
      </div>
    </DialogFrame>
  );
}
