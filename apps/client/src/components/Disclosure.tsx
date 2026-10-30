import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

// The Pulse disclosure (kit .pos-disclosure / .pos-group__toggle): a 56 px+ button with aria-expanded that
// shows a rare section in place. `row` is the one-line row "Advanced · Never allow · Nothing blocked." (01b
// staff form); `group` is a role-editor permission group with its count summary under the name.
// `inPlace` (row only): once open, the section replaces the row, as drawn on StaffFormImran, and focus moves
// into it. Enter or Space toggles (native button); Escape inside an open group closes it and refocuses the toggle.
export function Disclosure({
  variant = 'row',
  title,
  summary,
  icon,
  defaultOpen = false,
  inPlace = false,
  children,
}: {
  variant?: 'row' | 'group';
  title: string;
  summary?: string;
  icon?: IconName;
  defaultOpen?: boolean;
  inPlace?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [opened, setOpened] = useState(false);
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const region = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (opened && inPlace) region.current?.querySelector<HTMLElement>('button, a[href], input, select, textarea')?.focus();
  }, [opened, inPlace]);

  const onToggle = () => {
    setOpen(!open);
    setOpened(!open);
  };

  if (variant === 'group') {
    return (
      <section className="pos-group">
        <button ref={toggle} type="button" className="pos-group__toggle" aria-expanded={open} aria-controls={open ? id : undefined} onClick={onToggle}>
          <span className="pos-group__name">
            {title}
            {summary !== undefined && <small>{summary}</small>}
          </span>
          <Icon name="chevron" />
        </button>
        {open && (
          <div
            id={id}
            className="pos-group__body"
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || event.defaultPrevented) return;
              setOpen(false);
              toggle.current?.focus();
            }}
          >
            {children}
          </div>
        )}
      </section>
    );
  }

  if (open && inPlace) {
    return (
      <div id={id} ref={region} className="pos-disclosure__body">
        {children}
      </div>
    );
  }
  return (
    <>
      <button ref={toggle} type="button" className="pos-disclosure" aria-expanded={open} aria-controls={open ? id : undefined} onClick={onToggle}>
        {icon !== undefined && <Icon name={icon} />}
        <span>
          {title}
          {summary !== undefined && <small> · {summary}</small>}
        </span>
        <Icon name="chevron" />
      </button>
      {open && (
        <div id={id} ref={region} className="pos-disclosure__body">
          {children}
        </div>
      )}
    </>
  );
}
