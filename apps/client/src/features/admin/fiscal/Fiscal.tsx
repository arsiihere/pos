import { useState } from 'react';
import { usePhone } from '../../../app/phone';
import { AppBar } from '../../../components/AppBar';
import { t } from '../../../i18n';
import { AdminSignIn } from '../kitchen-screens/KitchenScreens';
import type { FiscalApi } from './api';

// 05 row H-2 (00 v1.12 §8.2; D-3 / PL-12: the existing admin page pattern, no 05 design hand-off): the shell of the
// hub admin "Fiscal" page at /admin/fiscal/. Sign-in and the app bar only; the POS ID list and the write-only token
// fields are task 31a's.
export function FiscalApp({ api }: { api: FiscalApi }) {
  const [signedIn, setSignedIn] = useState(() => api.hasSession());
  if (!signedIn) {
    return <AdminSignIn api={api} title={t('fiscal.title')} chip="fiscal.sign_in" noAdmins="fiscal.no_admins" onLoggedIn={() => setSignedIn(true)} />;
  }
  return <Fiscal />;
}

function Fiscal() {
  const phone = usePhone();
  return (
    <div className="pos-page pos-page--fit">
      <AppBar title={t('fiscal.title')} phone={phone} />
      <main className="pos-content pos-admin__content" />
    </div>
  );
}
