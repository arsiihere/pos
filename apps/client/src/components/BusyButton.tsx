import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { Banner } from './Banner';

// §8.1: a busy button keeps its place with `is-busy`; a call still running after 3 s adds a warn banner.
export const SLOW_AFTER_MS = 3_000;

export function BusyButton({
  busy,
  onClick,
  children,
  primary = false,
  type = 'button',
}: {
  busy: boolean;
  onClick?: () => void;
  children: ReactNode;
  primary?: boolean;
  type?: 'button' | 'submit';
}) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [busy]);

  return (
    <>
      <button
        type={type}
        className={`pos-btn${primary ? ' pos-btn--primary' : ''}${busy ? ' is-busy' : ''}`}
        disabled={busy}
        aria-busy={busy ? true : undefined}
        onClick={onClick}
      >
        {children}
      </button>
      {busy && slow && <Banner tone="warn" text={t('common.slow')} />}
    </>
  );
}
