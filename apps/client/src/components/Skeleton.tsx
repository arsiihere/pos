import { t } from '../i18n';

// Kit .pos-skeleton lines while a list loads; the kit stops the pulse under prefers-reduced-motion.
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="pos-stack" role="status" aria-busy="true" aria-label={t('common.loading')}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="pos-skeleton" />
      ))}
    </div>
  );
}
