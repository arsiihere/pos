import { useRef, type ReactNode } from 'react';
import { useModalFocus } from './Dialog';

// A side drawer over the page (kit .pos-scrim + .pos-sidenav--drawer, spec 01a S50 a v1.3.1): a modal
// dialog with the kit Dialog's focus rules (focus moves in, Tab stays inside, Escape closes, focus returns
// to the trigger). A tap on the scrim closes it too. The child is the drawer panel, e.g.
// <SideNav drawer={{ onClose, closeLabel }} …/>; the caller unmounts the Drawer to close it.
export function Drawer({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const onKeyDown = useModalFocus(box, onClose);
  return (
    <div className="pos-drawer-layer">
      <div className="pos-scrim" aria-hidden="true" onClick={onClose} />
      <div ref={box} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>
  );
}
