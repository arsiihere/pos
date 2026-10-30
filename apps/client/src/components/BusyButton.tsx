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
  disabled = false,
  type = 'button',
  form,
  size,
}: {
  busy: boolean;
  onClick?: () => void;
  children: ReactNode;
  primary?: boolean;
  // S53: also disabled while the cloud is unreachable.
  disabled?: boolean;
  type?: 'button' | 'submit';
  // A submit button outside its form (the item form's app bar).
  form?: string;
  // Kit size modifiers, e.g. 'lg block' → pos-btn--lg pos-btn--block (the owner sign-in button).
  size?: 'lg' | 'lg block';
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
        form={form}
        className={`pos-btn${primary ? ' pos-btn--primary' : ''}${size === undefined ? '' : size.split(' ').map((m) => ` pos-btn--${m}`).join('')}${busy ? ' is-busy' : ''}`}
        disabled={busy || disabled}
        aria-busy={busy ? true : undefined}
        onClick={onClick}
      >
        {children}
      </button>
      {busy && slow && <Banner tone="warn" text={t('common.slow')} />}
    </>
  );
}
