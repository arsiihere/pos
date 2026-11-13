import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { DeviceType } from '@pos/domain';
import { readDeviceKey } from '../../api/hub-admin';
import '../../app/ui-kit-staff';
import { initLanguage, language } from '../../i18n';
import { initial } from '../alerts/ui';
import { readPageMeta } from './api';
import { StaffApp } from './StaffApp';
import { PairAgain } from './tables/PairAgain';

// 01d task 41: the /staff/ entry. Not mount() (app/mount.tsx), which loads the 00 kit bundle: this entry loads
// only the Pulse staff layer (app/ui-kit-staff.ts). The device token, id and type come from the pairing store
// (IndexedDB `pos-device` / `device`); the envelope ids and the hub clock from the page the hub serves.

const DEVICE_TYPES: readonly DeviceType[] = ['tablet', 'cashier_kiosk', 'phone', 'kds'];

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function start(): Promise<void> {
  initLanguage({ search: window.location.search, storage: localStorageOrNull(), navigatorLanguage: navigator.language });
  const container = document.getElementById('root');
  if (!container) throw new Error('#root missing');
  const [token, id, type] = await Promise.all([readDeviceKey('token'), readDeviceKey('device_id'), readDeviceKey('device_type')]);
  const meta = readPageMeta();
  const root = createRoot(container);
  if (token === null || id === null || meta === null || !DEVICE_TYPES.includes(type as DeviceType)) {
    // 02a §8 Login (frame 02a-S00): not paired (or the keys were wiped) → "This screen must be paired again" → /pair
    const lang = language();
    root.render(
      <div className="pu v-brand staff" lang={lang} dir={lang === 'ur' ? 'rtl' : 'ltr'} data-theme="light">
        <header className="top">
          {meta !== null && meta.branchName !== '' && (
            <div className="brand">
              <div className="mark" aria-hidden="true">
                {initial(meta.branchName)}
              </div>
              <div>
                <b>{meta.branchName}</b>
              </div>
            </div>
          )}
        </header>
        <PairAgain />
      </div>,
    );
    return;
  }
  root.render(
    <StrictMode>
      <StaffApp device={{ token, id, type: type as DeviceType }} meta={meta} />
    </StrictMode>,
  );
}

void start();
