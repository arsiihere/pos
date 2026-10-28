import type { ReactNode } from 'react';

// Kit .pos-actionbar: sticky at the bottom, a status line at the start and the actions at the end.
export function ActionBar({ info, children }: { info?: ReactNode; children?: ReactNode }) {
  return (
    <footer className="pos-actionbar">
      {info !== undefined && <div className="pos-actionbar__info">{info}</div>}
      {children !== undefined && <div className="pos-actionbar__end">{children}</div>}
    </footer>
  );
}
