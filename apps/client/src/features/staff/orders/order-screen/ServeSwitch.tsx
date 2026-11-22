import { t } from '../../../../i18n';
import type { ServeMode } from '../contracts';

// 02b v1.0.21 §8 (STAB-5, owner option C): "Serve: Together / As ready" next to Send. It sets the order's choice for
// every line without its own override (a line override in its edit sheet always wins). `mixed`: the lines' menu
// settings differ and the switch was not set — neither option is pressed.
export function ServeSwitch({ state, onSet }: { state: ServeMode | 'mixed'; onSet(mode: ServeMode): void }) {
  return (
    <div className="serve" role="group" aria-label={t('serve.label')}>
      <span className="serve__l">
        {t('serve.label')}
        {state === 'mixed' && <small> · {t('serve.mixed')}</small>}
      </span>
      <div className="seg">
        <button type="button" className="btn" aria-pressed={state === 'sync'} onClick={() => onSet('sync')}>
          {t('serve.together')}
        </button>
        <button type="button" className="btn" aria-pressed={state === 'immediate'} onClick={() => onSet('immediate')}>
          {t('serve.as_ready')}
        </button>
      </div>
    </div>
  );
}
