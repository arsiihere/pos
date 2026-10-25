import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui-kit';

// Entry bootstrap shared by every entry's main.tsx (S35 a).
export function mount(app: ReactNode): void {
  const container = document.getElementById('root');
  if (!container) throw new Error('#root missing');
  createRoot(container).render(<StrictMode>{app}</StrictMode>);
}
