import type { MouseEvent, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

// Kit .pos-sidenav (laptop, tablet) and the phone tab bar (.pos-actionbar as a nav), one item list.
export interface NavItem {
  href: string;
  icon: IconName;
  label: string;
  count?: number;
  current?: boolean;
}

// S50 c: a guard (a dirty form) can stop a navigation by returning false.
type Guard = (href: string) => boolean;

function guarded(onNavigate: Guard | undefined, href: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (onNavigate !== undefined && !onNavigate(href)) event.preventDefault();
  };
}

export function SideNav({
  label,
  brand,
  items,
  foot,
  onNavigate,
}: {
  label: string;
  brand: { title: string; sub?: string };
  items: readonly NavItem[];
  foot?: ReactNode;
  onNavigate?: Guard;
}) {
  return (
    <nav className="pos-sidenav" aria-label={label}>
      <div className="pos-sidenav__brand">
        <strong>{brand.title}</strong>
        {brand.sub !== undefined && <span>{brand.sub}</span>}
      </div>
      {items.map((item) => (
        <a
          key={item.href}
          className="pos-sidenav__item"
          href={item.href}
          aria-current={item.current === true ? 'page' : undefined}
          onClick={guarded(onNavigate, item.href)}
        >
          <Icon name={item.icon} />
          {item.label}
          {item.count !== undefined && <small className="pos-ltr">{item.count}</small>}
        </a>
      ))}
      {foot !== undefined && <div className="pos-sidenav__foot">{foot}</div>}
    </nav>
  );
}

export function TabBar({ label, items, onNavigate }: { label: string; items: readonly NavItem[]; onNavigate?: Guard }) {
  return (
    <nav className="pos-actionbar pos-actionbar--tabs" aria-label={label}>
      {items.map((item) => (
        <a
          key={item.href}
          className="pos-sidenav__item"
          href={item.href}
          aria-current={item.current === true ? 'page' : undefined}
          onClick={guarded(onNavigate, item.href)}
        >
          <Icon name={item.icon} />
          {item.label}
        </a>
      ))}
    </nav>
  );
}
