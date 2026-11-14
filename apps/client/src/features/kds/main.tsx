import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../app/ui-kit-kds';
import { initLanguage } from '../../i18n';
import { registerPrintSlots } from '../print/register';
import { KdsApp } from './KdsApp';
import { readKdsPage } from './session';

// 03b v1.0.8 §8 (Q-42), 00 v1.9.2 §8.2: the /kds/ entry. Not mount() (app/mount.tsx): this entry loads the KDS kit
// (app/ui-kit-kds.ts) only. English only in P1 (brief §6.1). The page meta (envelope ids, hub clock) is the one the
// hub serves with /staff/; the app reads the device token itself and calls POST /auth/station.

initLanguage({ search: '?lang=en', storage: null, navigatorLanguage: 'en' });
// IR-15: 03c's printed tag before the first render; KdsApp adds Reprint with the station session's transport
registerPrintSlots();
const container = document.getElementById('root');
if (!container) throw new Error('#root missing');
createRoot(container).render(
  <StrictMode>
    <KdsApp page={readKdsPage()} />
  </StrictMode>,
);
