import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { t } from '../i18n';

// Kit .pos-dialog in a .pos-scrim. Focus moves in on open, Tab stays inside, Escape closes, and focus
// returns to whatever had it before (the trigger) when the dialog goes away.
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// `variant: 'nav'` is the phone owner nav (01b P-4 B): the same focus rules, laid out as a drawer.
export function Dialog({
  title,
  onClose,
  form = true,
  variant,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  form?: boolean;
  variant?: 'nav';
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = box.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? box.current)?.focus();
    return () => before?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || box.current === null) return;
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items.at(-1);
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={`pos-scrim${variant === 'nav' ? ' pos-overlay--nav' : ''}`}>
      <div
        ref={box}
        className={`pos-dialog${form ? ' pos-dialog--form' : ''}${variant === 'nav' ? ' pos-dialog--nav' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h2 className="pos-dialog__title" id={titleId}>
          {title}
        </h2>
        {children}
        {footer !== undefined && <div className="pos-dialog__footer">{footer}</div>}
      </div>
    </div>
  );
}

// D01: the confirm button names the thing ("Archive Paye"); Cancel comes first and sends nothing.
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  tone = 'primary',
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="pos-btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className={`pos-btn pos-btn--${tone}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="pos-dialog__body">{body}</p>
    </Dialog>
  );
}
