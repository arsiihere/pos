import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { initLanguage } from '../i18n';
import './ui-kit';

// Entry bootstrap shared by every entry's main.tsx (S35 a).
export function mount(app: ReactNode): void {
  initLanguage({ search: window.location.search, storage: localStorageOrNull(), navigatorLanguage: navigator.language });
  const container = document.getElementById('root');
  if (!container) throw new Error('#root missing');
  createRoot(container).render(<StrictMode>{app}</StrictMode>);
}

// Reading window.localStorage itself throws where site data is blocked (S49: the page works without it).
function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
