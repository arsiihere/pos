import { t } from '../../../i18n';

// 03b §3.3 (K2; frame 03b-C05): a row whose details have not arrived yet (`kds_lines` follows the plan frame).
export function Placeholder({ off, compact }: { off: boolean; compact: boolean }) {
  return (
    <article className={['kl', 's-ph', compact ? 'kl--c' : null, off ? 's-off' : null].filter(Boolean).join(' ')} aria-label={t('kds.loading')}>
      <div className="kl__top">
        <div className="kl__id">
          <span className="sk sk--kid" />
        </div>
        <span className="sk sk--kring" />
      </div>
      <span className="sk sk--kl1" />
      <span className="sk sk--kl2" />
    </article>
  );
}
