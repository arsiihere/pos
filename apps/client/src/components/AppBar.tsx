import type { ReactNode } from 'react';

// Kit .pos-appbar: optional start (a back link), the title, content after it (chips), actions at the end.
export function AppBar({
  title,
  phone = false,
  start,
  after,
  children,
}: {
  title: string;
  phone?: boolean;
  start?: ReactNode;
  after?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className={`pos-appbar${phone ? ' pos-appbar--phone' : ''}`}>
      {start}
      <h1 className="pos-appbar__title">{title}</h1>
      {after}
      {children !== undefined && <div className="pos-appbar__end">{children}</div>}
    </header>
  );
}
