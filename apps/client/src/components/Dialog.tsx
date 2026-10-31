import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { t } from '../i18n';

// Kit .pos-dialog in a .pos-scrim. Focus moves in on open, Tab stays inside, Escape closes, and focus
// returns to whatever had it before (the trigger) when the dialog goes away.
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// The modal focus rules shared by Dialog and Drawer: focus moves into `box` on mount (its first focusable,
// else the box), Tab and Shift+Tab wrap inside it, Escape calls onClose, and focus goes back to whatever had
// it before (the trigger) on unmount. Put the returned handler on the box's onKeyDown.
export function useModalFocus(box: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = box.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? box.current)?.focus();
    return () => before?.focus();
  }, [box]);

  return (event: KeyboardEvent<HTMLElement>) => {
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
}

export function Dialog({
  title,
  onClose,
  form = true,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  form?: boolean;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onKeyDown = useModalFocus(box, onClose);

  return (
    <div className="pos-scrim">
      <div
        ref={box}
        className={`pos-dialog${form ? ' pos-dialog--form' : ''}`}
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
