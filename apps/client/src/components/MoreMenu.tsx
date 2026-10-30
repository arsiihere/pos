import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from './Icon';

// The Pulse "⋯" More menu (kit .pos-more + .pos-menu; 01a hand-off CHANGES §2): a 56 px button with
// aria-haspopup="menu" that opens a menu with an optional info head and its items. Destructive items are
// `danger` (.pos-menu__item--danger) and should open the existing confirm. The menu closes on Escape, on a
// tap outside it and after a pick; focus goes back to the ⋯ button. Arrow keys move between items.
//
// It renders the button and the menu side by side: the kit places .pos-menu against the nearest positioned
// parent (.pos-appbar, .pos-section, .pos-list__row.has-menu), on the end side, which is the start of the
// screen in RTL. `up` opens it above the button (.pos-menu--up).
export interface MoreMenuItem {
  label: string;
  onSelect: () => void;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
}

export function MoreMenu({
  label,
  info,
  items,
  up = false,
}: {
  label: string; // the button's and the menu's accessible name, e.g. "More for Paye"
  info?: { title: string; detail?: string };
  items: readonly MoreMenuItem[];
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('.pos-menu__item:not([disabled])')?.focus();
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target !== null && (menu.current?.contains(target) || button.current?.contains(target))) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const enabled = [...(menu.current?.querySelectorAll<HTMLButtonElement>('.pos-menu__item:not([disabled])') ?? [])];
    if (enabled.length === 0) return;
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? enabled.length - 1
          : (at + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
    enabled[next]?.focus();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="pos-more"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          className={`pos-menu${up ? ' pos-menu--up' : ''}`}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
        >
          {info !== undefined && (
            <div className="pos-menu__info">
              <b>{info.title}</b>
              {info.detail !== undefined && <span>{info.detail}</span>}
            </div>
          )}
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`pos-menu__item${item.danger === true ? ' pos-menu__item--danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
            >
              {item.icon !== undefined && <Icon name={item.icon} />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
