import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

// Kit .pos-chip. A status tone always shows its icon next to the word (UI kit README); a neutral or
// accent chip is a plain label. With onClick it is a button (B14 chips scroll to their row).
export type ChipTone = 'ok' | 'warn' | 'danger' | 'info' | 'accent';

const TONE_ICON: Partial<Record<ChipTone, IconName>> = { ok: 'check', warn: 'clock', danger: 'alert', info: 'sync' };

export function Chip({
  tone,
  icon,
  onClick,
  children,
}: {
  tone?: ChipTone;
  icon?: IconName;
  onClick?: () => void;
  children: ReactNode;
}) {
  const className = `pos-chip${tone !== undefined ? ` pos-chip--${tone}` : ''}`;
  const shown = icon ?? (tone !== undefined ? TONE_ICON[tone] : undefined);
  const body = (
    <>
      {shown !== undefined && <Icon name={shown} />}
      {children}
    </>
  );
  return onClick !== undefined ? (
    <button type="button" className={className} onClick={onClick}>
      {body}
    </button>
  ) : (
    <span className={className}>{body}</span>
  );
}
