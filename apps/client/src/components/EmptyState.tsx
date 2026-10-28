import type { ReactNode } from 'react';

// Kit .pos-empty: what is missing, why, and the way forward.
export function EmptyState({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="pos-empty">
      <h3>{title}</h3>
      {body !== undefined && <p>{body}</p>}
      {children}
    </div>
  );
}
