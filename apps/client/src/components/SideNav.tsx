import { Fragment, type MouseEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

// Kit .pos-sidenav: the side nav on a laptop or tablet, and the same nav as a phone drawer
// (.pos-sidenav--drawer inside a Drawer, spec 01a S50 a v1.3.1).
export interface NavItem {
  href: string;
  icon: IconName;
  label: string;
  count?: number;
  current?: boolean;
  group?: string; // a heading shown before the first item of each group (01b README §9)
}

// S50 c: a guard (a dirty form) can stop a navigation by returning false.
type Guard = (href: string) => boolean;

function guarded(onNavigate: Guard | undefined, href: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (onNavigate !== undefined && !onNavigate(href)) event.preventDefault();
  };
}

// Initials for the brand avatar: the first letter of the first two words ("Arif Chatkhara" → "AC").
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => [...word][0] ?? '')
    .join('')
    .toUpperCase();
}

// The Pulse brand block: an initials avatar, a name and a line under it. Also used in a stand-alone app bar.
export function NavBrand({ title, sub, avatar }: { title: string; sub?: string; avatar?: string }) {
  return (
    <div className="pos-sidenav__brand">
      {avatar !== undefined && (
        <i className="pos-avatar" aria-hidden="true">
          {initials(avatar)}
        </i>
      )}
      <div>
        <strong>{title}</strong>
        {sub !== undefined && <span>{sub}</span>}
      </div>
    </div>
  );
}

export function SideNav({
  label,
  brand,
  items,
  foot,
  onNavigate,
  drawer,
}: {
  label: string;
  brand: { title: string; sub?: string; avatar?: string };
  items: readonly NavItem[];
  foot?: ReactNode;
  onNavigate?: Guard;
  drawer?: { onClose: () => void; closeLabel: string }; // the phone drawer form, with its close button
}) {
  return (
    <nav className={`pos-sidenav${drawer !== undefined ? ' pos-sidenav--drawer' : ''}`} aria-label={label}>
      {drawer !== undefined && (
        <button type="button" className="pos-more pos-drawer__close" aria-label={drawer.closeLabel} onClick={drawer.onClose}>
          <Icon name="x" />
        </button>
      )}
      <NavBrand {...brand} />
      {items.map((item, i) => (
        <Fragment key={item.href}>
          {item.group !== undefined && item.group !== items[i - 1]?.group && (
            <span className="pos-sidenav__group">{item.group}</span>
          )}
          <a
            className="pos-sidenav__item"
            href={item.href}
            aria-current={item.current === true ? 'page' : undefined}
            onClick={guarded(onNavigate, item.href)}
          >
            <Icon name={item.icon} />
            {item.label}
            {item.count !== undefined && (
              <small>
                <span className="pos-ltr">{item.count}</span>
              </small>
            )}
          </a>
        </Fragment>
      ))}
      {foot !== undefined && <div className="pos-sidenav__foot">{foot}</div>}
    </nav>
  );
}
