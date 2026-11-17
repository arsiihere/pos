import { t } from '../../../i18n';
import { errorKey, fill } from '../../../i18n/en';
import type { RowMessage } from './actions';

// 03b §3.2 (K3; frames 03b-B02, 03b-B05): the one inline line on a row after a refused tap. The Done-early confirm
// (B01) is not a line: it replaces the Done button (DoneEarly).

export function InlineError({ msg }: { msg: RowMessage | null }) {
  if (msg === null || msg.kind === 'confirm') return null;
  switch (msg.kind) {
    case 'start_first':
      return (
        <div className="kl__msg c-warn" role="status">
          {t('kds.start_first')}
        </div>
      );
    case 'line':
      return (
        <div className={`kl__msg c-${msg.tone}`} role="status">
          {t(msg.key)}
        </div>
      );
    case 'changed':
      return (
        <div className="kl__msg c-mute" role="status">
          {fill(t('kds.changed'), { stage: t(`kds.changed.${msg.stage}`) })}
        </div>
      );
    case 'code':
      return (
        <div className="kl__msg c-danger" role="status">
          {t(errorKey(msg.code))}
        </div>
      );
  }
}
