import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

// 01d v1.3.3 §3.13.6a (DL Q-K (c); cs14 review, integrator ruling): a real popup (.scrim at z-index 30) opened from
// a route sheet must not sit inside the sheet's wrapper, which is its own stacking context at 10, under the banners
// (20). Every popup frame renders through this portal into the shell root `.pu.staff`, as AnswerSheet already sits
// there, so it lands in the page's one stacking context above the banners. Outside the staff shell (a component on
// its own in a test, another entry) there is no `.pu.staff`: the popup renders where it is, as before.
export function PopupLayer({ children }: { children: ReactNode }) {
  const root = typeof document === 'undefined' ? null : document.querySelector('.pu.staff');
  return root === null ? <>{children}</> : createPortal(children, root);
}
