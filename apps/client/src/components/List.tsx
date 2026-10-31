import type { ReactNode } from 'react';

// Kit .pos-list with its column presets; rows are grid rows the caller fills.
export type ListPreset = 'menu' | 'menuphone' | 'cats' | 'tax' | 'rows' | 'stock' | 'stack';

export function List({
  preset,
  head,
  busy = false,
  children,
}: {
  preset?: ListPreset;
  head?: readonly ReactNode[];
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <ul className={`pos-list${preset !== undefined ? ` pos-list--${preset}` : ''}`} aria-busy={busy ? true : undefined}>
      {head !== undefined && (
        <li className="pos-list__head">
          {head.map((cell, i) => (
            <span key={i}>{cell}</span>
          ))}
        </li>
      )}
      {children}
    </ul>
  );
}

export function ListRow({
  touched = false,
  muted = false,
  id,
  attrs,
  className,
  children,
}: {
  // An extra row class, e.g. pos-list__row--group / --size (01c menu nesting).
  className?: string;
  touched?: boolean;
  muted?: boolean;
  id?: string;
  // data-* hooks and tabIndex for a row a chip can focus (B14).
  attrs?: Record<`data-${string}`, string> & { tabIndex?: number };
  children: ReactNode;
}) {
  return (
    <li id={id} {...attrs} className={`pos-list__row${className === undefined ? '' : ` ${className}`}${touched ? ' is-touched' : ''}${muted ? ' is-muted' : ''}`}>
      {children}
    </li>
  );
}
