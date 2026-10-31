import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

// Kit .pos-empty: what is missing, why, and the way forward. `card` sets it on a raised card with its icon
// (Pulse frames, e.g. OwnerMenuNoMatch).
export function EmptyState({
  title,
  body,
  icon,
  card = false,
  children,
}: {
  title: string;
  body?: string;
  icon?: IconName;
  card?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={card ? 'pos-empty pos-card' : 'pos-empty'}>
      {icon !== undefined && <Icon name={icon} />}
      <h3>{title}</h3>
      {body !== undefined && <p>{body}</p>}
      {children}
    </div>
  );
}
